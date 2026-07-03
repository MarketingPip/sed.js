import { spawnSync } from 'child_process';

// ─────────────────────────────────────────────────────────────────────────────
// POSIX expr — recursive descent implementation
// ─────────────────────────────────────────────────────────────────────────────
//
// Operator precedence (low → high):
//   |   &   = != < <= > >=   + -   * / %   :
//
// Usage:
//   exprEval(args)                        — full GNU (default)
//   exprEval(args, { mode: 'posix' })     — strict POSIX only
//   exprEval(args, { mode: 'posix', extensions: { match: true } })  — mix
//
// Available extension flags (all default true in 'gnu' mode, false in 'posix'):
//   match      — 'match STRING PATTERN' keyword (synonym for STRING : PATTERN)
//   plusPrefix — '+' forces next token to be a plain string
//   doubleDash — leading '--' is stripped (GNU end-of-options)
//   gnuBre     — \+ \? \| BRE quantifier/alternation extensions
//   dotAll     — '.' matches newline in regex patterns
//
// POSIX features always present regardless of mode:
//   All arithmetic, comparison, logical operators
//   length, substr, index keywords
//   POSIX BRE: \( \) capture groups, \{n,m\} intervals, back-references
//   POSIX bracket classes: [[:upper:]] [[:digit:]] etc.
//   Arbitrary-precision integers (BigInt, matching GNU expr's libgmp behaviour)

