/**
 * Vanilla JS `sed` Implementation with VFS Support
 */

// ==========================================
// 1. Regex Utilities
// ==========================================

const POSIX_CLASSES = new Map([
  ["alnum", "a-zA-Z0-9"],["alpha", "a-zA-Z"], ["ascii", "\\x00-\\x7F"],["blank", " \\t"], ["cntrl", "\\x00-\\x1F\\x7F"],["digit", "0-9"],
  ["graph", "!-~"], ["lower", "a-z"],["print", " -~"],
  ["punct", "!-/:-@\\[-`{-~"],["space", " \\t\\n\\r\\f\\v"], ["upper", "A-Z"],["word", "a-zA-Z0-9_"], ["xdigit", "0-9A-Fa-f"]
]);

function breToEre(pattern) {
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
        if (["+", "?", "|", "(", ")", "{", "}"].includes(next)) { result += next; i += 2; continue; }
        if (next === "t") { result += "\t"; i += 2; continue; }
        if (next === "n") { result += "\n"; i += 2; continue; }
        if (next === "r") { result += "\r"; i += 2; continue; }
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

function escapeForList(input) {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]; const code = ch.charCodeAt(0);
    if (ch === "\\") result += "\\\\";
    else if (ch === "\t") result += "\\t";
    else if (ch === "\n") result += "$\n";
    else if (ch === "\r") result += "\\r";
    else if (ch === "\x07") result += "\\a";
    else if (ch === "\b") result += "\\b";
    else if (ch === "\f") result += "\\f";
    else if (ch === "\v") result += "\\v";
    else if (code < 32 || code >= 127) result += `\\${code.toString(8).padStart(3, "0")}`;
    else result += ch;
  }
  return `${result}$`;
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
  constructor(input) { this.input = input; this.pos = 0; this.line = 1; this.column = 1; }
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
    if (ch === "+" && this.isDigit(this.input[this.pos + 1] || "")) return this.readRelativeOffset();
    if (ch === "/") return this.readPattern();
    if (ch === ":") return this.readLabelDef();
    return this.readCommand();
  }
  readNumber() {
    const startLine = this.line; const startColumn = this.column; let numStr = "";
    while (this.isDigit(this.peek())) numStr += this.advance();
    if (this.peek() === "~") {
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
    return { type: SedTokenType.PATTERN, value: pattern, pattern, line: startLine, column: startColumn };
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
      case "p": case "P": case "d": case "D": case "h": case "H": case "g": case "G": case "x": case "n": case "N": case "q": case "Q": case "z": case "=": case "l": case "F": return { type: SedTokenType.COMMAND, value: ch, line: startLine, column: startColumn };
      case "v": return this.readVersion(startLine, startColumn);
      default: return { type: SedTokenType.ERROR, value: ch, line: startLine, column: startColumn };
    }
  }
  readSubstitute(startLine, startColumn) {
    const delimiter = this.advance();
    if (!delimiter || delimiter === "\n") return { type: SedTokenType.ERROR, value: "s", line: startLine, column: startColumn };
    let pattern = ""; let inBracket = false;
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === delimiter && !inBracket) break;
      if (ch === "\\") {
        this.advance();
        if (this.pos < this.input.length && this.peek() !== "\n") { const escaped = this.peek(); if (escaped === delimiter && !inBracket) pattern += this.advance(); else { pattern += "\\"; pattern += this.advance(); } } 
        else { pattern += "\\"; }
      } 
      else if (ch === "\n") { break; }
      else if (ch === "[" && !inBracket) { inBracket = true; pattern += this.advance(); if (this.peek() === "^") pattern += this.advance(); if (this.peek() === "]") pattern += this.advance(); } 
      else if (ch === "]" && inBracket) { inBracket = false; pattern += this.advance(); } 
      else { pattern += this.advance(); }
    }
    if (this.peek() !== delimiter) return { type: SedTokenType.ERROR, value: "unterminated substitution pattern", line: startLine, column: startColumn };
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
    if (this.peek() === delimiter) this.advance();
    let flags = "";
    while (this.pos < this.input.length) { const ch = this.peek(); if (["g", "i", "p", "I"].includes(ch) || this.isDigit(ch)) flags += this.advance(); else break; }
    return { type: SedTokenType.SUBSTITUTE, value: `s${delimiter}${pattern}${delimiter}${replacement}${delimiter}${flags}`, pattern, replacement, flags, line: startLine, column: startColumn };
  }
  readTransliterate(startLine, startColumn) {
    const delimiter = this.advance();
    if (!delimiter || delimiter === "\n") return { type: SedTokenType.ERROR, value: "y", line: startLine, column: startColumn };
    const source = this.readEscapedString(delimiter);
    if (source === null || this.peek() !== delimiter) return { type: SedTokenType.ERROR, value: "unterminated transliteration source", line: startLine, column: startColumn };
    this.advance();
    const dest = this.readEscapedString(delimiter);
    if (dest === null || this.peek() !== delimiter) return { type: SedTokenType.ERROR, value: "unterminated transliteration dest", line: startLine, column: startColumn };
    this.advance();
    let nextChar = this.peek();
    while (nextChar === " " || nextChar === "\t") { this.advance(); nextChar = this.peek(); }
    if (nextChar !== "" && nextChar !== ";" && nextChar !== "\n" && nextChar !== "}") return { type: SedTokenType.ERROR, value: "extra text at the end of a transform command", line: startLine, column: startColumn };
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
      if (ch === "\n") { if (text.endsWith("\\")) { text = `${text.slice(0, -1)}\n`; this.advance(); continue; } break; }
      if (ch === "\\" && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        if (next === "n") { text += "\n"; this.advance(); this.advance(); continue; }
        if (next === "t") { text += "\t"; this.advance(); this.advance(); continue; }
        if (next === "r") { text += "\r"; this.advance(); this.advance(); continue; }
      }
      text += this.advance();
    }
    return { type: SedTokenType.TEXT_CMD, value: cmd, text, line: startLine, column: startColumn };
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
  constructor(scripts, extendedRegex = false) { this.scripts = scripts; this.extendedRegex = extendedRegex; this.tokens = []; this.pos = 0; }
  parse() {
    const allCommands =[];
    for (const script of this.scripts) {
      const lexer = new SedLexer(script); this.tokens = lexer.tokenize(); this.pos = 0;
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
      case SedTokenType.SUBSTITUTE: return this.parseSubstituteFromToken(token, address);
      case SedTokenType.TRANSLITERATE: return this.parseTransliterateFromToken(token, address);
      case SedTokenType.LABEL_DEF: this.advance(); return { command: { type: "label", name: token.label || "" } };
      case SedTokenType.BRANCH: this.advance(); return { command: { type: "branch", address, label: token.label } };
      case SedTokenType.BRANCH_ON_SUBST: this.advance(); return { command: { type: "branchOnSubst", address, label: token.label } };
      case SedTokenType.BRANCH_ON_NO_SUBST: this.advance(); return { command: { type: "branchOnNoSubst", address, label: token.label } };
      case SedTokenType.TEXT_CMD: this.advance(); return this.parseTextCommand(token, address);
      case SedTokenType.FILE_READ: this.advance(); return { command: { type: "readFile", address, filename: token.filename || "" } };
      case SedTokenType.FILE_READ_LINE: this.advance(); return { command: { type: "readFileLine", address, filename: token.filename || "" } };
      case SedTokenType.FILE_WRITE: this.advance(); return { command: { type: "writeFile", address, filename: token.filename || "" } };
      case SedTokenType.FILE_WRITE_LINE: this.advance(); return { command: { type: "writeFirstLine", address, filename: token.filename || "" } };
      case SedTokenType.EXECUTE: this.advance(); return { command: { type: "execute", address, command: token.command } };
      case SedTokenType.VERSION: this.advance(); return { command: { type: "version", address, minVersion: token.label } };
      case SedTokenType.LBRACE: return this.parseGroup(address);
      case SedTokenType.RBRACE: return { command: null };
      case SedTokenType.ERROR: return { command: null, error: `invalid command: ${token.value}` };
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
    if (map[cmd]) return { command: { type: map[cmd], address } };
    return { command: null, error: `unknown command: ${cmd}` };
  }
  parseSubstituteFromToken(token, address) {
    this.advance(); const flags = token.flags || ""; let nthOccurrence;
    const numMatch = flags.match(/(\d+)/); if (numMatch) nthOccurrence = parseInt(numMatch[1], 10);
    return {
      command: {
        type: "substitute", address, pattern: token.pattern || "", replacement: token.replacement || "",
        global: flags.includes("g") || flags.includes("I"), ignoreCase: flags.includes("i") || flags.includes("I"),
        printOnMatch: flags.includes("p"), nthOccurrence, extendedRegex: this.extendedRegex
      }
    };
  }
  parseTransliterateFromToken(token, address) {
    this.advance(); const source = token.source || ""; const dest = token.dest || "";
    if (source.length !== dest.length) return { command: null, error: "transliteration sets must have same length" };
    return { command: { type: "transliterate", address, source, dest } };
  }
  parseTextCommand(token, address) {
    const cmd = token.value; const text = token.text || "";
    if (cmd === "a") return { command: { type: "append", address, text } };
    if (cmd === "i") return { command: { type: "insert", address, text } };
    if (cmd === "c") return { command: { type: "change", address, text } };
    return { command: null, error: `unknown text command: ${cmd}` };
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
    if (!this.check(SedTokenType.RBRACE)) return { command: null, error: "unmatched brace in grouped commands" };
    this.advance(); return { command: { type: "group", address, commands } };
  }
  parseAddressRange() {
    if (this.check(SedTokenType.COMMA)) return { error: "expected context address" };
    const start = this.parseAddress(); if (start === undefined) return undefined;
    let end;
    if (this.check(SedTokenType.RELATIVE_OFFSET)) { const token = this.advance(); end = { offset: token.offset || 0 }; } 
    else if (this.check(SedTokenType.COMMA)) { this.advance(); end = this.parseAddress(); if (end === undefined) return { error: "expected context address" }; }
    return { address: { start, end } };
  }
  parseAddress() {
    const token = this.peek();
    switch (token.type) {
      case SedTokenType.NUMBER: this.advance(); return token.value;
      case SedTokenType.DOLLAR: this.advance(); return "$";
      case SedTokenType.PATTERN: this.advance(); return { pattern: token.pattern || token.value };
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

function parseMultipleScripts(scripts, extendedRegex = false) {
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
  const parser = new SedParser([combinedScript], extendedRegex || extendedRegexFromComment);
  const result = parser.parse();
  return { ...result, silentMode, extendedRegexMode: extendedRegexFromComment };
}

// ==========================================
// 4. Executor
// ==========================================

function createInitialState(totalLines, filename, rangeStates) {
  return {
    patternSpace: "", holdSpace: "", lineNumber: 0, totalLines,
    deleted: false, printed: false, quit: false, quitSilent: false,
    exitCode: undefined, errorMessage: undefined, appendBuffer: [],
    substitutionMade: false, lineNumberOutput:[], nCommandOutput:[],
    restartCycle: false, inDRestartedCycle: false, currentFilename: filename,
    pendingFileReads: [], pendingFileWrites:[], rangeStates: rangeStates || new Map(), linesConsumedInCycle: 0
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
      const pattern = normalizeForJs(breToEre(rawPattern));
      return new RegExp(pattern).test(line);
    } catch { return false; }
  }
  return false;
}

function serializeRange(range) {
  const serializeAddr = addr => {
    if (addr === undefined) return "undefined"; if (addr === "$") return "$";
    if (typeof addr === "number") return String(addr);
    if ("pattern" in addr) return `/${addr.pattern}/`;
    if ("first" in addr) return `${addr.first}~${addr.step}`;
    return "unknown";
  };
  return `${serializeAddr(range.start)},${serializeAddr(range.end)}`;
}

function isInRangeInternal(range, lineNum, totalLines, line, rangeStates, state) {
  if (!range || (!range.start && !range.end)) return true;
  const { start, end } = range;
  if (start !== undefined && end === undefined) return matchesAddress(start, lineNum, totalLines, line, state);

  if (start !== undefined && end !== undefined) {
    const hasPatternStart = typeof start === "object" && "pattern" in start;
    const hasPatternEnd = typeof end === "object" && "pattern" in end;
    const hasRelativeEnd = isRelativeOffset(end);

    if (hasRelativeEnd && rangeStates) {
      const rangeKey = serializeRange(range); let rangeState = rangeStates.get(rangeKey);
      if (!rangeState) { rangeState = { active: false }; rangeStates.set(rangeKey, rangeState); }
      if (!rangeState.active) {
        if (matchesAddress(start, lineNum, totalLines, line, state)) {
          rangeState.active = true; rangeState.startLine = lineNum; rangeStates.set(rangeKey, rangeState);
          if (end.offset === 0) { rangeState.active = false; rangeStates.set(rangeKey, rangeState); }
          return true;
        }
        return false;
      } else {
        const startLine = rangeState.startLine || lineNum;
        if (lineNum >= startLine + end.offset) { rangeState.active = false; rangeStates.set(rangeKey, rangeState); }
        return true;
      }
    }

    if (!hasPatternStart && !hasPatternEnd && !hasRelativeEnd) {
      const startNum = typeof start === "number" ? start : start === "$" ? totalLines : 1;
      const endNum = typeof end === "number" ? end : end === "$" ? totalLines : totalLines;
      if (startNum <= endNum) return lineNum >= startNum && lineNum <= endNum;
      if (rangeStates) {
        const rangeKey = serializeRange(range); let rangeState = rangeStates.get(rangeKey);
        if (!rangeState) { rangeState = { active: false }; rangeStates.set(rangeKey, rangeState); }
        if (!rangeState.completed) { if (lineNum >= startNum) { rangeState.completed = true; rangeStates.set(rangeKey, rangeState); return true; } }
        return false;
      }
      return false;
    }

    if (rangeStates) {
      const rangeKey = serializeRange(range); let rangeState = rangeStates.get(rangeKey);
      if (!rangeState) { rangeState = { active: false }; rangeStates.set(rangeKey, rangeState); }
      if (!rangeState.active) {
        if (rangeState.completed) return false;
        let startMatches = typeof start === "number" ? lineNum >= start : matchesAddress(start, lineNum, totalLines, line, state);
        if (startMatches) {
          rangeState.active = true; rangeState.startLine = lineNum; rangeStates.set(rangeKey, rangeState);
          if (matchesAddress(end, lineNum, totalLines, line, state)) { rangeState.active = false; if (typeof start === "number") rangeState.completed = true; rangeStates.set(rangeKey, rangeState); }
          return true;
        }
        return false;
      } else {
        if (matchesAddress(end, lineNum, totalLines, line, state)) { rangeState.active = false; if (typeof start === "number") rangeState.completed = true; rangeStates.set(rangeKey, rangeState); }
        return true;
      }
    }
    return matchesAddress(start, lineNum, totalLines, line, state);
  }
  return true;
}

function isInRange(range, lineNum, totalLines, line, rangeStates, state) {
  const result = isInRangeInternal(range, lineNum, totalLines, line, rangeStates, state);
  return range?.negated ? !result : result;
}

function globalReplace(input, regex, _replacement, replaceFn) {
  let result = ""; let pos = 0; let skipZeroLengthAtNextPos = false;
  while (pos <= input.length) {
    regex.lastIndex = pos; const match = regex.exec(input);
    if (!match) { result += input.slice(pos); break; }
    if (match.index !== pos) { result += input.slice(pos, match.index); pos = match.index; skipZeroLengthAtNextPos = false; continue; }
    const matchedText = match[0]; const groups = match.slice(1);
    if (skipZeroLengthAtNextPos && matchedText.length === 0) { if (pos < input.length) { result += input[pos]; pos++; } else { break; } skipZeroLengthAtNextPos = false; continue; }
    result += replaceFn(matchedText, groups); skipZeroLengthAtNextPos = false;
    if (matchedText.length === 0) { if (pos < input.length) { result += input[pos]; pos++; } else { break; } } else { pos += matchedText.length; skipZeroLengthAtNextPos = true; }
  }
  return result;
}

function processReplacement(replacement, match, groups) {
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
        if (next === "U") { caseMode = "upper"; i += 2; continue; }
        if (next === "L") { caseMode = "lower"; i += 2; continue; }
        if (next === "E") { caseMode = "none";  i += 2; continue; }
        if (next === "u") { nextCase = "upper"; i += 2; continue; }
        if (next === "l") { nextCase = "lower"; i += 2; continue; }
        
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

async function executeCommand(cmd, state, shell=null) {
  const { lineNumber, totalLines, patternSpace } = state;
  if (cmd.type === "label") return;
  if (!isInRange(cmd.address, lineNumber, totalLines, patternSpace, state.rangeStates, state)) return;

  switch (cmd.type) {
    case "substitute": {
      let flags = "";
      if (cmd.global) flags += "g";
      if (cmd.ignoreCase) flags += "i";
      let rawPattern = cmd.pattern;
      if (rawPattern === "" && state.lastPattern) rawPattern = state.lastPattern;
      else if (rawPattern !== "") state.lastPattern = rawPattern;
      const pattern = normalizeForJs(cmd.extendedRegex ? rawPattern : breToEre(rawPattern));

      try {
        const regex = new RegExp(pattern, flags);
        const hasMatch = regex.test(state.patternSpace);
        regex.lastIndex = 0;
        if (hasMatch) {
          state.substitutionMade = true;
          if (cmd.nthOccurrence && cmd.nthOccurrence > 0 && !cmd.global) {
            let count = 0;
            const nthRegex = new RegExp(pattern, `g${cmd.ignoreCase ? "i" : ""}`);
            state.patternSpace = state.patternSpace.replace(nthRegex, (match, ...args) => {
              count++;
              if (count === cmd.nthOccurrence) {
                const groups = typeof args[args.length - 1] === 'object' ? args.slice(0, -3) : args.slice(0, -2);
                return processReplacement(cmd.replacement, match, groups);
              }
              return match;
            });
          } else if (cmd.global) {
            const globalRegex = new RegExp(pattern, `g${cmd.ignoreCase ? "i" : ""}`);
            state.patternSpace = globalReplace(state.patternSpace, globalRegex, cmd.replacement, (match, groups) => processReplacement(cmd.replacement, match, groups));
          } else {
            state.patternSpace = state.patternSpace.replace(regex, (match, ...args) => {
              const groups = typeof args[args.length - 1] === 'object' ? args.slice(0, -3) : args.slice(0, -2);
              return processReplacement(cmd.replacement, match, groups);
            });
          }
          if (cmd.printOnMatch) state.lineNumberOutput.push(state.patternSpace);
        }
      } catch (e) { /* ignore */ }
      break;
    }
    case "print": state.lineNumberOutput.push(state.patternSpace); break;
    case "printFirstLine": {
      const newlineIdx = state.patternSpace.indexOf("\n");
      state.lineNumberOutput.push(newlineIdx !== -1 ? state.patternSpace.slice(0, newlineIdx) : state.patternSpace); break;
    }
    case "delete": state.deleted = true; break;
    case "deleteFirstLine": {
      const newlineIdx = state.patternSpace.indexOf("\n");
      if (newlineIdx !== -1) { state.patternSpace = state.patternSpace.slice(newlineIdx + 1); state.restartCycle = true; state.inDRestartedCycle = true; }
      else { state.deleted = true; } break;
    }
    case "zap": state.patternSpace = ""; break;
    case "append": state.appendBuffer.push(cmd.text); break;
    case "insert": state.appendBuffer.unshift(`__INSERT__${cmd.text}`); break;
    case "change": state.deleted = true; state.changedText = cmd.text; break;
    case "hold": state.holdSpace = state.patternSpace; break;
    case "holdAppend": state.holdSpace = state.holdSpace ? `${state.holdSpace}\n${state.patternSpace}` : state.patternSpace; break;
    case "get": state.patternSpace = state.holdSpace; break;
    case "getAppend": state.patternSpace += `\n${state.holdSpace}`; break;
    case "exchange": { const temp = state.patternSpace; state.patternSpace = state.holdSpace; state.holdSpace = temp; break; }
    case "next": state.printed = true; break;
    case "quit": state.quit = true; if (cmd.exitCode !== undefined) state.exitCode = cmd.exitCode; break;
    case "quitSilent": state.quit = true; state.quitSilent = true; if (cmd.exitCode !== undefined) state.exitCode = cmd.exitCode; break;
    case "list": state.lineNumberOutput.push(escapeForList(state.patternSpace)); break;
    case "printFilename": if (state.currentFilename) state.lineNumberOutput.push(state.currentFilename); break;
    case "readFile": state.pendingFileReads.push({ filename: cmd.filename, wholeFile: true }); break;
    case "readFileLine": state.pendingFileReads.push({ filename: cmd.filename, wholeFile: false }); break;
    case "writeFile": state.pendingFileWrites.push({ filename: cmd.filename, content: `${state.patternSpace}\n` }); break;
    case "writeFirstLine": { const newlineIdx = state.patternSpace.indexOf("\n"); state.pendingFileWrites.push({ filename: cmd.filename, content: `${newlineIdx !== -1 ? state.patternSpace.slice(0, newlineIdx) : state.patternSpace}\n` }); break; }
    // Handling an unsupported command in the 'execute' case
    case "execute":
      if(shell){
            // The 'e' command (standalone)
            if (cmd.command) {
              // Scenario: e command (ignores pattern space, just emits output)
              const output = await ctx.shell(cmd.command);
              state.lineNumberOutput.push(output); 
              break;
            } else {
              // Scenario: s/pattern/replacement/e (executes pattern space)
              const output = await ctx.shell(state.patternSpace);
              state.patternSpace = output.trimEnd();
              break;
            }
      };
      
    state.errorMessage = "sed: e command is not supported in this environment";

    state.quit = true;
    break;
    case "transliterate": { let result = ""; for (const char of state.patternSpace) { const idx = cmd.source.indexOf(char); result += idx !== -1 ? cmd.dest[idx] : char; } state.patternSpace = result; break; }
    case "lineNumber": state.lineNumberOutput.push(String(state.lineNumber)); break;
  }
}

async function executeCommands(commands, state, ctx) {
  const labelIndex = new Map();
  for (let i = 0; i < commands.length; i++) if (commands[i].type === "label") labelIndex.set(commands[i].name, i);
  let i = 0;
  while (i < commands.length) {
    if (state.deleted || state.quit || state.quitSilent || state.restartCycle) break;
    const cmd = commands[i];

    if (cmd.type === "next") {
      if (isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state)) {
        state.nCommandOutput.push(state.patternSpace);
        if (ctx && ctx.currentLineIndex + state.linesConsumedInCycle + 1 < ctx.lines.length) {
          state.linesConsumedInCycle++; state.patternSpace = ctx.lines[ctx.currentLineIndex + state.linesConsumedInCycle];
          state.lineNumber = ctx.currentLineIndex + state.linesConsumedInCycle + 1; state.substitutionMade = false;
        } else { state.quit = true; state.deleted = true; break; }
      }
      i++; continue;
    }

    if (cmd.type === "nextAppend") {
      if (isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state)) {
        if (ctx && ctx.currentLineIndex + state.linesConsumedInCycle + 1 < ctx.lines.length) {
          state.linesConsumedInCycle++; state.patternSpace += `\n${ctx.lines[ctx.currentLineIndex + state.linesConsumedInCycle]}`;
          state.lineNumber = ctx.currentLineIndex + state.linesConsumedInCycle + 1;
        } else { state.quit = true; break; }
      }
      i++; continue;
    }

    if (["branch", "branchOnSubst", "branchOnNoSubst"].includes(cmd.type)) {
      if (isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state)) {
        const shouldBranch = cmd.type === "branch" || (cmd.type === "branchOnSubst" && state.substitutionMade) || (cmd.type === "branchOnNoSubst" && !state.substitutionMade);
        if (cmd.type === "branchOnSubst" && state.substitutionMade) state.substitutionMade = false;
        if (shouldBranch) {
          if (cmd.label) {
            const target = labelIndex.get(cmd.label);
            if (target !== undefined) { i = target; continue; }
            state.branchRequest = cmd.label; break;
          }
          break;
        }
      }
      i++; continue;
    }

    if (cmd.type === "group") {
      if (isInRange(cmd.address, state.lineNumber, state.totalLines, state.patternSpace, state.rangeStates, state)) {
        await executeCommands(cmd.commands, state, ctx);
        if (state.branchRequest) {
          const target = labelIndex.get(state.branchRequest);
          if (target !== undefined) { state.branchRequest = undefined; i = target; continue; }
          break;
        }
      }
      i++; continue;
    }

    await executeCommand(cmd, state, ctx.shell); i++;
  }
  return state.linesConsumedInCycle;
}

