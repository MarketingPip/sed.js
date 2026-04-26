import * as fflate from "https://esm.sh/fflate";
import memfs from "https://esm.sh/memfs"
const {vol} = memfs;
const fs = vol;
import path from "https://esm.sh/path-browserify"
 

const ctx = {
  cwd: "/",
  stdin: "",
  fs: {
    // Wrap the memfs vol and add the missing resolvePath method
    ...vol.promises, 
    resolvePath: (cwd, file) => {
      // If 'file' is absolute, it returns 'file'; 
      // if relative, it joins it with 'cwd'
      return path.resolve(cwd, file);
    },
    // Ensure readFileBuffer maps to the correct memfs method
    readFileBuffer: async (p) => {
      return vol.readFileSync(p); // memfs readFileSync returns a Buffer/Uint8Array
    }
  }
};

await ctx.fs.writeFile("myfile.txt", "cool")

/**
 * 1. INTERNAL UTILITIES
 */

// Converts Uint8Array to a binary string (latin1) to pass through shell strings
const toBinaryString = (buf) => {
  let str = "";
  for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
  return str;
};

// Extracts uncompressed size from the last 4 bytes of gzip trailer
const getUncompressedSize = (data) => {
  const len = data.length;
  if (len < 4) return 0;
  return (data[len - 4] | (data[len - 3] << 8) | (data[len - 2] << 16) | (data[len - 1] << 24)) >>> 0;
};

const isGzip = (data) => data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;

/**
 * 2. ARGUMENT PARSER
 */
function parseArgs(args, definitions) {
  const flags = {};
  const positional = [];
  
  for (const key in definitions) {
    if (definitions[key].default !== undefined) flags[key] = definitions[key].default;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      let matched = false;
      for (const key in definitions) {
        const def = definitions[key];
        if (arg === `-${def.short}` || arg === `--${def.long}`) {
          if (def.type === "boolean") flags[key] = true;
          else if (def.type === "string") flags[key] = args[++i];
          matched = true;
          break;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

const argDefs = {
  stdout: { short: "c", long: "stdout", type: "boolean" },
  decompress: { short: "d", long: "decompress", type: "boolean" },
  force: { short: "f", long: "force", type: "boolean" },
  keep: { short: "k", long: "keep", type: "boolean" },
  list: { short: "l", long: "list", type: "boolean" },
  suffix: { short: "S", long: "suffix", type: "string", default: ".gz" },
  verbose: { short: "v", long: "verbose", type: "boolean" },
  fast: { short: "1", long: "fast", type: "boolean" },
  best: { short: "9", long: "best", type: "boolean" }
};

/**
 * 3. CORE EXECUTION
 */
async function executeGzip(args, ctx, cmdName) {
 
  const { flags, positional } = parseArgs(args, argDefs);
  let files = positional.length > 0 ? positional : ["-"];

  const decompress = cmdName === "gunzip" || cmdName === "zcat" || flags.decompress;
  const toStdout = cmdName === "zcat" || flags.stdout;
  const level = flags.best ? 9 : flags.fast ? 1 : 6;

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  for (const file of files) {
    try {
      let inputData;
      
      // Read Input (Sync/Async handled by ctx.fs)
      if (file === "-") {
        inputData = new TextEncoder().encode(ctx.stdin || "");
      } else {
        const path = ctx.path ? ctx.path.resolve(ctx.cwd, file) : file;
        inputData = await ctx.fs.readFileBuffer(path);
      }

      // Mode: List
      if (flags.list) {
        if (!isGzip(inputData)) throw new Error("not in gzip format");
        const uncompressed = getUncompressedSize(inputData);
        const ratio = ((1 - inputData.length / uncompressed) * 100).toFixed(1);
        stdout += `${inputData.length.toString().padStart(10)} ${uncompressed.toString().padStart(10)} ${ratio}% ${file}\n`;
        continue;
      }

      // SYNC COMPRESSION/DECOMPRESSION
      let processed;
      if (decompress) {
        if (!isGzip(inputData)) throw new Error("not in gzip format");
        processed = fflate.gunzipSync(inputData);
      } else {
        processed = fflate.gzipSync(inputData, { level, filename: file === "-" ? undefined : file });
      }

      // Output Handling
      if (toStdout || file === "-") {
        stdout += toBinaryString(processed);
      } else {
        const outName = decompress 
          ? file.replace(new RegExp(`${flags.suffix}$`), "") 
          : file + flags.suffix;
        
        const outPath = ctx.fs.resolvePath(ctx.cwd, outName);
        await ctx.fs.writeFile(outPath, processed);
        
        if (!flags.keep) {
          await ctx.fs.rm(ctx.fs.resolvePath(ctx.cwd, file));
        }

        if (flags.verbose) {
          stderr += `${file}:\t${((1 - processed.length / inputData.length) * 100).toFixed(1)}% -- replaced with ${outName}\n`;
        }
      }
    } catch (e) {
      stderr += `${cmdName}: ${file}: ${e.message}\n`;
      exitCode = 1;
    }
  }

  return { stdout, stderr, exitCode };
}

/**
 * 4. EXPORTS
 */
export const gzipCommand = {
  name: "gzip",
  async execute(args, ctx) {
    const res = await executeGzip(args, ctx, "gzip");
    return { ...res, stdoutEncoding: "binary" };
  }
};

export const gunzipCommand = {
  name: "gunzip",
  async execute(args, ctx) {
    const res = await executeGzip(args, ctx, "gunzip");
    return { ...res, stdoutEncoding: "binary" };
  }
};

export const zcatCommand = {
  name: "zcat",
  async execute(args, ctx) {
    const res = await executeGzip(args, ctx, "zcat");
    return { ...res, stdoutEncoding: "binary" };
  }
};

 

// Simulate: gzip -v -9 myfile.txt
const result = await gzipCommand.execute(['-v', '-9', 'myfile.txt'], ctx);

console.log(result.stdout); // Empty in this case (unless -c was used)
console.log(result.stderr); // "myfile.txt: 85.2% -- replaced with myfile.txt.gz"
