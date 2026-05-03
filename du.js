import memfs from "https://esm.sh/memfs";
const  { vol } = memfs;

const fs = vol.promises;
/**
 * POSIX-compliant Disk Usage (du) implementation
 * Signature: du(args, fs, cwd)
 * @param {string[]} args - Arguments (e.g., ["-sh", "/home"])
 * @param {object} fs - The file system object (promises API)
 * @param {string} cwd - Current working directory
 */
export async function du(args, fs, cwd = "/") {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  // 1. Parse Flags and Operands
  const flags = {
    allFiles: false,      // -a
    humanReadable: false, // -h
    summarize: false,     // -s
    grandTotal: false,    // -c
    maxDepth: null        // -d (non-POSIX but common)
  };

  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-") && arg.length > 1) {
      if (arg.includes("a")) flags.allFiles = true;
      if (arg.includes("h")) flags.humanReadable = true;
      if (arg.includes("s")) flags.summarize = true;
      if (arg.includes("c")) flags.grandTotal = true;
      if (arg.includes("d")) {
        flags.maxDepth = parseInt(args[++i], 10);
      }
    } else {
      operands.push(arg);
    }
  }

  const targets = operands.length > 0 ? operands : ["."];
  let grandTotalSize = 0;

  // 2. Process Targets
  for (const target of targets) {
    const fullPath = resolvePath(cwd, target);
    try {
      const result = await calculateSize(fullPath, target, fs, flags, 0);
      stdout += result.output;
      grandTotalSize += result.totalSize;
      if (result.error) {
        stderr += result.error;
        exitCode = 1;
      }
    } catch (err) {
      stderr += `du: cannot access '${target}': No such file or directory\n`;
      exitCode = 1;
    }
  }

  if (flags.grandTotal) {
    stdout += `${formatSize(grandTotalSize, flags.humanReadable)}\ttotal\n`;
  }

  return { stdout, stderr, exitCode };
}

/**
 * Recursive size calculation
 */
async function calculateSize(fullPath, displayPath, fs, flags, depth) {
  let totalSize = 0;
  let output = "";
  let error = "";

  const stats = await fs.stat(fullPath);
  
  if (!stats.isDirectory()) {
    totalSize = stats.size;
    if (flags.allFiles || depth === 0) {
      output = `${formatSize(totalSize, flags.humanReadable)}\t${displayPath}\n`;
    }
    return { totalSize, output, error };
  }

  // Handle Directory
  try {
    const entries = await fs.readdir(fullPath);
    let dirContentsSize = 0;

    for (const entry of entries) {
      const childFullPath = fullPath.endsWith("/") ? `${fullPath}${entry}` : `${fullPath}/${entry}`;
      const childDisplayPath = displayPath === "." ? entry : `${displayPath}/${entry}`;
      
      const res = await calculateSize(childFullPath, childDisplayPath, fs, flags, depth + 1);
      dirContentsSize += res.totalSize;
      
      // Print sub-items if not summarizing and depth allows
      if (!flags.summarize && (flags.maxDepth === null || depth < flags.maxDepth)) {
        output += res.output;
      }
    }

    totalSize = dirContentsSize + stats.size; // Include directory's own size
  } catch (err) {
    error = `du: cannot read directory '${displayPath}': Permission denied\n`;
    totalSize = stats.size;
  }

  // Print the directory itself
  if (flags.summarize || flags.maxDepth === null || depth <= flags.maxDepth) {
    output += `${formatSize(totalSize, flags.humanReadable)}\t${displayPath}\n`;
  }

  return { totalSize, output, error };
}

/**
 * Helpers
 */
function formatSize(bytes, human) {
  if (!human) return Math.ceil(bytes / 1024).toString(); // POSIX default is 512b or 1k blocks
  if (bytes < 1024) return `${bytes}B`;
  const units = ['K', 'M', 'G', 'T'];
  let u = -1;
  do {
    bytes /= 1024;
    u++;
  } while (bytes >= 1024 && u < units.length - 1);
  return bytes.toFixed(1) + units[u];
}

function resolvePath(cwd, path) {
  if (path.startsWith("/")) return path;
  if (cwd === "/") return `/${path}`;
  return `${cwd}/${path}`;
}

 

(async () => {
  // Setup: Create a dummy file structure
  // /projects/web/index.html (1024 bytes)
  // /projects/web/style.css  (2048 bytes)
  // /projects/notes.txt      (512 bytes)
  
  await fs.mkdir("/projects/web", { recursive: true });
  await fs.writeFile("/projects/web/index.html", "a".repeat(1024));
  await fs.writeFile("/projects/web/style.css", "a".repeat(2048));
  await fs.writeFile("/projects/notes.txt", "a".repeat(512));

  console.log("--- Scenario 1: Basic Usage (Current Dir) ---");
  const res1 = await du(["/projects"], fs);
  console.log(res1.stdout);
  // Output shows directory totals in 1K blocks

  console.log("--- Scenario 2: Human Readable & All Files ---");
  // Equivalent to: du -ah /projects
  const res2 = await du(["-ah", "/projects"], fs);
  console.log(res2.stdout);
  // Output shows individual file sizes (index.html, style.css) with 'K' units

  console.log("\n--- Scenario 3: Summarize & Grand Total ---");
  // Equivalent to: du -sc /projects/web /projects/notes.txt
  const res3 = await du(["-sc", "/projects/web", "/projects/notes.txt"], fs);
  console.log(res3.stdout);
  // Output shows only the totals for the two targets and a 'total' line at the end

  console.log("\n--- Scenario 4: Max Depth Limit ---");
  // Equivalent to: du -d 0 /projects (Only show the top-level folder total)
  const res4 = await du(["-d", "0", "/projects"], fs);
  console.log(res4.stdout);

  console.log("\n--- Scenario 5: Error Handling (Non-existent) ---");
  const res5 = await du(["/missing_folder"], fs);
  console.log("Exit Code:", res5.exitCode);
  console.log("Error:", res5.stderr);
})();