// ==========================================
// 5. Integration / Main Process
// ==========================================

async function processContent(content, commands, silent, options = {}) {
  const { filename, vfs } = options;
  const inputEndsWithNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const totalLines = lines.length; let output = ""; let exitCode; let lastOutputWasAutoPrint = false;
  const appendOutput = text => { output += text; };

  let holdSpace = ""; let lastPattern; const rangeStates = new Map();
  const fileLineCache = new Map(); const fileLinePositions = new Map(); const fileWrites = new Map();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const state = { ...createInitialState(totalLines, filename, rangeStates), patternSpace: lines[lineIndex], holdSpace, lastPattern, lineNumber: lineIndex + 1 };
    const ctx = { lines, currentLineIndex: lineIndex, shell:options.shell };

    let cycleIterations = 0; state.linesConsumedInCycle = 0;
    do {
      cycleIterations++; if (cycleIterations > 10000) break;
      state.restartCycle = false; state.pendingFileReads = []; state.pendingFileWrites =[];
      await executeCommands(commands, state, ctx);

      if (vfs) {
        for (const read of state.pendingFileReads) {
          const filePath = read.filename;
          try {
            if (read.wholeFile) { if (vfs[filePath] !== undefined) state.appendBuffer.push(vfs[filePath].replace(/\n$/, "")); } 
            else {
              if (!fileLineCache.has(filePath)) { if (vfs[filePath] !== undefined) { fileLineCache.set(filePath, vfs[filePath].split("\n")); fileLinePositions.set(filePath, 0); } }
              const fileLines = fileLineCache.get(filePath); const pos = fileLinePositions.get(filePath);
              if (fileLines && pos !== undefined && pos < fileLines.length) { state.appendBuffer.push(fileLines[pos]); fileLinePositions.set(filePath, pos + 1); }
            }
          } catch (e) { /* Ignore */ }
        }
        for (const write of state.pendingFileWrites) { const filePath = write.filename; fileWrites.set(filePath, (fileWrites.get(filePath) || "") + write.content); }
      }
    } while (state.restartCycle && !state.deleted && !state.quit && !state.quitSilent);

    lineIndex += state.linesConsumedInCycle; holdSpace = state.holdSpace; lastPattern = state.lastPattern;

    if (!silent) for (const ln of state.nCommandOutput) appendOutput(`${ln}\n`);
    const hadLineNumberOutput = state.lineNumberOutput.length > 0;
    for (const ln of state.lineNumberOutput) appendOutput(`${ln}\n`);

    const inserts =[]; const appends =[];
    for (const item of state.appendBuffer) { if (item.startsWith("__INSERT__")) inserts.push(item.slice(10)); else appends.push(item); }
    for (const text of inserts) appendOutput(`${text}\n`);

    let hadPatternSpaceOutput = false;
    if (!state.deleted && !state.quitSilent) {
      if (silent) { if (state.printed) { appendOutput(`${state.patternSpace}\n`); hadPatternSpaceOutput = true; } } 
      else { appendOutput(`${state.patternSpace}\n`); hadPatternSpaceOutput = true; }
    } else if (state.changedText !== undefined) { appendOutput(`${state.changedText}\n`); hadPatternSpaceOutput = true; }
    for (const text of appends) appendOutput(`${text}\n`);

    const hadOutput = hadLineNumberOutput || hadPatternSpaceOutput;
    lastOutputWasAutoPrint = hadOutput && appends.length === 0;

    if (state.quit || state.quitSilent) {
      if (state.exitCode !== undefined) exitCode = state.exitCode;
      if (state.errorMessage) return { output: "", exitCode: exitCode || 1, errorMessage: state.errorMessage }; break;
    }
  }

  if (vfs) { for (const [filePath, fileContent] of fileWrites) vfs[filePath] = fileContent; }
  if (!inputEndsWithNewline && lastOutputWasAutoPrint && output.endsWith("\n")) output = output.slice(0, -1);
  return { output, exitCode };
}

