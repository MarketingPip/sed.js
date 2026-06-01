/**
 * GNU echo port in JavaScript
 * Spec: https://www.man7.org/linux/man-pages/man1/echo.1.html
 *
 * Run tests:  npx jest echo.js
 */

import { spawnSync } from "child_process"

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const VERSION = "9.5"

const HELP_TEXT =
  `Usage: echo [SHORT-OPTION]... [STRING]...\n` +
  `  or:  echo LONG-OPTION\n` +
  `Echo the STRING(s) to standard output.\n` +
  `\n` +
  `  -n             do not output the trailing newline\n` +
  `  -e             enable interpretation of backslash escapes\n` +
  `  -E             disable interpretation of backslash escapes (default)\n` +
  `      --help     display this help and exit\n` +
  `      --version  output version information and exit\n` +
  `\n` +
  `If -e is in effect, the following sequences are recognized:\n` +
  `\n` +
  `  \\\\     backslash\n` +
  `  \\a     alert (BEL)\n` +
  `  \\b     backspace\n` +
  `  \\c     produce no further output\n` +
  `  \\e     escape\n` +
  `  \\f     form feed\n` +
  `  \\n     new line\n` +
  `  \\r     carriage return\n` +
  `  \\t     horizontal tab\n` +
  `  \\v     vertical tab\n` +
  `  \\0NNN  byte with octal value NNN (1 to 3 digits)\n` +
  `  \\xHH   byte with hexadecimal value HH (1 to 2 digits)\n`

// ─────────────────────────────────────────────
// Escape processor
// ─────────────────────────────────────────────

/**
 * Process GNU echo backslash escape sequences.
 * @param {string} input
 * @returns {{ output: string, stop: boolean }}
 */
