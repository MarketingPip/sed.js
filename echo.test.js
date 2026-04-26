import { spawnSync } from "child_process"

// --- Implementation Logic ---

/**
 * Process echo -e escape sequences
 */
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
          // \c stops output and suppresses trailing newline
          return { output: result, stop: true }
        case "0": {
          // \0NNN - octal (up to 3 digits after the 0)
          let octal = ""
          let j = i + 2
          while (j < input.length && j < i + 5 && /[0-7]/.test(input[j])) {
            octal += input[j]
            j++
          }
          if (octal.length === 0) {
            // \0 alone is NUL
            result += "\0"
          } else {
            const code = parseInt(octal, 8) % 256
            result += String.fromCharCode(code)
          }
          i = j
          break
        }
        case "x": {
          // \xHH - hex (1-2 hex digits)
          let hex = ""
          let j = i + 2
          while (
            j < input.length &&
            j < i + 4 &&
            /[0-9a-fA-F]/.test(input[j])
          ) {
            hex += input[j]
            j++
          }
          if (hex.length === 0) {
            // \x with no valid hex digits - output literally
            result += "\\x"
            i += 2
          } else {
            const code = parseInt(hex, 16)
            result += String.fromCharCode(code)
            i = j
          }
          break
        }
        case "u": {
          // \uHHHH - 4-digit unicode
          let hex = ""
          let j = i + 2
          while (
            j < input.length &&
            j < i + 6 &&
            /[0-9a-fA-F]/.test(input[j])
          ) {
            hex += input[j]
            j++
          }
          if (hex.length === 0) {
            result += "\\u"
            i += 2
          } else {
            const code = parseInt(hex, 16)
            result += String.fromCodePoint(code)
            i = j
          }
          break
        }
        case "U": {
          // \UHHHHHHHH - 8-digit unicode
          let hex = ""
          let j = i + 2
          while (
            j < input.length &&
            j < i + 10 &&
            /[0-9a-fA-F]/.test(input[j])
          ) {
            hex += input[j]
            j++
          }
          if (hex.length === 0) {
            result += "\\U"
            i += 2
          } else {
            const code = parseInt(hex, 16)
            try {
              result += String.fromCodePoint(code)
            } catch {
              // Invalid code point, output as-is
              result += `\\U${hex}`
            }
            i = j
          }
          break
        }
        default:
          // Unknown escape - keep the backslash and character
          result += `\\${next}`
          i += 2
      }
    } else {
      result += input[i]
      i++
    }
  }

  return { output: result, stop: false }
}


/**
 * The echo command execution logic
 */
export async function executeEcho(args, ctx = {}) {
  let noNewline = false
  let interpretEscapes = ctx.xpgEcho ?? false
  let startIndex = 0

  while (startIndex < args.length) {
    const arg = args[startIndex]
    if (arg === "-n") {
      noNewline = true
      startIndex++
    } else if (arg === "-e") {
      interpretEscapes = true
      startIndex++
    } else if (arg === "-E") {
      interpretEscapes = false
      startIndex++
    } else if (arg === "-ne" || arg === "-en") {
      noNewline = true
      interpretEscapes = true
      startIndex++
    } else {
      break
    }
  }

  let output = args.slice(startIndex).join(" ")

  if (interpretEscapes) {
    const result = processEscapes(output)
    output = result.output
    if (result.stop) {
      return { stdout: output, stderr: "", exitCode: 0 }
    }
  }

  if (!noNewline) {
    output += "\n"
  }

  return { stdout: output, stderr: "", exitCode: 0 }
}

// --- Jest Tests ---

describe("echo command - Real Bash Comparison", () => {
  const compareWithBash = async cmdArgs => {
    // 1. Get real bash output
    // Note: We use shell: true to ensure 'echo' flags like -e are handled by the system shell
    const bashResult = spawnSync("echo", cmdArgs, {
      encoding: "utf8",
      shell: true
    })
    const expected = bashResult.stdout

    // 2. Get our TS output
    const result = await executeEcho(cmdArgs)

    // 3. Compare
    expect(result.stdout).toBe(expected)
  }

  it("should match simple string", async () => {
    await compareWithBash(["hello"])
  })

  it("should match -n flag (no newline)", async () => {
    await compareWithBash(["-n", "hello"])
  })

  it("should match -e flag with newline", async () => {
    await compareWithBash(["-e", "line1\\nline2"])
  })

  it("it should handle multiple arguments", async () => {
    await compareWithBash(["one", "two", "three"])
  })

  it("should handle the -ne combined flag", async () => {
    await compareWithBash(["-ne", "no\\nnewline"])
  })

  it("should match -e flag with tabs", async () => {
    await compareWithBash(["-e", "col1\\tcol2"])
  })

  it("should stop output when \\c is encountered", async () => {
    // In bash, everything after \c is ignored and no trailing newline is added
    await compareWithBash(["-e", "hello\\c world"])
  })

  it("should handle octal escapes", async () => {
    // \0112 is 'J'
    await compareWithBash(["-e", "char: \\0112"])
  })

  it("should handle hex escapes", async () => {
    // \x41 is 'A'
    await compareWithBash(["-e", "char: \\x41"])
  })
})
