/**
 * Vanilla JS `sed` Implementation with VFS & Async Shell Support
 */

// ==========================================
// 1. Regex Utilities
// ==========================================

const POSIX_CLASSES = new Map([["alnum", "a-zA-Z0-9"],["alpha", "a-zA-Z"],["ascii", "\\x00-\\x7F"], ["blank", " \\t"],["cntrl", "\\x00-\\x1F\\x7F"], ["digit", "0-9"],["graph", "!-~"],["lower", "a-z"], ["print", " -~"],["punct", "!-/:-@\\[-`{-~"],["space", " \\t\\n\\r\\f\\v"], ["upper", "A-Z"],["word", "a-zA-Z0-9_"],["xdigit", "0-9A-Fa-f"]
]);

// The VFS is a plain object keyed by filename, supplied by the caller. Using
// bare `vfs[name]` / `name in vfs` is unsafe for filenames like "__proto__",
// "constructor", or "toString": `in` and property reads walk the prototype
// chain, so a file that was never set can appear to "exist" (returning
// Object.prototype itself), and a plain assignment to `vfs.__proto__` is
// silently ignored rather than creating a real entry. These helpers restrict
// every VFS access to the object's *own* properties so any filename behaves
// consistently and predictably.
function vfsHas(vfs, key) {
  return vfs != null && Object.prototype.hasOwnProperty.call(vfs, key);
}
function vfsGet(vfs, key) {
  return vfsHas(vfs, key) ? vfs[key] : undefined;
}
function vfsSet(vfs, key, value) {
  Object.defineProperty(vfs, key, { value, writable: true, enumerable: true, configurable: true });
}

// ==========================================
// FS Adapter
// ==========================================
//
// Normalizes several backend "shapes" behind one async interface so the
// rest of the engine never has to branch on what was passed in:
//
//   - a plain object, e.g. { "file.txt": "contents" }        (today's `vfs`)
//   - an fs/promises-style module: { readFile, writeFile, ... } returning
//     Promises (covers require('fs/promises'), memfs's `fs.promises`,
//     a Volume's `.promises`, or any custom async shim with that shape)
//   - a Node-`fs`-module-like object with a nested `.promises` (covers
//     require('fs') itself, and memfs's default `fs` export)
//   - a sync-only fs-like object: { readFileSync, writeFileSync, ... }
//     (covers a bare memfs Volume instance, or a custom sync shim)
//
// `options.fs` is the preferred option key; `options.vfs` is kept as a
// permanent alias for backward compatibility (both, if somehow both
// given, `fs` wins).

function detectFsAdapterKind(fsOption) {
  if (fsOption == null) return "json";
  if (fsOption.promises && typeof fsOption.promises.readFile === "function" && typeof fsOption.promises.writeFile === "function") {
    return "node-like"; // require('fs'), memfs's `fs` export
  }
  if (typeof fsOption.readFile === "function" && typeof fsOption.writeFile === "function") {
    return "promises"; // require('fs/promises'), memfs's fs.promises, Volume#promises
  }
  if (typeof fsOption.readFileSync === "function" && typeof fsOption.writeFileSync === "function") {
    return "sync"; // a bare memfs Volume, or a custom sync-only shim
  }
  return "json";
}

// Creates a normalized async adapter. Every method returns a Promise
// regardless of backend kind, so callers just `await` uniformly.
function createFsAdapter(options) {
  const provided = options.fs !== undefined ? options.fs : options.vfs;
  const onEvent = typeof options.onFsEvent === "function" ? options.onFsEvent : null;
  const mutate = options.mutateVfs !== false; // default true: preserves the historical `vfs` mutation behavior
  const kind = detectFsAdapterKind(provided);

  function emit(type, filename, extra) {
    if (!onEvent) return;
    try { onEvent({ type, filename, ...extra }); } catch { /* a listener's own error must never break sed */ }
  }

  if (kind === "json") {
    let store = provided || {};
    if (!mutate) {
      // Clone into a fresh object rather than touching the caller's
      // object, so writes made during this run never leak back into
      // whatever object they passed in. vfsSet is used for the copy too,
      // so the clone is exactly as prototype-pollution-safe as the source.
      const clone = {};
      if (provided) {
        for (const key of Object.keys(provided)) {
          if (Object.prototype.hasOwnProperty.call(provided, key)) vfsSet(clone, key, provided[key]);
        }
      }
      store = clone;
    }
    return {
      kind: "json",
      supportsSnapshot: true,
      async has(name) {
        const r = vfsHas(store, name);
        if (!r) emit("missing", name);
        return r;
      },
      async get(name) {
        const r = vfsGet(store, name);
        emit("read", name, { found: r !== undefined });
        return r;
      },
      async set(name, value) {
        vfsSet(store, name, value);
        emit("write", name, { size: value.length });
      },
      async snapshot() {
        const out = {};
        for (const key of Object.keys(store)) {
          if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
        }
        return out;
      },
    };
  }

  // Real-fs-like backends: filenames are passed straight through to the
  // underlying implementation, exactly as a shell would hand sed a path.
  // Relative-path resolution is the backend's own responsibility (Node's
  // fs and memfs both resolve relative to process.cwd() the same way).
  const readFile = kind === "sync"
    ? (name) => Promise.resolve().then(() => provided.readFileSync(name, "utf8"))
    : kind === "node-like"
      ? (name) => provided.promises.readFile(name, "utf8")
      : (name) => provided.readFile(name, "utf8");

  const writeFile = kind === "sync"
    ? (name, content) => Promise.resolve().then(() => { provided.writeFileSync(name, content, "utf8"); })
    : kind === "node-like"
      ? (name, content) => provided.promises.writeFile(name, content, "utf8")
      : (name, content) => provided.writeFile(name, content, "utf8");

  async function has(name) {
    if (kind === "sync" && typeof provided.existsSync === "function") {
      const r = provided.existsSync(name);
      if (!r) emit("missing", name);
      return r;
    }
    if (kind === "node-like" && provided.promises && typeof provided.promises.access === "function") {
      try { await provided.promises.access(name); return true; }
      catch { emit("missing", name); return false; }
    }
    try { await readFile(name); return true; }
    catch { emit("missing", name); return false; }
  }

  return {
    kind,
    // Only memfs-style Volumes expose toJSON(); real OS fs has no
    // well-defined "whole filesystem as JSON" concept, so snapshot()
    // returns null there rather than pretending to support it.
    supportsSnapshot: typeof provided.toJSON === "function",
    has,
    async get(name) {
      try {
        const content = await readFile(name);
        emit("read", name, { found: true });
        return content;
      } catch {
        emit("read", name, { found: false });
        return undefined;
      }
    },
    async set(name, value) {
      await writeFile(name, value);
      emit("write", name, { size: value.length });
    },
    async snapshot() {
      if (typeof provided.toJSON === "function") return provided.toJSON();
      return null;
    },
  };
}

function sedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function breToEre(pattern, posix = false) {
  let result = ""; let i = 0; let inBracket = false;
  while (i < pattern.length) {
    if (pattern[i] === "[" && !inBracket) {
      if (pattern.slice(i, i + 3) === "[[:") {
        const closeIdx = pattern.indexOf(":]]", i + 3);
        if (closeIdx !== -1) {
          const className = pattern.slice(i + 3, closeIdx);
          const jsClass = POSIX_CLASSES.get(className);
          if (jsClass) { result += `[${jsClass}]`; i = closeIdx + 3; continue; }
        }
      }
      if (pattern.slice(i, i + 4) === "[^[:") {
        const closeIdx = pattern.indexOf(":]]", i + 4);
        if (closeIdx !== -1) {
          const className = pattern.slice(i + 4, closeIdx);
          const jsClass = POSIX_CLASSES.get(className);
          if (jsClass) { result += `[^${jsClass}]`; i = closeIdx + 3; continue; }
        }
      }
      result += "["; i++; inBracket = true;
      if (i < pattern.length && pattern[i] === "^") { result += "^"; i++; }
      if (i < pattern.length && pattern[i] === "]") { result += "\\]"; i++; }
      continue;
    }
    if (inBracket) {
      if (pattern[i] === "]") { result += "]"; i++; inBracket = false; continue; }
      if (pattern[i] === "[" && pattern[i + 1] === ":") {
        const closeIdx = pattern.indexOf(":]", i + 2);
        if (closeIdx !== -1) {
          const className = pattern.slice(i + 2, closeIdx);
          const jsClass = POSIX_CLASSES.get(className);
          if (jsClass) { result += jsClass; i = closeIdx + 2; continue; }
        }
      }
      if (pattern[i] === "\\" && i + 1 < pattern.length) { result += pattern[i] + pattern[i + 1]; i += 2; continue; }
      result += pattern[i]; i++; continue;
    }
    if (pattern[i] === "\\") {
      if (i + 1 < pattern.length) {
        const next = pattern[i + 1];
        // \( \) \{ \} are core POSIX BRE grouping/intervals -- always convert.
        if (["(", ")", "{", "}"].includes(next)) { result += next; i += 2; continue; }
        // \+ \? \| are GNU BRE extensions (quantifier/alternation without
        // full ERE). Under posix they have no special meaning and reduce to
        // the literal character instead.
        if (["+", "?", "|"].includes(next)) {
          if (posix) { result += `\\${next}`; i += 2; continue; }
          result += next; i += 2; continue;
        }
        // \< \> (GNU word-boundary anchors) map to \b in GNU mode; under
        // posix they're just literal angle brackets.
        if (next === "<" || next === ">") {
          if (!posix) { result += "\\b"; i += 2; continue; }
          result += next; i += 2; continue;
        }
        if (next === "t") { result += "\t"; i += 2; continue; }
        if (next === "n") { result += "\n"; i += 2; continue; }
        if (next === "r") { result += "\r"; i += 2; continue; }
        // \b \B \w \W \s \S are GNU character-class/boundary shortcuts that
        // happen to already match JS regex syntax in GNU mode; under posix
        // they degrade to the literal letter.
        if (posix && ["b", "B", "w", "W", "s", "S"].includes(next)) { result += next; i += 2; continue; }
        result += pattern[i] + next; i += 2; continue;
      }
    }
    if (["+", "?", "|", "(", ")"].includes(pattern[i])) { result += `\\${pattern[i]}`; i++; continue; }
    if (pattern[i] === "^") { if (result !== "" && !result.endsWith("(")) { result += "\\^"; i++; continue; } }
    if (pattern[i] === "$") {
      const isEnd = i === pattern.length - 1;
      const beforeGroupClose = i + 2 < pattern.length && pattern[i + 1] === "\\" && pattern[i + 2] === ")";
      if (!isEnd && !beforeGroupClose) { result += "\\$"; i++; continue; }
    }
    result += pattern[i]; i++;
  }
  return result;
}

