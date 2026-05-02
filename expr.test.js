import { spawnSync } from 'child_process';

// ─────────────────────────────────────────────
// POSIX expr — recursive descent implementation
// ─────────────────────────────────────────────
//
// Operator precedence (low → high):
//   |   &   = != < <= > >=   + -   * / %   :
//
// Exit semantics (matching real expr):
//   result is non-zero/non-empty → exit 0  (success: true)
//   result is "0" or ""          → exit 1  (success: false)
//   any error                    → exit 2  (success: false)
//
// Parentheses must be passed as escaped tokens: '\(' '\)'
// (the shell escaping; by the time args[] arrives they are literal
//  backslash-paren strings '\\(' '\\)')
//
// Special functions consume directly from the arg stream (not a value
// stack), matching real expr behaviour:
//   length STR
//   substr  STR POS LEN     (1-indexed, POSIX)
//   index   STR CHARS

export function exprEval(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('syntax error');
  }

  // Validate: no null/undefined tokens
  for (const a of args) {
    if (a === null || a === undefined) throw new Error('syntax error');
  }

  let pos = 0;

  const peek  = ()  => args[pos];
  const next  = ()  => args[pos++];
  const done  = ()  => pos >= args.length;

  // ── helpers ──────────────────────────────────

  // POSIX: both operands must look like [-]digits (no leading zeros issue)
  const isInt = (s) => /^-?\d+$/.test(String(s));

  const toInt = (s) => {
    if (!isInt(s)) throw new Error('non-integer argument');
    return parseInt(s, 10);
  };

  const isTruthy = (v) => v !== '0' && v !== '';

  const cmp = (op, l, r) => {
    const numeric = isInt(l) && isInt(r);
    const lv = numeric ? parseInt(l, 10) : l;
    const rv = numeric ? parseInt(r, 10) : r;
    switch (op) {
      case '=':  return lv === rv;
      case '!=': return lv !== rv;
      case '>':  return lv >   rv;
      case '<':  return lv <   rv;
      case '>=': return lv >=  rv;
      case '<=': return lv <=  rv;
    }
  };

  // ── parser ───────────────────────────────────

  function parseExpr()    { return parseOr(); }

  function parseOr() {
    let left = parseAnd();
    while (peek() === '|') {
      next();
      const right = parseAnd();
      left = isTruthy(left) ? left : right;
    }
    return left;
  }

  function parseAnd() {
    let left = parseCmp();
    while (peek() === '&') {
      next();
      const right = parseCmp();
      left = (isTruthy(left) && isTruthy(right)) ? left : '0';
    }
    return left;
  }

  function parseCmp() {
    let left = parseAdd();
    const CMP_OPS = new Set(['=', '!=', '>', '<', '>=', '<=']);
    while (CMP_OPS.has(peek())) {
      const op = next();
      const right = parseAdd();
      left = cmp(op, left, right) ? '1' : '0';
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const right = parseMul();
      left = String(op === '+' ? toInt(left) + toInt(right)
                               : toInt(left) - toInt(right));
    }
    return left;
  }

  function parseMul() {
    let left = parseMatch();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op   = next();
      const right = parseMatch();
      const l = toInt(left);
      const r = toInt(right);
      if (r === 0 && (op === '/' || op === '%')) throw new Error('division by zero');
      if (op === '*') left = String(l * r);
      if (op === '/') left = String(Math.trunc(l / r));  // POSIX truncates toward zero
      if (op === '%') left = String(l % r);
    }
    return left;
  }

  function parseMatch() {
    let left = parsePrimary();
    while (peek() === ':') {
      next();
      const pattern = next();
      if (pattern === undefined) throw new Error('syntax error');
      // The : operator anchors at start implicitly
      let re;
      try { re = new RegExp('^(?:' + pattern + ')'); }
      catch { throw new Error('invalid regex'); }
      const m = String(left).match(re);
      // If the pattern has a capture group, return the captured text;
      // otherwise return the match length (or 0 on no match).
      if (!m) {
        left = '0';
      } else if (m[1] !== undefined) {
        left = m[1];   // first capture group → returned as string
      } else {
        left = String(m[0].length);
      }
    }
    return left;
  }

  function parsePrimary() {
    const tok = next();
    if (tok === undefined) throw new Error('syntax error');

    // Escaped open paren  (shell passes \( as the two-char string \( )
    if (tok === '\\(') {
      const val = parseExpr();
      const close = next();
      if (close !== '\\)') throw new Error('syntax error');
      return val;
    }

    // length STR
    if (tok === 'length') {
      const str = next();
      if (str === undefined) throw new Error('syntax error');
      return String(str.length);
    }

    // substr STR POS LEN  — 1-indexed, clamps gracefully
    if (tok === 'substr') {
      const str = next();
      const rawPos = next();
      const rawLen = next();
      if (str === undefined || rawPos === undefined || rawLen === undefined)
        throw new Error('syntax error');
      const p = toInt(rawPos);
      const l = toInt(rawLen);
      // POSIX: positions before 1 are treated as 1; negative len → empty
      const start = Math.max(0, p - 1);
      const len   = Math.max(0, l);
      return String(str).substr(start, len);
    }

    // index STR CHARS  — find first char of STR that appears in CHARS
    if (tok === 'index') {
      const str   = next();
      const chars = next();
      if (str === undefined || chars === undefined) throw new Error('syntax error');
      for (let j = 0; j < str.length; j++) {
        if (chars.includes(str[j])) return String(j + 1);
      }
      return '0';
    }

    // Everything else is a literal value
    return tok;
  }

  // ── entry point ──────────────────────────────

  const result = parseExpr();

  // Leftover tokens → syntax error (e.g. unmatched \) )
  if (!done()) throw new Error('syntax error');

  return String(result ?? '');
}

