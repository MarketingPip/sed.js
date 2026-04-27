// 1. Move handlers OUTSIDE so it persists across calls
/*
function trap(signal, command) {
  if (signal === undefined || signal === null) {
    throw new Error('Signal must be a string or number');
  }
  
  let signalName;
  let signalNum;
  
  const nameToNum = {
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
    'IO': 29, 'SIGIO': 29, '29': 29,
    'PWR': 30, 'SIGPWR': 30, '30': 30,
    'SYS': 31, 'SIGSYS': 31, '31': 31,
  };
  
  const handlers = new Map();
  
  if (typeof signal === 'string') {
    signalName = signal.toUpperCase();
    if (nameToNum[signalName] === undefined) {
      throw new Error('Invalid signal name');
    }
    signalNum = nameToNum[signalName];
  } else if (typeof signal === 'number') {
    if (signal < 0 || !Number.isInteger(signal)) {
      throw new Error('Invalid signal number');
    }
    signalNum = signal;
  } else {
    throw new Error('Signal must be a string or number');
  }
  
  if (command === undefined) {
    return null;
  }
  
  if (command === '') {
    handlers.set(signalNum, null);
    return null;
  }
  
  if (typeof command !== 'string') {
    throw new Error('Command must be a string');
  }
  
  const existing = handlers.get(signalNum);
  if (existing !== undefined) {
    return existing;
  }
  
  handlers.set(signalNum, command);
  return command;
}
*/ 
const handlers = new Map();

function trap(signal, command) {
  if (signal === undefined || signal === null) {
    throw new Error('Signal must be a string or number');
  }
  
  let signalNum;
  
  const nameToNum = {
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
    'IO': 29, 'SIGIO': 29, '29': 29,
    'PWR': 30, 'SIGPWR': 30, '30': 30,
    'SYS': 31, 'SIGSYS': 31, '31': 31,
  };
  
  if (typeof signal === 'string') {
    const signalName = signal.toUpperCase();
    if (nameToNum[signalName] === undefined) {
      throw new Error('Invalid signal name');
    }
    signalNum = nameToNum[signalName];
  } else if (typeof signal === 'number') {
    // 2. Fix: Check if the number actually exists in our supported list
    if (!Object.values(nameToNum).includes(signal)) {
      throw new Error('Invalid signal number');
    }
    signalNum = signal;
  } else {
    throw new Error('Signal must be a string or number');
  }
  
  if (command === undefined) {
    return handlers.get(signalNum) || null;
  }
  
  if (command === '') {
    handlers.delete(signalNum);
    return null;
  }
  
  if (typeof command !== 'string') {
    throw new Error('Command must be a string');
  }
  
  // 3. Now this logic works because 'handlers' is persistent!
  const existing = handlers.get(signalNum);
  if (existing !== undefined) {
    return existing; 
  }
  
  handlers.set(signalNum, command);
  return command;
}

/*
console.log(trap('SIGINT', 'echo Ctrl+C pressed'));
// → "echo Ctrl+C pressed"

console.log(trap(15, 'echo terminating'));
// → "echo terminating"

const r1 = trap('SIGINT', 'cmd1');
const r2 = trap('SIGINT', 'cmd2');

console.log(r1); // "cmd1"
console.log(r2); // "cmd1"  ← second one ignored

function trigger(signalNum) {
  const cmd = handlers.get(signalNum);
  if (cmd) {
    console.log(`Running: ${cmd}`);
  } else {
    console.log('No handler');
  }
}

trigger(2);  // Running: echo Ctrl+C pressed
trigger(15); // Running: echo terminating

*/



test('trap registers SIGINT handler', () => {
  expect(trap('SIGINT', 'echo hit')).toBeTruthy();
});

test('trap registers SIGTERM handler', () => {
  expect(trap('SIGTERM', 'echo term')).toBeTruthy();
});

test('trap registers handler by signal number 2', () => {
  expect(trap(2, 'echo int')).toBeTruthy();
});

test('trap registers handler by signal number 15', () => {
  expect(trap(15, 'echo term')).toBeTruthy();
});

test('trap throws on invalid signal number', () => {
  expect(() => trap(999, 'echo')).toThrow();
});

test('trap throws on invalid signal name', () => {
  expect(() => trap('SIGNALXX', 'echo')).toThrow();
});

test('trap resets handler on exit signal 0', () => {
  expect(trap(0, 'echo exit')).toBeTruthy();
});

test('trap clears trap when command is empty string', () => {
  const result = trap('SIGINT', '');
  expect(result).toBeNull();
});

test('trap is case insensitive for signal names', () => {
  expect(trap('sigint', 'echo')).toBeTruthy();
  expect(trap('SigInt', 'echo')).toBeTruthy();
});

test('trap ignores multiple registrations for same signal', () => {
  const r1 = trap('SIGINT', 'cmd1');
  const r2 = trap('SIGINT', 'cmd2');
  expect(r2).toBe(r1);
});

test('trap returns undefined for no command provided', () => {
  expect(trap('SIGINT', undefined)).toBeNull();
});

test('trap handles signal name with prefix sig', () => {
  expect(trap('SIGCHLD', 'cmd')).toBeTruthy();
});

test('trap throws on non-string non-number signal', () => {
  expect(() => trap(['array'], 'cmd')).toThrow();
});

test('trap throws on object command', () => {
  expect(() => trap('SIGINT', {})).toThrow();
});

test('trap handles special signal SIGHUP', () => {
  expect(trap('SIGHUP', 'reload')).toBeTruthy();
});

test('trap handles special signal SIGKILL', () => {
  expect(trap('SIGKILL', 'kill')).toBeTruthy();
});

test('trap validates numeric signal range', () => {
  expect(() => trap(-1, 'cmd')).toThrow();
});

test('trap validates positive numeric signal', () => {
  expect(trap(1, 'cmd')).toBeTruthy();
});

test('trap preserves original command for list', () => {
  expect(trap('SIGINT', 'ls')).toBeTruthy();
});

test('trap handles signal number above 31', () => {
  expect(trap(32, 'cmd')).toBeTruthy();
});
