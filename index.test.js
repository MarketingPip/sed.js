import sed from './src/index.js';
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir;
let notesPath;
let multiPath;
let emptyPath;
let numbersPath;

const myVfs = {
  'notes.txt': 'Hello, this is a test file containing the word hello.', 
  'multi.txt': 'one\ntwo\nthree\nfour\nfive',
  'empty.txt': '',
  'numbers.txt': '1\n2\n3\n4\n5\n6\n7\n8\n9\n10',
  'script-comments.sed':  '# comment\ns/hello/HELLO/\n',
  'script.sed': 's/hello/HELLO/\ns/world/WORLD/\n'
};
 

async function fakeShell(cmd) {
  if (cmd === 'whoami') return 'user';
  return 'unknown command';
}

 function normalizeEol(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function mirrorVfsToRealFs(vfs, dir) {
  await Promise.all(
    Object.entries(vfs).map(([filename, contents]) =>
      fs.writeFile(path.join(dir, filename), contents)
    )
  );
}


async function runSed(command, stdin = null, shell = fakeShell) {
  try {
    const opts = { vfs: myVfs, shell };
    if (stdin !== null && stdin !== undefined) opts.stdin = stdin;

    const result = await sed(command, opts);
    return { success: true, data: normalizeEol(result), error: null };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: normalizeEol(err?.message || err?.stderr || String(err)),
    };
  }
}

async function runSystemSed(args, stdin = null) {
  try {
    const spawnOptions = {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    };

    if (stdin !== null && stdin !== undefined) {
      spawnOptions.input = String(stdin);
    }

    const result = spawnSync('sed', args, spawnOptions);

    if (result.error) {
      return {
        success: false,
        data: null,
        error: normalizeEol(result.error.message || String(result.error)),
      };
    }

    const success = result.status === 0;

    return {
      success,
      data: success ? normalizeEol(result.stdout) : null,
      error: normalizeEol(result.stderr || result.stdout || ''),
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: normalizeEol(err?.message || String(err)),
    };
  }
}

async function systemShell(command) {
  const result = spawnSync(command, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: true,
  });

  if (result.error || result.status !== 0) {
    throw new Error(normalizeEol(result.error?.message || result.stderr || `Command failed: ${command}`));
  }

  return normalizeEol(result.stdout);
}

async function expectSameSedOutput({
  portCommand,
  systemArgs,
  stdin = null,
  shell = fakeShell,
}) {
  const [port, system] = await Promise.all([
    runSed(portCommand, stdin, shell),
    runSystemSed(systemArgs, stdin),
  ]);

  expect(port.success).toBe(true);

  if (system.success) {
    expect(port.data).toBe(system.data);
  }

  return { port, system };
}

export { runSed };

describe('Sed.js Tests vs System Sed', () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sed-test-'));

    notesPath = path.join(tmpDir, 'notes.txt');
    multiPath = path.join(tmpDir, 'multi.txt');
    emptyPath = path.join(tmpDir, 'empty.txt');
    numbersPath = path.join(tmpDir, 'numbers.txt');

    await mirrorVfsToRealFs(myVfs, tmpDir);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should replace "hello" with "hi" and match system sed', async () => {
    const response = await expectSameSedOutput({
      portCommand: `s/hello/hi/ notes.txt`,
      systemArgs: ['s/hello/hi/', notesPath],
    });

    expect(response.port.data).toContain('hi');
  });

  it('should handle stdin correctly and match system sed', async () => {
    await expectSameSedOutput({
      portCommand: 's/test/TEST/',
      systemArgs: ['s/test/TEST/'],
      stdin: 'This is a test string.',
    });
  });
});