function normalizeForJs(pattern) {
  let result = ""; let inBracket = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "[" && !inBracket) {
      inBracket = true; result += "["; i++;
      if (i < pattern.length && pattern[i] === "^") { result += "^"; i++; }
      if (i < pattern.length && pattern[i] === "]") { result += "]"; i++; }
      i--;
    } else if (pattern[i] === "]" && inBracket) { inBracket = false; result += "]"; }
    else if (!inBracket && pattern[i] === "{" && pattern[i + 1] === ",") { result += "{0,"; i++; }
    else { result += pattern[i]; }
  }
  return result;
}

function escapeForList(input, width = 70) {
  const tokens = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]; const code = ch.charCodeAt(0);
    if (ch === "\\") tokens.push("\\\\");
    else if (ch === "\t") tokens.push("\\t");
    else if (ch === "\n") tokens.push("\\n");
    else if (ch === "\r") tokens.push("\\r");
    else if (ch === "\x07") tokens.push("\\a");
    else if (ch === "\b") tokens.push("\\b");
    else if (ch === "\f") tokens.push("\\f");
    else if (ch === "\v") tokens.push("\\v");
    else if (code < 32 || code >= 127) tokens.push(`\\${code.toString(8).padStart(3, "0")}`);
    else tokens.push(ch);
  }
  // GNU sed wraps `l` output at 70 columns by default: each wrapped line
  // holds up to 69 characters of the escaped text plus a continuation "\",
  // and the final line ends with the "$" terminator. Multi-character escape
  // sequences (e.g. "\\", "\t", octal codes) are never split across the
  // wrap boundary -- if a token doesn't fully fit, it's deferred whole to
  // the next line.
  let wrapped = ""; let lineLen = 0;
  for (const tok of tokens) {
    if (width > 0 && lineLen + tok.length > width - 1) { wrapped += "\\\n"; lineLen = 0; }
    wrapped += tok; lineLen += tok.length;
  }
  wrapped += "$";
  return wrapped;
}

// ==========================================
// 2. Lexer
// ==========================================

const SedTokenType = {
  NUMBER: "NUMBER", DOLLAR: "DOLLAR", PATTERN: "PATTERN", STEP: "STEP",
  RELATIVE_OFFSET: "RELATIVE_OFFSET", LBRACE: "LBRACE", RBRACE: "RBRACE",
  SEMICOLON: "SEMICOLON", NEWLINE: "NEWLINE", COMMA: "COMMA", NEGATION: "NEGATION",
  COMMAND: "COMMAND", SUBSTITUTE: "SUBSTITUTE", TRANSLITERATE: "TRANSLITERATE",
  LABEL_DEF: "LABEL_DEF", BRANCH: "BRANCH", BRANCH_ON_SUBST: "BRANCH_ON_SUBST",
  BRANCH_ON_NO_SUBST: "BRANCH_ON_NO_SUBST", TEXT_CMD: "TEXT_CMD",
  FILE_READ: "FILE_READ", FILE_READ_LINE: "FILE_READ_LINE", FILE_WRITE: "FILE_WRITE",
  FILE_WRITE_LINE: "FILE_WRITE_LINE", EXECUTE: "EXECUTE", VERSION: "VERSION",
  EOF: "EOF", ERROR: "ERROR"
};