function processEscapes(input) {
  let result = ""
  let i = 0

  while (i < input.length) {
    if (input[i] !== "\\") {
      result += input[i++]
      continue
    }

    // Trailing lone backslash — emit as-is
    if (i + 1 >= input.length) {
      result += "\\"
      break
    }

    const next = input[i + 1]

    switch (next) {
      case "\\":                        // \\  → backslash
        result += "\\"
        i += 2
        break

      case "a":                         // \a  → BEL
        result += "\x07"
        i += 2
        break

      case "b":                         // \b  → backspace
        result += "\b"
        i += 2
        break

      case "c":                         // \c  → stop all output
        return { output: result, stop: true }

      case "e":                         // \e  → ESC  (also \E per GNU src)
      case "E":
        result += "\x1b"
        i += 2
        break

      case "f":                         // \f  → form feed
        result += "\f"
        i += 2
        break

      case "n":                         // \n  → newline
        result += "\n"
        i += 2
        break

      case "r":                         // \r  → carriage return
        result += "\r"
        i += 2
        break

      case "t":                         // \t  → horizontal tab
        result += "\t"
        i += 2
        break

      case "v":                         // \v  → vertical tab
        result += "\v"
        i += 2
        break

      case "0": {                       // \0NNN  → octal (1–3 digits)
        let octal = ""
        let j = i + 2
        while (j < input.length && octal.length < 3 && /[0-7]/.test(input[j])) {
          octal += input[j++]
        }
        result += octal.length === 0
          ? "\0"
          : String.fromCharCode(parseInt(octal, 8) & 0xff)
        i = j
        break
      }

      case "x": {                       // \xHH  → hex (1–2 digits)
        let hex = ""
        let j = i + 2
        while (j < input.length && hex.length < 2 && /[0-9a-fA-F]/.test(input[j])) {
          hex += input[j++]
        }
        if (hex.length === 0) {
          result += "\\x"              // no valid digits — emit literally
          i += 2
        } else {
          result += String.fromCharCode(parseInt(hex, 16))
          i = j
        }
        break
      }

      default:                          // unrecognised — emit literally
        result += `\\${next}`
        i += 2
    }
  }

  return { output: result, stop: false }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Execute GNU echo.
 *
 * @param {string[]} args  Argument list (not including the "echo" token itself)
 * @param {{ xpgEcho?: boolean }} [ctx]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export async function executeEcho(args, ctx = {}) {
  // ── Long options (must be the sole argument) ──────────────────────────────
  if (args.length === 1) {
    if (args[0] === "--help")
      return { stdout: HELP_TEXT, stderr: "", exitCode: 0 }

    if (args[0] === "--version")
      return { stdout: `echo (GNU coreutils) ${VERSION}\n`, stderr: "", exitCode: 0 }
  }

  // ── Short-option parsing ──────────────────────────────────────────────────
  // GNU echo does not use getopt; it greedily consumes leading arguments that
  // look like valid flag strings (-[neE]+) and stops at the first non-flag arg.
  let noNewline        = false
  let interpretEscapes = ctx.xpgEcho ?? false   // -E is the default

  let i = 0
  while (i < args.length && /^-[neE]+$/.test(args[i])) {
    for (const ch of args[i].slice(1)) {
      if      (ch === "n") noNewline       = true
      else if (ch === "e") interpretEscapes = true
      else if (ch === "E") interpretEscapes = false
    }
    i++
  }

  // ── Build output ──────────────────────────────────────────────────────────
  let output = args.slice(i).join(" ")

  if (interpretEscapes) {
    const { output: processed, stop } = processEscapes(output)
    output = processed
    if (stop) return { stdout: output, stderr: "", exitCode: 0 }
  }

  if (!noNewline) output += "\n"

  return { stdout: output, stderr: "", exitCode: 0 }
}

// ─────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────

/** Run the same args through real bash and return its output. */
function bashEcho(args) {
  const escaped = args.map(a => `'${String(a).replace(/'/g, `'\\''`)}'`).join(" ")
  const { stdout, stderr, status } = spawnSync("bash", ["-c", `echo ${escaped}`], {
    encoding: "utf8"
  })
  return { stdout, stderr, exitCode: status }
}

/** Assert that executeEcho(args) produces the same stdout as bash's echo. */
async function matchesBash(args) {
  const [impl, bash] = await Promise.all([
    executeEcho(args),
    Promise.resolve(bashEcho(args))
  ])
  expect(impl.stdout).toBe(bash.stdout)
  expect(impl.exitCode).toBe(bash.exitCode)
}

// ─────────────────────────────────────────────
// Tests — bash-comparison (behaviour parity)
// ─────────────────────────────────────────────

describe("echo — bash parity", () => {
  it("plain string",                             () => matchesBash(["hello"]))
  it("multiple arguments",                       () => matchesBash(["one", "two", "three"]))
  it("empty args",                               () => matchesBash([]))
  it("-n suppresses newline",                    () => matchesBash(["-n", "hello"]))
  it("-e enables escapes",                       () => matchesBash(["-e", "line1\\nline2"]))
  it("-E disables escapes",                      () => matchesBash(["-E", "line1\\nline2"]))
  it("-e with tab",                              () => matchesBash(["-e", "col1\\tcol2"]))
  it("-e with backslash",                        () => matchesBash(["-e", "a\\\\b"]))
  it("-e with \\r",                              () => matchesBash(["-e", "a\\rb"]))
  it("-e with \\v",                              () => matchesBash(["-e", "a\\vb"]))
  it("-e with \\f",                              () => matchesBash(["-e", "a\\fb"]))
  it("-ne combined flag",                        () => matchesBash(["-ne", "no\\nnewline"]))
  it("-en combined flag",                        () => matchesBash(["-en", "no\\nnewline"]))
  it("-nE combined flag",                        () => matchesBash(["-nE", "no\\nnewline"]))
  it("\\c stops output",                         () => matchesBash(["-e", "hello\\c world"]))
  it("\\c at start",                             () => matchesBash(["-e", "\\c hello"]))
  it("octal \\0112 → J",                         () => matchesBash(["-e", "char: \\0112"]))
  it("octal \\0101 → A",                         () => matchesBash(["-e", "\\0101"]))
  it("octal \\07 → BEL",                         () => matchesBash(["-e", "\\07"]))
  it("octal \\0 → NUL byte",                     () => matchesBash(["-e", "\\0"]))
  it("hex \\x41 → A",                            () => matchesBash(["-e", "char: \\x41"]))
  it("hex \\x61 → a",                            () => matchesBash(["-e", "\\x61"]))
  it("hex single digit \\x9",                    () => matchesBash(["-e", "\\x9"]))
  it("unknown escape emits literally",           () => matchesBash(["-e", "\\q"]))
  it("\\x with no digits emits literally",       () => matchesBash(["-e", "\\x not hex"]))
  it("flags without operands",                   () => matchesBash(["-n"]))
  it("non-flag arg stops flag parsing",          () => matchesBash(["-n", "hello", "-e"]))
  it("non-flag before -e keeps -e as literal",   () => matchesBash(["text", "-e", "\\n"]))
})

// ─────────────────────────────────────────────
// Tests — unit / internal behaviour
// ─────────────────────────────────────────────

describe("echo — unit tests", () => {
  it("--help returns help text", async () => {
    const r = await executeEcho(["--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("--help")
    expect(r.stdout).toContain("-e")
    expect(r.stdout).toContain("\\0NNN")
    expect(r.stdout).toContain("\\xHH")
  })

  it("--version returns version string", async () => {
    const r = await executeEcho(["--version"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/^echo \(GNU coreutils\)/)
  })

  it("--help with extra args is NOT treated as long option", async () => {
    const r = await executeEcho(["--help", "extra"])
    expect(r.stdout).not.toBe(HELP_TEXT)
  })

  it("\\a produces BEL (0x07)", async () => {
    const r = await executeEcho(["-e", "\\a"])
    expect(r.stdout).toBe("\x07\n")
  })

  it("\\b produces backspace (0x08)", async () => {
    const r = await executeEcho(["-e", "\\b"])
    expect(r.stdout).toBe("\b\n")
  })

  it("\\e produces ESC (0x1b)", async () => {
    const r = await executeEcho(["-e", "\\e"])
    expect(r.stdout).toBe("\x1b\n")
  })

  it("\\E also produces ESC (GNU extension)", async () => {
    const r = await executeEcho(["-e", "\\E"])
    expect(r.stdout).toBe("\x1b\n")
  })

  it("trailing lone backslash emits backslash", async () => {
    const r = await executeEcho(["-e", "hello\\"])
    expect(r.stdout).toBe("hello\\\n")
  })

  it("-e on plain text is a no-op", async () => {
    const r = await executeEcho(["-e", "plain"])
    expect(r.stdout).toBe("plain\n")
  })

  it("octal overflow wraps at 256", async () => {
    // \0400 = 256 decimal → 256 & 0xff = 0 → NUL
    const r = await executeEcho(["-e", "\\0400"])
    expect(r.stdout.charCodeAt(0)).toBe(0)
  })

  it("octal stops at 3 digits — 4th digit is literal", async () => {
    // \01234 → octal(123) + '4'
    const r = await executeEcho(["-e", "\\01234"])
    expect(r.stdout).toBe(String.fromCharCode(parseInt("123", 8) & 0xff) + "4\n")
  })

  it("hex stops at 2 digits — 3rd hex char is literal", async () => {
    // \x414 → chr(0x41) + '4' = 'A4'
    const r = await executeEcho(["-e", "\\x414"])
    expect(r.stdout).toBe("A4\n")
  })

  it("xpgEcho ctx flag enables escape interpretation", async () => {
    const r = await executeEcho(["hello\\nworld"], { xpgEcho: true })
    expect(r.stdout).toBe("hello\nworld\n")
  })

  it("xpgEcho ctx flag is overridden by explicit -E", async () => {
    const r = await executeEcho(["-E", "hello\\nworld"], { xpgEcho: true })
    expect(r.stdout).toBe("hello\\nworld\n")
  })

  it("stderr is always empty", async () => {
    const r = await executeEcho(["anything"])
    expect(r.stderr).toBe("")
  })

  it("exitCode is always 0", async () => {
    const r = await executeEcho([])
    expect(r.exitCode).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE-BASED GENERATED TEST SUITE
// Systematically generated cases verified against real Bash echo
// ═════════════════════════════════════════════════════════════════════════════

describe("generated — all single-letter escapes", () => {
  const escapes = [
    { seq: "\\\\", name: "backslash" },
    { seq: "\\a",  name: "BEL" },
    { seq: "\\b",  name: "backspace" },
    { seq: "\\e",  name: "ESC" },
    { seq: "\\E",  name: "ESC-capital" },
    { seq: "\\f",  name: "form-feed" },
    { seq: "\\n",  name: "newline" },
    { seq: "\\r",  name: "carriage-return" },
    { seq: "\\t",  name: "tab" },
    { seq: "\\v",  name: "vertical-tab" },
  ]

  escapes.forEach(({ seq, name }) => {
    it(`-e ${name} (${seq})`, () => matchesBash(["-e", `pre${seq}post`]))
    it(`-e ${name} alone`,    () => matchesBash(["-e", seq]))
    it(`-E ${name} literal`,  () => matchesBash(["-E", `pre${seq}post`]))
  })
})

describe("generated — octal escape coverage", () => {
  // All 1-digit octal values
  for (let i = 0; i <= 7; i++) {
    it(`octal \\\\0${i}`, () => matchesBash(["-e", `\\0${i}`]))
  }

  // Boundary 2-digit values
  ;[10, 20, 37, 40, 77, 100].forEach(n => {
    const oct = n.toString(8)
    it(`octal \\\\0${oct} → ${n}`, () => matchesBash(["-e", `\\0${oct}`]))
  })

  // Boundary 3-digit values
  ;[100, 177, 200, 255, 256, 377, 400].forEach(n => {
    const oct = n.toString(8).padStart(3, "0")
    it(`octal \\\\0${oct} (value ${n})`, () => matchesBash(["-e", `\\0${oct}`]))
  })

  // 4-digit overflow / stop-at-3 behaviour
  ;["01234", "07771", "04000"].forEach(seq => {
    it(`octal \\\\${seq} (4 digits, stops at 3)`, () => matchesBash(["-e", `\\${seq}`]))
  })

  // Zero-length octal → literal NUL
  it("octal \\\\0 with no digits", () => matchesBash(["-e", "a\\0b"]))

  // Octal followed immediately by another escape
  it("octal then \\\\n", () => matchesBash(["-e", "\\0101\\n"]))
})

describe("generated — hex escape coverage", () => {
  // All single hex digits
  for (let i = 0; i <= 15; i++) {
    const h = i.toString(16)
    it(`hex \\\\x${h} single digit`, () => matchesBash(["-e", `\\x${h}`]))
  }

  // Boundary 2-digit values
  ;[0x00, 0x01, 0x41, 0x61, 0x7f, 0x80, 0xff].forEach(n => {
    const h = n.toString(16).padStart(2, "0")
    it(`hex \\\\x${h} → ${n}`, () => matchesBash(["-e", `\\x${h}`]))
  })

  // 3-digit stop-at-2 behaviour
  ;["x414", "x616", "x0000"].forEach(seq => {
    it(`hex \\\\${seq} (3+ chars, stops at 2)`, () => matchesBash(["-e", `\\${seq}`]))
  })

  // No digits after x
  it("hex \\\\x with no digits", () => matchesBash(["-e", "a\\xb"]))
  it("hex \\\\x space", () => matchesBash(["-e", "\\x not-hex"]))
})

describe("generated — flag combination matrix", () => {
  const flagSets = [
    [],
    ["-n"],
    ["-e"],
    ["-E"],
    ["-ne"],
    ["-en"],
    ["-nE"],
    ["-En"],
    ["-eE"],
    ["-Ee"],
    ["-neE"],
    ["-nEe"],
    ["-enE"],
    ["-eEn"],
    ["-Een"],
    ["-Ene"],
  ]

  const payloads = [
    "plain",
    "with\\nescapes",
    "a\\tb\\tc",
    "hello\\c world",
    "\\x41\\x42\\x43",
    "\\0101\\0102",
    "trail\\",
  ]

  flagSets.forEach(flags => {
    payloads.forEach(payload => {
      const flagStr = flags.join("") || "(no flags)"
      it(`flags ${flagStr} with "${payload.replace(/\\/g, "\\\\")}"`, () =>
        matchesBash([...flags, payload]))
    })
  })
})

describe("generated — multi-argument scenarios", () => {
  const cases = [
    { args: ["one", "two", "three"], desc: "three plain args" },
    { args: ["-n", "one", "two"],    desc: "-n then two args" },
    { args: ["-e", "one", "two\\n"], desc: "-e with escape in second arg" },
    { args: ["-E", "one\\n", "two"], desc: "-E disables escapes across args" },
    { args: ["-n", "-e", "a\\n", "b\\n"], desc: "-n -e multiple escaped args" },
    { args: ["a", "-e", "\\n"],      desc: "non-flag stops parsing, -e literal" },
    { args: ["-n", "hello", "-e"],   desc: "flag then arg then literal -e" },
    { args: ["-ne", "a\\n", "b\\t"], desc: "combined flags two escaped args" },
    { args: [],                      desc: "no args at all" },
    { args: [""],                    desc: "single empty string" },
    { args: ["", ""],                desc: "two empty strings" },
    { args: ["-n", ""],              desc: "-n with empty string" },
  ]

  cases.forEach(({ args, desc }) => {
    it(desc, () => matchesBash(args))
  })
})

describe("generated — \\c at every position", () => {
  const positions = [
    { args: ["-e", "\\chello"],        desc: "start" },
    { args: ["-e", "h\\cello"],        desc: "second char" },
    { args: ["-e", "he\\cllo"],        desc: "middle" },
    { args: ["-e", "hell\\co"],        desc: "near end" },
    { args: ["-e", "hello\\c"],        desc: "at end" },
    { args: ["-e", "a\\nb\\c\\nc"],    desc: "multiple \\c" },
    { args: ["-e", "\\c"],             desc: "only \\c" },
    { args: ["-ne", "hello\\c world"], desc: "-ne with \\c" },
    { args: ["-en", "hello\\c world"], desc: "-en with \\c" },
  ]

  positions.forEach(({ args, desc }) => {
    it(`\\c at ${desc}`, () => matchesBash(args))
  })
})

describe("generated — edge cases and stress", () => {
  const cases = [
    { args: ["-e", "\\\\\\\\"],         desc: "double backslash" },
    { args: ["-e", "\\\\\\\\\\n"],      desc: "double backslash then n" },
    { args: ["-e", "\\"],               desc: "lone trailing backslash" },
    { args: ["-e", "\\\\"],              desc: "two backslashes (one escaped)" },
    { args: ["-e", "\\\\\\"],            desc: "three backslashes" },
    { args: ["-e", "\\q\\w\\e\\r"],     desc: "unknown escapes" },
    { args: ["-e", "\\0\\00\\000"],     desc: "octal zero variants" },
    { args: ["-e", "\\x0\\x00\\x000"],  desc: "hex zero variants" },
    { args: ["-e", "\\xfg\\xGH"],       desc: "invalid hex digits" },
    { args: ["-e", "\\777\\800"],       desc: "octal 777 then literal 8" },
    { args: ["-e", "\\xFF\\xfg"],       desc: "hex FF then invalid" },
    { args: ["-e", "line1\\n\\nline2"], desc: "consecutive newlines" },
    { args: ["-e", "\\t\\t\\t"],        desc: "consecutive tabs" },
    { args: ["-e", "a\\rb\\rc"],       desc: "multiple carriage returns" },
    { args: ["-E", "\\n\\t\\a\\b"],     desc: "-E all escapes literal" },
    { args: ["-n", "-E", "\\n"],        desc: "-n -E literal newline" },
    { args: ["--help"],                 desc: "long option --help" },
    { args: ["--version"],             desc: "long option --version" },
    { args: ["--help", "--version"],   desc: "--help with extra arg (not long opt)" },
    { args: ["--version", "extra"],    desc: "--version with extra arg (not long opt)" },
    { args: ["-n", "--help"],          desc: "-n then --help (not long opt)" },
  ]

  cases.forEach(({ args, desc }) => {
    it(desc, () => matchesBash(args))
  })
})

describe("generated — xpgEcho context flag matrix", () => {
  const payloads = [
    "hello\\nworld",
    "tab\\there",
    "\\x41\\x42",
    "\\0101",
    "no\\cstop",
  ]

  payloads.forEach(payload => {
    it(`xpgEcho=true  "${payload.replace(/\\/g, "\\\\")}"`, async () => {
      const impl = await executeEcho([payload], { xpgEcho: true })
      const bash = bashEcho(["-e", payload])
      expect(impl.stdout).toBe(bash.stdout)
    })

    it(`xpgEcho=true overridden by -E  "${payload.replace(/\\/g, "\\\\")}"`, async () => {
      const impl = await executeEcho(["-E", payload], { xpgEcho: true })
      const bash = bashEcho(["-E", payload])
      expect(impl.stdout).toBe(bash.stdout)
    })

    it(`xpgEcho=false with -e  "${payload.replace(/\\/g, "\\\\")}"`, async () => {
      const impl = await executeEcho(["-e", payload], { xpgEcho: false })
      const bash = bashEcho(["-e", payload])
      expect(impl.stdout).toBe(bash.stdout)
    })
  })
})

describe("generated — high-byte / wrap-around octal", () => {
  // Values that wrap around 0xFF
  const octals = [
    "0377", // 255 → ÿ
    "0400", // 256 → 0 (NUL)
    "0401", // 257 → 1 (SOH)
    "0777", // 511 → 255 (same as 0377)
    "01000", // 512 → 0 (NUL) + literal '0'
  ]

  octals.forEach(seq => {
    it(`octal \\\\${seq}`, () => matchesBash(["-e", `\\${seq}`]))
  })
})

describe("generated — mixed escape soup", () => {
  const soups = [
    "a\\nb\\tc\\rd\\ve\\ff",
    "\\x48\\x65\\x6c\\x6c\\x6f", // "Hello"
    "\\0102\\0101\\0103\\0104", // "BASH"
    "\\n\\r\\t\\a\\b\\v\\f\\e\\E\\\\",
    "price: \\x24\\x31\\x30",   // "$10"
    "ctrl-c\\cignored",
    "line1\\n\\nline3\\n\\n\\nline6",
    "\\0\\00\\000\\0000",       // NUL variants
  ]

  soups.forEach((soup, idx) => {
    it(`soup #${idx + 1}`, () => matchesBash(["-e", soup]))
  })
})