describe('Sed.js FULL Test Suite', () => {
  describe('Basic Substitution', () => {
    it('replaces first match only', async () => {
      await expectSameSedOutput({
        portCommand: 's/apple/orange/',
        systemArgs: ['s/apple/orange/'],
        stdin: 'apple apple apple',
      });
    });

    it('global replacement', async () => {
      await expectSameSedOutput({
        portCommand: 's/apple/orange/g',
        systemArgs: ['s/apple/orange/g'],
        stdin: 'apple apple apple',
      });
    });

    it('case insensitive', async () => {
      await expectSameSedOutput({
        portCommand: 's/hello/hi/I',
        systemArgs: ['s/hello/hi/I'],
        stdin: 'Hello hello HELLO',
      });
    });

    it('backreferences', async () => {
      await expectSameSedOutput({
        portCommand: 's/\\(\\w\\+\\) \\(\\w\\+\\)/\\2 \\1/',
        systemArgs: ['s/\\(\\w\\+\\) \\(\\w\\+\\)/\\2 \\1/'],
        stdin: 'hello world',
      });
    });

    it('ampersand replacement', async () => {
      await expectSameSedOutput({
        portCommand: 's/foo/[&]/g',
        systemArgs: ['s/foo/[&]/g'],
        stdin: 'foo foo',
      });
    });

    it('is case-sensitive by default', async () => {
      await expectSameSedOutput({
        portCommand: 's/hello/hi/',
        systemArgs: ['s/hello/hi/'],
        stdin: 'Hello hello HELLO',
      });
    });

    it('only replaces the first occurrence per line by default', async () => {
      await expectSameSedOutput({
        portCommand: 's/apple/orange/',
        systemArgs: ['s/apple/orange/'],
        stdin: 'apple apple apple',
      });
    });

    it('supports combined flags (gI)', async () => {
      await expectSameSedOutput({
        portCommand: 's/hello/hi/gI',
        systemArgs: ['s/hello/hi/gI'],
        stdin: 'Hello hello HELLO',
      });
    });
  });

  describe('Regex and Special Characters', () => {
    it('regex dot matches any character', async () => {
      await expectSameSedOutput({
        portCommand: 's/c.t/dog/g',
        systemArgs: ['s/c.t/dog/g'],
        stdin: 'cat cot cut',
      });
    });

    it('handles start (^) and end ($) anchors', async () => {
      const input = 'test results for test';

      const start = await expectSameSedOutput({
        portCommand: 's/^test/FINAL/',
        systemArgs: ['s/^test/FINAL/'],
        stdin: input,
      });

      const end = await expectSameSedOutput({
        portCommand: 's/test$/FINAL/',
        systemArgs: ['s/test$/FINAL/'],
        stdin: input,
      });

      expect(start.port.data).toBe('FINAL results for test');
      expect(end.port.data).toBe('test results for FINAL');
    });
  });

  describe('Addressing', () => {
    it('single line number', async () => {
      await expectSameSedOutput({
        portCommand: '2s/two/TWO/',
        systemArgs: ['2s/two/TWO/', multiPath],
      });
    });

    it('range addressing', async () => {
      await expectSameSedOutput({
        portCommand: '2,4s/.*/X/',
        systemArgs: ['2,4s/.*/X/', multiPath],
      });
    });

    it('regex address', async () => {
      const { port, system } = await expectSameSedOutput({
        portCommand: '/three/s/.*/MATCH/',
        systemArgs: ['/three/s/.*/MATCH/', multiPath],
      });

      if (system.success) {
        expect(port.data).toContain('MATCH');
        expect(system.data).toContain('MATCH');
      }
    });

    it('negated address', async () => {
      await expectSameSedOutput({
        portCommand: '/three/!s/.*/NO/',
        systemArgs: ['/three/!s/.*/NO/', multiPath],
      });
    });
  });

  describe('Multiple Commands', () => {
    it('-e chaining', async () => {
      await expectSameSedOutput({
        portCommand: `-e 's/a/A/g' -e 's/b/B/g'`,
        systemArgs: ['-e', 's/a/A/g', '-e', 's/b/B/g'],
        stdin: 'abc',
      });
    });

    it('semicolon chaining', async () => {
      await expectSameSedOutput({
        portCommand: 's/a/A/; s/b/B/',
        systemArgs: ['s/a/A/; s/b/B/'],
        stdin: 'abc',
      });
    });

    it('complex multi-stage transformation (case + hold + conditional)', async () => {
      const stdin = `sed is powerful\nxyz`;

      await expectSameSedOutput({
        portCommand: `-e 's/[a-z]/\\U&/g' -e '/[AEIOU]/ { h; s/./*/g; G; s/\\n/ /; }'`,
        systemArgs: ['-e', 's/[a-z]/\\U&/g', '-e', '/[AEIOU]/ { h; s/./*/g; G; s/\\n/ /; }'],
        stdin,
      });
    });
  });

  describe('Hold Space', () => {
    it('h and g', async () => {
      await expectSameSedOutput({
        portCommand: 'h; s/.*/X/; g',
        systemArgs: ['h; s/.*/X/; g'],
        stdin: 'hello',
      });
    });

    it('H and G append', async () => {
      const { port, system } = await expectSameSedOutput({
        portCommand: 'H; $!d; x',
        systemArgs: ['H; $!d; x'],
        stdin: 'a\nb\nc',
      });

      expect(port.data.trimStart()).toBe(system.data.trimStart());
    });

    it('x swap', async () => {
      await expectSameSedOutput({
        portCommand: 'h; s/a/b/; x',
        systemArgs: ['h; s/a/b/; x'],
        stdin: 'a',
      });
    });
  });

  describe('Delete & Print', () => {
    it('delete matching lines', async () => {
      const { port, system } = await expectSameSedOutput({
        portCommand: '/two/d',
        systemArgs: ['/two/d', multiPath],
      });

      if (system.success) {
        expect(port.data).not.toContain('two');
        expect(system.data).not.toContain('two');
      }
    });

    it('print only matching (-n + p)', async () => {
      await expectSameSedOutput({
        portCommand: '-n /two/p',
        systemArgs: ['-n', '/two/p', multiPath],
      });
    });

    it('default print suppressed with -n', async () => {
      await expectSameSedOutput({
        portCommand: '-n',
        systemArgs: ['-n'],
        stdin: 'hello',
      });
    });
  });

  describe('Text Commands', () => {
    it('append (a)', async () => {
      await expectSameSedOutput({
        portCommand: '/two/a AFTER',
        systemArgs: ['/two/a AFTER', multiPath],
      });
    });

    it('insert (i)', async () => {
      await expectSameSedOutput({
        portCommand: '/two/i BEFORE',
        systemArgs: ['/two/i BEFORE', multiPath],
      });
    });

    it('change (c)', async () => {
      await expectSameSedOutput({
        portCommand: '/two/c REPLACED',
        systemArgs: ['/two/c REPLACED', multiPath],
      });
    });
  });

  describe('Branching', () => {
    it('simple label + branch', async () => {
      const cmd = `
:a
s/a/A/
ta
`;

      await expectSameSedOutput({
        portCommand: cmd,
        systemArgs: ['-e', ':a\ns/a/A/\nta'],
        stdin: 'aaa',
      });
    });

    it('conditional branch (t)', async () => {
      await expectSameSedOutput({
        portCommand: 's/a/A/; t done; s/b/B/; :done',
        systemArgs: ['s/a/A/; t done; s/b/B/; :done'],
        stdin: 'a',
      });
    });
  });

  describe('Multiline Pattern Space', () => {
    it('N command joins lines', async () => {
      await expectSameSedOutput({
        portCommand: 'N; s/\\n/ /',
        systemArgs: ['N; s/\\n/ /'],
        stdin: 'hello\nworld',
      });
    });

    it('D command partial delete', async () => {
      await expectSameSedOutput({
        portCommand: 'N; D',
        systemArgs: ['N; D'],
        stdin: 'a\nb\nc',
      });
    });

    it('P prints partial', async () => {
      await expectSameSedOutput({
        portCommand: '-n N; P',
        systemArgs: ['-n', 'N; P'],
        stdin: 'a\nb',
      });
    });

    it('processes substitution on every line of a multi-line string', async () => {
      await expectSameSedOutput({
        portCommand: 's/line/row/g',
        systemArgs: ['s/line/row/g'],
        stdin: 'line one\nline two\nline three',
      });
    });
  });

  describe('VFS', () => {
    it('reads file', async () => {
      await expectSameSedOutput({
        portCommand: 's/hello/hi/g notes.txt',
        systemArgs: ['s/hello/hi/g', notesPath],
      });
    });

    it('missing file error', async () => {
      const port = await runSed('s/x/y/ nope.txt');
      const system = await runSystemSed(['s/x/y/', path.join(tmpDir, 'nope.txt')]);

      expect(port.success).toBe(false);
      expect(system.success).toBe(false);
      expect(port.error).toMatch(/nope\.txt/i);
      expect(system.error).toMatch(/nope\.txt/i);
    });

    it('reads from the virtual file system', async () => {
      await expectSameSedOutput({
        portCommand: 's/test/demo/ notes.txt',
        systemArgs: ['s/test/demo/', notesPath],
      });
    });

    it('throws or returns error for non-existent files', async () => {
      const port = await runSed('s/foo/bar/ ghost.txt');
      const system = await runSystemSed(['s/foo/bar/', path.join(tmpDir, 'ghost.txt')]);

      expect(port.success).toBe(false);
      expect(system.success).toBe(false);
      expect(port.error).toMatch(/ghost\.txt/i);
      expect(system.error).toMatch(/ghost\.txt/i);
    });
  });

  describe('Edge Cases', () => {
    it('empty input', async () => {
      await expectSameSedOutput({
        portCommand: 's/a/b/',
        systemArgs: ['s/a/b/'],
        stdin: '',
      });
    });

    it('empty file', async () => {
      await expectSameSedOutput({
        portCommand: 's/a/b/ empty.txt',
        systemArgs: ['s/a/b/', emptyPath],
      });
    });

    it('no match substitution', async () => {
      await expectSameSedOutput({
        portCommand: 's/x/y/',
        systemArgs: ['s/x/y/'],
        stdin: 'abc',
      });
    });

    it('large input stress', async () => {
      const big = 'a\n'.repeat(10000);

      await expectSameSedOutput({
        portCommand: 's/a/b/g',
        systemArgs: ['s/a/b/g'],
        stdin: big,
      });
    });
  });

  it("executes shell with 'e' flag (s///e)", async () => {
    const response = await runSed('s/.*/&/e', 'whoami', systemShell);
    const expectedUser = os.userInfo().username;

    expect(response.success).toBe(true);
    expect(response.data.trim()).toBe(expectedUser.trim());
  });

  describe('Real-world pipelines', () => {
    it('number lines', async () => {
      await expectSameSedOutput({
        portCommand: '=; N; s/\\n/: /',
        systemArgs: ['=; N; s/\\n/: /'],
        stdin: 'a\nb',
      });
    });

    it('duplicate lines', async () => {
      await expectSameSedOutput({
        portCommand: 'p',
        systemArgs: ['p'],
        stdin: 'x',
      });
    });

    it('reverse file using hold space', async () => {
      const cmd = '1!G; h; $!d';

      await expectSameSedOutput({
        portCommand: cmd,
        systemArgs: [cmd],
        stdin: 'a\nb\nc',
      });
    });
  });
});


