import memfs from "https://esm.sh/memfs";
const  { vol } = memfs;

/**
 * GNU POSIX-compliant mv implementation for memfs/Node fs
 * Signature: mv(args, fs)
 * @param {string[]} args - Command line arguments (e.g., ["-v", "src", "dest"])
 * @param {object} fs - The file system object (promises API)
 */
export async function mv(args, fs) {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  // 1. Parse Flags and Operands
  const flags = {
    force: false,      // -f
    noClobber: false,  // -n
    verbose: false,    // -v
  };

  const operands = [];
  for (const arg of args) {
    if (arg.startsWith("-") && arg.length > 1) {
      if (arg.includes("f")) { flags.force = true; flags.noClobber = false; }
      if (arg.includes("n")) { flags.noClobber = true; flags.force = false; }
      if (arg.includes("v")) flags.verbose = true;
    } else {
      operands.push(arg);
    }
  }

  // 2. Validate Operands
  if (operands.length < 2) {
    const error = operands.length === 0 
      ? "mv: missing file operand\n" 
      : `mv: missing destination file operand after '${operands[0]}'\n`;
    return { stdout, stderr: error, exitCode: 1 };
  }

  const destPath = operands.pop();
  const sources = operands;

  // 3. Analyze Destination
  let destIsDir = false;
  try {
    const stats = await fs.stat(destPath);
    destIsDir = stats.isDirectory();
  } catch (e) {
    // Destination doesn't exist yet; that's fine unless we have multiple sources
    if (sources.length > 1) {
      return { 
        stdout, 
        stderr: `mv: target '${destPath}' is not a directory\n`, 
        exitCode: 1 
      };
    }
  }

  // 4. Process Sources
  for (const src of sources) {
    try {
      const srcBase = src.split('/').filter(Boolean).pop() || src;
      const finalDest = destIsDir 
        ? `${destPath.replace(/\/$/, "")}/${srcBase}` 
        : destPath;

      // Logic for -n (no-clobber)
      if (flags.noClobber) {
        try {
          await fs.stat(finalDest);
          continue; // Silently skip if destination exists
        } catch {}
      }

      // POSIX Requirement: Rename is the primary move mechanism
      await fs.rename(src, finalDest);

      if (flags.verbose) {
        stdout += `renamed '${src}' -> '${finalDest}'\n`;
      }
    } catch (error) {
      stderr += `mv: cannot move '${src}' to '${destPath}': ${error.message}\n`;
      exitCode = 1;
    }
  }

  return { stdout, stderr, exitCode };
}

// --- Usage Example ---
const fs = vol.promises;

(async () => {
  await fs.mkdir("/data", { recursive: true });
  await fs.writeFile("/test.txt", "content");

  // Usage: mv([flags, sources, dest], fs)
  const result = await mv(["-v", "/test.txt", "/data"], fs);
  console.log("Exit Code:", result.exitCode);
  console.log("STDOUT:", result.stdout);
  console.log("STDERR:", result.stderr);
  console.log(vol)
})();