class SedLexer {
  constructor(input, posix = false) { this.input = input; this.pos = 0; this.line = 1; this.column = 1; this.posix = posix; }
  tokenize() {
    const tokens =[];
    while (this.pos < this.input.length) { const token = this.nextToken(); if (token) tokens.push(token); }
    tokens.push(this.makeToken(SedTokenType.EOF, "")); return tokens;
  }
  makeToken(type, value, extra) { return { type, value, line: this.line, column: this.column, ...extra }; }
  peek(offset = 0) { return this.input[this.pos + offset] || ""; }
  advance() { const ch = this.input[this.pos++] || ""; if (ch === "\n") { this.line++; this.column = 1; } else { this.column++; } return ch; }
  readEscapedString(delimiter) {
    let result = "";
    while (this.pos < this.input.length && this.peek() !== delimiter) {
      if (this.peek() === "\\") {
        this.advance(); const escaped = this.advance();
        if (escaped === "n") result += "\n"; else if (escaped === "t") result += "\t"; else result += escaped;
      } else if (this.peek() === "\n") { return null; } else { result += this.advance(); }
    }
    return result;
  }
  skipWhitespace() {
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r") { this.advance(); }
      else if (ch === "#") { while (this.pos < this.input.length && this.peek() !== "\n") this.advance(); }
      else { break; }
    }
  }
  nextToken() {
    this.skipWhitespace();
    if (this.pos >= this.input.length) return null;
    const startLine = this.line; const startColumn = this.column; const ch = this.peek();
    if (ch === "\n") { this.advance(); return { type: SedTokenType.NEWLINE, value: "\n", line: startLine, column: startColumn }; }
    if (ch === ";") { this.advance(); return { type: SedTokenType.SEMICOLON, value: ";", line: startLine, column: startColumn }; }
    if (ch === "{") { this.advance(); return { type: SedTokenType.LBRACE, value: "{", line: startLine, column: startColumn }; }
    if (ch === "}") { this.advance(); return { type: SedTokenType.RBRACE, value: "}", line: startLine, column: startColumn }; }
    if (ch === ",") { this.advance(); return { type: SedTokenType.COMMA, value: ",", line: startLine, column: startColumn }; }
    if (ch === "!") { this.advance(); return { type: SedTokenType.NEGATION, value: "!", line: startLine, column: startColumn }; }
    if (ch === "$") { this.advance(); return { type: SedTokenType.DOLLAR, value: "$", line: startLine, column: startColumn }; }
    if (this.isDigit(ch)) return this.readNumber();
    if (ch === "+" && !this.posix && this.isDigit(this.input[this.pos + 1] || "")) return this.readRelativeOffset();
    if (ch === "/") return this.readPattern();
    if (ch === ":") return this.readLabelDef();
    return this.readCommand();
  }
  readNumber() {
    const startLine = this.line; const startColumn = this.column; let numStr = "";
    while (this.isDigit(this.peek())) numStr += this.advance();
    if (this.peek() === "~" && !this.posix) {
      this.advance(); let stepStr = ""; while (this.isDigit(this.peek())) stepStr += this.advance();
      return { type: SedTokenType.STEP, value: `${numStr}~${stepStr}`, first: parseInt(numStr, 10), step: parseInt(stepStr, 10) || 0, line: startLine, column: startColumn };
    }
    return { type: SedTokenType.NUMBER, value: parseInt(numStr, 10), line: startLine, column: startColumn };
  }
  readRelativeOffset() {
    const startLine = this.line; const startColumn = this.column; this.advance(); let numStr = "";
    while (this.isDigit(this.peek())) numStr += this.advance();
    const offset = parseInt(numStr, 10) || 0; return { type: SedTokenType.RELATIVE_OFFSET, value: `+${offset}`, offset, line: startLine, column: startColumn };
  }
  readPattern() {
    const startLine = this.line; const startColumn = this.column; this.advance();
    let pattern = ""; let inBracket = false;
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === "/" && !inBracket) break;
      if (ch === "\\") { pattern += this.advance(); if (this.pos < this.input.length && this.peek() !== "\n") pattern += this.advance(); }
      else if (ch === "\n") { break; }
      else if (ch === "[" && !inBracket) { inBracket = true; pattern += this.advance(); if (this.peek() === "^") pattern += this.advance(); if (this.peek() === "]") pattern += this.advance(); }
      else if (ch === "]" && inBracket) { inBracket = false; pattern += this.advance(); }
      else { pattern += this.advance(); }
    }
    if (this.peek() === "/") this.advance();
    let flags = "";
    while (!this.posix && (this.peek() === "I" || this.peek() === "M" || this.peek() === "m")) flags += this.advance();
    return { type: SedTokenType.PATTERN, value: pattern, pattern, ignoreCase: flags.includes("I"), multiline: /[Mm]/.test(flags), line: startLine, column: startColumn };
  }
  readLabelDef() {
    const startLine = this.line; const startColumn = this.column; this.advance();
    while (this.peek() === " " || this.peek() === "\t") this.advance();
    let label = "";
    while (this.pos < this.input.length) { const ch = this.peek(); if ([" ", "\t", "\n", ";", "}", "{"].includes(ch)) break; label += this.advance(); }
    return { type: SedTokenType.LABEL_DEF, value: label, label, line: startLine, column: startColumn };
  }
  readCommand() {
    const startLine = this.line; const startColumn = this.column; const ch = this.advance();
    const gnuOnly = () => ({ type: SedTokenType.ERROR, value: ch, line: startLine, column: startColumn });
    if (this.posix && "TRWeFzvQ".includes(ch)) return gnuOnly();
    switch (ch) {
      case "s": return this.readSubstitute(startLine, startColumn);
      case "y": return this.readTransliterate(startLine, startColumn);
      case "a": case "i": case "c": return this.readTextCommand(ch, startLine, startColumn);
      case "b": return this.readBranch(SedTokenType.BRANCH, "b", startLine, startColumn);
      case "t": return this.readBranch(SedTokenType.BRANCH_ON_SUBST, "t", startLine, startColumn);
      case "T": return this.readBranch(SedTokenType.BRANCH_ON_NO_SUBST, "T", startLine, startColumn);
      case "r": return this.readFileCommand(SedTokenType.FILE_READ, "r", startLine, startColumn);
      case "R": return this.readFileCommand(SedTokenType.FILE_READ_LINE, "R", startLine, startColumn);
      case "w": return this.readFileCommand(SedTokenType.FILE_WRITE, "w", startLine, startColumn);
      case "W": return this.readFileCommand(SedTokenType.FILE_WRITE_LINE, "W", startLine, startColumn);
      case "e": return this.readExecute(startLine, startColumn);
      case "p": case "P": case "d": case "D": case "h": case "H": case "g": case "G": case "x": case "n": case "N": case "q": case "Q": case "z": case "=": case "l": case "F":
        return this.readSimpleCommand(ch, startLine, startColumn);
      case "v": return this.readVersion(startLine, startColumn);
      default: return { type: SedTokenType.ERROR, value: ch, line: startLine, column: startColumn };
    }
  }
  readSimpleCommand(ch, startLine, startColumn) {
    // q, Q, and l accept an optional trailing numeric argument (exit code /
    // line-wrap width); everything else must be followed only by
    // whitespace and a terminator (newline, ;, }, comment, or EOF).
    while (this.peek() === " " || this.peek() === "\t") this.advance();
    let numArg;
    if ("qQl".includes(ch)) {
      let numStr = "";
      while (this.isDigit(this.peek())) numStr += this.advance();
      if (numStr !== "") numArg = parseInt(numStr, 10);
      while (this.peek() === " " || this.peek() === "\t") this.advance();
    }
    const next = this.peek();
    if (next !== "" && next !== "\n" && next !== ";" && next !== "}" && next !== "#") {
      return { type: SedTokenType.ERROR, value: "extra characters after command", isMessage: true, line: startLine, column: startColumn };
    }
    return { type: SedTokenType.COMMAND, value: ch, numArg, line: startLine, column: startColumn };
  }
  readSubstitute(startLine, startColumn) {
    const delimiter = this.advance();
    if (!delimiter || delimiter === "\n") return { type: SedTokenType.ERROR, value: "unterminated `s' command", isMessage: true, line: startLine, column: startColumn };
    
    let pattern = ""; let inBracket = false;
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === delimiter && !inBracket) break;
      if (ch === "\\") {
        this.advance();
        if (this.pos < this.input.length && this.peek() !== "\n") { 
          const escaped = this.peek(); 
          if (escaped === delimiter && !inBracket) pattern += this.advance(); 
          else { pattern += "\\"; pattern += this.advance(); } 
        }
        else { pattern += "\\"; }
      }
      else if (ch === "\n") { break; }
      else if (ch === "[" && !inBracket) { inBracket = true; pattern += this.advance(); if (this.peek() === "^") pattern += this.advance(); if (this.peek() === "]") pattern += this.advance(); }
      else if (ch === "]" && inBracket) { inBracket = false; pattern += this.advance(); }
      else { pattern += this.advance(); }
    }
    
    if (this.peek() !== delimiter) return { type: SedTokenType.ERROR, value: "unterminated `s' command", isMessage: true, line: startLine, column: startColumn };
    this.advance();
    
    let replacement = "";
    while (this.pos < this.input.length && this.peek() !== delimiter) {
      if (this.peek() === "\\") {
        this.advance();
        if (this.pos < this.input.length) {
          const next = this.peek();
          if (next === "\\") { this.advance(); if (this.pos < this.input.length && this.peek() === "\n") { replacement += "\n"; this.advance(); } else { replacement += "\\"; } }
          else if (next === "\n") { replacement += "\n"; this.advance(); } else { replacement += `\\${this.advance()}`; }
        } else { replacement += "\\"; }
      } else if (this.peek() === "\n") { break; } else { replacement += this.advance(); }
    }
    
    if (this.peek() !== delimiter) return { type: SedTokenType.ERROR, value: "unterminated `s' command", isMessage: true, line: startLine, column: startColumn };
    this.advance();
    
    let flags = "";
    const allowedFlags = this.posix ? ["g", "p"] : ["g", "i", "p", "I", "e", "M", "m"];
    while (this.pos < this.input.length) { 
      const ch = this.peek(); 
      if (allowedFlags.includes(ch) || this.isDigit(ch)) flags += this.advance(); 
      else break; 
    }

    // Optional trailing `w filename` flag (POSIX): consumes the rest of the
    // line as the filename, same as the standalone `w` command.
    let writeFilename;
    {
      const savedPos = this.pos;
      while (this.peek() === " " || this.peek() === "\t") this.advance();
      if (this.peek() === "w") {
        this.advance();
        while (this.peek() === " " || this.peek() === "\t") this.advance();
        let filename = "";
        while (this.pos < this.input.length && this.peek() !== "\n") filename += this.advance();
        writeFilename = filename.trim();
      } else {
        this.pos = savedPos;
      }
    }

    if (writeFilename === undefined) {
      while (this.peek() === " " || this.peek() === "\t") this.advance();
      const next = this.peek();
      if (next !== "" && next !== "\n" && next !== ";" && next !== "}" && next !== "#") {
        return { type: SedTokenType.ERROR, value: "unknown option to `s'", isMessage: true, line: startLine, column: startColumn };
      }
    }
    
    let nthOccurrence;
    const numMatch = flags.match(/(\d+)/); 
    if (numMatch) nthOccurrence = parseInt(numMatch[1], 10);
    
    return {
      type: SedTokenType.SUBSTITUTE, 
      value: `s${delimiter}${pattern}${delimiter}${replacement}${delimiter}${flags}`,
      pattern: pattern || "", 
      replacement: replacement || "", 
      flags,
      global: flags.includes("g"), // Fix: Removed "I" flag from forcing a global replacement
      ignoreCase: flags.includes("i") || flags.includes("I"),
      multiline: /[Mm]/.test(flags),
      printOnMatch: flags.includes("p"), 
      executeShell: flags.includes("e"), 
      nthOccurrence,
      writeFilename,
      line: startLine, 
      column: startColumn
    };
  }
  readTransliterate(startLine, startColumn) {
    const delimiter = this.advance();
    if (!delimiter || delimiter === "\n") return { type: SedTokenType.ERROR, value: "unterminated `y' command", isMessage: true, line: startLine, column: startColumn };
    const source = this.readEscapedString(delimiter);
    if (source === null || this.peek() !== delimiter) return { type: SedTokenType.ERROR, value: "unterminated `y' command", isMessage: true, line: startLine, column: startColumn };
    this.advance();
    const dest = this.readEscapedString(delimiter);
    if (dest === null || this.peek() !== delimiter) return { type: SedTokenType.ERROR, value: "unterminated `y' command", isMessage: true, line: startLine, column: startColumn };
    this.advance();
    let nextChar = this.peek();
    while (nextChar === " " || nextChar === "\t") { this.advance(); nextChar = this.peek(); }
    if (nextChar !== "" && nextChar !== ";" && nextChar !== "\n" && nextChar !== "}") return { type: SedTokenType.ERROR, value: "extra characters after command", isMessage: true, line: startLine, column: startColumn };
    return { type: SedTokenType.TRANSLITERATE, value: `y${delimiter}${source}${delimiter}${dest}${delimiter}`, source, dest, line: startLine, column: startColumn };
  }
  readTextCommand(cmd, startLine, startColumn) {
    let hasBackslash = false;
    if (this.peek() === "\\" && this.pos + 1 < this.input.length &&["\n", " ", "\t"].includes(this.input[this.pos + 1])) { hasBackslash = true; this.advance(); }
    if (this.peek() === " " || this.peek() === "\t") this.advance();
    if (this.peek() === "\\" && this.pos + 1 < this.input.length && [" ", "\t"].includes(this.input[this.pos + 1])) this.advance();
    if (hasBackslash && this.peek() === "\n") this.advance();
    let text = "";
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === "\n") break;
      if (ch === "\\") {
        if (this.pos + 1 < this.input.length) {
          const next = this.input[this.pos + 1];
          if (next === "\n") { text += "\n"; this.advance(); this.advance(); continue; }
          if (next === "n") { text += "\n"; this.advance(); this.advance(); continue; }
          if (next === "t") { text += "\t"; this.advance(); this.advance(); continue; }
          if (next === "r") { text += "\r"; this.advance(); this.advance(); continue; }
          if (next === "a") { text += "\x07"; this.advance(); this.advance(); continue; }
          if (next === "f") { text += "\f"; this.advance(); this.advance(); continue; }
          if (next === "v") { text += "\v"; this.advance(); this.advance(); continue; }
          // Any other backslash-escaped character in a/i/c text just yields
          // that character literally -- the backslash is stripped.
          text += next; this.advance(); this.advance(); continue;
        } else {
          text += this.advance(); continue;
        }
      }
      text += this.advance();
    }
    return { type: SedTokenType.TEXT_CMD, value: cmd, text, hasBackslash, line: startLine, column: startColumn };
  }
  readBranch(type, cmd, startLine, startColumn) {
    while (this.peek() === " " || this.peek() === "\t") this.advance();
    let label = ""; while (this.pos < this.input.length) { const ch = this.peek(); if ([" ", "\t", "\n", ";", "}", "{"].includes(ch)) break; label += this.advance(); }
    return { type, value: cmd, label: label || undefined, line: startLine, column: startColumn };
  }
  readVersion(startLine, startColumn) {
    while (this.peek() === " " || this.peek() === "\t") this.advance();
    let version = ""; while (this.pos < this.input.length) { const ch = this.peek(); if ([" ", "\t", "\n", ";", "}", "{"].includes(ch)) break; version += this.advance(); }
    return { type: SedTokenType.VERSION, value: "v", label: version || undefined, line: startLine, column: startColumn };
  }
  readFileCommand(type, cmd, startLine, startColumn) {
    while (this.peek() === " " || this.peek() === "\t") this.advance();
    let filename = ""; while (this.pos < this.input.length) { const ch = this.peek(); if (ch === "\n" || ch === ";") break; filename += this.advance(); }
    return { type, value: cmd, filename: filename.trim(), line: startLine, column: startColumn };
  }
  readExecute(startLine, startColumn) {
    while (this.peek() === " " || this.peek() === "\t") this.advance();
    let command = ""; while (this.pos < this.input.length) { const ch = this.peek(); if (ch === "\n" || ch === ";") break; command += this.advance(); }
    return { type: SedTokenType.EXECUTE, value: "e", command: command.trim() || undefined, line: startLine, column: startColumn };
  }
  isDigit(ch) { return ch >= "0" && ch <= "9"; }
}

// ==========================================
// 3. Parser
// ==========================================

