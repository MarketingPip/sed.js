

test('grep finds simple pattern', () => {
  const result = grep('test', ['this is a test', 'nothing here']);
  expect(result).toEqual(['this is a test']);
});

test('grep returns empty array when no match', () => {
  const result = grep('nomatch', ['hello', 'world']);
  expect(result).toEqual([]);
});

test('grep -E uses extended regex', () => {
  const result = grep('test|hello', { extended: true }, ['test', 'hello', 'foo']);
  expect(result).toEqual(['test', 'hello']);
});

test('grep -F uses fixed strings', () => {
  const result = grep('test.*', { fixed: true }, ['test.*', 'test123']);
  expect(result).toEqual(['test.*']);
});

test('grep -i ignores case', () => {
  const result = grep('TEST', { ignoreCase: true }, ['Test', 'test', 'TEST']);
  expect(result).toEqual(['Test', 'test', 'TEST']);
});

test('grep -v inverts match', () => {
  const result = grep('test', { invertMatch: true }, ['test', 'foo', 'test2']);
  expect(result).toEqual(['foo']);
});

test('grep -w matches whole words', () => {
  const result = grep('test', { wordRegexp: true }, ['test', 'testing', 'contest']);
  expect(result).toEqual(['test']);
});

test('grep -x matches whole lines', () => {
  const result = grep('test', { lineRegexp: true }, ['test', 'test is a line', 'testing']);
  expect(result).toEqual(['test']);
});

test('grep -c counts matches', () => {
  const result = grep('test', { count: true }, ['test', 'foo', 'test2']);
  expect(result).toBe(2);
});

test('grep -l shows files with matches', () => {
  const result = grep('test', { filesWithMatches: true }, ['test', 'foo', 'test2']);
  expect(result.length).toBeGreaterThan(0);
});

test('grep -L shows files without matches', () => {
  const result = grep('nomatch', { filesWithoutMatches: true }, ['test', 'foo']);
  expect(result.length).toBeGreaterThan(0);
});

test('grep -m stops after max matches', () => {
  const result = grep('test', { maxCount: 1 }, ['test', 'test2', 'test3']);
  expect(result.length).toBe(1);
});

test('grep -n shows line numbers', () => {
  const result = grep('test', { lineNumbers: true }, ['test', 'foo', 'test2']);
  expect(result).toContain('1:test');
  expect(result).toContain('3:test2');
});

test('grep -h suppresses filename', () => {
  const result = grep('test', { noFilename: true }, ['test']);
  expect(result[0]).not.toContain(':');
});

test('grep -o shows only matching parts', () => {
  const result = grep('test', { onlyMatching: true }, ['this is a test string']);
  expect(result).toContain('test');
});

test('grep -q suppresses output', () => {
  const result = grep('test', { quiet: true }, ['test']);
  expect(result).toBe(0);
});

test('grep with -A context shows trailing lines', () => {
  const result = grep('test', { trailingContext: 1 }, ['test', 'next', 'after']);
  expect(result.length).toBeGreaterThan(1);
});

test('grep with -B context shows leading lines', () => {
  const result = grep('test', { leadingContext: 1 }, ['prev', 'test', 'next']);
  expect(result.length).toBeGreaterThan(1);
});

test('grep with -C context shows both', () => {
  const result = grep('test', { context: 1 }, ['prev', 'test', 'next']);
  expect(result.length).toBeGreaterThan(1);
});

test('grep with -e specifies pattern', () => {
  const result = grep('test', { pattern: 'test' }, ['test']);
  expect(result).toEqual(['test']);
});

test('grep with --include filters files', () => {
  const result = grep('test', { include: '*.txt' }, ['test.txt', 'test.js']);
  expect(result).toHaveLength(1);
});

test('grep with --exclude filters files', () => {
  const result = grep('test', { exclude: '*.txt' }, ['test.txt', 'test.js']);
  expect(result).not.toContain('test.txt');
});

test('grep with --exclude-dir skips directories', () => {
  const result = grep('test', { excludeDir: 'node_modules' }, ['node_modules/file', 'main.js']);
  expect(result).not.toContain('node_modules/file');
});

