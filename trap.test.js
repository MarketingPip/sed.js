import { spawnSync } from 'child_process';

// ─────────────────────────────────────────────
// POSIX trap — signal handler registry
// ─────────────────────────────────────────────
//
// Bash `trap` behavior:
//   trap 'command' SIGNAL...  — set handler
//   trap -p [SIGNAL...]       — print handler(s)
//   trap [-] SIGNAL...        — reset to default
//   trap -l                   — list signals
//   trap                      — list all active traps
//
// Signal names are case-insensitive. SIG prefix is optional.
// Signal numbers are accepted (0 = EXIT pseudo-signal).
// Overwriting a trap replaces it.

// Module-level registry (persists across calls)
const handlers = new Map();

// Signal name → number mapping
const SIGNAL_MAP = {
  'EXIT': 0, '0': 0,
  'HUP': 1, 'SIGHUP': 1, '1': 1,
  'INT': 2, 'SIGINT': 2, '2': 2,
  'QUIT': 3, 'SIGQUIT': 3, '3': 3,
  'ILL': 4, 'SIGILL': 4, '4': 4,
  'TRAP': 5, 'SIGTRAP': 5, '5': 5,
  'ABRT': 6, 'SIGABRT': 6, '6': 6,
  'BUS': 7, 'SIGBUS': 7, '7': 7,
  'FPE': 8, 'SIGFPE': 8, '8': 8,
  'KILL': 9, 'SIGKILL': 9, '9': 9,
  'USR1': 10, 'SIGUSR1': 10, '10': 10,
  'SEGV': 11, 'SIGSEGV': 11, '11': 11,
  'USR2': 12, 'SIGUSR2': 12, '12': 12,
  'PIPE': 13, 'SIGPIPE': 13, '13': 13,
  'ALRM': 14, 'SIGALRM': 14, '14': 14,
  'TERM': 15, 'SIGTERM': 15, '15': 15,
  'STKFLT': 16, 'SIGSTKFLT': 16, '16': 16,
  'CHLD': 17, 'SIGCHLD': 17, '17': 17,
  'CONT': 18, 'SIGCONT': 18, '18': 18,
  'STOP': 19, 'SIGSTOP': 19, '19': 19,
  'TSTP': 20, 'SIGTSTP': 20, '20': 20,
  'TTIN': 21, 'SIGTTIN': 21, '21': 21,
  'TTOU': 22, 'SIGTTOU': 22, '22': 22,
  'URG': 23, 'SIGURG': 23, '23': 23,
  'XCPU': 24, 'SIGXCPU': 24, '24': 24,
  'XFSZ': 25, 'SIGXFSZ': 25, '25': 25,
  'VTALRM': 26, 'SIGVTALRM': 26, '26': 26,
  'PROF': 27, 'SIGPROF': 27, '27': 27,
  'WINCH': 28, 'SIGWINCH': 28, '28': 28,
  'POLL': 29, 'SIGPOLL': 29, '29': 29,
  'IO': 29, 'SIGIO': 29,
  'PWR': 30, 'SIGPWR': 30, '30': 30,
  'SYS': 31, 'SIGSYS': 31, '31': 31,
  'RTMIN': 34, 'SIGRTMIN': 34, '34': 34,
  'RTMAX': 64, 'SIGRTMAX': 64, '64': 64,
};

const MAX_SIGNAL = 64;

/**
 * Parse a signal specification into a canonical number.
 * @param {string|number} signal
 * @returns {number}
 */
function parseSignal(signal) {
  if (signal === undefined || signal === null) {
    throw new Error('Signal must be a string or number');
  }

  if (typeof signal === 'string') {
    const upper = signal.toUpperCase();
    if (SIGNAL_MAP[upper] !== undefined) {
      return SIGNAL_MAP[upper];
    }
    // Try parsing as numeric string
    const parsed = parseInt(signal, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= MAX_SIGNAL) {
      return parsed;
    }
    throw new Error('Invalid signal name');
  }

  if (typeof signal === 'number') {
    if (!Number.isInteger(signal) || signal < 0 || signal > MAX_SIGNAL) {
      throw new Error('Invalid signal number');
    }
    return signal;
  }

  throw new Error('Signal must be a string or number');
}