class SedParser {
  static nextRangeId = 1;
  constructor(scripts, extendedRegex = false, posix = false) { this.scripts = scripts; this.extendedRegex = extendedRegex; this.posix = posix; this.tokens =[]; this.pos = 0; }
  parse() {
    const allCommands =[];
    for (const script of this.scripts) {
      const lexer = new SedLexer(script, this.posix); this.tokens = lexer.tokenize(); this.pos = 0;
      while (!this.isAtEnd()) {
        if (this.check(SedTokenType.NEWLINE) || this.check(SedTokenType.SEMICOLON)) { this.advance(); continue; }
        const posBefore = this.pos; const result = this.parseCommand();
        if (result.error) return { commands:[], error: result.error };
        if (result.command) allCommands.push(result.command);
        if (this.pos === posBefore && !this.isAtEnd()) return { commands:[], error: `unknown command: '${this.peek()?.value}'` };
      }
    }
    return { commands: allCommands };
  }
  parseCommand() {
    const addressResult = this.parseAddressRange();
    if (addressResult?.error) return { command: null, error: addressResult.error };
    const address = addressResult?.address;
    if (this.check(SedTokenType.NEGATION)) { this.advance(); if (address) address.negated = true; }
    while (this.check(SedTokenType.NEWLINE) || this.check(SedTokenType.SEMICOLON)) this.advance();
    if (this.isAtEnd()) {
      if (address && (address.start !== undefined || address.end !== undefined)) return { command: null, error: "command expected" };
      return { command: null };
    }
    const token = this.peek();
    
    switch (token.type) {
      case SedTokenType.COMMAND: return this.parseSimpleCommand(token, address);
      case SedTokenType.SUBSTITUTE: this.advance(); return { command: { ...token, type: "substitute", address, extendedRegex: this.extendedRegex, posix: this.posix } };
      
      case SedTokenType.TRANSLITERATE: {
        this.advance();
        if (token.source.length !== token.dest.length) {
          return { command: null, error: "strings for `y' command are different lengths" };
        }
        return { command: { type: "transliterate", address, source: token.source, dest: token.dest } };
      };
      case SedTokenType.LABEL_DEF: this.advance(); return { command: { type: "label", name: token.label || "" } };
      case SedTokenType.BRANCH: this.advance(); return { command: { type: "branch", address, label: token.label } };
      case SedTokenType.BRANCH_ON_SUBST: this.advance(); return { command: { type: "branchOnSubst", address, label: token.label } };
      case SedTokenType.BRANCH_ON_NO_SUBST: this.advance(); return { command: { type: "branchOnNoSubst", address, label: token.label } };
      case SedTokenType.TEXT_CMD: {
        this.advance();
        const textType = token.value === "a" ? "append" : token.value === "i" ? "insert" : "change";
        if (this.posix && textType !== "change" && address && address.end !== undefined) {
          return { command: null, error: "command only uses one address" };
        }
        if (this.posix && !token.hasBackslash) {
          return { command: null, error: "expected \\ after `a', `c' or `i'" };
        }
        return { command: { type: textType, address, text: token.text } };
      }
      case SedTokenType.FILE_READ: {
        this.advance();
        if (this.posix && address && address.end !== undefined) return { command: null, error: "command only uses one address" };
        return { command: { type: "readFile", address, filename: token.filename || "" } };
      }
      case SedTokenType.FILE_READ_LINE: this.advance(); return { command: { type: "readFileLine", address, filename: token.filename || "" } };
      case SedTokenType.FILE_WRITE: this.advance(); return { command: { type: "writeFile", address, filename: token.filename || "" } };
      case SedTokenType.FILE_WRITE_LINE: this.advance(); return { command: { type: "writeFirstLine", address, filename: token.filename || "" } };
      case SedTokenType.EXECUTE: this.advance(); return { command: { type: "execute", address, command: token.command } };
      case SedTokenType.VERSION: this.advance(); return { command: { type: "version", address, minVersion: token.label } };
      case SedTokenType.LBRACE: return this.parseGroup(address);
      case SedTokenType.RBRACE: return { command: null };
      case SedTokenType.ERROR: return { command: null, error: token.isMessage ? token.value : `unknown command: \`${token.value}'` };
      default: if (address && (address.start !== undefined || address.end !== undefined)) return { command: null, error: "command expected" }; return { command: null };
    }
  }
  parseSimpleCommand(token, address) {
    this.advance(); const cmd = token.value;
    const map = {
      "p": "print", "P": "printFirstLine", "d": "delete", "D": "deleteFirstLine",
      "h": "hold", "H": "holdAppend", "g": "get", "G": "getAppend", "x": "exchange",
      "n": "next", "N": "nextAppend", "q": "quit", "Q": "quitSilent", "z": "zap",
      "=": "lineNumber", "l": "list", "F": "printFilename"
    };
    if (map[cmd]) {
      if (this.posix && "q=l".includes(cmd) && address && address.end !== undefined) {
        return { command: null, error: "command only uses one address" };
      }
      const extra = {};
      if ((cmd === "q" || cmd === "Q") && token.numArg !== undefined) extra.exitCode = token.numArg;
      if (cmd === "l" && token.numArg !== undefined) extra.listWidth = token.numArg;
      return { command: { type: map[cmd], address, ...extra } };
    }
    return { command: null, error: `unknown command: ${cmd}` };
  }
  parseGroup(address) {
    this.advance(); const commands =[];
    while (!this.isAtEnd() && !this.check(SedTokenType.RBRACE)) {
      if (this.check(SedTokenType.NEWLINE) || this.check(SedTokenType.SEMICOLON)) { this.advance(); continue; }
      const posBefore = this.pos; const result = this.parseCommand();
      if (result.error) return { command: null, error: result.error };
      if (result.command) commands.push(result.command);
      if (this.pos === posBefore && !this.isAtEnd()) return { command: null, error: `unknown command: '${this.peek()?.value}'` };
    }
    if (!this.check(SedTokenType.RBRACE)) return { command: null, error: "unmatched `{'" };
    this.advance(); return { command: { type: "group", address, commands } };
  }
  parseAddressRange() {
    if (this.check(SedTokenType.COMMA)) return { error: "expected context address" };
    const start = this.parseAddress(); if (start === undefined) return undefined;
    if (this.posix && start === 0) return { error: "invalid usage of line address 0" };
    let end;
    if (this.check(SedTokenType.RELATIVE_OFFSET)) { const token = this.advance(); end = { offset: token.offset || 0 }; }
    else if (this.check(SedTokenType.COMMA)) { this.advance(); end = this.parseAddress(); if (end === undefined) return { error: "expected context address" }; }
    const address = { start, end };
    if (end !== undefined) address.rangeId = SedParser.nextRangeId++;
    return { address };
  }
  parseAddress() {
    const token = this.peek();
    switch (token.type) {
      case SedTokenType.NUMBER: this.advance(); return token.value;
      case SedTokenType.DOLLAR: this.advance(); return "$";
      case SedTokenType.PATTERN: this.advance(); return { pattern: token.pattern || token.value, ignoreCase: token.ignoreCase, multiline: token.multiline };
      case SedTokenType.STEP: this.advance(); return { first: token.first || 0, step: token.step || 0 };
      case SedTokenType.RELATIVE_OFFSET: this.advance(); return { offset: token.offset || 0 };
      default: return undefined;
    }
  }
  peek() { return this.tokens[this.pos] || { type: SedTokenType.EOF, value: "", line: 0, column: 0 }; }
  advance() { if (!this.isAtEnd()) this.pos++; return this.tokens[this.pos - 1]; }
  check(type) { return this.peek().type === type; }
  isAtEnd() { return this.peek().type === SedTokenType.EOF; }
}

