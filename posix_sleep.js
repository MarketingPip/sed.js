/**
 * POSIX-compliant sleep implementation
 * Spec: https://pubs.opengroup.org/onlinepubs/9699919799/utilities/sleep.html
 * 
 * @param {string[]} args - Exactly one non-negative integer string (e.g., ["5"])
 * @param {object} options - Optional: signal (AbortSignal)
 */
export async function sleep(args, options = {}) {
  let stdout = "";
  let stderr = "";

  // 1. POSIX Argument Count Validation
  if (args.length === 0) {
    return { stdout, stderr: "sleep: missing operand\n", exitCode: 1 };
  }
  if (args.length > 1) {
    return { stdout, stderr: `sleep: extra operand '${args[1]}'\n`, exitCode: 1 };
  }

  const arg = args[0];

  // 2. POSIX Operand Format Validation
  // POSIX strictly requires a non-negative decimal integer.
  // No decimal points, negative signs, or unit suffixes.
  if (!/^\d+$/.test(arg)) {
    return {
      stdout,
      stderr: `sleep: invalid time interval '${arg}'\n`,
      exitCode: 1,
    };
  }

  const seconds = parseInt(arg, 10);
  if (isNaN(seconds)) {
    return {
      stdout,
      stderr: `sleep: invalid time interval '${arg}'\n`,
      exitCode: 1,
    };
  }

  const totalMs = seconds * 1000;
  if (totalMs === 0) {
    return { stdout, stderr, exitCode: 0 };
  }

  // 3. Execution with AbortSignal support
  try {
    await wait(totalMs, options.signal);
  } catch (err) {
    // Standard shell early exit on interruption
    return { stdout, stderr, exitCode: 0 };
  }

  return { stdout, stderr, exitCode: 0 };
}

/**
 * JS setTimeout supports a maximum delay of 2,147,483,647 ms (approx 24.8 days).
 * Because POSIX requires supporting sleep durations up to 2,147,483,647 seconds,
 * we chunk extreme durations into multiple smaller sleep cycles to prevent integer overflow.
 */
const MAX_TIMEOUT_MS = 2147483647;

async function wait(ms, signal) {
  let remaining = ms;
  
  while (remaining > 0) {
    if (signal?.aborted) return;
    
    const chunk = Math.min(remaining, MAX_TIMEOUT_MS);
    
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, chunk);
      
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    
    remaining -= chunk;
  }
}