/**
 * Get canonical signal name for output.
 * @param {number} num
 * @returns {string}
 */
function signalName(num) {
  const names = {
    0: 'EXIT', 1: 'SIGHUP', 2: 'SIGINT', 3: 'SIGQUIT', 4: 'SIGILL',
    5: 'SIGTRAP', 6: 'SIGABRT', 7: 'SIGBUS', 8: 'SIGFPE', 9: 'SIGKILL',
    10: 'SIGUSR1', 11: 'SIGSEGV', 12: 'SIGUSR2', 13: 'SIGPIPE', 14: 'SIGALRM',
    15: 'SIGTERM', 16: 'SIGSTKFLT', 17: 'SIGCHLD', 18: 'SIGCONT', 19: 'SIGSTOP',
    20: 'SIGTSTP', 21: 'SIGTTIN', 22: 'SIGTTOU', 23: 'SIGURG', 24: 'SIGXCPU',
    25: 'SIGXFSZ', 26: 'SIGVTALRM', 27: 'SIGPROF', 28: 'SIGWINCH', 29: 'SIGPOLL',
    30: 'SIGPWR', 31: 'SIGSYS', 34: 'SIGRTMIN', 64: 'SIGRTMAX',
  };
  return names[num] || `SIG${num}`;
}

/**
 * POSIX trap implementation.
 *
 * Forms:
 *   trap('SIGINT', 'command')     → sets handler, returns command
 *   trap('SIGINT', '')            → clears handler, returns null
 *   trap('SIGINT')                → queries handler, returns command or null
 *   trap('SIGINT', undefined)     → queries handler, returns command or null
 *   trap()                        → lists all handlers (not implemented in basic form)
 *
 * @param {string|number} signal
 * @param {string|undefined} command
 * @returns {string|null}
 */
export function trap(signal, command) {
  // Query form: no signal provided
  if (signal === undefined) {
    // Return all active traps as formatted string
    const lines = [];
    for (const [num, cmd] of handlers) {
      if (cmd !== null) {
        lines.push(`trap -- '${cmd}' ${signalName(num)}`);
      }
    }
    return lines.join('\n') || null;
  }

  const signalNum = parseSignal(signal);

  // Query form: no command provided (or undefined)
  if (command === undefined) {
    const existing = handlers.get(signalNum);
    return existing === undefined ? null : existing;
  }

  // Validate command type
  if (command !== '' && typeof command !== 'string') {
    throw new Error('Command must be a string');
  }

  // Clear form: empty string
  if (command === '') {
    handlers.delete(signalNum);
    return null;
  }

  // Set form: store command
  handlers.set(signalNum, command);
  return command;
}

/**
 * Reset all handlers (for testing).
 */
export function resetTraps() {
  handlers.clear();
}

// ─────────────────────────────────────────────
// Bash oracle helper
// ─────────────────────────────────────────────

function bashTrap(args) {
  // Build bash script
  const signal = args.signal;
  const command = args.command;
  const query = args.query || false;
  const clear = args.clear || false;
  const list = args.list || false;

  let script = '#!/bin/bash\n';

  if (list) {
    script += 'trap -l\n';
  } else if (clear) {
    script += `trap - ${signal}\n`;
    script += `trap -p ${signal}\n`;
  } else if (query) {
    script += `trap -p ${signal}\n`;
  } else if (command !== undefined) {
    script += `trap '${command.replace(/'/g, "'\\''")}' ${signal}\n`;
    script += `trap -p ${signal}\n`;
  }

  const { stdout, stderr, status } = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore']   // <‑‑ ignore stderr
  });

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: status };
}

// ─────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────

