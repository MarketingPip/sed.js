import { spawnSync } from "child_process"

// --- Implementation Logic --- (unchanged)
function processEscapes(input) {
  let result = ""
  let i = 0

  while (i < input.length) {
    if (input[i] === "\\") {
      if (i + 1 >= input.length) {
        result += "\\"
        break
      }

      const next = input[i + 1]

      switch (next) {
        case "\\":
          result += "\\"
          i += 2
          break
        case "n":
          result += "\n"
          i += 2
          break
        case "t":
          result += "\t"
          i += 2
          break
        case "r":
          result += "\r"
          i += 2
          break
        case "a":
          result += "\x07"
          i += 2
          break
        case "b":
          result += "\b"
          i += 2
          break
        case "f":
          result += "\f"
          i += 2
          break
        case "v":
          result += "\v"
          i += 2
          break
        case "e":
        case "E":
          result += "\x1b"
          i += 2
          break
        case "c":
          return { output: result, stop: true }
        case "0": {
          let octal = ""
          let j = i + 2
          while (j < input.length && j < i + 5 && /[0-7]/.test(input[j])) {
            octal += input[j]
            j++
          }
          if (octal.length === 0) result += "\0"
          else result += String.fromCharCode(parseInt(octal, 8) % 256)
          i = j
          break
        }
        case "x": {
          let hex = ""
          let j = i + 2
          while (j < input.length && j < i + 4 && /[0-9a-fA-F]/.test(input[j])) {
            hex += input[j]
            j++
          }
          if (!hex.length) {
            result += "\\x"
            i += 2
          } else {
            result += String.fromCharCode(parseInt(hex, 16))
            i = j
          }
          break
        }
        case "u": {
          let hex = ""
          let j = i + 2
          while (j < input.length && j < i + 6 && /[0-9a-fA-F]/.test(input[j])) {
            hex += input[j]
            j++
          }
          if (!hex.length) {
            result += "\\u"
            i += 2
          } else {
            result += String.fromCodePoint(parseInt(hex, 16))
            i = j
          }
          break
        }
        case "U": {
          let hex = ""
          let j = i + 2
          while (j < input.length && j < i + 10 && /[0-9a-fA-F]/.test(input[j])) {
            hex += input[j]
            j++
          }
          if (!hex.length) {
            result += "\\U"
            i += 2
          } else {
            try {
              result += String.fromCodePoint(parseInt(hex, 16))
            } catch {
              result += `\\U${hex}`
            }
            i = j
          }
          break
        }
        default:
          result += `\\${next}`
          i += 2
      }
    } else {
      result += input[i++]
    }
  }

  return { output: result, stop: false }
}

export async function executeEcho(args, ctx = {}) {
  let noNewline = false
  let interpretEscapes = ctx.xpgEcho ?? false
  let startIndex = 0

  while (startIndex < args.length) {
    const arg = args[startIndex]
    if (arg === "-n") noNewline = true, startIndex++
    else if (arg === "-e") interpretEscapes = true, startIndex++
    else if (arg === "-E") interpretEscapes = false, startIndex++
    else if (arg === "-ne" || arg === "-en") {
      noNewline = true
      interpretEscapes = true
      startIndex++
    } else break
  }

  let output = args.slice(startIndex).join(" ")

  if (interpretEscapes) {
    const r = processEscapes(output)
    output = r.output
    if (r.stop) return { stdout: output, stderr: "", exitCode: 0 }
  }

  if (!noNewline) output += "\n"

  return { stdout: output, stderr: "", exitCode: 0 }
}

// --- FIXED REAL BASH COMPARISON ---

function escapeForBash(arg) {
  // safest minimal escaping for echo arguments
  return `'${String(arg).replace(/'/g, `'\\''`)}'`
}

function compareWithBash(cmdArgs) {
  // Build a real bash command explicitly
  const cmd = "echo " + cmdArgs.map(escapeForBash).join(" ")

  const bashResult = spawnSync("bash", ["-lc", cmd], {
    encoding: "utf8"
  })

  return {
    stdout: bashResult.stdout,
    stderr: bashResult.stderr,
    exitCode: bashResult.status
  }
}

// --- Tests (unchanged logic, but now truly bash-backed) ---

describe("echo command - Real Bash Comparison", () => {
  const run = async (cmdArgs) => {
    const bash = compareWithBash(cmdArgs)
    const result = await executeEcho(cmdArgs)
    expect(result.stdout).toBe(bash.stdout)
  }

  it("should match simple string", async () => {
    await run(["hello"])
  })

  it("should match -n flag (no newline)", async () => {
    await run(["-n", "hello"])
  })

  it("should match -e flag with newline", async () => {
    await run(["-e", "line1\\nline2"])
  })

  it("it should handle multiple arguments", async () => {
    await run(["one", "two", "three"])
  })

  it("should handle the -ne combined flag", async () => {
    await run(["-ne", "no\\nnewline"])
  })

  it("should match -e flag with tabs", async () => {
    await run(["-e", "col1\\tcol2"])
  })

  it("should stop output when \\c is encountered", async () => {
    await run(["-e", "hello\\c world"])
  })

  it("should handle octal escapes", async () => {
    await run(["-e", "char: \\0112"])
  })

  it("should handle hex escapes", async () => {
    await run(["-e", "char: \\x41"])
  })
})