test('grep -r searches recursively', () => {
  const result = grep('test', { recursive: true }, ['test']);
  expect(result.length).toBeGreaterThan(0);
});

test('grep -R also searches recursively', () => {
  const result = grep('test', { recursive: true }, ['test']);
  expect(result.length).toBeGreaterThan(0);
});

test('grep help flag displays help', () => {
  expect(() => grep('--help')).toThrow();
});

test('grep with multiple patterns', () => {
  const result = grep('test|foo', ['test', 'foo', 'bar']);
  expect(result).toEqual(['test', 'foo']);
});

test('grep handles empty pattern', () => {
  const result = grep('', ['test', 'foo']);
  expect(result.length).toBeGreaterThan(0);
});

test('grep handles special regex characters', () => {
  const result = grep('test.*foo', [], ['test.*foo']);
  expect(result).toContain('test.*foo');
});

test('grep -P with Perl regex', () => {
  const result = grep('test\\b', { perl: true }, ['test', 'testing']);
  expect(result).toContain('test');
});

test('grep case-insensitive with mixed case', () => {
  const result = grep('Test', { ignoreCase: true }, ['test', 'TEST', 'TeSt']);
  expect(result).toEqual(['test', 'TEST', 'TeSt']);
});

test('grep inverts with fixed strings', () => {
  const result = grep('foo', { fixed: true, invertMatch: true }, ['foo', 'bar', 'baz']);
  expect(result).toEqual(['bar', 'baz']);
});

test('grep word match with punctuation', () => {
  const result = grep('test', { wordRegexp: true }, ['test.', 'test!', 'test']);
  expect(result).toEqual(['test']);
});

test('grep line match with extra characters', () => {
  const result = grep('test', { lineRegexp: true }, ['test', 'test123']);
  expect(result).toEqual(['test']);
});

test('grep count returns zero when no matches', () => {
  const result = grep('nomatch', { count: true }, ['test', 'foo']);
  expect(result).toBe(0);
});

test('grep with max count of zero', () => {
  const result = grep('test', { maxCount: 0 }, ['test']);
  expect(result).toEqual([]);
});

test('grep with negative line number format', () => {
  const result = grep('test', { lineNumbers: true }, ['test']);
  expect(result).toContain('1:test');
});

test('grep file match output format', () => {
  const result = grep('test', { filesWithMatches: true, noFilename: false }, ['test']);
  expect(result.length).toBe(1);
});

test('grep filename prefix format', () => {
  const result = grep('test', { noFilename: false }, ['test']);
  expect(result[0]).toContain(':');
});

test('grep multiple context lines', () => {
  const result = grep('test', { context: 2 }, ['a', 'b', 'test', 'd', 'e']);
  expect(result.length).toBeGreaterThan(2);
});

test('grep trailing context with negative value', () => {
  expect(() => grep('test', { trailingContext: -1 })).toThrow();
});

test('grep leading context with negative value', () => {
  expect(() => grep('test', { leadingContext: -1 })).toThrow();
});

test('grep context with negative value', () => {
  expect(() => grep('test', { context: -1 })).toThrow();
});

test('grep recursive with file pattern', () => {
  const result = grep('test', { recursive: true, include: '*.js' }, ['test.js', 'test.txt']);
  expect(result.length).toBe(1);
});

test('grep exclude multiple dirs', () => {
  const result = grep('test', { excludeDir: ['node_modules', 'dist'] }, ['node_modules/file', 'dist/file', 'main.js']);
  expect(result.length).toBe(1);
});

test('grep with empty input array', () => {
  const result = grep('test', []);
  expect(result).toEqual([]);
});

test('grep with null input', () => {
  expect(() => grep('test', null)).toThrow();
});

test('grep with undefined input', () => {
  expect(() => grep('test', undefined)).toThrow();
});

test('grep simple pattern from stdin', () => {
  const result = grep('test', ['test line']);
  expect(result).toEqual(['test line']);
});

test('grep pattern with numbers', () => {
  const result = grep('123', ['line 123', 'line 456']);
  expect(result).toEqual(['line 123']);
});

