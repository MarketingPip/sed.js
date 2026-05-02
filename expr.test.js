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
// Parentheses arrive as escaped tokens: '\\(' '\\)'
// Special functions (length/substr/index) consume directly from the
// arg stream — they are NOT stack-based.

export function exprEval(args) {
  if (!Array.isArray(args) || args.length === 0) throw new Error('syntax error');
  for (const a of args) {
    if (a === null || a === undefined) throw new Error('syntax error');
  }

  let pos = 0;
  const peek = () => args[pos];
  const next = () => args[pos++];
  const done = () => pos >= args.length;

  const isInt    = (s) => /^-?\d+$/.test(String(s));
  const toInt    = (s) => { if (!isInt(s)) throw new Error('non-integer argument'); return parseInt(s, 10); };
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

  function parseExpr()  { return parseOr(); }

  function parseOr() {
    let left = parseAnd();
    // GNU expr: | returns '0' rather than '' when falling through to an empty right operand
    while (peek() === '|') { next(); const r = parseAnd(); left = isTruthy(left) ? left : (r === '' ? '0' : r); }
    return left;
  }

  function parseAnd() {
    let left = parseCmp();
    while (peek() === '&') { next(); const r = parseCmp(); left = (isTruthy(left) && isTruthy(r)) ? left : '0'; }
    return left;
  }

  function parseCmp() {
    let left = parseAdd();
    const OPS = new Set(['=', '!=', '>', '<', '>=', '<=']);
    while (OPS.has(peek())) { const op = next(); const r = parseAdd(); left = cmp(op, left, r) ? '1' : '0'; }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = next(); const r = parseMul();
      left = String(op === '+' ? toInt(left) + toInt(r) : toInt(left) - toInt(r));
    }
    return left;
  }

  function parseMul() {
    let left = parseMatch();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next(); const r = parseMatch();
      const l = toInt(left), rv = toInt(r);
      if (rv === 0 && (op === '/' || op === '%')) throw new Error('division by zero');
      if (op === '*') left = String(l * rv);
      if (op === '/') left = String(Math.trunc(l / rv)); // POSIX: truncate toward zero
      if (op === '%') left = String(l % rv);
    }
    return left;
  }

  // Translate BRE pattern to JS regex:
  //   \( \) → capture groups ( )
  //   \+ \? \{ \} \| → quantifiers/alternation
  //   bare ( ) → escaped literals \( \)
  function breToJs(pat) {
    let out = '', i = 0;
    while (i < pat.length) {
      if (pat[i] === '\\' && i + 1 < pat.length) {
        const n = pat[i + 1];
        const special = { '(': '(', ')': ')', '+': '+', '?': '?', '{': '{', '}': '}', '|': '|' };
        out += n in special ? special[n] : ('\\' + n);
        i += 2;
      } else if (pat[i] === '(' || pat[i] === ')') {
        out += '\\' + pat[i++]; // literal paren in BRE → escape for JS
      } else {
        out += pat[i++];
      }
    }
    return out;
  }

  function parseMatch() {
    let left = parsePrimary();
    while (peek() === ':') {
      next();
      const pattern = next();
      if (pattern === undefined) throw new Error('syntax error');
      // POSIX: no match returns '' if pattern has \(...\), else '0'
      const hasCaptureGroup = /\\\(/.test(pattern);
      let re;
      try { re = new RegExp('^' + breToJs(pattern)); } catch { throw new Error('invalid regex'); }
      const m = String(left).match(re);
      if (!m)              left = hasCaptureGroup ? '' : '0';
      else if (m[1] !== undefined) left = m[1];
      else                left = String(m[0].length);
    }
    return left;
  }

  function parsePrimary() {
    const tok = next();
    if (tok === undefined) throw new Error('syntax error');

    if (tok === '(' || tok === '\\(') {
      const val = parseExpr();
      const close = next();
      if (close !== ')' && close !== '\\)') throw new Error('syntax error');
      return val;
    }

    if (tok === 'length') {
      const str = next();
      if (str === undefined) throw new Error('syntax error');
      return String(str.length);
    }

    if (tok === 'substr') {
      const str = next(), rawPos = next(), rawLen = next();
      if (str === undefined || rawPos === undefined || rawLen === undefined) throw new Error('syntax error');
      const p = toInt(rawPos), l = toInt(rawLen);
      // POSIX: pos < 1 yields empty string (no clamping to start of string)
      if (p < 1) return '';
      return String(str).substr(p - 1, Math.max(0, l));
    }

    if (tok === 'index') {
      const str = next(), chars = next();
      if (str === undefined || chars === undefined) throw new Error('syntax error');
      for (let j = 0; j < str.length; j++) {
        if (chars.includes(str[j])) return String(j + 1);
      }
      return '0';
    }

    return tok;
  }

  const result = parseExpr();
  if (!done()) throw new Error('syntax error');
  return String(result ?? '');
}

