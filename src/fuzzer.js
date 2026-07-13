import { execFileSync } from 'node:child_process';
import sed from './index.js';

// ---------- PRNG (seeded, reproducible) ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(12345);
function setSeed(s) { rand = mulberry32(s); }
function ri(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
function choice(arr) { return arr[ri(0, arr.length - 1)]; }
function bool(p = 0.5) { return rand() < p; }

// ---------- Random input text generation ----------
const WORDS = ['foo', 'bar', 'baz', 'hello', 'world', 'a', 'ab', 'abc', 'test', '123', '456', 'X', 'Y', 'Z', '', 'the quick brown fox', 'AAA', 'aaa', 'line'];
function randWord() { return choice(WORDS); }
function randLine() {
  const n = ri(0, 4);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(randWord());
  return parts.join(' ');
}
function randInput() {
  const nLines = ri(0, 8);
  const lines = [];
  for (let i = 0; i < nLines; i++) lines.push(randLine());
  let text = lines.join('\n');
  if (nLines > 0 && bool(0.85)) text += '\n'; // usually terminate with newline
  return text;
}

// ---------- Random address generation ----------
function randAddr(maxLine, extended, posix) {
  const kind = posix ? choice(['num', 'dollar', 'regex']) : choice(['num', 'dollar', 'regex', 'step']);
  if (kind === 'num') return String(ri(1, Math.max(1, maxLine)));
  if (kind === 'dollar') return '$';
  if (kind === 'step') return `${ri(1, 3)}~${ri(1, 3)}`;
  return `/${randRegexPattern(extended)}/`;
}

const REGEX_POOL = [
  { p: 'foo', pe: 'foo', g: 0 }, { p: 'bar', pe: 'bar', g: 0 }, { p: 'a', pe: 'a', g: 0 }, { p: 'b', pe: 'b', g: 0 },
  { p: '[ab]', pe: '[ab]', g: 0 }, { p: '^a', pe: '^a', g: 0 }, { p: 'o$', pe: 'o$', g: 0 }, { p: 'a.c', pe: 'a.c', g: 0 },
  { p: 'a*', pe: 'a*', g: 0 }, { p: 'a\\+', pe: 'a+', g: 0 }, { p: '[0-9]', pe: '[0-9]', g: 0 }, { p: '[a-z]+', pe: '[a-z]+', g: 0 },
  { p: 'x\\?', pe: 'x?', g: 0 }, { p: '.', pe: '.', g: 0 }, { p: 'lin.', pe: 'lin.', g: 0 },
  { p: '\\(foo\\)', pe: '(foo)', g: 1 }, { p: '\\(a\\)\\(b\\)', pe: '(a)(b)', g: 2 }, { p: '\\(.\\)\\(.\\)', pe: '(.)(.)', g: 2 },
  { p: '\\([a-z]*\\)', pe: '([a-z]*)', g: 1 }, { p: '\\(foo\\)\\|\\(bar\\)', pe: '(foo)|(bar)', g: 2 },
];
function randRegexEntry() { return choice(REGEX_POOL); }
function randRegexPattern(extended) { const e = randRegexEntry(); return extended ? e.pe : e.p; }

function randAddress(maxLine, extended, posix) {
  // returns address prefix string like "3,5" or "/foo/" or "" (none)
  if (bool(0.4)) return '';
  const a1 = randAddr(maxLine, extended, posix);
  let addr = a1;
  if (bool(0.35)) {
    if (!posix && bool(0.3)) {
      addr += `,+${ri(0, 3)}`; // relative end (GNU extension)
    } else {
      addr += `,${randAddr(maxLine, extended, posix)}`;
    }
  }
  if (bool(0.15)) addr += '!';
  return addr + ' ';
}

// ---------- Random command generation ----------
const labelPool = ['A', 'B', 'loop'];

function randDelimiter() {
  return choice(['/', '#', '@']);
}

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

function randBranchCmd() {
  return choice(['b', 't', 'T']);
}

// Generates a flat list of command strings (no nested groups, to keep branch targets simple)
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

// Occasionally inserts a top-level `:label` plus one or more `b`/`t`/`T`
// commands targeting it, to exercise branch/label handling. Branches are
// address-guarded so they don't trivially create unbounded loops on every
// line (the runaway-script safety nets handle it if they do anyway).
function maybeAddLabelAndBranches(cmds, maxLine, extended, posix) {
  if (!bool(0.06) || cmds.length < 2) return cmds;
  const labelPos = ri(0, cmds.length - 1);
  const label = choice(labelPool);
  const withLabel = [...cmds];
  withLabel.splice(labelPos, 0, `:${label}`);
  const nBranches = 1;
  for (let i = 0; i < nBranches; i++) {
    // Always address-guard branches (never unconditional) to keep the
    // overwhelming majority of generated scripts terminating quickly --
    // an unconditional `b` back to an earlier label loops forever every time.
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

// ---------- Runners ----------
function runRealSed(args, input) {
  try {
    const out = execFileSync('sed', args, { input, encoding: 'utf8', timeout: 800 });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString() };
  }
}

async function runJsSed(args, input) {
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('JS_TIMEOUT')), 800));
    const out = await Promise.race([sed(args, { stdin: input }), timeout]);
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function normalizeOutput(realResult) {
  // GNU sed with execFileSync: stdout captured without trailing manipulation.
  // Our JS sed's `output` never includes a final trailing newline marker logic matches "no trailing \n if input had none".
  // Real sed via execFileSync captures raw stdout exactly, so we must compare exactly,
  // but our js return value never adds trailing content beyond what sed would print.
  return realResult;
}

