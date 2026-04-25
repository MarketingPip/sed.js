import sed from './src/index.js';
import { execa } from 'execa';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

/* -----------------------------
 * TEST HARNESS CORE
 * ----------------------------- */

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sed-test-'));

  // mirror VFS to real FS
  for (const [name, content] of Object.entries(myVfs)) {
    await fs.writeFile(path.join(tmpDir, name), content);
  }
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

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

/* -----------------------------
 * SYSTEM SED MIRROR
 * ----------------------------- */

function mapCommandToSystem(command) {
  // replace virtual filenames with real temp paths
  let mapped = command;

  for (const name of Object.keys(myVfs)) {
    const full = path.join(tmpDir, name);
    mapped = mapped.replace(new RegExp(`\\b${name}\\b`, 'g'), full);
  }

  return mapped;
}

async function runSystemSed(command, stdin = null) {
  try {
    const mapped = mapCommandToSystem(command);

    const options = stdin ? { input: stdin, shell: true } : { shell: true };

    const { stdout } = await execa(`sed ${mapped}`, options);
    return { success: true, data: stdout, error: null };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err.stderr || err.message
    };
  }
}

/* -----------------------------
 * ASSERTION WRAPPER
 * ----------------------------- */

async function expectSedMatch(command, stdin = null) {
  const mine = await runSed(command, stdin);
  const real = await runSystemSed(command, stdin);

  expect(mine.success).toBe(real.success);

  if (mine.success) {
    expect(mine.data).toBe(real.data);
  } else {
    expect(mine.error).toBe(real.error);
  }

  return mine; // so tests can still assert specifics
}

/* =========================================================
 * TESTS (UNCHANGED, JUST ROUTED THROUGH expectSedMatch)
 * ========================================================= */

describe('Sed.js FULL Test Suite (Validated Against System sed)', () => {

  describe('Basic Substitution', () => {
    it('replaces first match only', async () => {
      const r = await expectSedMatch('s/apple/orange/', 'apple apple apple');
      expect(r.data).toBe('orange apple apple');
    });

    it('global replacement', async () => {
      const r = await expectSedMatch('s/apple/orange/g', 'apple apple apple');
      expect(r.data).toBe('orange orange orange');
    });

    it('case insensitive', async () => {
      const r = await expectSedMatch('s/hello/hi/I', 'Hello hello HELLO');
      expect(r.data).toBe('hi hi hi');
    });

    it('backreferences', async () => {
      const r = await expectSedMatch('s/\\(\\w\\+\\) \\(\\w\\+\\)/\\2 \\1/', 'hello world');
      expect(r.data).toBe('world hello');
    });

    it('ampersand replacement', async () => {
      const r = await expectSedMatch('s/foo/[&]/g', 'foo foo');
      expect(r.data).toBe('[foo] [foo]');
    });

    it('is case-sensitive by default', async () => {
      const r = await expectSedMatch('s/hello/hi/', 'Hello hello HELLO');
      expect(r.data).toBe('Hello hi HELLO');
    });

    it('supports combined flags (gI)', async () => {
      const r = await expectSedMatch('s/hello/hi/gI', 'Hello hello HELLO');
      expect(r.data).toBe('hi hi hi');
    });
  });

  describe('Regex and Special Characters', () => {
    it('regex dot matches any character', async () => {
      const r = await expectSedMatch('s/c.t/dog/g', 'cat cot cut');
      expect(r.data).toBe('dog dog dog');
    });

    it('handles anchors', async () => {
      const input = 'test results for test';

      const start = await expectSedMatch('s/^test/FINAL/', input);
      const end = await expectSedMatch('s/test$/FINAL/', input);

      expect(start.data).toBe('FINAL results for test');
      expect(end.data).toBe('test results for FINAL');
    });
  });

  describe('Addressing', () => {
    it('single line number', async () => {
      const r = await expectSedMatch('2s/two/TWO/', myVfs['multi.txt']);
      expect(r.data).toBe("one\nTWO\nthree\nfour\nfive");
    });

    it('range addressing', async () => {
      const r = await expectSedMatch('2,4s/.*/X/', myVfs['multi.txt']);
      expect(r.data).toBe("one\nX\nX\nX\nfive");
    });

    it('regex address', async () => {
      const r = await expectSedMatch('/three/s/.*/MATCH/', myVfs['multi.txt']);
      expect(r.data).toContain('MATCH');
    });

    it('negated address', async () => {
      const r = await expectSedMatch('/three/!s/.*/NO/', myVfs['multi.txt']);
      expect(r.data).toBe("NO\nNO\nthree\nNO\nNO");
    });
  });

  describe('Multiple Commands', () => {
    it('-e chaining', async () => {
      const r = await expectSedMatch("-e 's/a/A/g' -e 's/b/B/g'", 'abc');
      expect(r.data).toBe('ABc');
    });

    it('semicolon chaining', async () => {
      const r = await expectSedMatch('s/a/A/; s/b/B/', 'abc');
      expect(r.data).toBe('ABc');
    });
  });

  describe('Hold Space', () => {
    it('h and g', async () => {
      const r = await expectSedMatch('h; s/.*/X/; g', 'hello');
      expect(r.data).toBe('hello');
    });
  });

  describe('Delete & Print', () => {
    it('delete matching lines', async () => {
      const r = await expectSedMatch('/two/d', myVfs['multi.txt']);
      expect(r.data).not.toContain('two');
    });

    it('print only matching', async () => {
      const r = await expectSedMatch('-n /two/p', myVfs['multi.txt']);
      expect(r.data.trim()).toBe('two');
    });
  });

  describe('Text Commands', () => {
    it('append (a)', async () => {
      const r = await expectSedMatch('/two/a AFTER', myVfs['multi.txt']);
      expect(r.data).toContain('two\nAFTER');
    });
  });

  describe('Edge Cases', () => {
    it('empty input', async () => {
      const r = await expectSedMatch('s/a/b/', '');
      expect(r.data).toBe('');
    });

    it('no match substitution', async () => {
      const r = await expectSedMatch('s/x/y/', 'abc');
      expect(r.data).toBe('abc');
    });
  });

  it("executes shell with 'e' flag", async () => {
    const r = await expectSedMatch("s/.*/&/e", "whoami");
    expect(r.data.trim()).toBe("user");
  });
});