// ==========================================
// 6. Public API / CLI Arg Parser
// ==========================================

function parseShellString(str) {
  const args =[]; let current = ''; let inQuotes = false; let quoteChar = null; let escape = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) { current += char; escape = false; continue; }
    if (char === '\\') { escape = true; current += char; continue; }
    if (inQuotes) { if (char === quoteChar) inQuotes = false; else current += char; } 
    else {
      if (char === "'" || char === '"') { inQuotes = true; quoteChar = char; }
      else if (char === ' ' || char === '\t') { if (current.length > 0) { args.push(current); current = ''; } }
      else { current += char; }
    }
  }
  if (current.length > 0) args.push(current);
  return args;
}

export default async function sed(commandStr, options = {}) {
  const args = Array.isArray(commandStr) ? commandStr : parseShellString(commandStr);
  const vfs = options.vfs || {};
  const shell = options.shell || null;
  let stdin = options.stdin !== undefined ? options.stdin : "";
  
  const scripts =[]; let silent = false; let inPlace = false; let extendedRegex = false; const files = [];
  let implicitScript =[];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["-n", "--quiet", "--silent"].includes(arg)) silent = true;
    else if (arg === "-i" || arg === "--in-place" || arg.startsWith("-i")) inPlace = true;
    else if (["-E", "-r", "--regexp-extended"].includes(arg)) extendedRegex = true;
    else if (arg === "-e") { if (i + 1 < args.length) scripts.push(args[++i]); }
    else if (arg.startsWith("--")) throw new Error(`sed: unknown option ${arg}`);
    else if (arg === "-") files.push(arg);
    else if (arg.startsWith("-") && arg.length > 1) {
      if (arg.includes("n")) silent = true;
      if (arg.includes("i")) inPlace = true;
      if (arg.includes("E") || arg.includes("r")) extendedRegex = true;
      if (arg.includes("e") && !arg.includes("n") && !arg.includes("i") && i + 1 < args.length) scripts.push(args[++i]);
    } else {
      if (options.stdin !== undefined && !inPlace) { implicitScript.push(arg); } 
      else {
        if (scripts.length === 0 && implicitScript.length === 0) implicitScript.push(arg);
        else files.push(arg);
      }
    }
  }

  if (implicitScript.length > 0) scripts.push(implicitScript.join(" "));
  if (scripts.length === 0) scripts.push("");

  const { commands, error, silentMode, extendedRegexMode } = parseMultipleScripts(scripts, extendedRegex);
  if (error) throw new Error(`sed: ${error}`);

  const effectiveSilent = !!(silent || silentMode);

  if (inPlace) {
    if (files.length === 0) throw new Error("sed: -i requires at least one file argument");
    for (const file of files) {
      if (file === "-") continue;
      if (!(file in vfs)) throw new Error(`sed: ${file}: No such file or directory`);
      const fileContent = vfs[file];
      const result = await processContent(fileContent, commands, effectiveSilent, { filename: file, vfs, shell});
      if (result.errorMessage) throw new Error(result.errorMessage);
      vfs[file] = result.output;
    }
    return "";
  }

  let content = "";
  if (files.length === 0) {
    content = stdin;
    const result = await processContent(content, commands, effectiveSilent, { vfs, shell });
    if (result.errorMessage) throw new Error(result.errorMessage);
    return result.output;
  }

  let stdinConsumed = false;
  for (const file of files) {
    let fileContent;
    if (file === "-") { if (stdinConsumed) fileContent = ""; else { fileContent = stdin; stdinConsumed = true; } } 
    else {
      if (!(file in vfs)) throw new Error(`sed: ${file}: No such file or directory`);
      fileContent = vfs[file];
    }
    if (content.length > 0 && fileContent.length > 0 && !content.endsWith("\n")) content += "\n";
    content += fileContent;
  }

  const result = await processContent(content, commands, effectiveSilent, { filename: files.length === 1 ? files[0] : undefined, vfs, shell });
  if (result.errorMessage) throw new Error(result.errorMessage);
  return result.output;
}
