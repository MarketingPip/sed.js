import memfs from "https://esm.sh/memfs";
const  { vol } = memfs;

const fs = vol.promises;

/**
 * GNU POSIX-compliant rm implementation
 * Signature: rm(args, fs)
 * @param {string[]} args - Command line arguments (e.g., ["-rf", "dir1"])
 * @param {object} fs - The file system object (promises API)
 */
export async function rm(args, fs) {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  // 1. Parse Flags and Operands
  const flags = {
    recursive: false, // -r, -R
    force: false,     // -f
    verbose: false,   // -v
  };

  const operands = [];
  for (const arg of args) {
    if (arg.startsWith("-") && arg.length > 1) {
      if (arg.includes("r") || arg.includes("R")) flags.recursive = true;
      if (arg.includes("f")) flags.force = true;
      if (arg.includes("v")) flags.verbose = true;
    } else {
      operands.push(arg);
    }
  }

  // 2. Initial Validation
  if (operands.length === 0) {
    // POSIX: rm -f with no operands is not an error
    if (flags.force) return { stdout, stderr, exitCode: 0 };
    return { stdout, stderr: "rm: missing operand\n", exitCode: 1 };
  }

  // 3. Process Operands
  for (const path of operands) {
    try {
      // Check existence and type
      const stats = await fs.stat(path);

      if (stats.isDirectory() && !flags.recursive) {
        stderr += `rm: cannot remove '${path}': Is a directory\n`;
        exitCode = 1;
        continue;
      }

      // Use the underlying fs.rm for actual deletion
      await fs.rm(path, { 
        recursive: flags.recursive, 
        force: flags.force 
      });

      if (flags.verbose) {
        stdout += `removed '${path}'\n`;
      }
    } catch (error) {
      // Logic for -f: ignore non-existent files/directories
      const isNotFound = error.code === 'ENOENT' || error.message.toLowerCase().includes("no such");
      
      if (flags.force && isNotFound) {
        continue; 
      }

      // Otherwise, report the error
      stderr += `rm: cannot remove '${path}': ${error.message}\n`;
      exitCode = 1;
    }
  }

  return { stdout, stderr, exitCode };
}

// --- Usage Example ---
(async () => {
  // Setup environment
  await fs.mkdir("/temp_dir", { recursive: true });
  await fs.writeFile("/temp_dir/notes.txt", "delete me");
  await fs.writeFile("/config.log", "some logs");

  console.log("--- Scenario 1: Removing a file (Verbose) ---");
  const res1 = await rm(["-v", "/config.log"], fs);
  console.log(res1.stdout || "No stdout");

  console.log("--- Scenario 2: Error when removing directory without -r ---");
  const res2 = await rm(["/temp_dir"], fs);
  console.log("Error:", res2.stderr);

  console.log("--- Scenario 3: Recursive remove ---");
  const res3 = await rm(["-rv", "/temp_dir"], fs);
  console.log(res3.stdout);

  console.log("--- Scenario 4: Force remove (no error for non-existent file) ---");
  const res4 = await rm(["-f", "/already_gone.txt"], fs);
  console.log("Exit Code (should be 0):", res4.exitCode);
})();
