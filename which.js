import memfs from "https://esm.sh/memfs";
const  { vol } = memfs;

const fs = vol.promises;

/**
 * GNU-style which implementation
 * Signature: which(args, fs, env)
 * @param {string[]} args - Command line arguments (e.g., ["-a", "ls", "node"])
 * @param {object} fs - The file system object (promises API)
 * @param {object} env - Environment variables object containing PATH
 */
export async function which(args, fs, env = {}) {
  let stdout = "";
  let stderr = "";
  
  // 1. Parse Flags and Operands
  let showAll = false; // -a
  const names = [];

  for (const arg of args) {
    if (arg === "-a") {
      showAll = true;
    } else if (arg.startsWith("-") && arg.length > 1) {
      // Handle combined flags if necessary, though which usually only has -a
      if (arg.includes("a")) showAll = true;
    } else {
      names.push(arg);
    }
  }

  if (names.length === 0) {
    return { stdout, stderr, exitCode: 1 };
  }

  // 2. Resolve PATH
  const pathEnv = env["PATH"] || "/usr/bin:/bin";
  const pathDirs = pathEnv.split(":").filter(Boolean);

  let allFound = true;

  // 3. Search Logic
  for (const name of names) {
    let foundThisName = false;

    // POSIX behavior: If name contains a '/', check it directly (don't search PATH)
    if (name.includes("/")) {
      try {
        const stats = await fs.stat(name);
        if (stats.isFile()) {
          stdout += `${name}\n`;
          foundThisName = true;
        }
      } catch {
        // Not found
      }
    } else {
      // Search through PATH directories
      for (const dir of pathDirs) {
        const fullPath = `${dir.replace(/\/$/, "")}/${name}`;
        try {
          const stats = await fs.stat(fullPath);
          if (stats.isFile()) {
            stdout += `${fullPath}\n`;
            foundThisName = true;
            if (!showAll) break; // Stop at first match unless -a is set
          }
        } catch {
          continue;
        }
      }
    }

    if (!foundThisName) {
      allFound = false;
    }
  }

  return {
    stdout,
    stderr,
    exitCode: allFound ? 0 : 1
  };
}

 

(async () => {
  // Setup mock environment
  await fs.mkdir("/bin", { recursive: true });
  await fs.mkdir("/usr/local/bin", { recursive: true });
  
  await fs.writeFile("/bin/ls", "executable content");
  await fs.writeFile("/usr/local/bin/ls", "newer ls content");
  await fs.writeFile("/bin/grep", "grep content");

  const env = { PATH: "/usr/local/bin:/bin" };

  console.log("--- Scenario 1: Standard Search ---");
  const res1 = await which(["ls"], fs, env);
  console.log("Found:", res1.stdout.trim()); // Should show /usr/local/bin/ls

  console.log("\n--- Scenario 2: Show All (-a) ---");
  const res2 = await which(["-a", "ls"], fs, env);
  console.log("All matches:\n" + res2.stdout.trim()); 
  /* 
     /usr/local/bin/ls
     /bin/ls
  */

  console.log("\n--- Scenario 3: Multiple Commands ---");
  const res3 = await which(["ls", "grep"], fs, env);
  console.log("Matches:\n" + res3.stdout.trim());

  console.log("\n--- Scenario 4: Command Not Found ---");
  const res4 = await which(["nonexistent"], fs, env);
  console.log("Exit Code:", res4.exitCode); // Should be 1
})();