export function exprEval(args, opts = {}) {
  // ── Feature flags ──────────────────────────────────────────────────────────
  const mode = opts.mode ?? 'gnu';
  if (mode !== 'gnu' && mode !== 'posix') throw new Error(`Unknown mode: ${mode}`);
  const isGnu  = mode === 'gnu';
  const ext    = opts.extensions ?? {};

  const gnu = {
    match:      ext.match      ?? isGnu,  // 'match' keyword
    plusPrefix: ext.plusPrefix ?? isGnu,  // '+' prefix operator
    doubleDash: ext.doubleDash ?? isGnu,  // leading '--' stripped
    gnuBre:     ext.gnuBre     ?? isGnu,  // \+ \? \| in BRE
    dotAll:     ext.dotAll     ?? isGnu,  // '.' matches \n
  };

  // ── Argument validation ────────────────────────────────────────────────────
  if (!Array.isArray(args) || args.length === 0) throw new Error('syntax error');
  for (const a of args) {
    if (a === null || a === undefined) throw new Error('syntax error');
  }

  // GNU ext: strip a single leading '--' (end-of-options marker).
  // Only applies in GNU mode and only when '--' is the exact first argument.
  if (gnu.doubleDash && args[0] === '--') {
    args = args.slice(1);
    if (args.length === 0) throw new Error('syntax error');
  }

  // ── Primitives ─────────────────────────────────────────────────────────────
  let pos = 0;
  const peek = () => args[pos];
  const next = () => args[pos++];
  const done = () => pos >= args.length;

  const isIntStr    = (s) => /^-?\d+$/.test(String(s));
  const isNullString = (s) => {
    // Returns true for '', '0', '00', '-0', '-00' etc. — GNU expr's null values.
    // Bare '-' (no digits) is truthy.
    if (s === '') return true;
    const start = s.startsWith('-') ? 1 : 0;
    if (start >= s.length) return false;
    for (let i = start; i < s.length; i++) {
      if (s[i] !== '0') return false;
    }
    return true;
  };

  const isNull      = (v) => v.type === 'integer' ? v.value === '0' : isNullString(v.value);
  const intValue    = (n) => ({ type: 'integer', value: String(n) });
  const strValue    = (s) => ({ type: 'string',  value: s });
  const toStringVal = (v) => v.type === 'integer' ? strValue(v.value) : v;

  // BigInt arithmetic matches GNU expr's libgmp (arbitrary precision, no overflow).
  const toInteger = (v) => {
    const s = v.value;
    if (!isIntStr(s)) throw new Error('non-integer argument');
    return BigInt(s);
  };

  const cmp = (op, l, r) => {
    const lStr = l.value, rStr = r.value;
    const numeric = isIntStr(lStr) && isIntStr(rStr);
    const lv = numeric ? BigInt(lStr) : lStr;
    const rv = numeric ? BigInt(rStr) : rStr;
    switch (op) {
      case '=':  return lv === rv;
      case '!=': return lv !== rv;
      case '>':  return lv >   rv;
      case '<':  return lv <   rv;
      case '>=': return lv >=  rv;
      case '<=': return lv <=  rv;
    }
  };

  // ── Regex translation (BRE → JS) ───────────────────────────────────────────
  // POSIX BRE special backslash sequences:
  //   \( \)  → capture groups
  //   \{ \}  → interval quantifiers {n,m}
  //
  // GNU BRE extensions (only when gnu.gnuBre):
  //   \+  → one-or-more quantifier
  //   \?  → zero-or-one quantifier
  //   \|  → alternation
  //
  // In POSIX mode, \+ \? \| are undefined by the standard.  We treat them as
  // escaped literals (\\+ \\? \\|) which match the literal character, the
  // safest and most portable interpretation.
  //
  // POSIX bracket classes ([[:upper:]] etc.) are always supported.
  const POSIX_CLASSES = {
    upper:  'A-Z',         lower:  'a-z',       alpha:  'A-Za-z',
    digit:  '0-9',         alnum:  'A-Za-z0-9', space:  ' \\t\\n\\r\\f\\v',
    blank:  ' \\t',        punct:  '\\x21-\\x2F\\x3A-\\x40\\x5B-\\x60\\x7B-\\x7E',
    print:  ' -~',         graph:  '!-~',        cntrl:  '\\x00-\\x1f\\x7f',
    xdigit: '0-9A-Fa-f',
  };

  function breToJs(pat) {
    // Backslash sequences that are ALWAYS special (POSIX BRE):
    const ALWAYS = { '(': '(', ')': ')', '{': '{', '}': '}' };
    // GNU BRE extensions — only active when gnu.gnuBre:
    const GNU_EXT = { '+': '+', '?': '?', '|': '|' };

    let out = '', i = 0;
    while (i < pat.length) {
      if (pat[i] === '[') {
        // Bracket expression: translate POSIX named classes inside.
        let bracket = '[';
        i++;
        if (i < pat.length && pat[i] === '^') { bracket += '^'; i++; }
        if (i < pat.length && pat[i] === ']') { bracket += ']'; i++; }
        while (i < pat.length && pat[i] !== ']') {
          if (pat[i] === '[' && i + 1 < pat.length && pat[i + 1] === ':') {
            const end = pat.indexOf(':]', i + 2);
            if (end !== -1) {
              const name = pat.slice(i + 2, end);
              bracket += POSIX_CLASSES[name] ?? pat.slice(i, end + 2);
              i = end + 2;
            } else { bracket += pat[i++]; }
          } else if (pat[i] === '\\' && i + 1 < pat.length) {
            bracket += '\\' + pat[i + 1]; i += 2;
          } else { bracket += pat[i++]; }
        }
        if (i < pat.length) { bracket += ']'; i++; }
        out += bracket;
      } else if (pat[i] === '\\' && i + 1 < pat.length) {
        const n = pat[i + 1];
        if (n in ALWAYS) {
          out += ALWAYS[n];
        } else if (gnu.gnuBre && n in GNU_EXT) {
          // GNU BRE extension: \+ \? \| become JS quantifiers/alternation
          out += GNU_EXT[n];
        } else {
          // All other \X: pass through as-is (back-references \1-\9, \n, etc.)
          out += '\\' + n;
        }
        i += 2;
      } else if (pat[i] === '(' || pat[i] === ')') {
        out += '\\' + pat[i++];            // bare ( ) are literals in BRE
      } else if (('+?|').includes(pat[i])) {
        out += '\\' + pat[i++];            // bare + ? | are literals in BRE
      } else if ('{}' .includes(pat[i])) {
        out += '\\' + pat[i++];            // bare { } are literals in BRE
      } else {
        out += pat[i++];
      }
    }
    return out;
  }

  // ── Match application ──────────────────────────────────────────────────────
  function applyMatch(leftVal, pattern, ev) {
    if (!ev) return intValue(0n);
    const hasCaptureGroup = /\\\(/.test(pattern);
    const leftStr = toStringVal(leftVal).value;

    // Bare back-reference with no preceding capture group is an error in GNU expr.
    const bareBackref = /\\[1-9]/.test(pattern) && !hasCaptureGroup;
    if (bareBackref) throw new Error('invalid regex');

    // dotAll ('s' flag): GNU expr's regex makes '.' match any byte including \n.
    // In POSIX mode, '.' matches any character EXCEPT newline (standard BRE).
    const flags = gnu.dotAll ? 's' : '';
    let re;
    try { re = new RegExp('^' + breToJs(pattern), flags); }
    catch (e) {
      const msg = e?.message ?? '';
      // BRE-valid patterns that JS rejects: treat as no-match (not an error).
      //   'Nothing to repeat'  — bare * ? {n} at pattern start (literal in BRE)
      //   'Range out of order' — [z-a] (BRE accepts, JS rejects)
      if (msg.includes('Nothing to repeat') || msg.includes('Range out of order')) {
        return hasCaptureGroup ? strValue('') : intValue(0n);
      }
      throw new Error('invalid regex');
    }

    const m = leftStr.match(re);
    if (!m) return hasCaptureGroup ? strValue('') : intValue(0n);
    if (m[1] !== undefined) return strValue(m[1]);
    return intValue(BigInt(m[0].length));
  }

  // ── Parser ─────────────────────────────────────────────────────────────────
  // Every parse function accepts `ev` (evaluate boolean).  When ev=false the
  // function still consumes tokens (position advances) but skips all runtime
  // operations that could throw (division-by-zero, non-integer-argument, regex).
  // Parse-structure errors (syntax error) always propagate regardless of ev.

  function parseExpr(ev) { return parseOr(ev); }

  function parseOr(ev) {
    let left = parseAnd(ev);
    while (peek() === '|') {
      next();
      if (ev && !isNull(left)) {
        parseAnd(false);              // truthy LHS: short-circuit, consume tokens
      } else {
        const r = parseAnd(ev);
        if (ev) {
          if (isNull(left)) left = isNull(r) ? intValue(0n) : r;
        } else { left = intValue(0n); }
      }
    }
    return left;
  }

  function parseAnd(ev) {
    let left = parseCmp(ev);
    while (peek() === '&') {
      next();
      if (ev && isNull(left)) {
        parseCmp(false);              // falsy LHS: short-circuit, consume tokens
        left = intValue(0n);
      } else {
        const r = parseCmp(ev);
        if (ev) {
          if (isNull(left) || isNull(r)) left = intValue(0n);
        } else { left = intValue(0n); }
      }
    }
    return left;
  }

  function parseCmp(ev) {
    let left = parseAdd(ev);
    const OPS = new Set(['=', '!=', '>', '<', '>=', '<=']);
    while (OPS.has(peek())) {
      const op = next();
      const r  = parseAdd(ev);
      left = ev ? intValue(cmp(op, left, r) ? 1n : 0n) : intValue(0n);
    }
    return left;
  }

  function parseAdd(ev) {
    let left = parseMul(ev);
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r  = parseMul(ev);
      if (!ev) { left = intValue(0n); continue; }
      left = intValue(toInteger(left) + (op === '+' ? toInteger(r) : -toInteger(r)));
    }
    return left;
  }

  function parseMul(ev) {
    let left = parseMatch(ev);
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const r  = parseMatch(ev);
      if (!ev) { left = intValue(0n); continue; }
      const lNum = toInteger(left), rNum = toInteger(r);
      if (rNum === 0n && (op === '/' || op === '%')) throw new Error('division by zero');
      if      (op === '*') left = intValue(lNum * rNum);
      else if (op === '/') left = intValue(lNum / rNum);
      else                 left = intValue(lNum % rNum);
    }
    return left;
  }

  function parseMatch(ev) {
    let left = parsePrimary(ev);
    while (peek() === ':') {
      next();
      // Pattern is a full primary expression (same recursive rule as keywords).
      // This means ':' 'substr' errors correctly, ':' '+ tok' forces tok as string.
      const patOp = parsePrimary(ev);
      left = applyMatch(left, toStringVal(patOp).value, ev);
    }
    return left;
  }

  function parsePrimary(ev) {
    const tok = next();
    if (tok === undefined) throw new Error('syntax error');
    if (tok === ')') throw new Error('syntax error');

    if (tok === '(') {
      const val   = parseExpr(ev);
      const close = next();
      if (close !== ')') throw new Error('syntax error');
      return val;
    }

    // GNU extension: '+' forces the next token to be a plain string, bypassing
    // keyword and operator interpretation.  In POSIX mode '+' is just a string.
    if (gnu.plusPrefix && tok === '+') {
      const raw = next();
      if (raw === undefined) throw new Error('syntax error');
      return strValue(raw);
    }

    // POSIX keywords: length, substr, index.
    // All parse their arguments as recursive primaries (not raw tokens).
    if (tok === 'length') {
      const operand = parsePrimary(ev);
      if (!ev) return intValue(0n);
      return intValue(BigInt(toStringVal(operand).value.length));
    }

    if (tok === 'substr') {
      const strOp = parsePrimary(ev), posOp = parsePrimary(ev), lenOp = parsePrimary(ev);
      if (!ev) return strValue('');
      const str    = toStringVal(strOp).value;
      const rawPos = toStringVal(posOp).value;
      const rawLen = toStringVal(lenOp).value;
      // Non-integer pos/len: silently returns '' (not an error), matching GNU expr.
      if (!isIntStr(rawPos) || !isIntStr(rawLen)) return strValue('');
      const p = Number(BigInt(rawPos)), l = Number(BigInt(rawLen));
      if (p < 1) return strValue('');
      return strValue(str.substr(p - 1, Math.max(0, l)));
    }

    if (tok === 'index') {
      const strOp = parsePrimary(ev), charsOp = parsePrimary(ev);
      if (!ev) return intValue(0n);
      const str = toStringVal(strOp).value, chars = toStringVal(charsOp).value;
      for (let j = 0; j < str.length; j++) {
        if (chars.includes(str[j])) return intValue(BigInt(j + 1));
      }
      return intValue(0n);
    }

    // GNU extension: 'match STRING PATTERN' is equivalent to 'STRING : PATTERN'.
    // In POSIX mode, 'match' is treated as a plain string value.
    if (gnu.match && tok === 'match') {
      const strOp = parsePrimary(ev), patOp = parsePrimary(ev);
      return applyMatch(strOp, toStringVal(patOp).value, ev);
    }

    // Any other token is a plain string value (including operator characters
    // like '=', '|', '*', ':', '+' in POSIX mode, etc.).
    return strValue(tok);
  }

  const result = parseExpr(true);
  if (!done()) throw new Error('syntax error');
  return result.value;
}

