// js-sed Benchmark Suite
// Run: node benchmark.js
// Run with GC: node --expose-gc benchmark.js

import { execSync } from 'child_process';
import fs from 'fs';
import { performance } from 'perf_hooks';
import sed from './index.js';

// ============================================================
// Config
// ============================================================
const SIZES = [
  { name: 'tiny',   lines: 10,       cols: 80 },
  { name: 'small',  lines: 1_000,    cols: 80 },
  { name: 'medium', lines: 100_000,  cols: 80 },
  { name: 'large',  lines: 1_000_000, cols: 80 },
];
const ITERATIONS = 5;
const WARMUP = 2;

// ============================================================
// Helpers
// ============================================================
function generateText(size) {
  const words = ['lorem','ipsum','dolor','sit','amet','consectetur','adipiscing','elit'];
  const lines = [];
  for (let i = 0; i < size.lines; i++) {
    let line = '';
    while (line.length < size.cols) line += words[i % words.length] + ' ';
    lines.push(line.slice(0, size.cols));
  }
  return lines.join('\n') + '\n';
}

function bench(name, fn) {
  // Warmup
  for (let i = 0; i < WARMUP; i++) fn();
  // Measure
  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a,b) => a+b) / times.length;
  return { name, avg, min: Math.min(...times), max: Math.max(...times) };
}

function report(results) {
  const baseline = results[0]?.avg || 1;
  console.log(`\n${'='.repeat(60)}`);
  console.log(results[0]?.suite || 'Benchmark');
  console.log('='.repeat(60));
  for (const r of results) {
    const bar = '█'.repeat(Math.min(50, Math.round((r.avg / baseline) * 10)));
    console.log(`${r.name.padEnd(20)} ${r.avg.toFixed(2).padStart(8)}ms  ${bar}`);
  }
}

// ============================================================
// Benchmarks
// ============================================================

function benchmarkBasic() {
  const results = [];
  for (const size of SIZES) {
    const text = generateText(size);
    const script = 's/lorem/REPLACED/g';

    // Native sed
    const native = bench(`native-${size.name}`, () => {
      const tmp = `/tmp/sedbench_${Date.now()}.txt`;
      fs.writeFileSync(tmp, text);
      execSync(`sed '${script}' ${tmp}`, { encoding: 'utf8' });
      fs.unlinkSync(tmp);
    });
    native.suite = 'Basic Substitution (s/foo/bar/g)';
    results.push(native);

    // js-sed
    const ours = bench(`js-sed-${size.name}`, () => {
      sed(script, { stdin: text });
    });
    ours.suite = 'Basic Substitution (s/foo/bar/g)';
    results.push(ours);
  }
  report(results);
  return results;
}

function benchmarkComplex() {
  const text = generateText(SIZES[2]); // medium
  const script = 's/\\(lorem\\)\\+\\1/\\1\\1/g';

  const results = [];
  const native = bench('native-complex', () => {
    const tmp = `/tmp/sedbench_${Date.now()}.txt`;
    fs.writeFileSync(tmp, text);
    execSync(`sed '${script}' ${tmp}`, { encoding: 'utf8' });
    fs.unlinkSync(tmp);
  });
  native.suite = 'Complex BRE (backrefs + quantifiers)';
  results.push(native);

  const ours = bench('js-sed-complex', () => sed(script, { stdin: text }));
  ours.suite = 'Complex BRE (backrefs + quantifiers)';
  results.push(ours);

  report(results);
  return results;
}

function benchmarkHold() {
  const text = generateText(SIZES[2]);
  const script = 'h;g;G;x';

  const results = [];
  const native = bench('native-hold', () => {
    const tmp = `/tmp/sedbench_${Date.now()}.txt`;
    fs.writeFileSync(tmp, text);
    execSync(`sed -e 'h' -e 'g' -e 'G' -e 'x' ${tmp}`, { encoding: 'utf8' });
    fs.unlinkSync(tmp);
  });
  native.suite = 'Hold Space (h;g;G;x)';
  results.push(native);

  const ours = bench('js-sed-hold', () => sed(script, { stdin: text }));
  ours.suite = 'Hold Space (h;g;G;x)';
  results.push(ours);

  report(results);
  return results;
}

function benchmarkBranch() {
  const text = generateText(SIZES[1]); // small
  const script = ':start;s/lorem/REPLACED/;t start';

  const results = [];
  const native = bench('native-branch', () => {
    const tmp = `/tmp/sedbench_${Date.now()}.txt`;
    fs.writeFileSync(tmp, text);
    execSync(`sed '${script}' ${tmp}`, { encoding: 'utf8' });
    fs.unlinkSync(tmp);
  });
  native.suite = 'Branching (labels + t)';
  results.push(native);

  const ours = bench('js-sed-branch', () => sed(script, { stdin: text }));
  ours.suite = 'Branching (labels + t)';
  results.push(ours);

  report(results);
  return results;
}

// ============================================================
// Correctness
// ============================================================

function testCorrectness() {
  console.log('\n' + '='.repeat(60));
  console.log('Correctness Verification');
  console.log('='.repeat(60));

  const cases = [
    { name: 'basic sub',    script: 's/foo/bar/',      input: 'foo foo' },
    { name: 'global sub',   script: 's/foo/bar/g',     input: 'foo foo foo' },
    { name: 'address line', script: '2s/foo/bar/',     input: 'foo\nfoo\nfoo' },
    { name: 'address range',script: '2,3s/foo/bar/',  input: 'foo\nfoo\nfoo\nfoo' },
    { name: 'delete',       script: '2d',              input: 'a\nb\nc' },
    { name: 'hold/get',     script: 'h;2g',            input: 'a\nb\nc' },
    { name: 'branch',       script: ':a;s/foo/bar/;ta', input: 'foofoofoo' },
    { name: 'transliterate',script: 'y/abc/xyz/',      input: 'abc' },
    { name: 'quit',         script: '2q',              input: 'a\nb\nc\nd' },
    { name: 'line number',  script: '=',               input: 'a\nb\nc' },
    { name: 'exchange',     script: 'x',               input: 'pattern' },
  ];

  let pass = 0, fail = 0;
  for (const tc of cases) {
    try {
      const tmp = `/tmp/sedtest_${Date.now()}.txt`;
      fs.writeFileSync(tmp, tc.input);
      const native = execSync(`sed '${tc.script}' ${tmp}`, { encoding: 'utf8' });
      fs.unlinkSync(tmp);
      const ours = sed(tc.script, { stdin: tc.input });

      if (native === ours) { pass++; }
      else {
        fail++;
        console.log(`FAIL: ${tc.name}`);
        console.log(`  native: ${JSON.stringify(native)}`);
        console.log(`  ours:   ${JSON.stringify(ours)}`);
      }
    } catch (e) {
      fail++;
      console.log(`ERROR: ${tc.name} — ${e.message}`);
    }
  }
  console.log(`\nResults: ${pass} passed, ${fail} failed / ${cases.length}`);
}

// ============================================================
// Main
// ============================================================

console.log('js-sed Benchmark Suite');
console.log(`Node ${process.version} | ${process.platform}`);

testCorrectness();
benchmarkBasic();
benchmarkComplex();
benchmarkHold();
benchmarkBranch();

console.log('\nDone!');
