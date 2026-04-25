/**
 * Vanilla JS `sed` Implementation with VFS Support
 */
/// breToEre normalizeForJs escapeForList

import {breToEre, normalizeForJs, escapeForList} from "./regex.js";


import {parseMultipleScripts} from "./parser.js";



// ==========================================
// 4. Executor
// ==========================================

function createInitialState(totalLines, filename, rangeStates) {
  return {
    patternSpace: "", holdSpace: "", lineNumber: 0, totalLines,
    deleted: false, printed: false, quit: false, quitSilent: false,
    exitCode: undefined, errorMessage: undefined, appendBuffer: [],
    substitutionMade: false, lineNumberOutput: [], nCommandOutput:[],
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
        if (next === "E") { caseMode = "none"; i += 2; continue; }
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
    if (cmd.global) doReplace = true;
    else if (cmd.nthOccurrence && count === cmd.nthOccurrence) doReplace = true;
    else if (!cmd.global && !cmd.nthOccurrence && count === 1) doReplace = true;

    if (doReplace) {
      matchedAny = true;
      let replaced = processReplacement(cmd.replacement, matchedText, groups);
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

async function executeCommand(cmd, state, shell) {
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
        const execRegex = new RegExp(pattern, "g" + (cmd.ignoreCase ? "i" : ""));
        const testRegex = new RegExp(pattern, cmd.ignoreCase ? "i" : "");
        if (testRegex.test(state.patternSpace)) {
          const { result, matchedAny } = await doAsyncReplace(state.patternSpace, execRegex, cmd, shell);
          if (matchedAny) {
            state.substitutionMade = true;
            state.patternSpace = result;
            if (cmd.printOnMatch) state.lineNumberOutput.push(state.patternSpace);
          }
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
    case "holdAppend": state.holdSpace += `\n${state.patternSpace}`; break;
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
    case "execute": {
      if (cmd.command) {
        if (shell) { let out = await shell(cmd.command); if (out.endsWith("\n")) out = out.slice(0, -1); state.lineNumberOutput.push(out); } 
        else { state.errorMessage = "sed: e command requires a shell executor"; state.quit = true; }
      } else {
        if (shell) { let out = await shell(state.patternSpace); if (out.endsWith("\n")) out = out.slice(0, -1); state.patternSpace = out; } 
        else { state.errorMessage = "sed: e command requires a shell executor"; state.quit = true; }
      }
      break;
    }
    case "transliterate": { let result = ""; for (const char of state.patternSpace) { const idx = cmd.source.indexOf(char); result += idx !== -1 ? cmd.dest[idx] : char; } state.patternSpace = result; break; }
    case "lineNumber": state.lineNumberOutput.push(String(state.lineNumber)); break;
  }
}

async function executeCommands(commands, state, ctx, shell) {
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
        await executeCommands(cmd.commands, state, ctx, shell);
        if (state.branchRequest) {
          const target = labelIndex.get(state.branchRequest);
          if (target !== undefined) { state.branchRequest = undefined; i = target; continue; }
          break;
        }
      }
      i++; continue;
    }

    await executeCommand(cmd, state, shell); i++;
  }
  return state.linesConsumedInCycle;
}

// ==========================================
// 5. Integration / Main Process
// ==========================================

async function processContent(content, commands, silent, options = {}) {
  const { filename, vfs, shell } = options;
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const totalLines = lines.length; let output = ""; let exitCode;
  const appendOutput = text => { output += text; };

  let holdSpace = ""; let lastPattern; const rangeStates = new Map();
  const fileLineCache = new Map(); const fileLinePositions = new Map(); const fileWrites = new Map();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const state = { ...createInitialState(totalLines, filename, rangeStates), patternSpace: lines[lineIndex], holdSpace, lastPattern, lineNumber: lineIndex + 1 };
    const ctx = { lines, currentLineIndex: lineIndex };

    let cycleIterations = 0; state.linesConsumedInCycle = 0;
    do {
      cycleIterations++; if (cycleIterations > 10000) break;
      state.restartCycle = false; state.pendingFileReads =[]; state.pendingFileWrites =[];
      await executeCommands(commands, state, ctx, shell);

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
    for (const ln of state.lineNumberOutput) appendOutput(`${ln}\n`);

    const inserts =[]; const appends =[];
    for (const item of state.appendBuffer) { if (item.startsWith("__INSERT__")) inserts.push(item.slice(10)); else appends.push(item); }
    for (const text of inserts) appendOutput(`${text}\n`);

    if (!state.deleted && !state.quitSilent) {
      if (silent) { if (state.printed) appendOutput(`${state.patternSpace}\n`); }
      else { appendOutput(`${state.patternSpace}\n`); }
    } else if (state.changedText !== undefined) { appendOutput(`${state.changedText}\n`); }
    for (const text of appends) appendOutput(`${text}\n`);

    if (state.quit || state.quitSilent) {
      if (state.exitCode !== undefined) exitCode = state.exitCode;
      if (state.errorMessage) return { output: "", exitCode: exitCode || 1, errorMessage: state.errorMessage }; break;
    }
  }

  if (vfs) { for (const[filePath, fileContent] of fileWrites) vfs[filePath] = fileContent; }
  
  // Conform to `execa` stripFinalNewline defaults to perfectly align comparisons
  if (output.endsWith("\n")) output = output.slice(0, -1);
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
  if (stdin === null) stdin = "";

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

  const { commands, error, silentMode } = parseMultipleScripts(scripts, extendedRegex);
  if (error) throw new Error(`sed: ${error}`);

  const effectiveSilent = !!(silent || silentMode);

  if (inPlace) {
    if (files.length === 0) throw new Error("sed: -i requires at least one file argument");
    for (const file of files) {
      if (file === "-") continue;
      if (!(file in vfs)) throw new Error(`sed: ${file}: No such file or directory`);
      const fileContent = vfs[file];
      const result = await processContent(fileContent, commands, effectiveSilent, { filename: file, vfs, shell });
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