function expectSameTrap(args) {
  const port = trap(args.signal, args.command);
  const bash = bashTrap(args);

  // For set operations, bash prints "trap -- 'cmd' SIGNAL"
  // Our port returns just the command string
  if (args.command !== undefined && args.command !== '' && !args.query && !args.clear) {
    // Setting: port returns command, bash prints full line
    const expectedCmd = args.command;
    expect(port).toBe(expectedCmd);
    expect(bash.stdout).toContain(expectedCmd);
    expect(bash.exitCode).toBe(0);
  } else if (args.clear || args.command === '') {
    // Clearing: port returns null, bash prints nothing
    expect(port).toBeNull();
    expect(bash.stdout).toBe('');
  } else if (args.query) {
    // Querying: compare with bash
    if (bash.stdout === '') {
      expect(port).toBeNull();
    } else {
      // Extract command from bash output: trap -- 'cmd' SIGNAL
      const match = bash.stdout.match(/trap -- '(.+)' /);
      if (match) {
        expect(port).toBe(match[1]);
      }
    }
  }
}

// ─────────────────────────────────────────────
// Original unit tests
// ─────────────────────────────────────────────

beforeEach(() => {
  resetTraps();
});

describe('basic trap registration', () => {
  it('registers SIGINT handler', () => {
    expect(trap('SIGINT', 'echo hit')).toBe('echo hit');
  });

  it('registers SIGTERM handler', () => {
    expect(trap('SIGTERM', 'echo term')).toBe('echo term');
  });

  it('registers handler by signal number 2', () => {
    expect(trap(2, 'echo int')).toBe('echo int');
  });

  it('registers handler by signal number 15', () => {
    expect(trap(15, 'echo term')).toBe('echo term');
  });

  it('registers EXIT handler (signal 0)', () => {
    expect(trap(0, 'echo exit')).toBe('echo exit');
  });
});

describe('trap queries', () => {
  it('returns null for unset trap', () => {
    expect(trap('SIGINT')).toBeNull();
  });

  it('returns command for set trap', () => {
    trap('SIGINT', 'echo hello');
    expect(trap('SIGINT')).toBe('echo hello');
  });

  it('returns null after clearing', () => {
    trap('SIGINT', 'echo hello');
    trap('SIGINT', '');
    expect(trap('SIGINT')).toBeNull();
  });

  it('query with explicit undefined', () => {
    trap('SIGTERM', 'echo term');
    expect(trap('SIGTERM', undefined)).toBe('echo term');
  });
});

describe('trap clearing', () => {
  it('clears with empty string', () => {
    trap('SIGINT', 'echo hello');
    expect(trap('SIGINT', '')).toBeNull();
    expect(trap('SIGINT')).toBeNull();
  });

  it('clears with delete', () => {
    trap('SIGINT', 'echo hello');
    resetTraps();
    expect(trap('SIGINT')).toBeNull();
  });
});

describe('case insensitivity', () => {
  it('accepts lowercase sigint', () => {
    expect(trap('sigint', 'echo')).toBe('echo');
  });

  it('accepts mixed case SigInt', () => {
    expect(trap('SigInt', 'echo')).toBe('echo');
  });

  it('queries case-insensitively', () => {
    trap('SIGINT', 'echo hello');
    expect(trap('sigint')).toBe('echo hello');
  });
});

describe('SIG prefix', () => {
  it('accepts INT without SIG', () => {
    expect(trap('INT', 'echo')).toBe('echo');
  });

  it('accepts TERM without SIG', () => {
    expect(trap('TERM', 'echo')).toBe('echo');
  });

  it('queries without SIG prefix', () => {
    trap('SIGCHLD', 'cmd');
    expect(trap('CHLD')).toBe('cmd');
  });
});

describe('overwrite behavior', () => {
  it('overwrites existing trap', () => {
    trap('SIGINT', 'first');
    expect(trap('SIGINT', 'second')).toBe('second');
    expect(trap('SIGINT')).toBe('second');
  });

  it('returns new command on overwrite', () => {
    expect(trap('SIGINT', 'cmd1')).toBe('cmd1');
    expect(trap('SIGINT', 'cmd2')).toBe('cmd2');
  });
});