function parseMultipleScripts(scripts, extendedRegex = false, posix = false) {
  let silentMode = false; let extendedRegexFromComment = false; const joinedScripts =[];
  for (let i = 0; i < scripts.length; i++) {
    let script = scripts[i];
    if (joinedScripts.length === 0 && i === 0) {
      const match = script.match(/^#([nr]+)\s*(?:\n|$)/i);
      if (match) {
        const flags = match[1].toLowerCase();
        if (flags.includes("n")) silentMode = true;
        if (flags.includes("r")) extendedRegexFromComment = true;
        script = script.slice(match[0].length);
      }
    }
    if (joinedScripts.length > 0 && joinedScripts[joinedScripts.length - 1].endsWith("\\")) {
      const lastScript = joinedScripts[joinedScripts.length - 1];
      joinedScripts[joinedScripts.length - 1] = `${lastScript}\n${script}`;
    } else { joinedScripts.push(script); }
  }
  const combinedScript = joinedScripts.join("\n");
  const parser = new SedParser([combinedScript], extendedRegex || extendedRegexFromComment, posix);
  const result = parser.parse();
  if (result.error) return { ...result, silentMode, extendedRegexMode: extendedRegexFromComment };

  // Validate that all branch targets refer to defined labels
  const definedLabels = new Set();
  function collectLabels(commands) {
    for (const cmd of commands) {
      if (cmd.type === "label") definedLabels.add(cmd.name);
      if (cmd.type === "group") collectLabels(cmd.commands);
    }
  }
  function checkBranches(commands) {
    for (const cmd of commands) {
      if (["branch", "branchOnSubst", "branchOnNoSubst"].includes(cmd.type)) {
        if (cmd.label && !definedLabels.has(cmd.label)) {
          return `can't find label for jump to \`${cmd.label}'`;
        }
      }
      if (cmd.type === "group") {
        const err = checkBranches(cmd.commands);
        if (err) return err;
      }
    }
    return null;
  }
  collectLabels(result.commands);
  const labelError = checkBranches(result.commands);
  if (labelError) return { commands: [], error: labelError, errorCode: 4, silentMode, extendedRegexMode: extendedRegexFromComment };

  return { ...result, silentMode, extendedRegexMode: extendedRegexFromComment };
}

// ==========================================
// 4. Executor
// ==========================================

function createInitialState(totalLines, filename, rangeStates, extendedRegex, posix) {
  return {
    patternSpace: "", holdSpace: "", lineNumber: 0, totalLines,
    chomped: true, holdChomped: true, extendedRegex: !!extendedRegex, posix: !!posix,
    deleted: false, printed: false, quit: false, quitSilent: false, explicitQuit: false,
    exitCode: undefined, errorMessage: undefined, errorCode: undefined,
    substitutionMade: false,
    deferredOutput: [],
    restartCycle: false, inDRestartedCycle: false, currentFilename: filename,
    pendingFileWrites: [], rangeStates: rangeStates || new Map(), linesConsumedInCycle: 0
  };
}

// Resets the subset of `state` fields that are per-line (i.e. must not
// leak from one line's processing into the next) in place on an existing
// state object, instead of allocating a fresh state object every line.
// holdSpace/holdChomped/lastPattern/rangeStates/totalLines/extendedRegex/
// posix/currentFilename are deliberately untouched here -- those persist
// across lines by design (hold space survives the whole file; range state
// tracks activation across lines; etc).
function resetLineState(state, patternSpace, chomped, lineNumber) {
  state.patternSpace = patternSpace;
  state.chomped = chomped;
  state.lineNumber = lineNumber;
  state.deleted = false;
  state.printed = false;
  state.quit = false;
  state.quitSilent = false;
  state.explicitQuit = false;
  state.exitCode = undefined;
  state.errorMessage = undefined;
  state.errorCode = undefined;
  state.substitutionMade = false;
  state.deferredOutput.length = 0;
  state.restartCycle = false;
  state.inDRestartedCycle = false;
  state.pendingFileWrites.length = 0;
  state.linesConsumedInCycle = 0;
}

// Output builder implementing GNU sed's "missing newline" deferred semantics:
// a chunk that comes from an unterminated final input line is written without
// its trailing newline; if further output follows, the newline is inserted
// first to separate them. If nothing follows, the newline is simply never
// written (matching a file with no trailing newline).
const MAX_OUTPUT_SIZE = 50 * 1024 * 1024; // 50MB safety cap

function makeOutputBuilder(recordSeparator = "\n") {
  let buf = "";
  let pending = false;
  let pendingSep = recordSeparator;
  return {
    write(text, chomped, sep = recordSeparator) {
      if (pending) { buf += pendingSep; pending = false; }
      buf += text;
      if (chomped) buf += sep; else { pending = true; pendingSep = sep; }
      if (buf.length > MAX_OUTPUT_SIZE) {
        throw sedError("sed: output size limit exceeded (possible infinite loop in script)", 1);
      }
    },
    // Splices raw bytes into the stream verbatim -- no separator added or
    // stripped, matching real sed's `r` command exactly (it dumps a file's
    // contents byte-for-byte, including a missing or repeated trailing
    // newline). Still flushes a previously-deferred separator first.
    writeRaw(text) {
      if (pending) { buf += pendingSep; pending = false; }
      buf += text;
      if (buf.length > MAX_OUTPUT_SIZE) {
        throw sedError("sed: output size limit exceeded (possible infinite loop in script)", 1);
      }
    },
    result() { return buf; }
  };
}

function isStepAddress(address) { return typeof address === "object" && "first" in address && "step" in address; }
function isRelativeOffset(address) { return typeof address === "object" && "offset" in address; }

function matchesAddress(address, lineNum, totalLines, line, state) {
  if (address === "$") return lineNum === totalLines;
  if (typeof address === "number") return lineNum === address;
  if (isStepAddress(address)) {
    const { first, step } = address;
    if (step === 0) return lineNum === first;
    return (lineNum - first) % step === 0 && lineNum >= first;
  }
  if (typeof address === "object" && "pattern" in address) {
    try {
      let rawPattern = address.pattern;
      if (rawPattern === "" && state?.lastPattern) rawPattern = state.lastPattern;
      else if (rawPattern !== "" && state) state.lastPattern = rawPattern;

      let regex;
      if (address._cachedRawPattern === rawPattern && address._cachedExtended === !!state?.extendedRegex && address._cachedPosix === !!state?.posix) {
        regex = address._cachedRegex;
      } else {
        const pattern = normalizeForJs(state?.extendedRegex ? rawPattern : breToEre(rawPattern, !!state?.posix));
        const jsFlags = "s" + (address.ignoreCase ? "i" : "") + (address.multiline ? "m" : "");
        regex = new RegExp(pattern, jsFlags);
        address._cachedRawPattern = rawPattern;
        address._cachedExtended = !!state?.extendedRegex;
        address._cachedPosix = !!state?.posix;
        address._cachedRegex = regex;
      }
      return regex.test(line);
    } catch { return false; }
  }
  return false;
}

function serializeRange(range) {
  if (range.rangeId !== undefined) return `#${range.rangeId}`;
  const serializeAddr = addr => {
    if (addr === undefined) return "undefined"; if (addr === "$") return "$";
    if (typeof addr === "number") return String(addr);
    if ("offset" in addr) return `+${addr.offset}`;
    if ("pattern" in addr) return `/${addr.pattern}/`;
    if ("first" in addr) return `${addr.first}~${addr.step}`;
    return "unknown";
  };
  return `${serializeAddr(range.start)},${serializeAddr(range.end)}`;
}

// Shared, reused address-match result object. Every isInRange(Internal)
// call mutates and returns this same object rather than allocating a fresh
// {matched, closing} literal. This is safe because every call site reads
// .matched/.closing synchronously and immediately after the call and never
// retains a reference past the next isInRange call (verified: no caller
// stores two concurrent results, and there's no re-entrancy -- neither
// function calls itself or the other before returning). Profiling showed
// this allocation (2 short-lived objects per address check, on every
// command, on every line) was the dominant GC source for address-heavy
// scripts over large inputs.
const _addrResult = { matched: false, closing: false };
function setAddrResult(matched, closing) {
  _addrResult.matched = matched;
  _addrResult.closing = closing;
  return _addrResult;
}

function isInRangeInternal(range, lineNum, totalLines, line, rangeStates, state) {
  if (!range || (!range.start && !range.end)) return setAddrResult(true, true);
  const { start, end } = range;
  if (start !== undefined && end === undefined) {
    const matched = matchesAddress(start, lineNum, totalLines, line, state);
    return setAddrResult(matched, matched);
  }

  if (start !== undefined && end !== undefined) {
    const isSimpleNum = v => v === "$" || typeof v === "number";
    const hasPatternStart = !isSimpleNum(start);
    const hasPatternEnd = !isSimpleNum(end);
    const hasRelativeEnd = isRelativeOffset(end);

    if (hasRelativeEnd && rangeStates) {
      const rangeKey = serializeRange(range); let rangeState = rangeStates.get(rangeKey);
      if (!rangeState) { rangeState = { active: false }; rangeStates.set(rangeKey, rangeState); }
      if (!rangeState.active) {
        if (rangeState.completed) return setAddrResult(false, false);
        const startMatches = typeof start === "number" ? lineNum >= start : matchesAddress(start, lineNum, totalLines, line, state);
        if (startMatches) {
          rangeState.active = true; rangeState.startLine = lineNum; rangeStates.set(rangeKey, rangeState);
          if (end.offset === 0) { rangeState.active = false; if (typeof start === "number") rangeState.completed = true; rangeStates.set(rangeKey, rangeState); return setAddrResult(true, true); }
          return setAddrResult(true, false);
        }
        return setAddrResult(false, false);
      } else {
        const target = (rangeState.startLine || lineNum) + end.offset;
        const closing = lineNum >= target;
        if (closing) { rangeState.active = false; if (typeof start === "number") rangeState.completed = true; rangeStates.set(rangeKey, rangeState); }
        return setAddrResult(true, closing);
      }
    }

    if (!hasPatternStart && !hasPatternEnd && !hasRelativeEnd && rangeStates) {
      const startNum = typeof start === "number" ? start : start === "$" ? totalLines : 1;
      const endNum = typeof end === "number" ? end : end === "$" ? totalLines : totalLines;
      const rangeKey = serializeRange(range);
      let rangeState = rangeStates.get(rangeKey);
      if (!rangeState) { rangeState = { closed: false }; rangeStates.set(rangeKey, rangeState); }

      if (startNum <= endNum) {
        if (rangeState.closed) return setAddrResult(false, false);
        const matched = lineNum >= startNum && lineNum <= endNum;
        const closing = matched && lineNum === endNum;
        if (closing) rangeState.closed = true;
        return setAddrResult(matched, closing);
      }

      // Inverted range (addr2 < addr1): per POSIX/GNU, matches only the
      // single line addr1, and only the first time that line is reached.
      if (!rangeState.closed && lineNum >= startNum) {
        rangeState.closed = true;
        if (lineNum === startNum) return setAddrResult(true, true);
      }
      return setAddrResult(false, false);
    }

    if (rangeStates) {
      const rangeKey = serializeRange(range); let rangeState = rangeStates.get(rangeKey);
      if (!rangeState) { rangeState = { active: false }; rangeStates.set(rangeKey, rangeState); }
      // Returns 'over' (already past end -- exclude this line), 'close' (this
      // is exactly the end line -- include and close), or 'open' (still active).
      const endStatus = () => {
        if (typeof end === "number") {
          if (lineNum > end) return "over";
          if (lineNum === end) return "close";
          return "open";
        }
        return matchesAddress(end, lineNum, totalLines, line, state) ? "close" : "open";
      };
      if (!rangeState.active) {
        if (rangeState.completed) return setAddrResult(false, false);
        let startMatches = typeof start === "number" ? lineNum >= start : matchesAddress(start, lineNum, totalLines, line, state);
        if (startMatches) {
          rangeState.active = true; rangeState.startLine = lineNum; rangeStates.set(rangeKey, rangeState);
          // The start line always matches. A numeric addr2 that's already
          // satisfied closes the range immediately, but a *regex* addr2 is
          // never tested against the very line where the range just began
          // (matching GNU sed's documented behavior).
          const endIsPattern = typeof end === "object" && end !== null && "pattern" in end;
          let closing = false;
          if (!endIsPattern || start === 0) {
            const status = endStatus();
            if (status === "close" || status === "over") { rangeState.active = false; if (typeof start === "number") rangeState.completed = true; rangeStates.set(rangeKey, rangeState); closing = true; }
          }
          return setAddrResult(true, closing);
        }
        return setAddrResult(false, false);
      } else {
        const status = endStatus();
        if (status === "over") { rangeState.active = false; if (typeof start === "number") rangeState.completed = true; rangeStates.set(rangeKey, rangeState); return setAddrResult(false, false); }
        if (status === "close") { rangeState.active = false; if (typeof start === "number") rangeState.completed = true; rangeStates.set(rangeKey, rangeState); return setAddrResult(true, true); }
        return setAddrResult(true, false);
      }
    }
    const matched = matchesAddress(start, lineNum, totalLines, line, state);
    return setAddrResult(matched, matched);
  }
  return setAddrResult(true, true);
}

function isInRange(range, lineNum, totalLines, line, rangeStates, state) {
  const r = isInRangeInternal(range, lineNum, totalLines, line, rangeStates, state);
  if (range?.negated) { const m = r.matched; r.matched = !m; r.closing = !m; }
  return r;
}

function processReplacement(replacement, match, groups, posix = false) {
  let result = ""; let i = 0;
  let caseMode = "none"; let nextCase = "none";

  function append(text) {
    if (!text) return;
    for (let j = 0; j < text.length; j++) {
      let char = text[j];
      if (nextCase === "upper") { char = char.toUpperCase(); nextCase = "none"; }
      else if (nextCase === "lower") { char = char.toLowerCase(); nextCase = "none"; }
      else if (caseMode === "upper") { char = char.toUpperCase(); }
      else if (caseMode === "lower") { char = char.toLowerCase(); }
      result += char;
    }
  }

  while (i < replacement.length) {
    if (replacement[i] === "\\") {
      if (i + 1 < replacement.length) {
        const next = replacement[i + 1];
        if (!posix) {
          if (next === "U") { caseMode = "upper"; i += 2; continue; }
          if (next === "L") { caseMode = "lower"; i += 2; continue; }
          if (next === "E") { caseMode = "none"; i += 2; continue; }
          if (next === "u") { nextCase = "upper"; i += 2; continue; }
          if (next === "l") { nextCase = "lower"; i += 2; continue; }
        }

        if (next === "&") { append("&"); i += 2; continue; }
        if (next === "n") { append("\n"); i += 2; continue; }
        if (next === "t") { append("\t"); i += 2; continue; }
        if (next === "r") { append("\r"); i += 2; continue; }

        const digit = parseInt(next, 10);
        if (digit === 0) { append(match); i += 2; continue; }
        if (digit >= 1 && digit <= 9) { append(groups[digit - 1] || ""); i += 2; continue; }
        append(next); i += 2; continue;
      }
    }
    if (replacement[i] === "&") { append(match); i++; continue; }
    append(replacement[i]); i++;
  }
  return result;
}

// Fast path: a synchronous copy of the matching loop below, used whenever
// the substitution doesn't need to await a shell callback (the vast
// majority of substitutions). This avoids async function call / Promise
// overhead per substitution while preserving sed's exact match semantics --
// notably that a zero-length match immediately following the end of the
// previous match is skipped rather than replaced again (verified against
// real sed: `s/a*/X/g` on "bab" must give "XbXbX", not "XbXXbX" -- native
// String.prototype.replace does NOT implement this rule, so it can't be
// used here as-is despite being faster in isolation).
function doSyncReplace(input, regex, cmd) {
  let result = ""; let pos = 0; let skipZeroLengthAtNextPos = false;
  let count = 0; let matchedAny = false;

  while (pos <= input.length) {
    regex.lastIndex = pos; const match = regex.exec(input);
    if (!match) { result += input.slice(pos); break; }
    if (match.index !== pos) { result += input.slice(pos, match.index); pos = match.index; skipZeroLengthAtNextPos = false; continue; }

    const matchedText = match[0]; const groups = match.slice(1);
    if (skipZeroLengthAtNextPos && matchedText.length === 0) {
      if (pos < input.length) { result += input[pos]; pos++; } else { break; }
      skipZeroLengthAtNextPos = false; continue;
    }

    count++;
    let doReplace = false;
    if (cmd.global && cmd.nthOccurrence) {
      if (count >= cmd.nthOccurrence) doReplace = true;
    } else if (cmd.global) {
      doReplace = true;
    } else if (cmd.nthOccurrence) {
      if (count === cmd.nthOccurrence) doReplace = true;
    } else {
      if (count === 1) doReplace = true;
    }

    if (doReplace) {
      matchedAny = true;
      result += processReplacement(cmd.replacement, matchedText, groups, !!cmd.posix);
    } else {
      result += matchedText;
    }

    skipZeroLengthAtNextPos = false;
    if (matchedText.length === 0) {
      if (pos < input.length) { result += input[pos]; pos++; } else { break; }
    } else {
      pos += matchedText.length; skipZeroLengthAtNextPos = true;
    }

    if (!cmd.global && count >= (cmd.nthOccurrence || 1)) {
      result += input.slice(pos);
      break;
    }
  }
  return { result, matchedAny };
}

async function doAsyncReplace(input, regex, cmd, shell) {
  let result = ""; let pos = 0; let skipZeroLengthAtNextPos = false;
  let count = 0; let matchedAny = false;

  while (pos <= input.length) {
    regex.lastIndex = pos; const match = regex.exec(input);
    if (!match) { result += input.slice(pos); break; }
    if (match.index !== pos) { result += input.slice(pos, match.index); pos = match.index; skipZeroLengthAtNextPos = false; continue; }

    const matchedText = match[0]; const groups = match.slice(1);
    if (skipZeroLengthAtNextPos && matchedText.length === 0) {
      if (pos < input.length) { result += input[pos]; pos++; } else { break; }
      skipZeroLengthAtNextPos = false; continue;
    }

    count++;
    let doReplace = false;
    
    // Accurately honor combinations of N and G flags (e.g. s/a/b/2g)
    if (cmd.global && cmd.nthOccurrence) {
      if (count >= cmd.nthOccurrence) doReplace = true;
    } else if (cmd.global) {
      doReplace = true;
    } else if (cmd.nthOccurrence) {
      if (count === cmd.nthOccurrence) doReplace = true;
    } else {
      if (count === 1) doReplace = true;
    }

    if (doReplace) {
      matchedAny = true;
      let replaced = processReplacement(cmd.replacement, matchedText, groups, !!cmd.posix);
      if (cmd.executeShell && shell) {
        replaced = await shell(replaced);
        if (replaced.endsWith("\n")) replaced = replaced.slice(0, -1);
      }
      result += replaced;
    } else {
      result += matchedText;
    }

    skipZeroLengthAtNextPos = false;
    if (matchedText.length === 0) {
      if (pos < input.length) { result += input[pos]; pos++; } else { break; }
    } else {
      pos += matchedText.length; skipZeroLengthAtNextPos = true;
    }

    if (!cmd.global && count >= (cmd.nthOccurrence || 1)) {
      result += input.slice(pos);
      break;
    }
  }
  return { result, matchedAny };
}

async function executeCommand(cmd, state, ctx, shell) {
  const { lineNumber, totalLines, patternSpace } = state;
  if (cmd.type === "label") return;
  const addrResult = isInRange(cmd.address, lineNumber, totalLines, patternSpace, state.rangeStates, state);
  if (!addrResult.matched) return;

  switch (cmd.type) {
    case "substitute": {
      let rawPattern = cmd.pattern;
      if (rawPattern === "" && state.lastPattern) rawPattern = state.lastPattern;
      else if (rawPattern !== "") state.lastPattern = rawPattern;

      let execRegex;
      if (cmd._cachedRawPattern === rawPattern) {
        execRegex = cmd._cachedExecRegex;
      } else {
        const pattern = normalizeForJs(cmd.extendedRegex ? rawPattern : breToEre(rawPattern, !!cmd.posix));
        execRegex = new RegExp(pattern, "gs" + (cmd.ignoreCase ? "i" : "") + (cmd.multiline ? "m" : ""));
        cmd._cachedRawPattern = rawPattern;
        cmd._cachedExecRegex = execRegex;
      }

      try {
        const { result, matchedAny } = cmd.executeShell
          ? await doAsyncReplace(state.patternSpace, execRegex, cmd, shell)
          : doSyncReplace(state.patternSpace, execRegex, cmd);
        if (matchedAny) {
          state.substitutionMade = true;
          state.patternSpace = result;
          if (cmd.printOnMatch) ctx.builder.write(state.patternSpace, state.chomped);
          if (cmd.writeFilename) state.pendingFileWrites.push({ filename: cmd.writeFilename, content: `${state.patternSpace}\n` });
        }
      } catch (e) { /* ignore */ }
      break;
    }
    case "print": ctx.builder.write(state.patternSpace, state.chomped); break;
    case "printFirstLine": {
      const boundaryIdx = state.patternSpace.indexOf(ctx.RS);
      if (boundaryIdx !== -1) ctx.builder.write(state.patternSpace.slice(0, boundaryIdx), true);
      else ctx.builder.write(state.patternSpace, state.chomped);
      break;
    }
    case "delete": state.deleted = true; break;
    case "deleteFirstLine": {
      const boundaryIdx = state.patternSpace.indexOf(ctx.RS);
      if (boundaryIdx !== -1) { state.patternSpace = state.patternSpace.slice(boundaryIdx + 1); state.restartCycle = true; state.inDRestartedCycle = true; }
      else { state.deleted = true; } break;
    }
    case "zap": state.patternSpace = ""; break;
    case "append": state.deferredOutput.push({ type: "text", text: cmd.text, chomped: true, sep: "\n" }); break;
    case "insert": ctx.builder.write(cmd.text, true); break;
    case "change": if (addrResult.closing) ctx.builder.write(cmd.text, true); state.deleted = true; break;
    case "hold": state.holdSpace = state.patternSpace; state.holdChomped = state.chomped; break;
    case "holdAppend":
    state.holdSpace = `${state.holdSpace}${ctx.RS}${state.patternSpace}`;
    state.holdChomped = state.chomped;
    break;
    case "get": state.patternSpace = state.holdSpace; state.chomped = state.holdChomped; break;
    case "getAppend": state.patternSpace += `${ctx.RS}${state.holdSpace}`; state.chomped = state.holdChomped; break;
    case "exchange": {
      const temp = state.patternSpace; state.patternSpace = state.holdSpace; state.holdSpace = temp;
      const tempC = state.chomped; state.chomped = state.holdChomped; state.holdChomped = tempC;
      break;
    }
    case "next": state.printed = true; break;
    case "quit": state.quit = true; state.explicitQuit = true; if (cmd.exitCode !== undefined) state.exitCode = cmd.exitCode; break;
    case "quitSilent": state.quit = true; state.explicitQuit = true; state.quitSilent = true; if (cmd.exitCode !== undefined) state.exitCode = cmd.exitCode; break;
    case "list": ctx.builder.write(escapeForList(state.patternSpace, cmd.listWidth !== undefined ? cmd.listWidth : (ctx.defaultListWidth !== undefined ? ctx.defaultListWidth : 70)), true); break;
    case "printFilename": if (state.currentFilename) ctx.builder.write(state.currentFilename, true); break;
    case "readFile": state.deferredOutput.push({ type: "r", filename: cmd.filename, wholeFile: true }); break;
    case "readFileLine": state.deferredOutput.push({ type: "r", filename: cmd.filename, wholeFile: false, sep: "\n" }); break;
    case "writeFile": state.pendingFileWrites.push({ filename: cmd.filename, content: `${state.patternSpace}${ctx.RS}` }); break;
    case "writeFirstLine": { const boundaryIdx = state.patternSpace.indexOf(ctx.RS); state.pendingFileWrites.push({ filename: cmd.filename, content: `${boundaryIdx !== -1 ? state.patternSpace.slice(0, boundaryIdx) : state.patternSpace}${ctx.RS}` }); break; }
    case "execute": {
      if (cmd.command) {
        if (shell) { let out = await shell(cmd.command); if (out.endsWith("\n")) out = out.slice(0, -1); ctx.builder.write(out, true); }
        else { state.errorMessage = "sed: e command requires a shell executor"; state.quit = true; }
      } else {
        if (shell) { let out = await shell(state.patternSpace); if (out.endsWith("\n")) out = out.slice(0, -1); state.patternSpace = out; } 
        else { state.errorMessage = "sed: e command requires a shell executor"; state.quit = true; }
      }
      break;
    }
    case "transliterate": { let result = ""; for (const char of state.patternSpace) { const idx = cmd.source.indexOf(char); result += idx !== -1 ? cmd.dest[idx] : char; } state.patternSpace = result; break; }
    case "lineNumber": ctx.builder.write(String(state.lineNumber), true); break;
  }
}

// GNU sed compiles the whole script into one flat instruction list, so a
// label defined inside a `{...}` block is visible to branches outside it
// (and vice versa). Our parser produces a nested tree (groups hold their
// own `commands` array), so we flatten it here: a group becomes a
// "groupStart" (address-gated conditional skip) followed by its body and a
// "groupEnd" marker, with the groupStart's skip target computed to land
// just past the matching groupEnd.
function flattenCommands(commands) {
  const flat = [];
  function visit(cmds) {
    for (const cmd of cmds) {
      if (cmd.type === "group") {
        const startIdx = flat.length;
        flat.push({ type: "groupStart", address: cmd.address, endIndex: null });
        visit(cmd.commands);
        flat.push({ type: "groupEnd" });
        flat[startIdx].endIndex = flat.length;
      } else {
        flat.push(cmd);
      }
    }
  }
  visit(commands);
  return flat;
}

function buildLabelIndex(flatCommands) {
  const labelIndex = new Map();
  for (let i = 0; i < flatCommands.length; i++) if (flatCommands[i].type === "label") labelIndex.set(flatCommands[i].name, i);
  return labelIndex;
}

async function executeCommands(commands, labelIndex, state, ctx, shell) {
  let i = 0;
  let steps = 0;
  const MAX_STEPS = 100_000;
  while (i < commands.length) {
    if (state.deleted || state.quit || state.quitSilent || state.restartCycle) break;
    steps++;
    if (steps > MAX_STEPS || state.patternSpace.length > 20_000_000) {
      throw sedError("sed: step/size limit exceeded (possible infinite loop in script)", 1);
    }
    const cmd = commands[i];

    if (cmd.type === "label" || cmd.type === "groupEnd") { i++; continue; }

    if (cmd.type === "groupStart") {
      const addrResult = isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state);
      if (!addrResult.matched) { i = cmd.endIndex; continue; }
      i++; continue;
    }

    if (cmd.type === "next") {
      if (isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state).matched) {
        if (!(ctx && ctx.silent)) ctx.builder.write(state.patternSpace, state.chomped);
        if (ctx && ctx.currentLineIndex + state.linesConsumedInCycle + 1 < ctx.lines.length) {
          if (ctx.flushDeferred) ctx.flushDeferred(state);
          state.linesConsumedInCycle++;
          const newIdx = ctx.currentLineIndex + state.linesConsumedInCycle;
          state.patternSpace = ctx.lines[newIdx];
          state.chomped = ctx.chompedFor(newIdx);
          state.lineNumber = newIdx + 1; state.substitutionMade = false;
        } else { state.quit = true; state.deleted = true; break; }
      }
      i++; continue;
    }

    if (cmd.type === "nextAppend") {
      if (isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state).matched) {
        if (ctx && ctx.currentLineIndex + state.linesConsumedInCycle + 1 < ctx.lines.length) {
          if (ctx.flushDeferred) ctx.flushDeferred(state);
          state.linesConsumedInCycle++;
          const newIdx = ctx.currentLineIndex + state.linesConsumedInCycle;
          state.patternSpace += `${ctx.RS}${ctx.lines[newIdx]}`;
          state.chomped = ctx.chompedFor(newIdx);
          state.lineNumber = newIdx + 1; state.substitutionMade = false;
        } else { state.quit = true; if (state.posix) state.deleted = true; break; }
      }
      i++; continue;
    }

   if (["branch", "branchOnSubst", "branchOnNoSubst"].includes(cmd.type)) {
      if (isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state).matched) {
        const shouldBranch =
          cmd.type === "branch" ||
          (cmd.type === "branchOnSubst" && state.substitutionMade) ||
          (cmd.type === "branchOnNoSubst" && !state.substitutionMade);
        if (cmd.type === "branchOnSubst" && state.substitutionMade) state.substitutionMade = false;
        if (shouldBranch) {
          if (cmd.label) {
            const target = labelIndex.get(cmd.label);
            if (target !== undefined) { i = target; continue; }
            // Label not found — error like real sed (unreachable in practice
            // since compile-time validation already catches this, kept as a
            // defensive fallback)
            state.errorMessage = `sed: can't find label for jump to \`${cmd.label}'`;
            state.errorCode = 4;
            state.quit = true;
            break;
          }
          break;
        }
      }
      i++; continue;
    }

    await executeCommand(cmd, state, ctx, shell); i++;
  }
  return state.linesConsumedInCycle;
}