describe('Advanced / Missing Coverage', () => {
  describe('Alternate Delimiters', () => {
    it('supports alternate delimiter (#)', async () => {
      await expectSameSedOutput({
        portCommand: "s#/path#/newpath#",
        systemArgs: ["s#/path#/newpath#"],
        stdin: "/path/to/file",
      });
    });

    it('supports alternate delimiter (|)', async () => {
      await expectSameSedOutput({
        portCommand: "s|foo|bar|g",
        systemArgs: ["s|foo|bar|g"],
        stdin: "foo foo",
      });
    });
  });

  describe('Nth Occurrence Substitution', () => {
    it('replaces 2nd occurrence only', async () => {
      await expectSameSedOutput({
        portCommand: "s/foo/X/2",
        systemArgs: ["s/foo/X/2"],
        stdin: "foo foo foo",
      });
    });

    it('replaces 3rd occurrence only', async () => {
      await expectSameSedOutput({
        portCommand: "s/a/X/3",
        systemArgs: ["s/a/X/3"],
        stdin: "a a a a a",
      });
    });
  });

  describe('Step Addressing (~)', () => {
    it('prints every 2nd line (0~2)', async () => {
      await expectSameSedOutput({
        portCommand: "-n 0~2p",
        systemArgs: ["-n", "0~2p"],
        stdin: "1\n2\n3\n4\n5\n6",
      });
    });

    it('prints every 3rd line (1~3)', async () => {
      await expectSameSedOutput({
        portCommand: "-n 1~3p",
        systemArgs: ["-n", "1~3p"],
        stdin: "1\n2\n3\n4\n5\n6",
      });
    });
  });

  describe('Quit Commands', () => {
    it('q quits after printing line', async () => {
      await expectSameSedOutput({
        portCommand: "2q",
        systemArgs: ["2q"],
        stdin: "a\nb\nc",
      });
    });

    it('Q quits without printing current line', async () => {
      await expectSameSedOutput({
        portCommand: "2Q",
        systemArgs: ["2Q"],
        stdin: "a\nb\nc",
      });
    });
  });

  describe('Zap (z) Command', () => {
    it('clears pattern space', async () => {
      await expectSameSedOutput({
        portCommand: "z",
        systemArgs: ["z"],
        stdin: "hello\nworld",
      });
    });

    it('clears only addressed line', async () => {
      await expectSameSedOutput({
        portCommand: "2z",
        systemArgs: ["2z"],
        stdin: "a\nb\nc",
      });
    });
  });

  describe('List (l) Command', () => {
    it('prints escaped output', async () => {
      await expectSameSedOutput({
        portCommand: "-n l",
        systemArgs: ["-n", "l"],
        stdin: "hello\tworld",
      });
    });

    it('escapes backslashes', async () => {
      await expectSameSedOutput({
        portCommand: "-n l",
        systemArgs: ["-n", "l"],
        stdin: "a\\b",
      });
    });
  });

  describe('Extended Regex (-E)', () => {
    it('supports + quantifier', async () => {
      await expectSameSedOutput({
        portCommand: "-E s/a+/X/",
        systemArgs: ["-E", "s/a+/X/"],
        stdin: "aaa bbb",
      });
    });

    it('supports alternation |', async () => {
      await expectSameSedOutput({
        portCommand: "-E s/cat|dog/X/g",
        systemArgs: ["-E", "s/cat|dog/X/g"],
        stdin: "cat dog bird",
      });
    });

    it('supports grouping + backreferences', async () => {
      await expectSameSedOutput({
        portCommand: "-E s/(hello) (world)/\\2 \\1/",
        systemArgs: ["-E", "s/(hello) (world)/\\2 \\1/"],
        stdin: "hello world",
      });
    });
  });

  describe('BRE Escapes', () => {
    it('supports \\+ as quantifier', async () => {
      await expectSameSedOutput({
        portCommand: "s/a\\+/X/",
        systemArgs: ["s/a\\+/X/"],
        stdin: "aaa",
      });
    });

    it('supports \\? optional', async () => {
      await expectSameSedOutput({
        portCommand: "s/a\\?b/X/",
        systemArgs: ["s/a\\?b/X/"],
        stdin: "ab\nb",
      });
    });

    it('supports \\| alternation', async () => {
      await expectSameSedOutput({
        portCommand: "s/cat\\|dog/X/",
        systemArgs: ["s/cat\\|dog/X/"],
        stdin: "cat\ndog\nbird",
      });
    });
  });

  describe('Relative Address (+N)', () => {
    it('deletes N lines after match', async () => {
      await expectSameSedOutput({
        portCommand: "/^2/,+2d",
        systemArgs: ["/^2/,+2d"],
        stdin: "1\n2\n3\n4\n5",
      });
    });

    it('prints N lines after match', async () => {
      await expectSameSedOutput({
        portCommand: "-n /a/,+1p",
        systemArgs: ["-n", "/a/,+1p"],
        stdin: "a\n1\na\n2",
      });
    });
  });

  describe('Grouped Commands {}', () => {
    it('runs grouped substitution', async () => {
      await expectSameSedOutput({
        portCommand: "2{s/b/B/}",
        systemArgs: ["2{s/b/B/}"],
        stdin: "a\nb\nc",
      });
    });

    it('runs multiple commands inside group', async () => {
      await expectSameSedOutput({
        portCommand: "-n 2{s/b/B/;p}",
        systemArgs: ["-n", "2{s/b/B/;p}"],
        stdin: "a\nb\nc",
      });
    });
  });

  describe('Range State Tracking', () => {
    it('handles START to END deletion', async () => {
      await expectSameSedOutput({
        portCommand: "/START/,/END/d",
        systemArgs: ["/START/,/END/d"],
        stdin: "a\nSTART\nb\nEND\nc",
      });
    });

    it('handles unclosed range', async () => {
      await expectSameSedOutput({
        portCommand: "/START/,/END/d",
        systemArgs: ["/START/,/END/d"],
        stdin: "a\nSTART\nb\nc",
      });
    });
  });

  describe('Substitution Tracking (t / T)', () => {
    it('t triggers on substitution', async () => {
      await expectSameSedOutput({
        portCommand: "s/a/A/; t done; s/b/B/; :done",
        systemArgs: ["s/a/A/; t done; s/b/B/; :done"],
        stdin: "a",
      });
    });

    it('T triggers when no substitution', async () => {
      await expectSameSedOutput({
        portCommand: "s/x/y/; T add; b end; :add; s/$/X/; :end",
        systemArgs: ["s/x/y/; T add; b end; :add; s/$/X/; :end"],
        stdin: "a",
      });
    });
  });
});


