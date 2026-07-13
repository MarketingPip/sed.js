import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sed from './index.js';

// ============================================================================
// Shared PRNG & utilities
// ============================================================================
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(1);
function setSeed(s) { rand = mulberry32(s); }
function ri(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
function choice(arr) { return arr[ri(0, arr.length - 1)]; }
function bool(p = 0.5) { return rand() < p; }

// ============================================================================
// Shared word pool (merged from both scripts)
// ============================================================================
const WORDS = [
  'foo', 'bar', 'baz', 'hello', 'world', 'a', 'ab', 'abc', 'test', '123', '456',
  'X', 'Y', 'Z', '', 'the quick brown fox', 'AAA', 'aaa', 'line'
];
function randWord() { return choice(WORDS); }
function randLine() {
  const n = ri(0, 4);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(randWord());
  return parts.join(' ');
}
function randRecordSet(n) {
  const r = [];
  for (let i = 0; i < n; i++) r.push(randLine());
  return r;
}

// ============================================================================
// Shared regex pool (merged from both scripts)
// ============================================================================
const REGEX_POOL = [
  { p: 'foo', pe: 'foo', g: 0 }, { p: 'bar', pe: 'bar', g: 0 },
  { p: 'a', pe: 'a', g: 0 }, { p: 'b', pe: 'b', g: 0 },
  { p: '[ab]', pe: '[ab]', g: 0 }, { p: '^a', pe: '^a', g: 0 },
  { p: 'o$', pe: 'o$', g: 0 }, { p: 'a.c', pe: 'a.c', g: 0 },
  { p: 'a*', pe: 'a*', g: 0 }, { p: 'a\\+', pe: 'a+', g: 0 },
  { p: '[0-9]', pe: '[0-9]', g: 0 }, { p: '[a-z]+', pe: '[a-z]+', g: 0 },
  { p: 'x\\?', pe: 'x?', g: 0 }, { p: '.', pe: '.', g: 0 },
  { p: 'lin.', pe: 'lin.', g: 0 },
  { p: '\\(foo\\)', pe: '(foo)', g: 1 },
  { p: '\\(a\\)\\(b\\)', pe: '(a)(b)', g: 2 },
  { p: '\\(.\\)\\(.\\)', pe: '(.)(.)', g: 2 },
  { p: '\\([a-z]*\\)', pe: '([a-z]*)', g: 1 },
  { p: '\\(foo\\)\\|(bar\\)', pe: '(foo)|(bar)', g: 2 },
];
function randRegexEntry() { return choice(REGEX_POOL); }
function randRegexPattern(extended) { const e = randRegexEntry(); return extended ? e.pe : e.p; }

// ============================================================================
// Shared random input generation
// ============================================================================
function randInput() {
  const nLines = ri(0, 8);
  const lines = [];
  for (let i = 0; i < nLines; i++) lines.push(randLine());
  let text = lines.join('\n');
  if (nLines > 0 && bool(0.85)) text += '\n';
  return text;
}

function randNullRecords() {
  const n = ri(0, 5);
  const recs = [];
  for (let i = 0; i < n; i++) {
    const parts = [];
    const lineCount = ri(1, 2);
    for (let j = 0; j < lineCount; j++) parts.push(randLine());
    recs.push(parts.join('\n'));
  }
  let content = recs.join('\0');
  if (n > 0 && bool(0.85)) content += '\0';
  return content;
}

// ============================================================================
// Shared address generation (from stdin fuzzer)
// ============================================================================
function randAddr(maxLine, extended, posix) {
  const kind = posix ? choice(['num', 'dollar', 'regex']) : choice(['num', 'dollar', 'regex', 'step']);
  if (kind === 'num') return String(ri(1, Math.max(1, maxLine)));
  if (kind === 'dollar') return '$';
  if (kind === 'step') return `${ri(1, 3)}~${ri(1, 3)}`;
  return `/${randRegexPattern(extended)}/`;
}

function randAddress(maxLine, extended, posix) {
  if (bool(0.4)) return '';
  const a1 = randAddr(maxLine, extended, posix);
  let addr = a1;
  if (bool(0.35)) {
    if (!posix && bool(0.3)) {
      addr += `,+${ri(0, 3)}`;
    } else {
      addr += `,${randAddr(maxLine, extended, posix)}`;
    }
  }
  if (bool(0.15)) addr += '!';
  return addr + ' ';
}

// ============================================================================
// Shared command generation (from stdin fuzzer)
// ============================================================================
const labelPool = ['A', 'B', 'loop'];

function randDelimiter() { return choice(['/', '#', '@']); }

function escapeForDelim(s, delim) {
  return s.split(delim).join('\\' + delim);
}

function randSubstitute(extended, posix) {
  const delim = randDelimiter();
  const entry = randRegexEntry();
  const pat = escapeForDelim(extended ? entry.pe : entry.p, delim);
  const replChoicesBase = posix ? ['X', 'Y&Z', 'repl', ''] : ['X', 'Y&Z', 'repl', 'a\\Ub\\Ec', '', '\\U&'];
  const replChoicesWithGroups = [];
  if (entry.g >= 1) replChoicesWithGroups.push('\\1', 'new-\\1');
  if (entry.g >= 2) replChoicesWithGroups.push('\\1-\\2', '\\2\\1');
  const repl = escapeForDelim(choice([...replChoicesBase, ...replChoicesWithGroups]), delim);
  let flags = '';
  if (bool(0.4)) flags += 'g';
  if (!posix && bool(0.2)) flags += 'i';
  if (bool(0.15)) flags += String(ri(1, 3));
  if (bool(0.15)) flags += 'p';
  return `s${delim}${pat}${delim}${repl}${delim}${flags}`;
}

function randTransliterate() {
  const delim = randDelimiter();
  const chars = 'abcXYZ123';
  const len = ri(1, 4);
  let src = '', dst = '';
  const used = new Set();
  while (src.length < len) {
    const c = chars[ri(0, chars.length - 1)];
    if (used.has(c)) continue;
    used.add(c); src += c; dst += chars[ri(0, chars.length - 1)];
  }
  return `y${delim}${escapeForDelim(src, delim)}${delim}${escapeForDelim(dst, delim)}${delim}`;
}

function randSimpleCmd(posix) {
  const cmds = posix
    ? ['p', 'P', 'd', 'D', 'h', 'H', 'g', 'G', 'x', 'n', 'N', '=', 'l']
    : ['p', 'P', 'd', 'D', 'h', 'H', 'g', 'G', 'x', 'n', 'N', 'z', '=', 'l'];
  return choice(cmds);
}

function randTextCmd() {
  const cmd = choice(['a', 'i', 'c']);
  const text = choice(['hello', 'inserted text', 'multi word text here', 'X']);
  return `${cmd}\\\n${text}`;
}

function randBranchCmd() { return choice(['b', 't', 'T']); }

function genScriptCommands(maxLine, extended, posix, depth = 0) {
  const n = ri(1, depth === 0 ? 6 : 3);
  const cmds = [];
  for (let i = 0; i < n; i++) {
    const addr = randAddress(maxLine, extended, posix);
    const kind = choice(['s', 's', 's', 'y', 'simple', 'simple', 'text', 'group']);
    if (kind === 'group' && depth < 1) {
      const inner = genScriptCommands(maxLine, extended, posix, depth + 1);
      cmds.push(`${addr}{${inner}}`);
    } else if (kind === 's') {
      cmds.push(`${addr}${randSubstitute(extended, posix)}`);
    } else if (kind === 'y') {
      cmds.push(`${addr}${randTransliterate()}`);
    } else if (kind === 'text') {
      cmds.push(`${addr}${randTextCmd()}`);
    } else {
      cmds.push(`${addr}${randSimpleCmd(posix)}`);
    }
  }
  return cmds.join('\n');
}

function maybeAddLabelAndBranches(cmds, maxLine, extended, posix) {
  if (!bool(0.06) || cmds.length < 2) return cmds;
  const labelPos = ri(0, cmds.length - 1);
  const label = choice(labelPool);
  const withLabel = [...cmds];
  withLabel.splice(labelPos, 0, `:${label}`);
  const nBranches = 1;
  for (let i = 0; i < nBranches; i++) {
    const addr = `/${randRegexPattern(extended)}/ `;
    const branchCmd = `${addr}${posix ? choice(['b', 't']) : randBranchCmd()} ${label}`;
    const pos = ri(0, withLabel.length);
    withLabel.splice(pos, 0, branchCmd);
  }
  return withLabel;
}

function genFullScript(extended, posix) {
  const maxLine = 8;
  const topCmds = genScriptCommands(maxLine, extended, posix).split('\n');
  const withBranches = maybeAddLabelAndBranches(topCmds, maxLine, extended, posix);
  return withBranches.join('\n');
}

function genCliArgs() {
  const flags = [];
  if (bool(0.3)) flags.push('-n');
  const posix = bool(0.25);
  let extended = false;
  if (posix) {
    flags.push('--posix');
  } else {
    extended = bool(0.15);
    if (extended) flags.push('-E');
  }
  return { flags, extended, posix };
}

function genTestCase() {
  const { flags, extended, posix } = genCliArgs();
  const script = genFullScript(extended, posix);
  const input = randInput();
  return { args: [...flags, script], input };
}

// ============================================================================
// Shared simple script generator (from -s/-z/M-flag fuzzer)
// ============================================================================
const SIMPLE_REGEX_POOL = ['a', 'foo', '[ab]', '^a', 'o$', '.', 'a*', '\\(a\\)\\(b\\)'];

function randSimpleScript() {
  const kind = choice(['s', 's', 'p', '=', 'yjoin', 'hgx']);
  if (kind === 's') {
    const pat = choice(SIMPLE_REGEX_POOL);
    const repl = choice(['X', 'Y&Z', '']);
    const flags = (bool(0.4) ? 'g' : '') + (bool(0.2) ? 'i' : '');
    return `s/${pat}/${repl}/${flags}`;
  }
  if (kind === 'p') return 'p';
  if (kind === '=') return '=';
  if (kind === 'yjoin') return ':a;N;$!ba;s/\n/,/g';
  if (kind === 'hgx') return '1h;2{x;G}';
  return 'p';
}

// ============================================================================
// Shared runners
// ============================================================================
function runRealSed(args, input) {
  try {
    const out = execFileSync('sed', args, { input, encoding: 'utf8', timeout: 800 });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString() };
  }
}

