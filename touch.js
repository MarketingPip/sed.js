import memfs from "https://esm.sh/memfs";
const  { vol } = memfs;

const fs = vol.promises;

 
/**
 * POSIX-compliant touch implementation
 * Signature: touch(args, fs, cwd)
 * @param {string[]} args - Arguments (e.g., ["-c", "-d", "2023-01-01", "file.txt"])
 * @param {object} fs - The file system object (promises API)
 * @param {string} cwd - Current working directory
 */
export async function touch(args, fs, cwd = "/") {
  let stderr = "";
  let exitCode = 0;

  // 1. Parse Flags and Operands
  const flags = {
    noCreate: false, // -c
    dateStr: null,   // -d
  };

  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      operands.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("-") && arg.length > 1) {
      if (arg.includes("c")) flags.noCreate = true;
      if (arg.includes("d")) {
        // Handle both -d <date> and -d<date>
        flags.dateStr = arg.length > 2 ? arg.slice(2) : args[++i];
      }
    } else {
      operands.push(arg);
    }
  }

  if (operands.length === 0) {
    return { stdout: "", stderr: "touch: missing file operand\n", exitCode: 1 };
  }

  // 2. Determine Timestamp
  const targetTime = flags.dateStr ? parseDateString(flags.dateStr) : new Date();
  if (flags.dateStr && !targetTime) {
    return { stdout: "", stderr: `touch: invalid date format '${flags.dateStr}'\n`, exitCode: 1 };
  }

  // 3. Process Files
  for (const path of operands) {
    const fullPath = resolvePath(cwd, path);
    try {
      let exists = true;
      try {
        await fs.stat(fullPath);
      } catch {
        exists = false;
      }

      if (!exists) {
        if (flags.noCreate) continue;
        await fs.writeFile(fullPath, "");
      }

      // Update access and modification times
      await fs.utimes(fullPath, targetTime, targetTime);
    } catch (error) {
      stderr += `touch: cannot touch '${path}': ${error.message}\n`;
      exitCode = 1;
    }
  }

  return { stdout: "", stderr, exitCode };
}

/**
 * Robust Date Parser for touch -d
 */
function parseDateString(dateStr) {
  const normalized = dateStr.replace(/\//g, "-");
  const date = new Date(normalized);
  
  if (!isNaN(date.getTime())) return date;

  // Manual fallback for YYYY-MM-DD
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (match) {
    const [_, y, m, d, hh = 0, mm = 0, ss = 0] = match;
    const dObj = new Date(y, m - 1, d, hh, mm, ss);
    if (!isNaN(dObj.getTime())) return dObj;
  }
  return null;
}

function resolvePath(cwd, path) {
  if (path.startsWith("/")) return path;
  return cwd.endsWith("/") ? `${cwd}${path}` : `${cwd}/${path}`;
}

(async () => {
  // Scenario 1: Create a new file
  console.log("--- Scenario 1: Create new file ---");
  const res1 = await touch(["new_file.txt"], fs, "/");
  
  await fs.access("/new_file.txt")
 
  // Scenario 2: Set back-dated timestamp
  console.log("\n--- Scenario 2: Back-date a file ---");
  // Equivalent to: touch -d "2020-01-01" old_log.txt
  await touch(["-d", "2020-01-01", "/old_log.txt"], fs, "/");
  const stats = await fs.stat("/old_log.txt");
  console.log("Mtime:", stats.mtime.getFullYear()); // 2020

  // Scenario 3: No-create flag on missing file
  console.log("\n--- Scenario 3: No-create on missing file ---");
  const res3 = await touch(["-c", "ghost.txt"], fs, "/");
  try{
  const ghostExists = await fs.access("/ghost.txt");
  }catch(err){
       console.log("ERROR:", err.message);// will not exist.
  }finally{
  console.log("Exit Code:", res3.exitCode);  // 0
  }
  // Scenario 4: Error handling (Invalid Date)
  console.log("\n--- Scenario 4: Invalid Date ---");
  const res4 = await touch(["-d", "not-a-date", "file.txt"], fs, "/");
  console.log("Stderr:", res4.stderr);
})();
