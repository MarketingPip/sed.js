 
// Browser polyfill for Node.js spawn
// Simulates child_process.spawn for testing timeoutCommand

export function spawn(command, args = [], options = {}) {
    // Simulate a process using a Promise
    // This polyfill only works for "fake" commands in the browser for testing
    let pid = Math.floor(Math.random() * 10000); // fake PID

    let killed = false;
    const listeners = { exit: [], error: [] };

    const child = {
        pid,
        killed,
        stdio: {
            // mimic Node.js stdio (dummy)
            write: (...args) => console.log(...args)
        },
        on(event, cb) {
            if (listeners[event]) listeners[event].push(cb);
        },
        kill(signal) {
            if (!killed) {
                killed = true;
                if (listeners.exit) {
                    // Map signals to exit code like Node.js
                    const code = signal === 'SIGKILL' ? null : 0;
                    const sig = signal || 'SIGTERM';
                    listeners.exit.forEach(fn => fn(code, sig));
                }
            }
        },
        _simulateExit(exitCode = 0, sig = null) {
            listeners.exit.forEach(fn => fn(exitCode, sig));
        }
    };

    // simulate command execution with random duration
    const duration = Math.random() * 2000 + 500; // 0.5s to 2.5s
    setTimeout(() => {
        if (!killed) child._simulateExit(0, null);
    }, duration);

    // simulate error for unknown command
    if (command === 'fail') {
        setTimeout(() => {
            listeners.error.forEach(fn => fn({ code: 'ENOENT' }));
        }, 100);
    }

    return child;
}

// Node.js port of GNU timeout
// Supports: timeout duration, kill-after, preserve-status, signal, verbose

 

const EXIT_TIMEDOUT = 124;
const EXIT_CANCELED = 125;
const EXIT_CANNOT_INVOKE = 126;
const EXIT_ENOENT = 127;

function parseDuration(str) {
    const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(str);
    if (!match) throw new Error(`invalid time interval ${str}`);
    let [_, value, suffix] = match;
    value = parseFloat(value);
    switch (suffix) {
        case 'm': value *= 60; break;
        case 'h': value *= 3600; break;
        case 'd': value *= 86400; break;
    }
    return value * 1000; // milliseconds
}

export function timeoutCommand({
    command,
    args = [],
    duration = 0,
    killAfter = 0,
    signal = 'SIGTERM',
    preserveStatus = false,
    verbose = false
}) {
    return new Promise((resolve) => {
        let timedOut = false;

        const child = spawn(command, args, {
            stdio: 'inherit',
            detached: true
        });

        let killTimer;
        let timeoutTimer;

        const cleanup = (exitCode) => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            if (killTimer) clearTimeout(killTimer);
            resolve(exitCode);
        };

        if (duration > 0) {
            timeoutTimer = setTimeout(() => {
                timedOut = true;
                if (verbose) console.error(`Sending signal ${signal} to ${command}`);
                try { process.kill(-child.pid, signal); } catch {}
                
                if (killAfter > 0) {
                    killTimer = setTimeout(() => {
                        if (verbose) console.error(`Sending SIGKILL to ${command}`);
                        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
                    }, killAfter);
                }
            }, duration);
        }

        child.on('exit', (code, sig) => {
            if (timedOut && !preserveStatus) {
                cleanup(EXIT_TIMEDOUT);
            } else if (code !== null) {
                cleanup(code);
            } else if (sig !== null) {
                cleanup(128 + (sig === 'SIGKILL' ? 9 : 0)); // Map signals
            } else {
                cleanup(EXIT_CANCELED);
            }
        });

        child.on('error', (err) => {
            if (err.code === 'ENOENT') cleanup(EXIT_ENOENT);
            else cleanup(EXIT_CANNOT_INVOKE);
        });
    });
}

// Example usage:
// timeoutCommand({
//   command: 'sleep',
//   args: ['10'],
//   duration: 3000,
//   killAfter: 2000,
//   verbose: true
// }).then(code => console.log('Exit code:', code));

timeoutCommand({
    command: 'sleep', // or 'fail' to simulate ENOENT
    args: ['2'],
    duration: 1000,
    killAfter: 500,
    verbose: true,
}).then(code => console.log('Exit code:', code));
