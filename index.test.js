import sed from './src/index.js';

const myVfs = {
  "notes.txt": "Hello, this is a test file containing the word hello.",
  "multi.txt": "one\ntwo\nthree\nfour\nfive",
  "empty.txt": "",
  "numbers.txt": "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"
};

async function fakeShell(cmd) {
  if (cmd === "whoami") return "user";
  return "unknown command";
}

async function runSed(command, stdin = null) {
  try {
    let result;

    if (stdin === null || stdin === undefined) {
      result = await sed(command, { vfs: myVfs, shell: fakeShell });
    } else {
      result = await sed(command, { stdin, shell: fakeShell });
    }

    return { success: true, data: result, error: null };
  } catch (err) {
    return { success: false, data: null, error: err.message };
  }
}

export { runSed };

describe('Sed.js FULL Test Suite', () => {
  /* -----------------------------
   * BASIC SUBSTITUTION
   * ----------------------------- */
  describe('Basic Substitution', () => {
    it('replaces first match only', async () => {
      const r = await runSed('s/apple/orange/', 'apple apple apple');
      expect(r.data).toBe('orange apple apple');
    });

    it('global replacement', async () => {
      const r = await runSed('s/apple/orange/g', 'apple apple apple');
      expect(r.data).toBe('orange orange orange');
    });

    it('case insensitive', async () => {
      const r = await runSed('s/hello/hi/I', 'Hello hello HELLO');
      expect(r.data).toBe('hi hi hi');
    });

    it('backreferences', async () => {
      const r = await runSed('s/\\(\\w\\+\\) \\(\\w\\+\\)/\\2 \\1/', 'hello world');
      expect(r.data).toBe('world hello');
    });

    it('ampersand replacement', async () => {
      const r = await runSed('s/foo/[&]/g', 'foo foo');
      expect(r.data).toBe('[foo] [foo]');
    });

    it('is case-sensitive by default', async () => {
      const r = await runSed('s/hello/hi/', 'Hello hello HELLO');
      expect(r.data).toBe('Hello hi HELLO');
    });

    it('only replaces the first occurrence per line by default', async () => {
      const r = await runSed('s/apple/orange/', 'apple apple apple');
      expect(r.data).toBe('orange apple apple');
    });

    it('supports combined flags (gI)', async () => {
      const r = await runSed('s/hello/hi/gI', 'Hello hello HELLO');
      expect(r.data).toBe('hi hi hi');
    });
  });

  /* -----------------------------
   * REGEX AND SPECIAL CHARACTERS
   * ----------------------------- */
  describe('Regex and Special Characters', () => {
    it('regex dot matches any character', async () => {
      const r = await runSed('s/c.t/dog/g', 'cat cot cut');
      expect(r.data).toBe('dog dog dog');
    });

    it('handles start (^) and end ($) anchors', async () => {
      const input = 'test results for test';

      const start = await runSed('s/^test/FINAL/', input);
      const end = await runSed('s/test$/FINAL/', input);

      expect(start.data).toBe('FINAL results for test');
      expect(end.data).toBe('test results for FINAL');
    });
  });

  /* -----------------------------
   * ADDRESSING
   * ----------------------------- */
  describe('Addressing', () => {
    it('single line number', async () => {
      const r = await runSed('2s/two/TWO/', myVfs['multi.txt']);
      expect(r.data).toBe("one\nTWO\nthree\nfour\nfive");
    });

    it('range addressing', async () => {
      const r = await runSed('2,4s/.*/X/', myVfs['multi.txt']);
      expect(r.data).toBe("one\nX\nX\nX\nfive");
    });

    it('regex address', async () => {
      const r = await runSed('/three/s/.*/MATCH/', myVfs['multi.txt']);
      expect(r.data).toContain('MATCH');
    });

    it('negated address', async () => {
      const r = await runSed('/three/!s/.*/NO/', myVfs['multi.txt']);
      expect(r.data).toBe("NO\nNO\nthree\nNO\nNO");
    });
  });

  /* -----------------------------
   * MULTI COMMAND
   * ----------------------------- */
  describe('Multiple Commands', () => {
    it('-e chaining', async () => {
      const r = await runSed("-e 's/a/A/g' -e 's/b/B/g'", 'abc');
      expect(r.data).toBe('ABc');
    });

    it('semicolon chaining', async () => {
      const r = await runSed('s/a/A/; s/b/B/', 'abc');
      expect(r.data).toBe('ABc');
    });

    it('complex multi-stage transformation (case + hold + conditional)', async () => {
      const stdin = `sed is powerful\nxyz`;
      const command = "-e 's/[a-z]/\\U&/g' -e '/[AEIOU]/ { h; s/./*/g; G; s/\\n/ /; }'";

      const r = await runSed(command, stdin);

      expect(r.success).toBe(true);

      const expected = `*************** SED IS POWERFUL\nXYZ`;
      expect(r.data).toBe(expected);
    });
  });

  /* -----------------------------
   * HOLD SPACE
   * ----------------------------- */
  describe('Hold Space', () => {
    it('h and g', async () => {
      const r = await runSed('h; s/.*/X/; g', 'hello');
      expect(r.data).toBe('hello');
    });

    it('H and G append', async () => {
      const r = await runSed('H; $!d; x', 'a\nb\nc');
      expect(r.data).toContain("a\nb\nc");
    });

    it('x swap', async () => {
      const r = await runSed('h; s/a/b/; x', 'a');
      expect(r.data).toBe('a');
    });
  });

  /* -----------------------------
   * DELETION / PRINTING
   * ----------------------------- */
  describe('Delete & Print', () => {
    it('delete matching lines', async () => {
      const r = await runSed('/two/d', myVfs['multi.txt']);
      expect(r.data).not.toContain('two');
    });

    it('print only matching (-n + p)', async () => {
      const r = await runSed('-n /two/p', myVfs['multi.txt']);
      expect(r.data.trim()).toBe('two');
    });

    it('default print suppressed with -n', async () => {
      const r = await runSed('-n', 'hello');
      expect(r.data).toBe('');
    });
  });

  /* -----------------------------
   * INSERT / APPEND / CHANGE
   * ----------------------------- */
  describe('Text Commands', () => {
    it('append (a)', async () => {
      const r = await runSed('/two/a AFTER', myVfs['multi.txt']);
      expect(r.data).toContain('two\nAFTER');
    });

    it('insert (i)', async () => {
      const r = await runSed('/two/i BEFORE', myVfs['multi.txt']);
      expect(r.data).toContain('BEFORE\ntwo');
    });

    it('change (c)', async () => {
      const r = await runSed('/two/c REPLACED', myVfs['multi.txt']);
      expect(r.data).toContain('REPLACED');
    });
  });

  /* -----------------------------
   * BRANCHING
   * ----------------------------- */
  describe('Branching', () => {
    it('simple label + branch', async () => {
      const cmd = `
        :a
        s/a/A/
        ta
      `;
      const r = await runSed(cmd, 'aaa');
      expect(r.data).toBe('AAA');
    });

    it('conditional branch (t)', async () => {
      const r = await runSed('s/a/A/; t done; s/b/B/; :done', 'a');
      expect(r.data).toBe('A');
    });
  });

  /* -----------------------------
   * MULTILINE PATTERN SPACE
   * ----------------------------- */
  describe('Multiline Pattern Space', () => {
    it('N command joins lines', async () => {
      const r = await runSed('N; s/\\n/ /', 'hello\nworld');
      expect(r.data).toBe('hello world');
    });

    it('D command partial delete', async () => {
      const r = await runSed('N; D', 'a\nb\nc');
      expect(r.data).toBe('c');
    });

    it('P prints partial', async () => {
      const r = await runSed('-n N; P', 'a\nb');
      expect(r.data).toContain('a');
    });

    it('processes substitution on every line of a multi-line string', async () => {
      const r = await runSed('s/line/row/g', 'line one\nline two\nline three');
      expect(r.data).toBe('row one\nrow two\nrow three');
    });
  });

  /* -----------------------------
   * FILE HANDLING
   * ----------------------------- */
  describe('VFS', () => {
    it('reads file', async () => {
      const r = await runSed('s/hello/hi/g notes.txt');
      expect(r.data).toContain('hi');
    });

    it('missing file error', async () => {
      const r = await runSed('s/x/y/ nope.txt');
      expect(r.success).toBe(false);
    });

    it('reads from the virtual file system', async () => {
      const r = await runSed('s/test/demo/ notes.txt');
      expect(r.data).toContain('demo file');
    });

    it('throws or returns error for non-existent files', async () => {
      const r = await runSed('s/foo/bar/ ghost.txt');
      expect(r.error).toBe('sed: ghost.txt: No such file or directory');
    });
  });

  /* -----------------------------
   * EDGE CASES
   * ----------------------------- */
  describe('Edge Cases', () => {
    it('empty input', async () => {
      const r = await runSed('s/a/b/', '');
      expect(r.data).toBe('');
    });

    it('empty file', async () => {
      const r = await runSed('s/a/b/ empty.txt');
      expect(r.data).toBe('');
    });

    it('no match substitution', async () => {
      const r = await runSed('s/x/y/', 'abc');
      expect(r.data).toBe('abc');
    });

    it('large input stress', async () => {
      const big = 'a\n'.repeat(10000);
      const r = await runSed('s/a/b/g', big);
      expect(r.data.includes('a')).toBe(false);
    });
  });

  it("executes shell with 'e' flag (s///e)", async () => {
    const r = await runSed("s/.*/&/e", "whoami");
    expect(r.data.trim()).toBe("user");
  });
  

  /* -----------------------------
   * REAL-WORLD PIPELINES
   * ----------------------------- */
  describe('Real-world pipelines', () => {
    it('number lines', async () => {
      const r = await runSed('=; N; s/\\n/: /', 'a\nb');
      expect(r.data).toContain('1\na: b');
    });

    it('duplicate lines', async () => {
      const r = await runSed('p', 'x');
      expect(r.data).toBe('x\nx');
    });

    it('reverse file using hold space', async () => {
      const cmd = '1!G; h; $!d';
      const r = await runSed(cmd, 'a\nb\nc');
      expect(r.data).toBe('c\nb\na');
    });
  });
});
