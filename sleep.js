/**
 * GNU-compliant sleep implementation
 * Signature: sleep(args, options)
 * @param {string[]} args - Duration strings (e.g., ["1.5s", "2m"])
 * @param {object} options - Optional: signal (AbortSignal), MAX_SLEEP_MS
 */
export async function sleep(args, options = {}) {
  const MAX_SLEEP_MS = options.MAX_SLEEP_MS ?? 3_600_000;
  let stdout = "";
  let stderr = "";
  let totalMs = 0;

  // 1. Argument Validation
  if (args.length === 0) {
    return { stdout, stderr: "sleep: missing operand\n", exitCode: 1 };
  }

  // 2. Parse and Sum Durations (GNU behavior)
  for (const arg of args) {
    const ms = parseDuration(arg);
    if (ms === null) {
      return {
        stdout,
        stderr: `sleep: invalid time interval '${arg}'\n`,
        exitCode: 1,
      };
    }
    totalMs += ms;
  }

  // 3. Cap Duration
  if (totalMs > MAX_SLEEP_MS) totalMs = MAX_SLEEP_MS;
  if (totalMs <= 0) return { stdout, stderr, exitCode: 0 };

  // 4. Execution with AbortSignal support
  try {
    await wait(totalMs, options.signal);
  } catch (err) {
    // If aborted, we return early (standard for shell interruptions)
    return { stdout, stderr, exitCode: 0 };
  }

  return { stdout, stderr, exitCode: 0 };
}

/**
 * Parses duration per GNU specs (floats + suffixes)
 */
function parseDuration(arg) {
  // Regex allows floats and suffixes s, m, h, d
  const match = /^([\d.]+)([smhd]?)$/.exec(arg.trim());
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;

  const unit = match[2] || "s";
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 3600 * 1000,
    d: 24 * 3600 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Promisified setTimeout with AbortSignal integration
 */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return resolve();

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(); 
    }, { once: true });
  });
}

// --- Usage Example ---
(async () => {
  console.log("Starting sleep...");
  
  // Example 1: Standard seconds
  const res1 = await sleep(["1.5"]); 
  console.log("Woke up after 1.5s");

  // Example 2: Multiple GNU-style arguments (0.5s + 1s = 1.5s)
  const res2 = await sleep(["0.5s", "1s"]);
  console.log("Woke up after sum of durations");

  // Example 3: Error handling
  const res3 = await sleep(["invalid"]);
  if (res3.exitCode !== 0) {
    console.error(res3.stderr);
  }

  // Example 4: AbortSignal (Simulating Ctrl+C)
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const res4 = await sleep(["10s"], { signal: controller.signal });
  console.log("Sleep interrupted early via signal");
})();