async function runJsSed(args, input, vfs) {
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('JS_TIMEOUT')), 800));
    const opts = vfs ? { vfs } : { stdin: input };
    const out = await Promise.race([sed(args, opts), timeout]);
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function isHangLike(err) { return /ETIMEDOUT|ENOBUFS/.test(err || ''); }
function isJsRunawayLike(err) { return /JS_TIMEOUT|output size limit exceeded/.test(err || ''); }

// ============================================================================
// MODE 1: Stdin fuzzer (comprehensive script generation)
// ============================================================================
async function fuzzStdin(count, seedStart) {
  const failures = [];
  let bothFailedCount = 0;
  let passCount = 0;

  for (let i = 0; i < count; i++) {
    setSeed(seedStart + i);
    const tc = genTestCase();
    let res;
    try {
      const real = runRealSed(tc.args, tc.input);
      const js = await runJsSed(tc.args, tc.input);

      if ((!real.ok && isHangLike(real.error)) || (!js.ok && isJsRunawayLike(js.error))) {
        res = { mismatch: false, bothFailed: true };
      } else if (real.ok && js.ok) {
        if (real.output !== js.output) {
          res = { mismatch: true, kind: 'output', real, js, tc };
        } else {
          res = { mismatch: false };
        }
      } else if (real.ok && !js.ok) {
        res = { mismatch: true, kind: 'js-threw-real-ok', real, js, tc };
      } else if (!real.ok && js.ok) {
        res = { mismatch: true, kind: 'real-failed-js-ok', real, js, tc };
      } else {
        res = { mismatch: false, bothFailed: true };
      }
    } catch (e) {
      res = { mismatch: true, kind: 'harness-exception', error: e.message, tc };
    }

    if (res.bothFailed) { bothFailedCount++; continue; }
    if (res.mismatch) failures.push({ seed: seedStart + i, ...res });
    else passCount++;
  }

  console.log(`\n========== STDIN MODE ==========`);
  console.log(`Total: ${count}  Pass: ${passCount}  BothFailed(skipped): ${bothFailedCount}  Mismatches: ${failures.length}`);
  const maxShow = 40;
  for (const f of failures.slice(0, maxShow)) {
    console.log('----------------------------------------');
    console.log('seed:', f.seed, 'kind:', f.kind);
    console.log('args:', JSON.stringify(f.tc.args));
    console.log('input:', JSON.stringify(f.tc.input));
    console.log('real:', JSON.stringify(f.real));
    console.log('js  :', JSON.stringify(f.js));
  }
  if (failures.length > maxShow) console.log(`... and ${failures.length - maxShow} more`);
  return failures.length;
}