// ─────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────

function normalize(v) {
  return String(v ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '');
}

// GNU expr: result is falsy if it's empty string OR a numeric zero string
function isFalsy(s) {
  return s === '' || (/^-?\d+$/.test(s) && parseInt(s, 10) === 0);
}

function runExpr(args) {
  try {
    const data = normalize(exprEval(args));
    return { success: !isFalsy(data), data, error: null };
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

// ─────────────────────────────────────────────
// Original tests
// ─────────────────────────────────────────────

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
  it('capture group returns text',         async () => expectSameExpr({ args: ['foobar', ':', '\\(foo\\)'] }));
  it('capture group no match returns ""',  async () => expectSameExpr({ args: ['foobar', ':', '\\(baz\\)'] }));
  it('partial capture',                    async () => expectSameExpr({ args: ['abc123', ':', '[a-z]*\\([0-9]*\\)'] }));
});

describe('BRE quantifiers in : operator', () => {
  it('\\+ one-or-more matches',       async () => expectSameExpr({ args: ['aaa', ':', 'a\\+'] }));
  it('\\+ one-or-more no match → 0', async () => expectSameExpr({ args: ['bbb', ':', 'a\\+'] }));
  it('\\? zero-or-one present',       async () => expectSameExpr({ args: ['ab',  ':', 'a\\?b'] }));
  it('\\? zero-or-one absent',        async () => expectSameExpr({ args: ['b',   ':', 'a\\?b'] }));
  it('capture with \\+',              async () => expectSameExpr({ args: ['aaa', ':', '\\(a\\+\\)'] }));
});