// ==========================================
// 5. Integration / Main Process
// ==========================================

async function processContent(content, commands, silent, options = {}) {
  const { filename, fsAdapter, shell, extendedRegex, posix, nullData } = options;
  const RS = nullData ? "\0" : "\n";
  const lines = content.split(RS);
  const endsWithSeparator = content.endsWith(RS);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const totalLines = lines.length; let exitCode;
  const builder = options.sharedBuilder || makeOutputBuilder(RS);
  // Only the very last physical line can be "not chomped" (i.e. lack a
  // trailing separator in the original input); every other line was
  // necessarily terminated by RS when we split on it.
  const chompedFor = idx => (idx === lines.length - 1) ? endsWithSeparator : true;

  const flatCommands = flattenCommands(commands);
  const labelIndex = buildLabelIndex(flatCommands);

  let holdSpace = options.initialHoldSpace ?? ""; let holdChomped = options.initialHoldChomped ?? true;
  let lastPattern = options.initialLastPattern; const rangeStates = new Map();
  const fileLineCache = new Map(); const fileLinePositions = new Map(); const fileWrites = new Map();

  // Deferred output (from `a`, `r`, `R`) is queued on state.deferredOutput
  // and flushed -- in order -- either when `n`/`N` performs a fresh read
  // (matching GNU sed's dump_append_queue-inside-read_pattern_space
  // behavior) or at the natural end of the current cycle.
  async function flushDeferred(state) {
    for (const item of state.deferredOutput) {
      let text = item.text; let chomped = item.chomped; let resolved = item.type !== "r"; let raw = false;
      if (item.type === "r" && fsAdapter) {
        const filePath = item.filename;
        try {
          if (item.wholeFile) {
            const content = await fsAdapter.get(filePath);
            if (content !== undefined) { text = content; resolved = true; raw = true; }
          } else {
            if (!fileLineCache.has(filePath)) {
              const content = await fsAdapter.get(filePath);
              if (content !== undefined) { fileLineCache.set(filePath, content.split("\n")); fileLinePositions.set(filePath, 0); }
            }
            const fileLines = fileLineCache.get(filePath); const pos = fileLinePositions.get(filePath);
            if (fileLines && pos !== undefined && pos < fileLines.length) { text = fileLines[pos]; chomped = true; resolved = true; fileLinePositions.set(filePath, pos + 1); }
          }
        } catch (e) { /* ignore */ }
      }
      if (!resolved) continue;
      if (raw) builder.writeRaw(text);
      else builder.write(text, chomped, item.sep);
    }
    state.deferredOutput.length = 0;
  }

  let didQuit = false;
  let didExplicitQuit = false;
  const state = createInitialState(totalLines, filename, rangeStates, extendedRegex, posix);
  state.holdSpace = holdSpace; state.holdChomped = holdChomped; state.lastPattern = lastPattern;
  const ctx = { lines, currentLineIndex: 0, silent, chompedFor, builder, flushDeferred, RS };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    resetLineState(state, lines[lineIndex], chompedFor(lineIndex), lineIndex + 1);
    ctx.currentLineIndex = lineIndex;

    let cycleIterations = 0; state.linesConsumedInCycle = 0;
    do {
      cycleIterations++; if (cycleIterations > 10000) break;
      state.restartCycle = false; state.pendingFileWrites.length = 0;
      await executeCommands(flatCommands, labelIndex, state, ctx, shell);
      for (const write of state.pendingFileWrites) { const filePath = write.filename; fileWrites.set(filePath, (fileWrites.get(filePath) || "") + write.content); }
    } while (state.restartCycle && !state.deleted && !state.quit && !state.quitSilent);

    lineIndex += state.linesConsumedInCycle;
    holdSpace = state.holdSpace; holdChomped = state.holdChomped; lastPattern = state.lastPattern;

    // Natural end-of-cycle auto-print (suppressed entirely by -n / -silent,
    // and skipped if the pattern space was deleted or `q`-silently quit).
    if (!state.deleted && !state.quitSilent && !silent) {
      builder.write(state.patternSpace, state.chomped);
    }

    await flushDeferred(state);

    if (state.quit || state.quitSilent) {
      didQuit = true;
      if (state.explicitQuit) didExplicitQuit = true;
      if (state.exitCode !== undefined) exitCode = state.exitCode;
      if (state.errorMessage) return { output: "", exitCode: exitCode || 1, errorMessage: state.errorMessage, errorCode: state.errorCode }; break;
    }
  }

  if (fsAdapter) { for (const [filePath, fileContent] of fileWrites) await fsAdapter.set(filePath, fileContent); }

  return { output: builder.result(), exitCode, holdSpace, holdChomped, lastPattern, quit: didQuit, explicitQuit: didExplicitQuit };
}