// ============================================================================
// MODE 2: -s (separate files) fuzzer
// ============================================================================
async function fuzzSeparate(count, seedStart) {
  let mismatches = 0, tested = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'sedfuzz-s-'));
  try {
    for (let i = 0; i < count; i++) {
      setSeed(seedStart + i);
      const nFiles = ri(1, 3);
      const vfs = {};
      const filenames = [];
      for (let f = 0; f < nFiles; f++) {
        const name = `f${f}.txt`;
        const nLines = ri(0, 4);
        const content = randRecordSet(nLines).join('\n') + (nLines > 0 && bool(0.85) ? '\n' : '');
        vfs[name] = content;
        writeFileSync(join(tmp, name), content);
        filenames.push(name);
      }
      const script = randSimpleScript();
      const silent = bool(0.3);
      const args = [...(silent ? ['-n'] : []), '-s', script, ...filenames];
      const realArgs = [...(silent ? ['-n'] : []), '-s', script, ...filenames.map(f => join(tmp, f))];

      let real, js;
      try { real = { ok: true, out: execFileSync('sed', realArgs, { encoding: 'utf8', timeout: 800 }) }; }
      catch (e) { real = { ok: false, err: (e.stderr || e.message || '').toString() }; }
      try { js = { ok: true, out: await sed(args, { vfs }) }; }
      catch (e) { js = { ok: false, err: e.message }; }

      if (real.ok && js.ok) {
        tested++;
        if (real.out !== js.out) {
          mismatches++;
          if (mismatches <= 10) {
            console.log('---- -s MISMATCH ----');
            console.log('seed', seedStart + i, 'args', JSON.stringify(args), 'vfs', JSON.stringify(vfs));
            console.log('real:', JSON.stringify(real.out));
            console.log('js  :', JSON.stringify(js.out));
          }
        }
      } else if (real.ok !== js.ok) {
        if (!isHangLike(real.err)) {
          mismatches++;
          if (mismatches <= 10) {
            console.log('---- -s ERROR MISMATCH ----');
            console.log('seed', seedStart + i, 'args', JSON.stringify(args), 'vfs', JSON.stringify(vfs));
            console.log('real:', JSON.stringify(real));
            console.log('js  :', JSON.stringify(js));
          }
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n========== -s MODE ==========`);
  console.log(`-s: tested=${tested} mismatches=${mismatches} total=${count}`);
  return mismatches;
}

// ============================================================================
// MODE 3: -z (null-delimited records) fuzzer
// ============================================================================
async function fuzzNullData(count, seedStart) {
  let mismatches = 0, tested = 0;
  for (let i = 0; i < count; i++) {
    setSeed(seedStart + i);
    const input = randNullRecords();
    const script = randSimpleScript();
    const silent = bool(0.3);
    const args = [...(silent ? ['-n'] : []), '-z', script];

    let real, js;
    try { real = { ok: true, out: execFileSync('sed', args, { input, encoding: 'utf8', timeout: 800 }) }; }
    catch (e) { real = { ok: false, err: (e.stderr || e.message || '').toString() }; }
    try { js = { ok: true, out: await sed(args, { stdin: input }) }; }
    catch (e) { js = { ok: false, err: e.message }; }

    if (real.ok && js.ok) {
      tested++;
      if (real.out !== js.out) {
        mismatches++;
        if (mismatches <= 10) {
          console.log('---- -z MISMATCH ----');
          console.log('seed', seedStart + i, 'args', JSON.stringify(args), 'input', JSON.stringify(input));
          console.log('real:', JSON.stringify(real.out));
          console.log('js  :', JSON.stringify(js.out));
        }
      }
    } else if (real.ok !== js.ok) {
      if (!isHangLike(real.err)) {
        mismatches++;
        if (mismatches <= 10) {
          console.log('---- -z ERROR MISMATCH ----');
          console.log('seed', seedStart + i, 'args', JSON.stringify(args), 'input', JSON.stringify(input));
          console.log('real:', JSON.stringify(real));
          console.log('js  :', JSON.stringify(js));
        }
      }
    }
  }
  console.log(`\n========== -z MODE ==========`);
  console.log(`-z: tested=${tested} mismatches=${mismatches} total=${count}`);
  return mismatches;
}

// ============================================================================
// MODE 4: M/m flag fuzzer
// ============================================================================
function randMultilineInput() {
  const n = ri(2, 4);
  return randRecordSet(n).join('\n') + (bool(0.85) ? '\n' : '');
}

async function fuzzMultilineFlag(count, seedStart) {
  let mismatches = 0, tested = 0;
  for (let i = 0; i < count; i++) {
    setSeed(seedStart + i);
    const input = randMultilineInput();
    const nJoins = ri(1, 3);
    const joinPrefix = Array(nJoins).fill('N').join(';') + ';';
    const kind = choice(['s', 'addr']);
    const pat = choice(['^a', 'o$', '^foo$', '^$', 'a.c']);
    let script;
    if (kind === 's') {
      const repl = choice(['X', 'Y&Z']);
      script = `${joinPrefix}s/${pat}/${repl}/${bool(0.5) ? 'gM' : 'M'}`;
    } else {
      script = `${joinPrefix}/${pat}/${bool(0.5) ? 'M' : 'IM'}p`;
    }
    const silent = kind === 'addr';
    const args = [...(silent ? ['-n'] : []), script];

    let real, js;
    try { real = { ok: true, out: execFileSync('sed', args, { input, encoding: 'utf8', timeout: 800 }) }; }
    catch (e) { real = { ok: false, err: (e.stderr || e.message || '').toString() }; }
    try { js = { ok: true, out: await sed(args, { stdin: input }) }; }
    catch (e) { js = { ok: false, err: e.message }; }

    if (real.ok && js.ok) {
      tested++;
      if (real.out !== js.out) {
        mismatches++;
        if (mismatches <= 10) {
          console.log('---- M-flag MISMATCH ----');
          console.log('seed', seedStart + i, 'args', JSON.stringify(args), 'input', JSON.stringify(input));
          console.log('real:', JSON.stringify(real.out));
          console.log('js  :', JSON.stringify(js.out));
        }
      }
    } else if (real.ok !== js.ok) {
      if (!isHangLike(real.err)) {
        mismatches++;
        if (mismatches <= 10) {
          console.log('---- M-flag ERROR MISMATCH ----');
          console.log('seed', seedStart + i, 'args', JSON.stringify(args), 'input', JSON.stringify(input));
          console.log('real:', JSON.stringify(real));
          console.log('js  :', JSON.stringify(js));
        }
      }
    }
  }
  console.log(`\n========== M-flag MODE ==========`);
  console.log(`M-flag: tested=${tested} mismatches=${mismatches} total=${count}`);
  return mismatches;
}

// ============================================================================
// Main entry point
// ============================================================================
const countArg = parseInt(process.argv[2] || '500', 10);
const seedArg = parseInt(process.argv[3] || '1', 10);

const results = await Promise.all([
  fuzzStdin(countArg, seedArg),
  fuzzSeparate(countArg, seedArg + 100000),
  fuzzNullData(countArg, seedArg + 200000),
  fuzzMultilineFlag(countArg, seedArg + 300000),
]);

const totalMismatches = results.reduce((a, b) => a + b, 0);
console.log(`\n========== OVERALL ==========`);
console.log(`Total mismatches across all modes: ${totalMismatches}`);
process.exitCode = totalMismatches > 0 ? 1 : 0;