// ─────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────

function normalize(v) {
  return String(v ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function runExpr(args) {
  try {
    const data = normalize(exprEval(args));
    return { success: data !== '0' && data !== '', data, error: null };
  } catch (err) {
    return { success: false, data: null, error: normalize(err?.message ?? String(err)) };
  }
}

function runSystemExpr(args) {
  try {
    const r = spawnSync('expr', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (r.error) return { success: false, data: null, error: normalize(r.error.message) };
    // exit 0 = true result, exit 1 = false result (not an error), exit 2 = syntax/runtime error
    if (r.status === 0) return { success: true,  data: normalize(r.stdout), error: null };
    if (r.status === 1) return { success: false, data: normalize(r.stdout), error: null };
    /* status >= 2  */  return { success: false, data: null, error: normalize(r.stderr || r.stdout) };
  } catch (err) {
    return { success: false, data: null, error: normalize(err?.message ?? String(err)) };
  }
}

// ─────────────────────────────────────────────
// Jest test suite
// ─────────────────────────────────────────────

async function expectSameExpr({ args }) {
  const port   = runExpr(args);
  const system = runSystemExpr(args);
  expect(port.success).toBe(system.success);
  if (system.success) {
    expect(port.data).toBe(system.data);
  } else if (system.error) {
    // Real error (non-zero stderr): port must also have produced an error
    expect(port.error?.length).toBeGreaterThan(0);
  } else {
    // False result (exit 1, no stderr): port must return the same falsy data
    expect(port.data).toBe(system.data);
  }
}

describe('basic arithmetic', () => {
  it('1 + 1',                        async () => expectSameExpr({ args: ['1', '+', '1'] }));
  it('10 - 3',                       async () => expectSameExpr({ args: ['10', '-', '3'] }));
  it('5 * 5',                        async () => expectSameExpr({ args: ['5', '*', '5'] }));
  it('10 / 2',                       async () => expectSameExpr({ args: ['10', '/', '2'] }));
  it('10 % 3',                       async () => expectSameExpr({ args: ['10', '%', '3'] }));
  it('7 / 2 truncates',              async () => expectSameExpr({ args: ['7', '/', '2'] }));
  it('-7 / 2 truncates toward zero', async () => expectSameExpr({ args: ['-7', '/', '2'] }));
  it('-7 % 2',                       async () => expectSameExpr({ args: ['-7', '%', '2'] }));
});

describe('operator precedence (left-to-right within tier)', () => {
  it('2 + 3 * 4 = 20',  async () => expectSameExpr({ args: ['2', '+', '3', '*', '4'] }));
  it('10 - 3 - 2 = 5',  async () => expectSameExpr({ args: ['10', '-', '3', '-', '2'] }));
});

describe('parentheses', () => {
  it('(2 + 3) * 4',  async () => expectSameExpr({ args: ['(', '2', '+', '3', ')', '*', '4'] }));
  it('(10 - 3) - 2', async () => expectSameExpr({ args: ['(', '10', '-', '3', ')', '-', '2'] }));
});

describe('comparisons — numeric', () => {
  it('1 = 1',                          async () => expectSameExpr({ args: ['1', '=', '1'] }));
  it('1 = 2 (false)',                  async () => expectSameExpr({ args: ['1', '=', '2'] }));
  it('1 != 2',                         async () => expectSameExpr({ args: ['1', '!=', '2'] }));
  it('5 > 3',                          async () => expectSameExpr({ args: ['5', '>', '3'] }));
  it('2 < 3',                          async () => expectSameExpr({ args: ['2', '<', '3'] }));
  it('3 >= 3',                         async () => expectSameExpr({ args: ['3', '>=', '3'] }));
  it('3 <= 4',                         async () => expectSameExpr({ args: ['3', '<=', '4'] }));
  it('01 = 1 (leading zero → numeric)',async () => expectSameExpr({ args: ['01', '=', '1'] }));
});

describe('comparisons — string', () => {
  it('abc = abc',         async () => expectSameExpr({ args: ['abc', '=', 'abc'] }));
  it('abc = def (false)', async () => expectSameExpr({ args: ['abc', '=', 'def'] }));
  it('abc != def',        async () => expectSameExpr({ args: ['abc', '!=', 'def'] }));
  it('b > a',             async () => expectSameExpr({ args: ['b', '>', 'a'] }));
  it('a < b',             async () => expectSameExpr({ args: ['a', '<', 'b'] }));
});

describe('logical operators', () => {
  it('5 & 2 = 5 (both truthy)', async () => expectSameExpr({ args: ['5', '&', '2'] }));
  it('0 & 2 = 0 (left falsy)',  async () => expectSameExpr({ args: ['0', '&', '2'] }));
  it('5 & 0 = 0 (right falsy)', async () => expectSameExpr({ args: ['5', '&', '0'] }));
  it('0 | 2 = 2',               async () => expectSameExpr({ args: ['0', '|', '2'] }));
  it('1 | 2 = 1',               async () => expectSameExpr({ args: ['1', '|', '2'] }));
  it('0 | 0 = 0 (false)',       async () => expectSameExpr({ args: ['0', '|', '0'] }));
  it('"" | fallback',           async () => expectSameExpr({ args: ['', '|', 'fallback'] }));
});

describe('string functions — length', () => {
  it('length abc = 3',        async () => expectSameExpr({ args: ['length', 'abc'] }));
  it('length "" = 0 (false)', async () => expectSameExpr({ args: ['length', ''] }));
  it('length "hello world"',  async () => expectSameExpr({ args: ['length', 'hello world'] }));
});

describe('string functions — substr', () => {
  it('substr abcdef 1 3 = abc',     async () => expectSameExpr({ args: ['substr', 'abcdef', '1', '3'] }));
  it('substr abcdef 3 2 = cd',      async () => expectSameExpr({ args: ['substr', 'abcdef', '3', '2'] }));
  it('substr abcdef 6 1 = f',       async () => expectSameExpr({ args: ['substr', 'abcdef', '6', '1'] }));
  it('substr abcdef 1 100 (clamp)', async () => expectSameExpr({ args: ['substr', 'abcdef', '1', '100'] }));
  it('substr abcdef 0 3 (pos<1→1)', async () => expectSameExpr({ args: ['substr', 'abcdef', '0', '3'] }));
});

describe('string functions — index', () => {
  it('index abcdef c = 3',    async () => expectSameExpr({ args: ['index', 'abcdef', 'c'] }));
  it('index abcdef z = 0',    async () => expectSameExpr({ args: ['index', 'abcdef', 'z'] }));
  it('index abcdef ae = 1',   async () => expectSameExpr({ args: ['index', 'abcdef', 'ae'] }));
});

describe('regex match operator (:)', () => {
  it('hello : h.*o = 5',         async () => expectSameExpr({ args: ['hello', ':', 'h.*o'] }));
  it('hello : xyz = 0 (false)',  async () => expectSameExpr({ args: ['hello', ':', 'xyz'] }));
  it('abc123 : [a-z][a-z]* = 3', async () => expectSameExpr({ args: ['abc123', ':', '[a-z][a-z]*'] }));
  it('hello : hel = 3',          async () => expectSameExpr({ args: ['hello', ':', 'hel'] }));
});

describe('exit semantics — false results must have success:false', () => {
  it('literal 0',    async () => expectSameExpr({ args: ['0'] }));
  it('1 = 2',        async () => expectSameExpr({ args: ['1', '=', '2'] }));
  it('length ""',    async () => expectSameExpr({ args: ['length', ''] }));
  it('0 & 1',        async () => expectSameExpr({ args: ['0', '&', '1'] }));
});

describe('error cases', () => {
  it('division by zero (/)', async () => expectSameExpr({ args: ['10', '/', '0'] }));
  it('division by zero (%)', async () => expectSameExpr({ args: ['10', '%', '0'] }));
  it('non-numeric left',     async () => expectSameExpr({ args: ['a', '+', '1'] }));
  it('non-numeric right',    async () => expectSameExpr({ args: ['1', '+', 'b'] }));
});

describe('edge cases', () => {
  it('single value',         async () => expectSameExpr({ args: ['42'] }));
  it('"" = ""',              async () => expectSameExpr({ args: ['', '=', ''] }));
  it('0 | 5 = 5',           async () => expectSameExpr({ args: ['0', '|', '5'] }));
  it('negative literal -1',  async () => expectSameExpr({ args: ['-1'] }));
  it('-1 + 1 = 0 (false)',   async () => expectSameExpr({ args: ['-1', '+', '1'] }));
});

describe('chained operations', () => {
  it('1 + 2 + 3 = 6',        async () => expectSameExpr({ args: ['1', '+', '2', '+', '3'] }));
  it('10 - 3 - 2 - 1 = 4',   async () => expectSameExpr({ args: ['10', '-', '3', '-', '2', '-', '1'] }));
  it('2 * 3 + 4 = 10',       async () => expectSameExpr({ args: ['2', '*', '3', '+', '4'] }));
  it('1 + 2 = 3 (mixed arith+cmp)', async () => expectSameExpr({ args: ['1', '+', '2', '=', '3'] }));
});

describe('nested parentheses', () => {
  it('((2 + 3)) * 4 = 20',   async () => expectSameExpr({ args: ['(', '(', '2', '+', '3', ')', ')', '*', '4'] }));
  it('(2 + (3 * 4)) = 14',   async () => expectSameExpr({ args: ['(', '2', '+', '(', '3', '*', '4', ')', ')'] }));
});

describe('logical operators — empty string', () => {
  it('"" & "x" = 0',         async () => expectSameExpr({ args: ['', '&', 'x'] }));
  it('"x" & "" = 0',         async () => expectSameExpr({ args: ['x', '&', ''] }));
  it('"" | "" = ""  (false)', async () => expectSameExpr({ args: ['', '|', ''] }));
  it('"" | "x" = x',         async () => expectSameExpr({ args: ['', '|', 'x'] }));
});

describe('regex match operator (:) — capture groups', () => {
  // POSIX: \( \) capture group → return captured text, not length
  it('capture group returns text',         async () => expectSameExpr({ args: ['foobar', ':', '\\(foo\\)'] }));
  it('capture group no match returns ""',  async () => expectSameExpr({ args: ['foobar', ':', '\\(baz\\)'] }));
  it('partial capture',                    async () => expectSameExpr({ args: ['abc123', ':', '[a-z]*\\([0-9]*\\)'] }));
});

describe('BRE quantifiers in : operator', () => {
  // \+ = one-or-more, \? = zero-or-one — translated by breToJs
  it('\\+ one-or-more matches',       async () => expectSameExpr({ args: ['aaa', ':', 'a\\+'] }));
  it('\\+ one-or-more no match → 0', async () => expectSameExpr({ args: ['bbb', ':', 'a\\+'] }));
  it('\\? zero-or-one present',       async () => expectSameExpr({ args: ['ab',  ':', 'a\\?b'] }));
  it('\\? zero-or-one absent',        async () => expectSameExpr({ args: ['b',   ':', 'a\\?b'] }));
  it('capture with \\+',              async () => expectSameExpr({ args: ['aaa', ':', '\\(a\\+\\)'] }));
});

describe('chained : operators (left-to-right)', () => {
  // Each : feeds its result as the new left operand
  it('length via chained :',   async () => expectSameExpr({ args: ['foobar', ':', 'foo\\(.*\\)', ':', '.*'] }));
  it('chain no match → 0',     async () => expectSameExpr({ args: ['foobar', ':', 'xyz', ':', '[0-9]*'] }));
});

describe('negative number comparisons', () => {
  it('-1 < 0',   async () => expectSameExpr({ args: ['-1', '<', '0'] }));
  it('-2 > -5',  async () => expectSameExpr({ args: ['-2', '>', '-5'] }));
  it('-1 = -1',  async () => expectSameExpr({ args: ['-1', '=', '-1'] }));
  it('-1 + -1 = -2', async () => expectSameExpr({ args: ['-1', '+', '-1', '=', '-2'] }));
});

describe('non-integer string comparisons', () => {
  // 1.5 is not an integer so comparison must be lexicographic
  it('1.5 = 1.5 (string)',  async () => expectSameExpr({ args: ['1.5', '=', '1.5'] }));
  it('1.5 > 1.4 (string)',  async () => expectSameExpr({ args: ['1.5', '>', '1.4'] }));
  it('+1 = 1 (string, not numeric)', async () => expectSameExpr({ args: ['+1', '=', '1'] }));
});

describe('string functions — length on various inputs', () => {
  it('length of numeric string', async () => expectSameExpr({ args: ['length', '123'] }));
  it('length of single char',    async () => expectSameExpr({ args: ['length', 'x'] }));
  it('length with spaces',       async () => expectSameExpr({ args: ['length', 'hello world'] }));
});

describe('string functions — index first-occurrence', () => {
  it('first of multiple matching chars', async () => expectSameExpr({ args: ['index', 'abcabc', 'ca'] }));
  it('char at position 1',               async () => expectSameExpr({ args: ['index', 'xyz', 'x'] }));
  it('all chars match, returns 1',       async () => expectSameExpr({ args: ['index', 'aaa', 'a'] }));
});

describe('string functions — substr boundaries', () => {
  it('pos beyond length returns ""',  async () => expectSameExpr({ args: ['substr', 'abc', '99', '3'] }));
  it('len = 0 returns ""',            async () => expectSameExpr({ args: ['substr', 'abc', '1', '0'] }));
  it('negative len returns ""',       async () => expectSameExpr({ args: ['substr', 'abc', '1', '-1'] }));
});



// chatgpt tests 
describe('POSIX parentheses (escaped)', () => {
  it('\\( 2 + 3 \\) * 4', async () =>
    expectSameExpr({ args: ['\\(', '2', '+', '3', '\\)', '*', '4'] })
  );
});

describe('numeric vs string boundary', () => {
  it('01 = 001 (numeric)', async () =>
    expectSameExpr({ args: ['01', '=', '001'] })
  );

  it('01 = 1a (string compare)', async () =>
    expectSameExpr({ args: ['01', '=', '1a'] })
  );
});


describe('regex BRE edge cases', () => {
  it('dot matches any char', async () =>
    expectSameExpr({ args: ['abc', ':', 'a.c'] })
  );

  it('anchor start ^', async () =>
    expectSameExpr({ args: ['abc', ':', '^a'] })
  );

  it('anchor end $', async () =>
    expectSameExpr({ args: ['abc', ':', 'c$'] })
  );

 it('empty regex', async () =>
  expectSameExpr({ args: ['abc', ':', ''] })
); 
});


describe('syntax errors', () => {
  it('missing operand', async () =>
    expectSameExpr({ args: ['1', '+'] })
  );

  it('missing operator', async () =>
    expectSameExpr({ args: ['1', '2'] })
  );

  it('unbalanced parentheses', async () =>
    expectSameExpr({ args: ['\\(', '1', '+', '2'] })
  );
});


describe('truthiness edge cases', () => {
  it('"00" is truthy', async () =>
    expectSameExpr({ args: ['00', '|', '5'] })
  );
});