// advanced.test.js

describe('Advanced Commands (Additional Coverage)', () => {
  describe('N command (append next line)', () => {
    it('joins pairs of lines (even count)', async () => {
      await expectSameSedOutput({
        portCommand: 'N; s/\\n/ /',
        systemArgs: ['N; s/\\n/ /'],
        stdin: 'line1\nline2\nline3\nline4',
      });
    });

    it('handles odd number of lines (auto-print on EOF)', async () => {
      await expectSameSedOutput({
        portCommand: 'N; s/\\n/ /',
        systemArgs: ['N; s/\\n/ /'],
        stdin: 'line1\nline2\nline3',
      });
    });

    it('joins with custom separator', async () => {
      await expectSameSedOutput({
        portCommand: 'N; s/\\n/,/',
        systemArgs: ['N; s/\\n/,/'],
        stdin: 'a\nb\nc\nd',
      });
    });
  });

  describe('y (transliteration)', () => {
    it('lowercase to uppercase', async () => {
      await expectSameSedOutput({
        portCommand:
          'y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/',
        systemArgs: [
          'y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/',
        ],
        stdin: 'hello world',
      });
    });

    it('character rotation', async () => {
      await expectSameSedOutput({
        portCommand: 'y/abc/bca/',
        systemArgs: ['y/abc/bca/'],
        stdin: 'abc',
      });
    });

    it('handles escape sequences', async () => {
      await expectSameSedOutput({
        portCommand: 'y/\\t/ /',
        systemArgs: ['y/\\t/ /'],
        stdin: 'a\tb',
      });
    });
  });

  describe('= (line number)', () => {
    it('prints line numbers for all lines', async () => {
      await expectSameSedOutput({
        portCommand: '=',
        systemArgs: ['='],
        stdin: 'a\nb\nc',
      });
    });

    it('prints line number for addressed line', async () => {
      await expectSameSedOutput({
        portCommand: '2=',
        systemArgs: ['2='],
        stdin: 'a\nb\nc',
      });
    });
  });

  describe('Branching (b, t, labels)', () => {
    it('unconditional branch skips commands', async () => {
      await expectSameSedOutput({
        portCommand: 'b; d',
        systemArgs: ['b; d'],
        stdin: 'hello\nworld',
      });
    });

    it('branch to label', async () => {
      await expectSameSedOutput({
        portCommand: 'b skip; d; :skip',
        systemArgs: ['b skip; d; :skip'],
        stdin: 'hello\nworld',
      });
    });

    it('conditional branch (t)', async () => {
      await expectSameSedOutput({
        portCommand: 's/hello/HELLO/; t; d',
        systemArgs: ['s/hello/HELLO/; t; d'],
        stdin: 'hello\nworld',
      });
    });

    it('conditional branch to label', async () => {
      await expectSameSedOutput({
        portCommand: 's/hello/HELLO/; t done; s/world/WORLD/; :done',
        systemArgs: ['s/hello/HELLO/; t done; s/world/WORLD/; :done'],
        stdin: 'hello\nworld',
      });
    });
  });

 
describe('-f (script file)', () => {
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sed-test-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('executes script from file', async () => {
    myVfs['script.sed'] = 's/hello/HELLO/\ns/world/WORLD/\n';
    const realPath = path.join(tmpDir, 'script.sed');
    await fs.writeFile(realPath, myVfs['script.sed']);

    await expectSameSedOutput({
      portCommand: `-f script.sed`,
      systemArgs: ['-f', realPath],
      stdin: 'hello world',
    });
  });

  it('ignores comments in script file', async () => {
    myVfs['script-comments.sed'] = '# comment\ns/hello/HELLO/\n';
    const realPath = path.join(tmpDir, 'script-comments.sed');
    await fs.writeFile(realPath, myVfs['script-comments.sed']);

    await expectSameSedOutput({
      portCommand: `-f script-comments.sed`,
      systemArgs: ['-f', realPath],
      stdin: 'hello',
    });
  });

  it('combines -f and -e', async () => {
    myVfs['script-mixed.sed'] = 's/hello/HELLO/\n';
    const realPath = path.join(tmpDir, 'script-mixed.sed');
    await fs.writeFile(realPath, myVfs['script-mixed.sed']);

    await expectSameSedOutput({
      portCommand: `-f script-mixed.sed -e 's/world/WORLD/'`,
      systemArgs: ['-f', realPath, '-e', 's/world/WORLD/'],
      stdin: 'hello world',
    });
  });

  it('errors on missing script file', async () => {
    const missing = 'nope.sed';
    const realPath = path.join(tmpDir, missing);

    const port = await runSed(`-f ${missing}`, 'hello');
    const system = await runSystemSed(['-f', realPath], 'hello');

    expect(port.success).toBe(false);
    expect(system.success).toBe(false);
    expect(port.error.toLowerCase()).toContain('nope');
    expect(system.error.toLowerCase()).toContain('nope');
  });
  });
});
