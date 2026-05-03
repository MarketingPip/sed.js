/**
 * GNU POSIX-compliant paste implementation
 * Signature: paste(args, fs, stdin)
 * @param {string[]} args - Command line arguments (e.g., ["-d", ":", "file1", "file2"])
 * @param {object} fs - The file system object (promises API)
 * @param {string} stdin - Standard input string
 */
export async function paste(args, fs, stdin = "") {
  let stdout = "";
  let stderr = "";
  
  // 1. Parse Arguments
  let delimiters = "\t";
  let serial = false;
  const operands = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-s") {
      serial = true;
    } else if (arg === "-d") {
      delimiters = args[++i] ?? "\t";
    } else if (arg.startsWith("-d")) {
      delimiters = arg.slice(2);
    } else {
      operands.push(arg);
    }
  }

  if (operands.length === 0) {
    return { stdout: "", stderr: "usage: paste [-s] [-d delimiters] file ...\n", exitCode: 1 };
  }

  // Handle escape sequences in delimiters (POSIX requires support for \n, \t, etc.)
  const parsedDelims = delimiters.replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");

  // Prepare stdin lines (generator-like behavior)
  const stdinLines = stdin.split(/\r?\n/);
  if (stdinLines.length > 0 && stdinLines[stdinLines.length - 1] === "") stdinLines.pop();
  let stdinPointer = 0;
  const getNextStdin = () => stdinLines[stdinPointer++] ?? "";

  // 2. Read File Contents
  const fileContents = [];
  for (const op of operands) {
    if (op === "-") {
      fileContents.push({ type: "stdin" });
    } else {
      try {
        const content = await fs.readFile(op, "utf-8");
        const lines = content.split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        fileContents.push({ type: "file", lines });
      } catch (err) {
        return { stdout: "", stderr: `paste: ${op}: No such file or directory\n`, exitCode: 1 };
      }
    }
  }

  // 3. Process Output
  let resultLines = [];

  if (serial) {
    // -s Serial Mode: Each file's lines are joined together on one line
    for (const entry of fileContents) {
      let lines = entry.type === "stdin" ? [...stdinLines] : entry.lines;
      // If entry was stdin, we consume it all
      if (entry.type === "stdin") stdinPointer = stdinLines.length; 
      resultLines.push(joinWithDelims(lines, parsedDelims));
    }
  } else {
    // Parallel Mode: Merge lines from each file column-wise
    const maxLines = Math.max(...fileContents.map(f => f.type === "file" ? f.lines.length : 0));
    
    // Note: POSIX parallel paste continues until ALL files reach EOF
    let active = true;
    let lineIdx = 0;
    
    while (active) {
      let currentParts = [];
      let allFilesDone = true;

      for (const entry of fileContents) {
        if (entry.type === "stdin") {
          // In parallel mode, each "-" in the args consumes ONE line per output row
          const line = getNextStdin();
          currentParts.push(line);
          if (stdinPointer <= stdinLines.length) allFilesDone = false;
        } else {
          const line = entry.lines[lineIdx];
          currentParts.push(line ?? "");
          if (lineIdx < entry.lines.length) allFilesDone = false;
        }
      }

      if (allFilesDone) {
        active = false;
      } else {
        resultLines.push(joinWithDelims(currentParts, parsedDelims));
        lineIdx++;
      }
    }
  }

  return { 
    stdout: resultLines.length > 0 ? resultLines.join("\n") + "\n" : "", 
    stderr: "", 
    exitCode: 0 
  };
}

function joinWithDelims(parts, delims) {
  if (parts.length === 0) return "";
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const d = delims[(i - 1) % delims.length];
    out += d + parts[i];
  }
  return out;
}

import memfs from "https://esm.sh/memfs";
const  { vol } = memfs;

const fs = vol.promises;

(async () => {
  // 1. Setup mock files
  await fs.writeFile("/names.txt", "Alice\nBob\nCharlie");
  await fs.writeFile("/scores.txt", "95\n88\n92");

  // --- SCENARIO 1: Basic Parallel Paste (Default) ---
  // Equivalent to: paste names.txt scores.txt
  const res1 = await paste(["/names.txt", "/scores.txt"], fs);
  console.log("--- Parallel Paste ---\n" + res1.stdout);
  /* 
     Alice	95
     Bob	88
     Charlie	92
  */

  // --- SCENARIO 2: Custom Delimiters and Serial Flag ---
  // Equivalent to: paste -s -d ", " names.txt
  // -s: treats the file as one long row
  // -d: cycles through the characters ',' and ' '
  const res2 = await paste(["-s", "-d", ", ", "/names.txt"], fs);
  console.log("--- Serial Paste with Custom Delims ---\n" + res2.stdout);
  /*
     Alice,Bob Charlie
  */

  // --- SCENARIO 3: The "Magic" of Stdin (-) ---
  // Equivalent to: echo -e "1\n2\n3\n4" | paste - -
  // Each "-" consumes ONE line per output row.
  const stdinContent = "1\n2\n3\n4";
  const res3 = await paste(["-", "-"], fs, stdinContent);
  console.log("--- Multi-column Stdin ---\n" + res3.stdout);
  /*
     1	2
     3	4
  */
})();
