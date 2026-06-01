import sed from './src/index.js';
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir;

const myVfs = {
  'notes.txt': 'Hello, this is a test file containing the word hello.',
  'multi.txt': 'one\ntwo\nthree\nfour\nfive',
  'empty.txt': '',
  'numbers.txt': '1\n2\n3\n4\n5\n6\n7\n8\n9\n10',
};

function normalizeEol(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '');
}

async function runSed(command, stdin = null) {
  try {
    const opts = { vfs: myVfs };
    if (stdin !== null && stdin !== undefined) opts.stdin = stdin;
    const result = await sed(command, opts);
    return { success: true, data: normalizeEol(result), error: null };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: normalizeEol(err?.message || String(err)),
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

async function expectSameSedOutput({
  portCommand,
  systemArgs,
  stdin = null,
  description = '',
}) {
  const [port, system] = await Promise.all([
    runSed(portCommand, stdin),
    runSystemSed(systemArgs, stdin),
  ]);

  const isMatch = port.success && system.success && port.data === system.data;
  const hasError = !port.success && !system.success;
  const isParity = isMatch || hasError;

  return { port, system, isMatch, hasError, isParity, description };
}

// Oracle Test Matrix: Comprehensive feature coverage
const ORACLE_TESTS = [
  // Basic Substitution
  {
    name: 'Basic substitution (first match)',
    portCommand: 's/hello/hi/',
    systemArgs: ['s/hello/hi/'],
    stdin: 'hello world hello',
  },
  {
    name: 'Global substitution',
    portCommand: 's/hello/hi/g',
    systemArgs: ['s/hello/hi/g'],
    stdin: 'hello hello hello',
  },
  {
    name: 'Case insensitive (I flag)',
    portCommand: 's/HELLO/hi/I',
    systemArgs: ['s/HELLO/hi/I'],
    stdin: 'Hello HELLO hello',
  },
  {
    name: 'Case insensitive (i flag)',
    portCommand: 's/hello/HI/i',
    systemArgs: ['s/hello/HI/i'],
    stdin: 'Hello HELLO hello',
  },
  {
    name: 'Print flag (p)',
    portCommand: '-n s/hello/hi/p',
    systemArgs: ['-n', 's/hello/hi/p'],
    stdin: 'hello world',
  },
  {
    name: 'Nth occurrence only (2nd)',
    portCommand: 's/a/X/2',
    systemArgs: ['s/a/X/2'],
    stdin: 'a a a a',
  },
  {
    name: 'Nth occurrence with global (2g)',
    portCommand: 's/a/X/2g',
    systemArgs: ['s/a/X/2g'],
    stdin: 'a a a a',
  },
  {
    name: 'Ampersand replacement',
    portCommand: 's/foo/[&]/g',
    systemArgs: ['s/foo/[&]/g'],
    stdin: 'foo bar foo',
  },
  {
    name: 'Alternate delimiter',
    portCommand: 's#/path#/new#',
    systemArgs: ['s#/path#/new#'],
    stdin: '/path/to/file',
  },
  {
    name: 'Backref replacement',
    portCommand: 's/\\(\\w\\+\\)/[\\1]/g',
    systemArgs: ['s/\\(\\w\\+\\)/[\\1]/g'],
    stdin: 'hello world',
  },

  // Addressing
  {
    name: 'Single line address',
    portCommand: '2s/two/TWO/',
    systemArgs: ['2s/two/TWO/', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Range addressing',
    portCommand: '2,4s/.*/X/',
    systemArgs: ['2,4s/.*/X/', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Last line ($)',
    portCommand: '$s/five/FIVE/',
    systemArgs: ['$s/five/FIVE/', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Regex address',
    portCommand: '/three/s/.*/MATCHED/',
    systemArgs: ['/three/s/.*/MATCHED/', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Negated address',
    portCommand: '/three/!s/.*/NO/',
    systemArgs: ['/three/!s/.*/NO/', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Step addressing (1~2)',
    portCommand: '-n 1~2p',
    systemArgs: ['-n', '1~2p'],
    stdin: '1\n2\n3\n4\n5\n6',
  },
  {
    name: 'Step addressing (2~3)',
    portCommand: '-n 2~3p',
    systemArgs: ['-n', '2~3p'],
    stdin: '1\n2\n3\n4\n5\n6\n7\n8\n9',
  },
  {
    name: 'Relative offset (+N)',
    portCommand: '-n /2/,+2p',
    systemArgs: ['-n', '/2/,+2p'],
    stdin: '1\n2\n3\n4\n5',
  },

  // Delete and Print
  {
    name: 'Delete matching lines',
    portCommand: '/two/d',
    systemArgs: ['/two/d', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Delete first line',
    portCommand: '1d',
    systemArgs: ['1d', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Print specific line (-n p)',
    portCommand: '-n 2p',
    systemArgs: ['-n', '2p', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Suppress auto print (-n)',
    portCommand: '-n',
    systemArgs: ['-n'],
    stdin: 'hello\nworld',
  },

  // Text Commands
  {
    name: 'Append text',
    portCommand: '/two/a APPENDED',
    systemArgs: ['/two/a APPENDED', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Insert text',
    portCommand: '/two/i INSERTED',
    systemArgs: ['/two/i INSERTED', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },
  {
    name: 'Change text',
    portCommand: '/two/c CHANGED',
    systemArgs: ['/two/c CHANGED', path.join(tmpDir, 'multi.txt')],
    file: 'multi.txt',
  },

  // Hold Space
  {
    name: 'Hold and get (h; g)',
    portCommand: 'h; s/.*/X/; g',
    systemArgs: ['h; s/.*/X/; g'],
    stdin: 'hello',
  },
  {
    name: 'Hold append (H; $!d)',
    portCommand: 'H; $!d; x',
    systemArgs: ['H; $!d; x'],
    stdin: 'a\nb\nc',
  },
  {
    name: 'Exchange (x)',
    portCommand: 'h; s/.*/Y/; x',
    systemArgs: ['h; s/.*/Y/; x'],
    stdin: 'hello',
  },
  {
    name: 'Get append (G)',
    portCommand: 'h; s/.*/X/; G',
    systemArgs: ['h; s/.*/X/; G'],
    stdin: 'hello',
  },

  // Multiline
  {
    name: 'Next append (N)',
    portCommand: 'N; s/\\n/ /',
    systemArgs: ['N; s/\\n/ /'],
    stdin: 'hello\nworld',
  },
  {
    name: 'Delete first line (D)',
    portCommand: 'N; D',
    systemArgs: ['N; D'],
    stdin: 'a\nb\nc',
  },
  {
    name: 'Print first line (P)',
    portCommand: '-n N; P',
    systemArgs: ['-n', 'N; P'],
    stdin: 'a\nb',
  },

  // Transliteration
  {
    name: 'Transliterate',
    portCommand: 'y/abc/xyz/',
    systemArgs: ['y/abc/xyz/'],
    stdin: 'abc',
  },
  {
    name: 'Case conversion via y',
    portCommand: 'y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/',
    systemArgs: ['y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/'],
    stdin: 'hello world',
  },

  // Line number and list
  {
    name: 'Print line number (=)',
    portCommand: '=',
    systemArgs: ['='],
    stdin: 'a\nb',
  },
  {
    name: 'List escaped (l)',
    portCommand: '-n l',
    systemArgs: ['-n', 'l'],
    stdin: 'hello\tworld',
  },

  // Branching
  {
    name: 'Label and branch',
    portCommand: 'b skip; d; :skip',
    systemArgs: ['b skip; d; :skip'],
    stdin: 'hello\nworld',
  },
  {
    name: 'Conditional branch (t)',
    portCommand: 's/a/A/; t done; s/b/B/; :done',
    systemArgs: ['s/a/A/; t done; s/b/B/; :done'],
    stdin: 'a\nb',
  },
  {
    name: 'Conditional no-match (T)',
    portCommand: 's/x/y/; T add; b end; :add; s/$/X/; :end',
    systemArgs: ['s/x/y/; T add; b end; :add; s/$/X/; :end'],
    stdin: 'a',
  },

  // Quit
  {
    name: 'Quit (q)',
    portCommand: '2q',
    systemArgs: ['2q'],
    stdin: 'a\nb\nc',
  },
  {
    name: 'Quit silent (Q)',
    portCommand: '2Q',
    systemArgs: ['2Q'],
    stdin: 'a\nb\nc',
  },

  // Grouping
  {
    name: 'Grouped commands',
    portCommand: '2{s/b/B/;p}',
    systemArgs: ['-n', '2{s/b/B/;p}'],
    stdin: 'a\nb\nc',
  },
  {
    name: 'Grouped with address',
    portCommand: '/b/{s/.*/X/;}',
    systemArgs: ['/b/{s/.*/X/;}'],
    stdin: 'a\nb\nc',
  },

  // Multiple commands
  {
    name: 'Semicolon separation',
    portCommand: 's/a/A/; s/b/B/',
    systemArgs: ['s/a/A/; s/b/B/'],
    stdin: 'abc',
  },
  {
    name: '-e chaining',
    portCommand: "-e 's/a/A/' -e 's/b/B/'",
    systemArgs: ['-e', 's/a/A/', '-e', 's/b/B/'],
    stdin: 'abc',
  },

  // Extended regex
  {
    name: 'ERE with +',
    portCommand: '-E s/a+/X/',
    systemArgs: ['-E', 's/a+/X/'],
    stdin: 'aaa bbb',
  },
  {
    name: 'ERE with alternation',
    portCommand: '-E s/cat|dog/X/g',
    systemArgs: ['-E', 's/cat|dog/X/g'],
    stdin: 'cat dog bird',
  },
  {
    name: 'ERE with grouping',
    portCommand: '-E s/(hello) (world)/\\2 \\1/',
    systemArgs: ['-E', 's/(hello) (world)/\\2 \\1/'],
    stdin: 'hello world',
  },

  // BRE escapes
  {
    name: 'BRE \\+ quantifier',
    portCommand: 's/a\\+/X/',
    systemArgs: ['s/a\\+/X/'],
    stdin: 'aaa bbb',
  },
  {
    name: 'BRE \\? optional',
    portCommand: 's/a\\?b/X/',
    systemArgs: ['s/a\\?b/X/'],
    stdin: 'ab\nb',
  },
  {
    name: 'BRE \\| alternation',
    portCommand: 's/cat\\|dog/X/',
    systemArgs: ['s/cat\\|dog/X/'],
    stdin: 'cat\ndog\nbird',
  },

  // Anchors
  {
    name: 'Start anchor (^)',
    portCommand: 's/^test/FOUND/',
    systemArgs: ['s/^test/FOUND/'],
    stdin: 'test results',
  },
  {
    name: 'End anchor ($)',
    portCommand: 's/test$/FOUND/',
    systemArgs: ['s/test$/FOUND/'],
    stdin: 'results test',
  },

  // Special cases
  {
    name: 'Empty pattern reuse',
    portCommand: 's/hello/X/; //s/X/Y/',
    systemArgs: ['s/hello/X/; //s/X/Y/'],
    stdin: 'hello hello',
  },
  {
    name: 'Dot matches any',
    portCommand: 's/c.t/dog/g',
    systemArgs: ['s/c.t/dog/g'],
    stdin: 'cat cot cut',
  },
  {
    name: 'Zap command (z)',
    portCommand: 'z',
    systemArgs: ['z'],
    stdin: 'hello\nworld',
  },
];

describe('Sed.js Parity Oracle Tests', () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sed-parity-'));
    await Promise.all(
      Object.entries(myVfs).map(([filename, contents]) =>
        fs.writeFile(path.join(tmpDir, filename), contents)
      )
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Dynamically generate tests from oracle matrix
  let passCount = 0;
  let failCount = 0;
  const results = [];

  for (const testCase of ORACLE_TESTS) {
    it(`[PARITY] ${testCase.name}`, async () => {
      // Resolve file paths if needed
      let systemArgs = testCase.systemArgs;
      if (testCase.file) {
        systemArgs = testCase.systemArgs.map(arg =>
          arg.includes('multi.txt') ? path.join(tmpDir, 'multi.txt') :
          arg.includes('notes.txt') ? path.join(tmpDir, 'notes.txt') :
          arg.includes('numbers.txt') ? path.join(tmpDir, 'numbers.txt') :
          arg.includes('empty.txt') ? path.join(tmpDir, 'empty.txt') :
          arg
        );
      }

      const result = await expectSameSedOutput({
        portCommand: testCase.portCommand,
        systemArgs,
        stdin: testCase.stdin,
        description: testCase.name,
      });

      results.push({
        name: testCase.name,
        ...result,
      });

      if (result.isParity) {
        passCount++;
        expect(result.port.success).toBe(true);
      } else {
        failCount++;
        console.log(`\n[PARITY MISMATCH] ${testCase.name}`);
        console.log(`Port: ${result.port.data || result.port.error}`);
        console.log(`System: ${result.system.data || result.system.error}`);
      }

      expect(result.isParity).toBe(true);
    });
  }

  afterAll(() => {
    console.log(`\n\n=== PARITY REPORT ===");
    console.log(`Total: ${passCount + failCount}`);
    console.log(`Pass: ${passCount}`);
    console.log(`Fail: ${failCount}`);
    console.log(`Success Rate: ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%`);
  });
});
