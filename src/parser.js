import {SedLexer} from "./lexer.js";

export class SedParser {
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