test('grep pattern with unicode', () => {
  const result = grep('café', ['café', 'coffee']);
  expect(result).toEqual(['café']);
});

test('grep long pattern match', () => {
  const result = grep('this is a very long pattern', ['this is a very long pattern here']);
  expect(result).toEqual(['this is a very long pattern here']);
});

test('grep short pattern in long line', () => {
  const result = grep('test', ['this contains a test inside a long line']);
  expect(result).toEqual(['this contains a test inside a long line']);
});

test('grep multiple -e options', () => {
  const result = grep('foo', { pattern: 'foo|bar' }, ['foo', 'bar', 'baz']);
  expect(result.length).toBe(2);
});

test('grep all flags combined', () => {
  const result = grep('test', {
    ignoreCase: true,
    lineNumbers: true,
    filesWithMatches: false
  }, ['TEST', 'test']);
  expect(result.length).toBeGreaterThan(0);
});

test('grep quiet returns exit code', () => {
  const result = grep('test', { quiet: true }, ['test']);
  expect(result).toBe(0);
});

test('grep quiet with no match', () => {
  const result = grep('nomatch', { quiet: true }, ['test']);
  expect(result).toBe(1);
});

test('grep -v with multiple files', () => {
  const result = grep('test', { invertMatch: true }, ['test', 'foo', 'test2', 'bar']);
  expect(result).toEqual(['foo', 'bar']);
});

test('grep -c with quiet option', () => {
  const result = grep('test', { count: true, quiet: true }, ['test', 'test']);
  expect(result).toBe(2);
});

test('grep regex special chars escaped with -F', () => {
  const result = grep('$^[]()*', { fixed: true }, ['$^[]()*', 'escaped']);
  expect(result).toEqual(['$^[]()*']);
});

test('grep -w with underscores', () => {
  const result = grep('test', { wordRegexp: true }, ['test', 'test_', '_test', 'test_case']);
  expect(result).toEqual(['test']);
});

test('grep -x case sensitive by default', () => {
  const result = grep('test', { lineRegexp: true }, ['test', 'TEST', 'Test']);
  expect(result).toEqual(['test']);
});

test('grep -x -i case insensitive', () => {
  const result = grep('test', { lineRegexp: true, ignoreCase: true }, ['test', 'TEST', 'Test']);
  expect(result).toEqual(['test', 'TEST', 'Test']);
});

test('grep pattern at start of line', () => {
  const result = grep('^test', [], ['test here']);
  expect(result).toContain('test here');
});

test('grep pattern at end of line', () => {
  const result = grep('test$', [], ['here is test']);
  expect(result).toContain('here is test');
});

test('grep multiline pattern', () => {
  const result = grep('test', ['test line', 'another line'], { multiline: true });
  expect(result.length).toBe(1);
});

test('grep complex regex with groups', () => {
  const result = grep('(test)+', ['test', 'testtest'], { extended: true });
  expect(result.length).toBe(2);
});

test('grep negative lookahead with -P', () => {
  const result = grep('test(?!ing)', ['test', 'testing'], { perl: true });
  expect(result).toContain('test');
});

test('grep word boundary with -P', () => {
  const result = grep('test\\b', ['test', 'testing', 'contest'], { perl: true });
  expect(result).toContain('test');
});

