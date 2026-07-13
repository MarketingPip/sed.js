import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sed from './index.js';

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

const WORDS = ['foo', 'bar', 'baz', 'hello', 'world', 'a', 'ab', 'X', 'Y', ''];
function randLine() { const n = ri(0, 3); const p = []; for (let i = 0; i < n; i++) p.push(choice(WORDS)); return p.join(' '); }
function randRecordSet(n) { const r = []; for (let i = 0; i < n; i++) r.push(randLine()); return r; }

const REGEX_POOL = ['a', 'foo', '[ab]', '^a', 'o$', '.', 'a*', '\\(a\\)\\(b\\)'];

function randScript() {
  const kind = choice(['s', 's', 'p', '=', 'yjoin', 'hgx']);
  if (kind === 's') {
    const pat = choice(REGEX_POOL);
    const repl = choice(['X', 'Y&Z', '']);
    const flags = (bool(0.4) ? 'g' : '') + (bool(0.2) ? 'i' : '');
    return `s/${pat}/${repl}/${flags}`;
  }
  if (kind === 'p') return '-n;p'.replace('-n;', ''); // handled via -n flag separately
  if (kind === '=') return '=';
  if (kind === 'yjoin') return ':a;N;$!ba;s/\\n/,/g';
  if (kind === 'hgx') return '1h;2{x;G}';
  return 'p';
}

// ---------- -s fuzzing ----------
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
      const script = randScript();
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
        // only count as mismatch if not a shared timeout-like divergence
        if (!/ETIMEDOUT|ENOBUFS/.test(real.err || '')) {
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
  console.log(`-s: tested=${tested} mismatches=${mismatches} total=${count}`);
  return mismatches;
}

// ---------- -z fuzzing ----------
function randNullRecords() {
  const n = ri(0, 5);
  const recs = [];
  for (let i = 0; i < n; i++) {
    // records can legitimately contain real newlines under -z
    const parts = [];
    const lineCount = ri(1, 2);
    for (let j = 0; j < lineCount; j++) parts.push(randLine());
    recs.push(parts.join('\n'));
  }
  let content = recs.join('\0');
  if (n > 0 && bool(0.85)) content += '\0';
  return content;
}

async function fuzzNullData(count, seedStart) {
  let mismatches = 0, tested = 0;
  for (let i = 0; i < count; i++) {
    setSeed(seedStart + i);
    const input = randNullRecords();
    const script = randScript();
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
      if (!/ETIMEDOUT|ENOBUFS/.test(real.err || '')) {
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
  console.log(`-z: tested=${tested} mismatches=${mismatches} total=${count}`);
  return mismatches;
}

// ---------- M/m flag fuzzing ----------
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
      if (!/ETIMEDOUT|ENOBUFS/.test(real.err || '')) {
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
  console.log(`M-flag: tested=${tested} mismatches=${mismatches} total=${count}`);
  return mismatches;
}

const count = parseInt(process.argv[2] || '300', 10);
const seedStart = parseInt(process.argv[3] || '1', 10);

const results = await Promise.all([
  fuzzSeparate(count, seedStart),
  fuzzNullData(count, seedStart + 100000),
  fuzzMultilineFlag(count, seedStart + 200000),
]);

const totalMismatches = results.reduce((a, b) => a + b, 0);
process.exitCode = totalMismatches > 0 ? 1 : 0;