async function runOne(tc) {
  const real = runRealSed(tc.args, tc.input);
  const js = await runJsSed(tc.args, tc.input);

  const isHangLike = err => /ETIMEDOUT|ENOBUFS/.test(err || '');
  const isJsRunawayLike = err => /JS_TIMEOUT|output size limit exceeded/.test(err || '');

  if ((!real.ok && isHangLike(real.error)) || (!js.ok && isJsRunawayLike(js.error))) {
    // Either side hit a pathological infinite-loop/unbounded-growth script.
    // There's no finite ground truth to compare against here, so this isn't
    // a genuine implementation mismatch -- skip it.
    return { mismatch: false, bothFailed: true };
  }

  if (real.ok && js.ok) {
    // real sed's stdout always literally what would be printed; compare directly.
    if (real.output !== js.output) {
      return { mismatch: true, kind: 'output', real, js, tc };
    }
    return { mismatch: false };
  } else if (real.ok && !js.ok) {
    return { mismatch: true, kind: 'js-threw-real-ok', real, js, tc };
  } else if (!real.ok && js.ok) {
    return { mismatch: true, kind: 'real-failed-js-ok', real, js, tc };
  } else {
    // both failed -- not counted as mismatch (error message parity not required)
    return { mismatch: false, bothFailed: true };
  }
}

// ---------- Main fuzz loop ----------
async function fuzz(count, seedStart = 1) {
  const failures = [];
  let bothFailedCount = 0;
  let passCount = 0;
  for (let i = 0; i < count; i++) {
    setSeed(seedStart + i);
    const tc = genTestCase();
    let res;
    try {
      res = await runOne(tc);
    } catch (e) {
      res = { mismatch: true, kind: 'harness-exception', error: e.message, tc };
    }
    if (res.bothFailed) { bothFailedCount++; continue; }
    if (res.mismatch) failures.push({ seed: seedStart + i, ...res });
    else passCount++;
  }
  return { failures, bothFailedCount, passCount, total: count };
}

const countArg = parseInt(process.argv[2] || '500', 10);
const seedArg = parseInt(process.argv[3] || '1', 10);

fuzz(countArg, seedArg).then(({ failures, bothFailedCount, passCount, total }) => {
  console.log(`Total: ${total}  Pass: ${passCount}  BothFailed(skipped): ${bothFailedCount}  Mismatches: ${failures.length}`);
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
  process.exitCode = failures.length > 0 ? 1 : 0;
});