// ─────────────────────────────────────────────
// Wrapper that mirrors the { success, data, error } shape
// used by the test harness, including POSIX exit semantics.
// ─────────────────────────────────────────────
export function runExpr(args) {
  try {
    const raw     = exprEval(args);
    const data    = normalize(raw);
    const isFalse = data === '0' || data === '';
    return { success: !isFalse, data, error: null };
  } catch (err) {
    return { success: false, data: null, error: normalize(err?.message ?? String(err)) };
  }
}

// ─────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────
function normalize(v) {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '');
}

function runSystemExpr(args) {
  try {
    const r = spawnSync('expr', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (r.error) return { success: false, data: null, error: normalize(r.error.message) };
    const ok = r.status === 0;
    return {
      success: ok,
      data:  ok  ? normalize(r.stdout) : null,
      error: !ok ? normalize(r.stderr || r.stdout) : null,
    };
  } catch (err) {
    return { success: false, data: null, error: normalize(err?.message ?? String(err)) };
  }
}

// ─────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function expectSameExpr({ args, label }) {
  const port   = runExpr(args);
  const system = runSystemExpr(args);
  const tag    = label ?? `expr ${args.join(' ')}`;

  const ok = port.success === system.success &&
    (system.success ? port.data === system.data : true);

  if (ok) {
    console.log(`  ✓ ${tag}`);
    passed++;
  } else {
    console.error(`  ✗ ${tag}`);
    console.error(`      port  : success=${port.success}  data=${JSON.stringify(port.data)}  error=${port.error}`);
    console.error(`      system: success=${system.success}  data=${JSON.stringify(system.data)}  error=${system.error}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ─────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────

section('Basic arithmetic');
await expectSameExpr({ args: ['1', '+', '1'] });
await expectSameExpr({ args: ['10', '-', '3'] });
await expectSameExpr({ args: ['5', '*', '5'] });
await expectSameExpr({ args: ['10', '/', '2'] });
await expectSameExpr({ args: ['10', '%', '3'] });
await expectSameExpr({ args: ['7', '/', '2'] });       // truncation toward zero
await expectSameExpr({ args: ['-7', '/', '2'] });      // negative truncation
await expectSameExpr({ args: ['-7', '%', '2'] });

section('Operator precedence (left-to-right, no implicit math precedence)');
// expr evaluates left-to-right within the same precedence tier
await expectSameExpr({ args: ['2', '+', '3', '*', '4'] });   // (2+3)*4 = 20
await expectSameExpr({ args: ['10', '-', '3', '-', '2'] });  // (10-3)-2 = 5

section('Parentheses');
await expectSameExpr({ args: ['\\(', '2', '+', '3', '\\)', '*', '4'] });
await expectSameExpr({ args: ['\\(', '10', '-', '3', '\\)', '-', '2'] });

section('Comparisons — numeric');
await expectSameExpr({ args: ['1', '=', '1'] });
await expectSameExpr({ args: ['1', '=', '2'] });        // false → success:false
await expectSameExpr({ args: ['1', '!=', '2'] });
await expectSameExpr({ args: ['5', '>', '3'] });
await expectSameExpr({ args: ['2', '<', '3'] });
await expectSameExpr({ args: ['3', '>=', '3'] });
await expectSameExpr({ args: ['3', '<=', '4'] });
await expectSameExpr({ args: ['01', '=', '1'] });       // leading zero: both numeric → equal

section('Comparisons — string');
await expectSameExpr({ args: ['abc', '=', 'abc'] });
await expectSameExpr({ args: ['abc', '=', 'def'] });
await expectSameExpr({ args: ['abc', '!=', 'def'] });
await expectSameExpr({ args: ['b', '>', 'a'] });
await expectSameExpr({ args: ['a', '<', 'b'] });

section('Logical operators');
await expectSameExpr({ args: ['5', '&', '2'] });        // 5 (both truthy)
await expectSameExpr({ args: ['0', '&', '2'] });        // 0 (left falsy)
await expectSameExpr({ args: ['5', '&', '0'] });        // 0 (right falsy)
await expectSameExpr({ args: ['0', '|', '2'] });        // 2
await expectSameExpr({ args: ['1', '|', '2'] });        // 1
await expectSameExpr({ args: ['0', '|', '0'] });        // 0 → success:false
await expectSameExpr({ args: ['', '|', 'fallback'] });  // fallback

section('String functions — length');
await expectSameExpr({ args: ['length', 'abc'] });
await expectSameExpr({ args: ['length', ''] });         // 0 → success:false
await expectSameExpr({ args: ['length', 'hello world'] });

section('String functions — substr');
await expectSameExpr({ args: ['substr', 'abcdef', '1', '3'] });   // abc
await expectSameExpr({ args: ['substr', 'abcdef', '3', '2'] });   // cd
await expectSameExpr({ args: ['substr', 'abcdef', '6', '1'] });   // f (last char)
await expectSameExpr({ args: ['substr', 'abcdef', '1', '100'] }); // abcdef (clamp)
await expectSameExpr({ args: ['substr', 'abcdef', '0', '3'] });   // pos<1 → treat as 1

section('String functions — index');
await expectSameExpr({ args: ['index', 'abcdef', 'c'] });   // 3
await expectSameExpr({ args: ['index', 'abcdef', 'z'] });   // 0 → success:false
await expectSameExpr({ args: ['index', 'abcdef', 'ae'] });  // 1 (first of a or e)

section('Regex match operator (:)');
await expectSameExpr({ args: ['hello', ':', 'h.*o'] });     // 5 (full match length)
await expectSameExpr({ args: ['hello', ':', 'xyz'] });      // 0 → success:false
await expectSameExpr({ args: ['abc123', ':', '[a-z]+'] });  // 3
await expectSameExpr({ args: ['hello', ':', 'hel'] });      // 3

section('Exit semantics — false results must have success:false');
await expectSameExpr({ args: ['0'] });                      // literal 0
await expectSameExpr({ args: ['1', '=', '2'] });            // compare false
await expectSameExpr({ args: ['length', ''] });             // 0
await expectSameExpr({ args: ['0', '&', '1'] });

section('Error cases — must fail on both sides');
await expectSameExpr({ args: ['10', '/', '0'] });
await expectSameExpr({ args: ['10', '%', '0'] });
await expectSameExpr({ args: ['a', '+', '1'] });
await expectSameExpr({ args: ['1', '+', 'b'] });

section('Edge cases');
await expectSameExpr({ args: ['42'] });                     // single value
await expectSameExpr({ args: ['', '=', ''] });              // empty string equality
await expectSameExpr({ args: ['0', '|', '5'] });            // OR with falsy left

// ─────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