// ==========================================
// 6. Public API / CLI Arg Parser
// ==========================================

function parseShellString2(input) {
  if (!input || input.trim() === '') return [];
  
  const tokens = [];
  let i = 0;
  let currentToken = '';
  let inQuote = null;
  let inEscape = false;
  
  while (i < input.length) {
    const char = input[i];
    
    if (inEscape) {
      currentToken += char;
      inEscape = false;
      i++;
      continue;
    }
    
    if (char === '\\' && inQuote) {
      inEscape = true;
      i++;
      continue;
    }
    
    if ((char === '"' || char === "'") && !inEscape) {
      if (!inQuote) {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
        inQuote = char;
      } else if (inQuote === char) {
        inQuote = null;
      } else {
        currentToken += char;
      }
      i++;
      continue;
    }
    
    if (!inQuote && char === ' ') {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
      i++;
      continue;
    }
    
    currentToken += char;
    i++;
  }
  
  if (currentToken) {
    tokens.push(currentToken);
  }
  
  if (tokens.length === 0) return [];
  
  const result = [];
  let pendingJoin = '';
  let shouldJoin = false;
  
  function isTextCommand(token) {
    const bare = /^[a-c]$/i.test(token);
    const numAddr = /^\d+([,]\d+)?[a-c]$/i.test(token);
    const patAddr = /^\/[^/]*\/[a-c]$/i.test(token);
    return bare || numAddr || patAddr;
  }
  
  function isFlag(token) {
    return token.startsWith('-');
  }
  
  for (const token of tokens) {
    if (isFlag(token)) {
      if (pendingJoin) {
        if (result.length > 0) {
          result[result.length - 1] += ' ' + pendingJoin;
        } else {
          result.push(pendingJoin);
        }
        pendingJoin = '';
      }
      
      if (token === '-e' || token === '-f') {
        result.push(token);
        continue;
      }
      
      result.push(token);
      shouldJoin = false;
      continue;
    }
    
    const textCmd = isTextCommand(token);
    
    if (textCmd && !pendingJoin) {
      pendingJoin = token;
      shouldJoin = true;
      continue;
    }
    
    if (shouldJoin) {
      pendingJoin += ' ' + token;
      shouldJoin = isTextCommand(token);
      continue;
    }
    
    if (pendingJoin) {
      if (result.length > 0) {
        result[result.length - 1] += ' ' + pendingJoin;
      } else {
        result.push(pendingJoin);
      }
      pendingJoin = '';
    }
    
    result.push(token);
  }
  
  if (pendingJoin) {
    if (result.length > 0) {
      result[result.length - 1] += ' ' + pendingJoin;
    } else {
      result.push(pendingJoin);
    }
  }
  
  return result;
}
 