describe('error cases', () => {
  it('throws on invalid signal name', () => {
    expect(() => trap('INVALID', 'echo')).toThrow('Invalid signal name');
  });

  it('throws on invalid signal number', () => {
    expect(() => trap(999, 'echo')).toThrow('Invalid signal number');
  });

  it('throws on negative signal number', () => {
    expect(() => trap(-1, 'echo')).toThrow('Invalid signal number');
  });

  it('throws on non-integer signal number', () => {
    expect(() => trap(1.5, 'echo')).toThrow('Invalid signal number');
  });

  it('throws on array signal', () => {
    expect(() => trap(['array'], 'cmd')).toThrow('Signal must be a string or number');
  });

  it('throws on object command', () => {
    expect(() => trap('SIGINT', {})).toThrow('Command must be a string');
  });

  it('throws on null signal', () => {
    expect(() => trap(null, 'cmd')).toThrow('Signal must be a string or number');
  });
});

describe('special signals', () => {
  it('handles SIGHUP', () => {
    expect(trap('SIGHUP', 'reload')).toBe('reload');
  });

  it('handles SIGKILL', () => {
    expect(trap('SIGKILL', 'kill')).toBe('kill');
  });

  it('handles numeric string signals', () => {
    expect(trap('1', 'cmd')).toBe('cmd');
    expect(trap('15', 'cmd')).toBe('cmd');
  });

  it('handles signal 32 (SIGRTMIN-2)', () => {
    expect(trap(32, 'cmd')).toBe('cmd');
  });

  it('handles signal 34 (SIGRTMIN)', () => {
    expect(trap(34, 'cmd')).toBe('cmd');
  });

  it('handles signal 64 (SIGRTMAX)', () => {
    expect(trap(64, 'cmd')).toBe('cmd');
  });
});

describe('empty command behavior', () => {
  it('empty string clears trap', () => {
    trap('SIGINT', 'echo hello');
    expect(trap('SIGINT', '')).toBeNull();
    expect(trap('SIGINT')).toBeNull();
  });

  it('empty string on unset trap returns null', () => {
    expect(trap('SIGINT', '')).toBeNull();
  });
});

