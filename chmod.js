import memfs from "https://esm.sh/memfs";
const  { vol } = memfs;

const fs = vol.promises;
/**
 * GNU POSIX-compliant chmod implementation
 * Signature: chmod(args, fs)
 * @param {string[]} args - Arguments (e.g., ["-R", "755", "/dir"])
 * @param {object} fs - The file system object (promises API)
 */
export async function chmod(args, fs) {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  // 1. Parse Flags and Operands
  const flags = {
    recursive: false, // -R
    verbose: false,   // -v
    force: false      // -f
  };

  const operands = [];
  for (const arg of args) {
    if (arg.startsWith("-") && arg.length > 1 && !/^-?\d+$/.test(arg)) {
      if (arg.includes("R")) flags.recursive = true;
      if (arg.includes("v")) flags.verbose = true;
      if (arg.includes("f")) flags.force = true;
    } else {
      operands.push(arg);
    }
  }

  if (operands.length < 2) {
    return { stdout, stderr: "chmod: missing operand\n", exitCode: 1 };
  }

  const modeArg = operands.shift();
  const paths = operands;

  // 2. Process Paths
  for (const path of paths) {
    try {
      await processPath(path, modeArg, fs, flags, (msg) => { stdout += msg; });
    } catch (error) {
      if (!flags.force) {
        stderr += `chmod: cannot access '${path}': ${error.message}\n`;
        exitCode = 1;
      }
    }
  }

  return { stdout, stderr, exitCode };
}

/**
 * Handles recursive traversal and permission application
 */
async function processPath(path, modeStr, fs, flags, log) {
  const stats = await fs.stat(path);
  const oldMode = stats.mode & 0o7777;
  const newMode = parseMode(modeStr, oldMode);

  if (oldMode !== newMode) {
    await fs.chmod(path, newMode);
    if (flags.verbose) {
      log(`mode of '${path}' changed from ${oldMode.toString(8)} to ${newMode.toString(8)}\n`);
    }
  }

  if (flags.recursive && stats.isDirectory()) {
    const entries = await fs.readdir(path);
    for (const entry of entries) {
      const fullPath = path.endsWith("/") ? `${path}${entry}` : `${path}/${entry}`;
      await processPath(fullPath, modeStr, fs, flags, log);
    }
  }
}

/**
 * GNU/POSIX Symbolic Mode Parser
 */
function parseMode(modeStr, currentMode) {
  if (/^[0-7]+$/.test(modeStr)) {
    return parseInt(modeStr, 8);
  }

  let mode = currentMode;
  const clauses = modeStr.split(",");

  for (const clause of clauses) {
    const match = clause.match(/^([ugoa]*)([+\-=])([rwxXstug]*)$/);
    if (!match) throw new Error(`invalid mode: ${modeStr}`);

    let who = match[1] || "a";
    const op = match[2];
    const perms = match[3];

    if (who === "a") who = "ugo";

    // Build permission bitmask
    let mask = 0;
    if (perms.includes("r")) mask |= 0o444;
    if (perms.includes("w")) mask |= 0o222;
    if (perms.includes("x")) mask |= 0o111;
    if (perms.includes("X") && ((mode & 0o111) || (mode & 0o40000))) mask |= 0o111; // Conditional execute

    // Apply "who" filtering to the mask
    let whoMask = 0;
    if (who.includes("u")) whoMask |= 0o700;
    if (who.includes("g")) whoMask |= 0o070;
    if (who.includes("o")) whoMask |= 0o007;
    
    const applyBits = mask & whoMask;

    if (op === "+") {
      mode |= applyBits;
    } else if (op === "-") {
      mode &= ~applyBits;
    } else if (op === "=") {
      mode = (mode & ~whoMask) | applyBits;
    }
  }
  return mode & 0o7777;
}

 

(async () => {
  await fs.mkdir("/scripts", { recursive: true });
  await fs.writeFile("/scripts/run.sh", "#!/bin/sh");
  
  console.log("--- Scenario 1: Numeric Mode ---");
  const res1 = await chmod(["755", "/scripts/run.sh"], fs);
  console.log("Exit Code:", res1.exitCode);

  console.log("\n--- Scenario 2: Symbolic Recursive (Verbose) ---");
  // Equivalent to: chmod -Rv g+w /scripts
  const res2 = await chmod(["-Rv", "g+w", "/scripts"], fs);
  console.log(res2.stdout);

  console.log("\n--- Scenario 3: Force flag on non-existent file ---");
  const res3 = await chmod(["-f", "644", "/ghost.txt"], fs);
  console.log("Exit Code with -f:", res3.exitCode); // Should be 0
})();