function parseShellString(str) {
  const args = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = null;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) { current += char; escape = false; continue; }
    if (char === '\\') { escape = true; current += char; continue; }
    if (inQuotes) {
      if (char === quoteChar) inQuotes = false;
      else current += char;
    } else {
      if (char === "'" || char === '"') { inQuotes = true; quoteChar = char; }
      else if (char === ' ' || char === '\t') {
        if (current.length > 0) { args.push(current); current = ''; }
      } else { current += char; }
    }
  }
  if (current.length > 0) args.push(current);

  return args;
}

export default async function sed(commandStr, options = {}) {
  const args = Array.isArray(commandStr) ? commandStr : parseShellString(commandStr);
  const fsAdapter = createFsAdapter(options);
  const shell = options.shell || null;
  let stdin = options.stdin !== undefined ? options.stdin : "";
  if (stdin === null) stdin = "";

  const scripts = []; let silent = false; let inPlace = false; let extendedRegex = false; let posix = !!options.posix; let nullData = !!options.nullData; let separate = !!options.separate; const files = [];
  let implicitScript = [];

  if (args.length === 0 || (args.length === 1 && args[0].trim() === '')) {
    throw sedError('sed: no script command!', 1);
  };
  

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["-n", "--quiet", "--silent"].includes(arg)) silent = true;
    else if (arg === "-i" || arg === "--in-place" || arg.startsWith("-i")) inPlace = true;
    else if (["-E", "-r", "--regexp-extended"].includes(arg)) extendedRegex = true;
    else if (arg === "-e") {
      if (i + 1 < args.length) scripts.push(args[++i]);
      else throw sedError('sed: option requires an argument -- e', 1);
    }
    else if (arg === "-f") {
      if (i + 1 < args.length) {
        const scriptFile = args[++i];
        if (!(await fsAdapter.has(scriptFile))) throw sedError(`sed: couldn't open file ${scriptFile}: No such file or directory`, 2);
        scripts.push(await fsAdapter.get(scriptFile));
      }
    }
    else if (arg === "--posix") posix = true;
    else if (arg === "--null-data" || arg === "--zero-terminated") nullData = true;
    else if (arg === "--separate") separate = true;
    else if (arg.startsWith("--")) throw sedError(`sed: unknown option ${arg}`, 1);
    else if (arg === "-") files.push(arg);
    else if (arg.startsWith("-") && arg.length > 1) {
      const knownFlags = new Set(['n', 'i', 'e', 'E', 'r', 'f', 's', 'z']);
      for (const ch of arg.slice(1)) {
        if (!knownFlags.has(ch)) throw sedError(`sed: invalid option -- '${ch}'`, 1);
      }
      if (arg.includes("n")) silent = true;
      if (arg.includes("i")) inPlace = true;
      if (arg.includes("E") || arg.includes("r")) extendedRegex = true;
      if (arg.includes("s")) separate = true;
      if (arg.includes("z")) nullData = true;
      if (arg.includes("f") && i + 1 < args.length) {
        const scriptFile = args[++i];
        if (!(await fsAdapter.has(scriptFile))) throw sedError(`sed: couldn't open file ${scriptFile}: No such file or directory`, 2);
        scripts.push(await fsAdapter.get(scriptFile));
      } else if (arg.includes("e") && !arg.includes("n") && !arg.includes("i") && i + 1 < args.length) {
        scripts.push(args[++i]);
      }
    } else {
      // Real sed classifies a bare argument as "the script" only when no
      // script has been supplied yet (via -e/-f, or as an earlier bare
      // arg); every other bare argument is a file operand -- this is what
      // we do below, and it's correctly independent of whether stdin
      // happens to be piped (file operands always take priority over
      // stdin for content; see the file-vs-stdin selection further down).
      //
      // There's one wrinkle our own string-mode tokenizer has that a real
      // shell wouldn't: a sed script frequently contains literal
      // unquoted spaces (e.g. the replacement text in "s/\n/ /"), and
      // unlike a real shell we have no quoting information telling us
      // those pieces were meant to stay glued together into one script
      // argument. If the script isn't finished yet and stdin is
      // available as a fallback, only treat a bare token as a file
      // operand when it actually names something in the filesystem --
      // otherwise fold it back into the script, since an actual filename
      // existing is a much stronger signal than an arbitrary token shape.
      const scriptAlreadyStarted = scripts.length > 0 || implicitScript.length > 0;
      const stdinAvailable = !inPlace && options.stdin !== undefined && options.stdin !== null;
      if (!scriptAlreadyStarted) implicitScript.push(arg);
      else if (stdinAvailable && !(await fsAdapter.has(arg))) implicitScript.push(arg);
      else files.push(arg);
    }
  }

  // If the implicit script ends with a bare a/i/c command, the text argument
  // was split off as the first file. Move it back onto the script.
  const pendingTextCmd = /(?:^|[;{\n]|\s)(?:\d+|\$|\/(?:[^\/\\]|\\.)*\/)?\s*[aic]\s*$/;
  while (implicitScript.length > 0 && files.length > 0) {
    if (pendingTextCmd.test(implicitScript.join(' '))) {
      implicitScript.push(files.shift());
    } else {
      break;
    }
  }

  if (implicitScript.length > 0) scripts.push(implicitScript.join(" "));
  if (scripts.length === 0) scripts.push("");

  const { commands, error, errorCode, silentMode, extendedRegexMode } = parseMultipleScripts(scripts, extendedRegex, posix);
  if (error) throw sedError(`sed: ${error}`, errorCode || 1);

  const effectiveSilent = !!(silent || silentMode);
  const effectiveExtendedRegex = !!(extendedRegex || extendedRegexMode);

  // Builds the return value, honoring options.exitCode (bare string vs.
  // {output, exitCode}) and options.returnFs (adds a `fs` snapshot of the
  // final filesystem state -- only meaningful for backends that support
  // it; see createFsAdapter's supportsSnapshot). Neither flag set: returns
  // exactly what earlier versions returned (a bare string), unchanged.
  async function finalize(output, exitCodeValue) {
    const wantsExitCode = !!options.exitCode;
    const wantsFs = !!options.returnFs;
    if (!wantsExitCode && !wantsFs) return output;
    const result = { output };
    if (wantsExitCode) result.exitCode = exitCodeValue ?? 0;
    if (wantsFs) result.fs = fsAdapter.supportsSnapshot ? await fsAdapter.snapshot() : null;
    return result;
  }

  if (inPlace) {
    if (files.length === 0) throw sedError("sed: -i requires at least one file argument", 1);
    let lastExitCode;
    for (const file of files) {
      if (file === "-") continue;
      if (!(await fsAdapter.has(file))) throw sedError(`sed: can't read ${file}: No such file or directory`, 2);
      const fileContent = await fsAdapter.get(file);
      const result = await processContent(fileContent, commands, effectiveSilent, { filename: file, fsAdapter, shell, extendedRegex: effectiveExtendedRegex, posix, nullData });
      if (result.errorMessage) throw sedError(result.errorMessage, result.errorCode || 1);
      await fsAdapter.set(file, result.output);
      if (result.exitCode !== undefined) lastExitCode = result.exitCode;
    }
    return finalize("", lastExitCode);
  }

  if (files.length === 0) {
    const result = await processContent(stdin, commands, effectiveSilent, { fsAdapter, shell, extendedRegex: effectiveExtendedRegex, posix, nullData });
    if (result.errorMessage) throw sedError(result.errorMessage, result.errorCode || 1);
    return finalize(result.output, result.exitCode);
  }

  const RS = nullData ? "\0" : "\n";

  if (separate) {
    // -s: process each file as its own independent stream -- fresh line
    // numbers, fresh $ semantics, fresh range/regex state -- except the
    // hold space (and the "last regex used" memory for empty // reuse),
    // which are real GNU sed's own global state and persist across files.
    // Verified directly against real `sed -s`: numeric/regex ranges don't
    // carry into the next file, but a value stashed in the hold space on
    // file 1 is still there when file 2 starts.
    //
    // The output builder is also shared across files (rather than one per
    // file) so the missing-trailing-newline deferral carries correctly
    // across file boundaries: verified against real sed that a separator
    // *is* inserted before the next file's output even when the previous
    // file itself lacked a trailing newline -- the "no trailing newline"
    // suppression only applies to the very last output of the whole run.
    let stdinConsumed = false;
    let holdSpace = ""; let holdChomped = true; let lastPattern;
    const sharedBuilder = makeOutputBuilder(RS);
    let lastExitCode;
    for (const file of files) {
      let fileContent;
      if (file === "-") { if (stdinConsumed) fileContent = ""; else { fileContent = stdin; stdinConsumed = true; } }
      else {
        if (!(await fsAdapter.has(file))) throw sedError(`sed: can't read ${file}: No such file or directory`, 2);
        fileContent = await fsAdapter.get(file);
      }
      const result = await processContent(fileContent, commands, effectiveSilent, {
        filename: file, fsAdapter, shell, extendedRegex: effectiveExtendedRegex, posix, nullData,
        initialHoldSpace: holdSpace, initialHoldChomped: holdChomped, initialLastPattern: lastPattern,
        sharedBuilder
      });
      if (result.errorMessage) throw sedError(result.errorMessage, result.errorCode || 1);
      holdSpace = result.holdSpace; holdChomped = result.holdChomped; lastPattern = result.lastPattern;
      if (result.exitCode !== undefined) lastExitCode = result.exitCode;
      if (result.explicitQuit) break;
    }
    const output = sharedBuilder.result();
    return finalize(output, lastExitCode);
  }

  let content = "";
  let stdinConsumed = false;
  for (const file of files) {
    let fileContent;
    if (file === "-") { if (stdinConsumed) fileContent = ""; else { fileContent = stdin; stdinConsumed = true; } }
    else {
      if (!(await fsAdapter.has(file))) throw sedError(`sed: can't read ${file}: No such file or directory`, 2);
      fileContent = await fsAdapter.get(file);
    }
    if (content.length > 0 && fileContent.length > 0 && !content.endsWith(RS)) content += RS;
    content += fileContent;
  }

  const result = await processContent(content, commands, effectiveSilent, { filename: files.length === 1 ? files[0] : undefined, fsAdapter, shell, extendedRegex: effectiveExtendedRegex, posix, nullData });
  if (result.errorMessage) throw sedError(result.errorMessage, result.errorCode || 1);
  return finalize(result.output, result.exitCode);
}
