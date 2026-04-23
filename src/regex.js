// ==========================================
// 1. Regex Utilities
// ==========================================

const POSIX_CLASSES = new Map([
  ["alnum", "a-zA-Z0-9"],["alpha", "a-zA-Z"], ["ascii", "\\x00-\\x7F"],["blank", " \\t"], ["cntrl", "\\x00-\\x1F\\x7F"],["digit", "0-9"],
  ["graph", "!-~"], ["lower", "a-z"],["print", " -~"],
  ["punct", "!-/:-@\\[-`{-~"],["space", " \\t\\n\\r\\f\\v"], ["upper", "A-Z"],["word", "a-zA-Z0-9_"], ["xdigit", "0-9A-Fa-f"]
]);

export function breToEre(pattern) {
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

export function normalizeForJs(pattern) {
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

export function escapeForList(input) {
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
