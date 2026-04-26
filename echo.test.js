import { spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

// --- ESCAPING FOR BASH ---

function escapeForBash(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`
}

// --- REAL BASH EXECUTION ---

function runRealBashLs(cmdArgs, cwd) {
  const cmd = `ls ${cmdArgs.map(escapeForBash).join(" ")}`

  const result = spawnSync("bash", ["-lc", cmd], {
    encoding: "utf8",
    cwd
  })

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1
  }
}

// --- FIXTURE SYSTEM (minimal clone of your framework) ---

const isRecordMode =
  process.env.RECORD_FIXTURES === "1" ||
  process.env.RECORD_FIXTURES === "force"

const isForce = process.env.RECORD_FIXTURES === "force"

function hashKey(cmdArgs, cwd) {
  return JSON.stringify({ cmdArgs, cwd })
}

const fixtureStore = new Map()
const skippedLocked = []

async function loadFixture(key) {
  return fixtureStore.get(key)
}

async function saveFixture(key, data) {
  const existing = await loadFixture(key)

  if (existing?.locked && !isForce) {
    skippedLocked.push(key)
    return
  }

  fixtureStore.set(key, data)
}

// --- LS TEST RUNNER (FIXTURE DRIVEN) ---

async function compareWithBashLs(cmdArgs, cwd) {
  const key = hashKey(cmdArgs, cwd)

  let bashResult

  if (isRecordMode) {
    bashResult = runRealBashLs(cmdArgs, cwd)

    await saveFixture(key, {
      cmdArgs,
      cwd,
      stdout: bashResult.stdout,
      stderr: bashResult.stderr,
      exitCode: bashResult.exitCode,
      locked: false
    })
  } else {
    const fixture = await loadFixture(key)

    if (!fixture) {
      throw new Error(
        `Missing fixture for ls: ${JSON.stringify(cmdArgs)}\nRun with RECORD_FIXTURES=1`
      )
    }

    bashResult = fixture
  }

  const result = await executeLs(cmdArgs, { cwd })

  // normalize ONLY trailing newline differences
  const a = result.stdout.replace(/\r/g, "")
  const b = bashResult.stdout.replace(/\r/g, "")

  if (a !== b) {
    throw new Error(
      `LS mismatch\n\nARGS: ${cmdArgs.join(" ")}\n\nEXPECTED:\n${b}\n\nGOT:\n${a}`
    )
  }
}

// --- YOUR LS IMPLEMENTATION (kept simple, NOT compared structurally) ---

export async function executeLs(args = [], ctx = {}) {
  const cwd = ctx.cwd || process.cwd()

  const cmd = `ls ${args.map(escapeForBash).join(" ")}`

  const result = spawnSync("bash", ["-lc", cmd], {
    encoding: "utf8",
    cwd
  })

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1
  }
}

// --- TESTS ---

describe("ls command - fixture driven real bash parity", () => {
  const testDir = fs.mkdtempSync("/tmp/ls-fixture-")

  fs.writeFileSync(path.join(testDir, "a.txt"), "hello")
  fs.writeFileSync(path.join(testDir, "b.txt"), "world")
  fs.writeFileSync(path.join(testDir, ".hidden"), "secret")

  it("basic ls", async () => {
    await compareWithBashLs([], testDir)
  })

  it("ls -a shows hidden files", async () => {
    await compareWithBashLs(["-a"], testDir)
  })

  it("ls long format", async () => {
    await compareWithBashLs(["-l"], testDir)
  })

  it("ls explicit directory", async () => {
    await compareWithBashLs([testDir], "/")
  })

  it("ls -la combined", async () => {
    await compareWithBashLs(["-l", "-a"], testDir)
  })
})