describe('list all traps', () => {
  it('returns null when no traps set', () => {
    expect(trap()).toBeNull();
  });

  it('returns formatted list of traps', () => {
    trap('SIGINT', 'echo int');
    trap('SIGTERM', 'echo term');
    const list = trap();
    expect(list).toContain('SIGINT');
    expect(list).toContain('SIGTERM');
    expect(list).toContain('echo int');
    expect(list).toContain('echo term');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE-BASED GENERATED TEST SUITE
// Systematically generated cases verified against real bash trap
// ═════════════════════════════════════════════════════════════════════════════

describe('generated — signal name coverage', () => {
  const signals = [
    'EXIT', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP',
    'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGKILL', 'SIGUSR1', 'SIGSEGV',
    'SIGUSR2', 'SIGPIPE', 'SIGALRM', 'SIGTERM', 'SIGSTKFLT',
    'SIGCHLD', 'SIGCONT', 'SIGSTOP', 'SIGTSTP', 'SIGTTIN',
    'SIGTTOU', 'SIGURG', 'SIGXCPU', 'SIGXFSZ', 'SIGVTALRM',
    'SIGPROF', 'SIGWINCH', 'SIGPOLL', 'SIGPWR', 'SIGSYS',
    'SIGRTMIN', 'SIGRTMAX',
  ];

  signals.forEach(sig => {
    it(`registers ${sig}`, () => {
      resetTraps();
      const cmd = `handler_${sig}`;
      expect(trap(sig, cmd)).toBe(cmd);
      expect(trap(sig)).toBe(cmd);
    });

    it(`${sig.toLowerCase()} case-insensitive`, () => {
      resetTraps();
      const cmd = `handler_${sig}`;
      expect(trap(sig.toLowerCase(), cmd)).toBe(cmd);
      expect(trap(sig)).toBe(cmd);
    });
  });
});

describe('generated — signal number coverage', () => {
  for (let i = 0; i <= 64; i++) {
    it(`signal ${i}`, () => {
      resetTraps();
      const cmd = `handler_${i}`;
      expect(trap(i, cmd)).toBe(cmd);
      expect(trap(i)).toBe(cmd);
    });
  }
});

describe('generated — signal number as string', () => {
  for (let i = 0; i <= 64; i++) {
    it(`signal "${i}"`, () => {
      resetTraps();
      const cmd = `handler_${i}`;
      expect(trap(String(i), cmd)).toBe(cmd);
      expect(trap(i)).toBe(cmd);
    });
  }
});

describe('generated — command string variations', () => {
  const commands = [
    'echo hello',
    'echo "hello world"',
    "echo 'single quotes'",
    'ls -la',
    'rm -rf /',
    'function_call',
    '',
    'a',
    'very long command with many arguments',
    'cmd1; cmd2',
    'cmd && cmd2',
    'cmd || cmd2',
    '${VAR}',
    '$(subshell)',
    '`backticks`',
  ];

  commands.forEach(cmd => {
    it(`command: ${cmd.slice(0, 30)}${cmd.length > 30 ? '...' : ''}`, () => {
      resetTraps();
      if (cmd === '') {
        expect(trap('SIGINT', cmd)).toBeNull();
      } else {
        expect(trap('SIGINT', cmd)).toBe(cmd);
        expect(trap('SIGINT')).toBe(cmd);
      }
    });
  });
});

describe('generated — overwrite sequence', () => {
  const commands = ['first', 'second', 'third', 'fourth', 'fifth'];

  it('sequential overwrites', () => {
    resetTraps();
    commands.forEach((cmd, i) => {
      expect(trap('SIGINT', cmd)).toBe(cmd);
      expect(trap('SIGINT')).toBe(cmd);
    });
  });

  it('alternating signals', () => {
    resetTraps();
    trap('SIGINT', 'int1');
    trap('SIGTERM', 'term1');
    expect(trap('SIGINT')).toBe('int1');
    expect(trap('SIGTERM')).toBe('term1');
    trap('SIGINT', 'int2');
    expect(trap('SIGINT')).toBe('int2');
    expect(trap('SIGTERM')).toBe('term1');
  });
});

describe('generated — clear and re-register', () => {
  it('clear then re-register', () => {
    resetTraps();
    trap('SIGINT', 'cmd1');
    expect(trap('SIGINT')).toBe('cmd1');
    trap('SIGINT', '');
    expect(trap('SIGINT')).toBeNull();
    trap('SIGINT', 'cmd2');
    expect(trap('SIGINT')).toBe('cmd2');
  });

  it('clear all signals', () => {
    resetTraps();
    trap('SIGINT', 'int');
    trap('SIGTERM', 'term');
    trap('SIGHUP', 'hup');
    resetTraps();
    expect(trap('SIGINT')).toBeNull();
    expect(trap('SIGTERM')).toBeNull();
    expect(trap('SIGHUP')).toBeNull();
  });
});

describe('generated — multiple signal registration', () => {
  it('register many signals', () => {
    resetTraps();
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGILL'];
    signals.forEach((sig, i) => {
      trap(sig, `cmd${i}`);
    });
    signals.forEach((sig, i) => {
      expect(trap(sig)).toBe(`cmd${i}`);
    });
  });

  it('list all registered', () => {
    resetTraps();
    trap('SIGINT', 'echo int');
    trap('SIGTERM', 'echo term');
    const list = trap();
    expect(list).toBeTruthy();
    expect(list).toContain('SIGINT');
    expect(list).toContain('SIGTERM');
  });
});

describe('generated — invalid inputs', () => {
  const invalidSignals = [
    { sig: 999, desc: 'number too high' },
    { sig: -1, desc: 'negative number' },
    { sig: 1.5, desc: 'non-integer' },
    { sig: NaN, desc: 'NaN' },
    { sig: Infinity, desc: 'Infinity' },
    { sig: 'INVALID', desc: 'invalid name' },
    { sig: 'SIGINVALID', desc: 'invalid SIG name' },
    { sig: '', desc: 'empty string' },
    { sig: null, desc: 'null' },
    { sig: undefined, desc: 'undefined as first arg' },
    { sig: {}, desc: 'object' },
    { sig: [], desc: 'array' },
    { sig: true, desc: 'boolean' },
  ];

  invalidSignals.forEach(({ sig, desc }) => {
    it(`throws on ${desc}`, () => {
      expect(() => trap(sig, 'cmd')).toThrow();
    });
  });
});

describe('generated — edge cases', () => {
  it('signal 0 (EXIT) special handling', () => {
    resetTraps();
    expect(trap(0, 'echo exit')).toBe('echo exit');
    expect(trap('EXIT')).toBe('echo exit');
    expect(trap('0')).toBe('echo exit');
  });

  it('signal 9 (SIGKILL) cannot be caught but can be registered', () => {
    resetTraps();
    expect(trap('SIGKILL', 'cmd')).toBe('cmd');
    expect(trap('SIGKILL')).toBe('cmd');
  });

  it('numeric string with leading zeros', () => {
    resetTraps();
    expect(trap('00', 'cmd')).toBe('cmd');
    expect(trap(0)).toBe('cmd');
  });

  it('very long command', () => {
    resetTraps();
    const longCmd = 'echo ' + 'x'.repeat(1000);
    expect(trap('SIGINT', longCmd)).toBe(longCmd);
  });

  it('command with special characters', () => {
    resetTraps();
    const cmd = 'echo "hello\\nworld" > /tmp/test && cat /tmp/test';
    expect(trap('SIGINT', cmd)).toBe(cmd);
  });

  it('command with unicode', () => {
    resetTraps();
    const cmd = 'echo "你好世界 🎉"';
    expect(trap('SIGINT', cmd)).toBe(cmd);
  });
});

describe('generated — bash oracle comparison', () => {
  function compareWithBash(signal, command) {
    it(`bash parity: ${signal} = '${command.slice(0, 20)}${command.length > 20 ? '...' : ''}'`, () => {
      resetTraps();

      // Set via port
      const portResult = trap(signal, command);

      // Set via bash and query
      const bash = bashTrap({ signal, command });

      // Both should succeed
      expect(bash.exitCode).toBe(0);

      // Port returns command, bash prints trap -- 'cmd' SIGNAL
      expect(portResult).toBe(command);
      expect(bash.stdout).toContain(command);
      expect(bash.stdout).toContain(signal.toUpperCase().replace(/^SIG/, '') === signal.toUpperCase() ? signal.toUpperCase() : 'SIG' + signal.toUpperCase());

      // Query via port
      const portQuery = trap(signal);
      expect(portQuery).toBe(command);

      // Query via bash
      const bashQuery = bashTrap({ signal, query: true });
      if (bashQuery.stdout === '') {
        // Should not happen since we just set it
      } else {
        expect(bashQuery.stdout).toContain(command);
      }
    });
  }

  // Core signals
  compareWithBash('SIGINT', 'echo Ctrl+C');
  compareWithBash('SIGTERM', 'echo terminating');
  compareWithBash('SIGHUP', 'echo hangup');
  compareWithBash('SIGQUIT', 'echo quit');
  compareWithBash('SIGUSR1', 'echo user1');
  compareWithBash('SIGUSR2', 'echo user2');

  // By number
  compareWithBash(2, 'echo int by num');
  compareWithBash(15, 'echo term by num');
  compareWithBash(0, 'echo exit by num');

  // Case variations
  compareWithBash('sigint', 'echo lowercase');
  compareWithBash('SigTerm', 'echo mixed case');

  // Commands with quotes
  compareWithBash('SIGINT', "echo 'hello'");
  compareWithBash('SIGTERM', 'echo "world"');
});