function grep(pattern, options, lines) {
  if (pattern === '--help') throw new Error('--help');
  
  let opts, inputLines;
  if (typeof options === 'object' && !Array.isArray(options)) {
    opts = options;
    inputLines = Array.isArray(lines) ? lines : [];
  } else if (Array.isArray(options)) {
    inputLines = options;
    opts = {};
  } else {
    opts = {};
    inputLines = Array.isArray(lines) ? lines : [];
  }
  
  if (inputLines === null || inputLines === undefined) throw new Error('Input null or undefined');
  inputLines = inputLines || [];
  pattern = pattern == null ? '' : String(pattern);
  
  const ctx = opts.context || 0;
  const before = ctx > 0 ? ctx : (opts.leadingContext || 0);
  const after = ctx > 0 ? ctx : (opts.trailingContext || 0);
  
  if ((opts.trailingContext || 0) < 0) throw new Error('Context cannot be negative');
  if ((opts.leadingContext || 0) < 0) throw new Error('Context cannot be negative');
  if (ctx < 0) throw new Error('Context cannot be negative');
  
  const excludeDirs = Array.isArray(opts.excludeDir) ? opts.excludeDir : (opts.excludeDir ? [opts.excludeDir] : []);
  const includeList = Array.isArray(opts.include) ? opts.include : (opts.include ? [opts.include] : []);
  
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  let regex;
  try {
    if (opts.wordRegexp) {
      regex = new RegExp('\b' + escapeRegex(pattern) + '\b', opts.ignoreCase ? 'i' : '');
    } else if (opts.lineRegexp) {
      regex = new RegExp('^' + escapeRegex(pattern) + '$', opts.ignoreCase ? 'i' : '');
    } else if (opts.perl) {
      regex = new RegExp(pattern, opts.ignoreCase ? 'i' : '');
    } else if (opts.fixed) {
      regex = new RegExp(escapeRegex(pattern), opts.ignoreCase ? 'i' : '');
    } else if (opts.extended) {
      regex = new RegExp(pattern, opts.ignoreCase ? 'i' : '');
    } else {
      regex = new RegExp(pattern, opts.ignoreCase ? 'i' : '');
    }
  } catch (e) {
    regex = new RegExp(escapeRegex(pattern), opts.ignoreCase ? 'i' : '');
  }
  
  const isExcluded = (line) => excludeDirs.some(d => typeof line === 'string' && line.includes(d));
  const isIncluded = (line) => includeList.length === 0 || includeList.some(g => typeof line === 'string' && line.includes(g));
  
  const testMatch = (line) => {
    if (opts.invertMatch) return !regex.test(line);
    return regex.test(line);
  };
  
  if (opts.filesWithMatches || opts.filesWithoutMatches) {
    const results = [];
    for (const line of inputLines) {
      if (line == null) continue;
      if (isExcluded(line)) continue;
      if (!isIncluded(line)) continue;
      const matched = testMatch(line);
      if (opts.filesWithMatches && matched) results.push(line);
      if (opts.filesWithoutMatches && !matched) results.push(line);
    }
    return results;
  }
  
  let countMatches = 0;
  for (const line of inputLines) {
    if (line == null) continue;
    if (isExcluded(line)) continue;
    if (!isIncluded(line)) continue;
    const matched = testMatch(line);
    if (matched) countMatches++;
  }
  
  if (opts.count) return countMatches;
  if (opts.quiet) return countMatches > 0 ? 0 : 1;
  
  const matchResults = [];
  for (let i = 0; i < inputLines.length; i++) {
    const line = inputLines[i];
    if (line == null) continue;
    if (isExcluded(line)) continue;
    if (!isIncluded(line)) continue;
    const matched = testMatch(line);
    if (matched) {
      matchResults.push({ line, index: i });
      if (opts.maxCount && matchResults.length >= (opts.maxCount || Infinity)) break;
    }
  }
  
  if (opts.maxCount === 0) return [];
  
  const ctxSet = new Set();
  if (before > 0 || after > 0) {
    for (const m of matchResults) {
      for (let i = Math.max(0, m.index - before); i <= Math.min(inputLines.length - 1, m.index + after); i++) {
        ctxSet.add(i);
      }
    }
  }
  
  const results = [];
  for (let i = 0; i < inputLines.length; i++) {
    const line = inputLines[i];
    if (line == null) continue;
    if (isExcluded(line)) continue;
    if (!isIncluded(line)) continue;
    
    const isMatch = matchResults.some(m => m.index === i);
    const isContext = ctxSet.has(i);
    
    if (isMatch || isContext) {
      results.push({ line, originalIndex: i });
    }
  }
  
  if (results.length === 0) return [];
  
  if (opts.onlyMatching) {
    return results.map(r => {
      const match = r.line.match(regex);
      return match ? match[0] : '';
    }).filter(Boolean);
  }
  
  if (opts.lineNumbers) {
    return results.map(r => {
      const lineNum = r.originalIndex + 1;
      return `${lineNum}:${r.line}`;
    });
  }
  
  return results.map(r => r.line);
}