describe('chained : operators (left-to-right)', () => {
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

describe('regex match — empty pattern', () => {
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

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE-BASED GENERATED TEST SUITE
// Systematically generated cases verified against real system expr
// ═════════════════════════════════════════════════════════════════════════════

describe('generated — arithmetic boundary values', () => {
  const cases = [
    { args: ['0', '+', '0'], desc: 'zero plus zero' },
    { args: ['0', '*', '99'], desc: 'zero times anything' },
    { args: ['1', '*', '1'], desc: 'one times one' },
    { args: ['-1', '*', '-1'], desc: 'negative times negative' },
    { args: ['-5', '+', '3'], desc: 'negative plus positive' },
    { args: ['5', '-', '10'], desc: 'positive minus larger positive' },
    { args: ['999', '+', '1'], desc: 'large number plus one' },
    { args: ['1000', '/', '3'], desc: 'large division' },
    { args: ['-1000', '/', '3'], desc: 'negative large division' },
    { args: ['7', '%', '3'], desc: 'modulo positive' },
    { args: ['-7', '%', '3'], desc: 'modulo negative dividend' },
    { args: ['7', '%', '-3'], desc: 'modulo negative divisor' },
    { args: ['0', '-', '5'], desc: 'zero minus positive' },
    { args: ['0', '-', '-5'], desc: 'zero minus negative' },
    { args: ['2147483647', '+', '0'], desc: 'INT_MAX boundary' },
    { args: ['-2147483648', '+', '0'], desc: 'INT_MIN boundary' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — comparison operator matrix', () => {
  const ops = ['=', '!=', '>', '<', '>=', '<='];
  const pairs = [
    ['1', '1'],
    ['1', '2'],
    ['2', '1'],
    ['0', '0'],
    ['-1', '0'],
    ['-5', '-10'],
    ['10', '-10'],
    ['abc', 'abc'],
    ['abc', 'def'],
    ['def', 'abc'],
    ['', ''],
    ['', 'x'],
    ['x', ''],
    ['01', '1'],
    ['001', '1'],
    ['1.5', '1.5'],
    ['1.5', '1.4'],
    ['+1', '1'],
  ];

  ops.forEach(op => {
    pairs.forEach(([l, r]) => {
      it(`${l} ${op} ${r}`, async () => expectSameExpr({ args: [l, op, r] }));
    });
  });
});

describe('generated — logical operator truth table', () => {
  const values = ['', '0', '1', '5', '-1', 'abc', '00'];
  values.forEach(l => {
    values.forEach(r => {
      it(`"${l}" & "${r}"`, async () => expectSameExpr({ args: [l, '&', r] }));
      it(`"${l}" | "${r}"`, async () => expectSameExpr({ args: [l, '|', r] }));
    });
  });
});

describe('generated — chained same-precedence operators', () => {
  const cases = [
    { args: ['1', '+', '2', '+', '3', '+', '4'], desc: 'chain +' },
    { args: ['10', '-', '1', '-', '2', '-', '3'], desc: 'chain -' },
    { args: ['2', '*', '3', '*', '4'], desc: 'chain *' },
    { args: ['100', '/', '2', '/', '2'], desc: 'chain /' },
    { args: ['100', '%', '30', '%', '7'], desc: 'chain %' },
    { args: ['1', '=', '1', '=', '1'], desc: 'chain =' },
    { args: ['1', '!=', '2', '!=', '3'], desc: 'chain !=' },
    { args: ['5', '>', '3', '>', '1'], desc: 'chain >' },
    { args: ['1', '<', '3', '<', '5'], desc: 'chain <' },
    { args: ['5', '>=', '5', '>=', '3'], desc: 'chain >=' },
    { args: ['3', '<=', '3', '<=', '5'], desc: 'chain <=' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — mixed precedence chains', () => {
  const cases = [
    { args: ['2', '+', '3', '*', '4', '+', '5'], desc: 'mul in add chain' },
    { args: ['10', '-', '2', '*', '3', '-', '1'], desc: 'mul in sub chain' },
    { args: ['100', '/', '2', '+', '3', '*', '4'], desc: 'div mul add mix' },
    { args: ['1', '+', '2', '=', '3', '*', '1'], desc: 'arith then cmp' },
    { args: ['5', '>', '3', '&', '2', '<', '4'], desc: 'cmp then and' },
    { args: ['0', '|', '5', '&', '3'], desc: 'or then and' },
    { args: ['0', '&', '5', '|', '3'], desc: 'and then or' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — parentheses nesting depth', () => {
  const cases = [
    { args: ['(', '1', '+', '2', ')'], desc: 'single level' },
    { args: ['(', '(', '1', '+', '2', ')', ')'], desc: 'double level' },
    { args: ['(', '(', '(', '1', '+', '2', ')', ')', '*', '4'], desc: 'triple level left' },
    { args: ['(', '1', '+', '(', '2', '*', '3', ')', ')'], desc: 'nested inside' },
    { args: ['(', '(', '1', '+', '2', ')', '*', '(', '3', '+', '4', ')', ')'], desc: 'parallel nesting' },
    { args: ['\\(', '1', '+', '2', '\\)'], desc: 'escaped parens' },
    { args: ['\\(', '\\(', '1', '+', '2', '\\)', '\\)'], desc: 'escaped double' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — length function exhaustive', () => {
  const inputs = [
    '',
    'a',
    'ab',
    'hello world',
    '1234567890',
    '   ',
    'tab\there',
    'newline\nhere',
    'mixed123ABC!@#',
  ];

  inputs.forEach(str => {
    it(`length "${str.replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`, async () =>
      expectSameExpr({ args: ['length', str] }));
  });
});

describe('generated — substr exhaustive', () => {
  const str = 'abcdefgh';
  const positions = [0, 1, 2, 3, 5, 8, 9, 99];
  const lengths = [0, 1, 2, 3, 5, 8, 9, 99, -1, -5];

  positions.forEach(p => {
    lengths.forEach(l => {
      it(`substr "${str}" ${p} ${l}`, async () =>
        expectSameExpr({ args: ['substr', str, String(p), String(l)] }));
    });
  });
});

describe('generated — index exhaustive', () => {
  const strings = ['abcdef', 'abcabc', 'aaaa', 'xyz', ''];
  const charsets = ['a', 'c', 'z', 'ae', 'xyz', 'def', ''];

  strings.forEach(str => {
    charsets.forEach(chars => {
      it(`index "${str}" "${chars}"`, async () =>
        expectSameExpr({ args: ['index', str, chars] }));
    });
  });
});

describe('generated — regex match patterns', () => {
  const strings = ['hello', 'abc123', 'foobar', 'aaa', 'b', '123', '', 'hello world'];
  const patterns = [
    'h.*o',
    '.*',
    '^h',
    'o$',
    '[a-z]+',
    '[0-9]+',
    '[a-z]*',
    'xyz',
    '',
    'a.c',
    'a\\+',
    'a\\?',
    '\\(foo\\)',
    '\\(bar\\)',
    '[a-z]*\\([0-9]*\\)',
    'foo\\(.*\\)',
    'hel\\+',
    'hel\\?',
    '.*\\(o\\)',
    '.*\\(x\\)',
  ];

  strings.forEach(str => {
    patterns.forEach(pat => {
      it(`"${str}" : "${pat}"`, async () =>
        expectSameExpr({ args: [str, ':', pat] }));
    });
  });
});

describe('generated — regex chained matches', () => {
  const cases = [
    { args: ['foobar', ':', 'foo\\(.*\\)', ':', '.*'], desc: 'capture then match all' },
    { args: ['abc123def', ':', '[a-z]*', ':', '[0-9]*'], desc: 'alpha then digits' },
    { args: ['hello', ':', 'h.*', ':', '.*o'], desc: 'overlapping patterns' },
    { args: ['no match', ':', 'xyz', ':', '.*'], desc: 'first no match then match' },
    { args: ['test', ':', '.*', ':', '.*'], desc: 'double match-all' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — division by zero variants', () => {
  const cases = [
    { args: ['1', '/', '0'], desc: 'positive / zero' },
    { args: ['-1', '/', '0'], desc: 'negative / zero' },
    { args: ['0', '/', '0'], desc: 'zero / zero' },
    { args: ['1', '%', '0'], desc: 'positive % zero' },
    { args: ['-1', '%', '0'], desc: 'negative % zero' },
    { args: ['0', '%', '0'], desc: 'zero % zero' },
    { args: ['10', '/', '0', '+', '1'], desc: 'div by zero in chain' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — non-integer arithmetic errors', () => {
  const nonInts = ['a', '1.5', '1a', '+1', '01x', ''];
  const ops = ['+', '-', '*', '/', '%'];

  nonInts.forEach(l => {
    nonInts.forEach(r => {
      ops.forEach(op => {
        it(`"${l}" ${op} "${r}"`, async () => expectSameExpr({ args: [l, op, r] }));
      });
    });
  });
});

describe('generated — syntax error cases', () => {
  const cases = [
    { args: [], desc: 'empty args' },
    { args: ['1', '+'], desc: 'missing right operand' },
    { args: ['1', '2'], desc: 'missing operator' },
    { args: ['('], desc: 'lone open paren' },
    { args: [')'], desc: 'lone close paren' },
    { args: ['(', '1'], desc: 'unclosed paren' },
    { args: ['1', ')'], desc: 'unopened paren' },
    { args: ['length'], desc: 'length missing arg' },
    { args: ['substr', 'abc'], desc: 'substr missing args' },
    { args: ['substr', 'abc', '1'], desc: 'substr missing len' },
    { args: ['index', 'abc'], desc: 'index missing charset' },
    { args: ['1', ':'], desc: 'match missing pattern' },
    { args: ['\\(', '1', '+', '2'], desc: 'escaped unclosed paren' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — single token literals', () => {
  const tokens = [
    '0', '1', '-1', '5', '00', '-0', '123456789',
    '', 'a', 'abc', 'hello world', '1.5', '+1', '-',
  ];

  tokens.forEach(tok => {
    it(`literal "${tok}"`, async () => expectSameExpr({ args: [tok] }));
  });
});

describe('generated — complex compound expressions', () => {
  const cases = [
    { args: ['(', '1', '+', '2', ')', '*', '(', '3', '+', '4', ')'], desc: 'two paren groups' },
    { args: ['5', '>', '3', '&', '2', '<', '4', '|', '0'], desc: 'cmp and or mix' },
    { args: ['length', 'hello', '>', '3', '&', 'index', 'abc', 'd', '=', '0'], desc: 'functions in logic' },
    { args: ['substr', 'abcdef', '2', '3', ':', 'bcd'], desc: 'substr then match' },
    { args: ['1', '+', '2', '*', '3', '-', '4', '/', '2'], desc: 'all arith ops' },
    { args: ['-5', '+', '3', '*', '2'], desc: 'negative in compound' },
    { args: ['0', '|', '(', '1', '+', '2', ')'], desc: 'or with paren' },
    { args: ['(', '0', '|', '5', ')', '&', '3'], desc: 'paren or then and' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — whitespace and special strings', () => {
  const cases = [
    { args: ['length', '   '], desc: 'length of spaces' },
    { args: ['length', '\t'], desc: 'length of tab' },
    { args: ['index', 'abc def', ' '], desc: 'index space char' },
    { args: ['substr', 'a b c', '2', '3'], desc: 'substr with spaces' },
    { args: ['hello world', ':', '.*'], desc: 'match string with space' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

describe('generated — large number stress', () => {
  const cases = [
    { args: ['999999', '+', '1'], desc: 'large add' },
    { args: ['1000000', '*', '2'], desc: 'large mul' },
    { args: ['1000000', '/', '3'], desc: 'large div' },
    { args: ['999999999', '%', '7'], desc: 'large mod' },
    { args: ['999999', '=', '999999'], desc: 'large eq' },
    { args: ['999999', '>', '999998'], desc: 'large gt' },
  ];

  cases.forEach(({ args, desc }) => {
    it(desc, async () => expectSameExpr({ args }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NEW TESTS — Targeted coverage for previously-unverified edge cases
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// 1. Integer overflow / large value correctness (BigInt)
//
// These values exceed Number.MAX_SAFE_INTEGER (2^53-1 = 9007199254740991).
// Before the BigInt fix, arithmetic on these would silently lose precision.
// Now we verify against the system oracle exactly as with all other tests.
// ─────────────────────────────────────────────
describe('large integers beyond Number.MAX_SAFE_INTEGER', () => {
  // 2^53 - 1 is the last exactly-representable JS Number
  const MAX_SAFE  = '9007199254740991';
  const OVER_SAFE = '9007199254740992'; // 2^53, first value that loses precision as Number
  const BIG       = '9999999999999999'; // 16 nines

  it('MAX_SAFE_INTEGER + 0 round-trips correctly',   async () => expectSameExpr({ args: [MAX_SAFE,  '+', '0'] }));
  it('MAX_SAFE_INTEGER + 1 does not wrap or lose',   async () => expectSameExpr({ args: [MAX_SAFE,  '+', '1'] }));
  it('OVER_SAFE + 0 round-trips',                    async () => expectSameExpr({ args: [OVER_SAFE, '+', '0'] }));
  it('OVER_SAFE + 1',                                async () => expectSameExpr({ args: [OVER_SAFE, '+', '1'] }));
  it('OVER_SAFE - 1',                                async () => expectSameExpr({ args: [OVER_SAFE, '-', '1'] }));
  it('BIG + 1',                                      async () => expectSameExpr({ args: [BIG,       '+', '1'] }));
  it('BIG * 2',                                      async () => expectSameExpr({ args: [BIG,       '*', '2'] }));
  it('BIG / 3 truncates correctly',                  async () => expectSameExpr({ args: [BIG,       '/', '3'] }));
  it('BIG % 7',                                      async () => expectSameExpr({ args: [BIG,       '%', '7'] }));
  it('BIG = BIG (equality)',                         async () => expectSameExpr({ args: [BIG,       '=',  BIG] }));
  it('BIG > MAX_SAFE',                               async () => expectSameExpr({ args: [BIG,       '>',  MAX_SAFE] }));
  it('negative BIG + BIG = 0',                       async () => expectSameExpr({ args: ['-' + BIG, '+', BIG] }));

  // INT64 boundaries (intmax_t on 64-bit systems)
  it('INT64_MAX + 0',  async () => expectSameExpr({ args: ['9223372036854775807',  '+', '0'] }));
  it('INT64_MIN + 0',  async () => expectSameExpr({ args: ['-9223372036854775808', '+', '0'] }));
});

// ─────────────────────────────────────────────
// 2. Keyword recursive primary parsing
//
// GNU expr parses `length`/`substr`/`index` arguments as full primary
// expressions, not raw tokens.  Consequences verified against oracle:
//
//   expr length length abc   → length(length("abc")) = length(3) = 1
//   expr length length       → inner length has no arg → syntax error
//   expr foo | length        → | is NOT short-circuited at parse level;
//                              length still needs an arg → syntax error
//   expr length ( abc )      → recursive: length(eval_paren(abc)) = 3
// ─────────────────────────────────────────────
describe('keyword recursive primary parsing', () => {
  // Recursive evaluation: outer length's arg is inner length's result
  it('length length abc = 1  (length of "3")',    async () => expectSameExpr({ args: ['length', 'length', 'abc'] }));
  it('length length "hello" = 1  (length of "5")',async () => expectSameExpr({ args: ['length', 'length', 'hello'] }));

  // length with a parenthesised expression as argument
  it('length ( 2 + 3 ) = 1  (length of "5")',     async () => expectSameExpr({ args: ['length', '(', '2', '+', '3', ')'] }));
  it('length ( abc ) = 3',                        async () => expectSameExpr({ args: ['length', '(', 'abc', ')'] }));

  // Missing argument: inner keyword consumes nothing → syntax error on both sides
  it('length length → syntax error (no arg for inner)',  async () => expectSameExpr({ args: ['length', 'length'] }));
  it('length substr → syntax error (no arg for inner)',  async () => expectSameExpr({ args: ['length', 'substr'] }));
  it('length index  → syntax error (no arg for inner)',  async () => expectSameExpr({ args: ['length', 'index'] }));

  // | does NOT short-circuit at parse level; length on RHS still needs an arg
  it('foo | length → syntax error (| not short-circuited)',  async () => expectSameExpr({ args: ['foo', '|', 'length'] }));
  it('"" | length  → syntax error',                          async () => expectSameExpr({ args: ['', '|', 'length'] }));
  it('"" | substr  → syntax error',                          async () => expectSameExpr({ args: ['', '|', 'substr'] }));
  it('"" | index   → syntax error',                          async () => expectSameExpr({ args: ['', '|', 'index'] }));

  // keyword tokens in positions where they are NOT parsed as keywords
  // (i.e. as RHS of a comparison, where parsePrimary reads them as keywords
  // and then tries to consume their argument — the next token)
  it('"foo" = length-as-primary eats next token, leftover = syntax error',
     async () => expectSameExpr({ args: ['foo', '=', 'length', 'abc'] }));

  // index with paren arg
  it('index ( abcdef ) c = 3',  async () => expectSameExpr({ args: ['index', '(', 'abcdef', ')', 'c'] }));

  // substr with paren args
  it('substr ( abcdef ) 1 3 = abc', async () => expectSameExpr({ args: ['substr', '(', 'abcdef', ')', '1', '3'] }));
});

// ─────────────────────────────────────────────
// 3. -0 and zero-string truthiness
//
// isNullString treats "-0", "00", "-00" as null/falsy because they are
// all-zero digit sequences.  Verify against oracle so behaviour is pinned
// and any future GNU expr change in this corner is caught immediately.
// ─────────────────────────────────────────────
describe('zero-string and -0 truthiness / falsiness', () => {
  // "-0" as a raw string token (type:string, not type:integer)
  it('"-0" as literal — success?',       async () => expectSameExpr({ args: ['-0'] }));
  it('"-0" | 5',                         async () => expectSameExpr({ args: ['-0', '|', '5'] }));
  it('"-0" & 1',                         async () => expectSameExpr({ args: ['-0', '&', '1'] }));
  it('"-0" = "0"',                       async () => expectSameExpr({ args: ['-0', '=', '0'] }));
  it('"-0" = "-0"',                      async () => expectSameExpr({ args: ['-0', '=', '-0'] }));

  // "00" — multiple zero digits (string type, truthy in some expr versions)
  it('"00" as literal',                  async () => expectSameExpr({ args: ['00'] }));
  it('"00" | 5',                         async () => expectSameExpr({ args: ['00', '|', '5'] }));
  it('"00" & 1',                         async () => expectSameExpr({ args: ['00', '&', '1'] }));

  // "-00" — negative all-zeros
  it('"-00" as literal',                 async () => expectSameExpr({ args: ['-00'] }));
  it('"-00" | 5',                        async () => expectSameExpr({ args: ['-00', '|', '5'] }));

  // Arithmetic result of 0 (integer type) must be falsy
  it('1 - 1 = 0 (integer zero, falsy)', async () => expectSameExpr({ args: ['1', '-', '1'] }));
  it('-1 + 1 = 0 (integer zero, falsy)',async () => expectSameExpr({ args: ['-1', '+', '1'] }));
});

// ─────────────────────────────────────────────
// 4. BRE interval quantifiers \{n,m\}
//
// These are valid BRE syntax and breToJs translates \{…\} → {…} for JS.
// Basic smoke tests; edge cases around unsupported forms are also included.
// ─────────────────────────────────────────────
describe('BRE interval quantifiers \\{n,m\\}', () => {
  it('a\\{3\\} matches exactly 3 a',       async () => expectSameExpr({ args: ['aaa',  ':', 'a\\{3\\}'] }));
  it('a\\{3\\} no match on 2 a',           async () => expectSameExpr({ args: ['aa',   ':', 'a\\{3\\}'] }));
  it('a\\{2,3\\} matches 2 a',             async () => expectSameExpr({ args: ['aa',   ':', 'a\\{2,3\\}'] }));
  it('a\\{2,3\\} matches 3 a',             async () => expectSameExpr({ args: ['aaa',  ':', 'a\\{2,3\\}'] }));
  it('a\\{2,3\\} does not over-match',     async () => expectSameExpr({ args: ['aaaa', ':', 'a\\{2,3\\}'] }));
  it('[0-9]\\{4\\} matches 4 digits',      async () => expectSameExpr({ args: ['1234', ':', '[0-9]\\{4\\}'] }));
  it('[0-9]\\{4\\} no match on 3 digits',  async () => expectSameExpr({ args: ['123',  ':', '[0-9]\\{4\\}'] }));
  it('capture with interval',              async () => expectSameExpr({ args: ['aaa',  ':', '\\(a\\{3\\}\\)'] }));
});
