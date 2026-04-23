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

export class SedLexer {
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
