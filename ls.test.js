import { spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

 

/**
 * Format permission bits like ls -l
 */
function formatMode(mode, isDir) {
  const type = isDir ? "d" : "-"

  const perms = [
    mode & 0o400 ? "r" : "-",
    mode & 0o200 ? "w" : "-",
    mode & 0o100 ? "x" : "-",
    mode & 0o040 ? "r" : "-",
    mode & 0o020 ? "w" : "-",
    mode & 0o010 ? "x" : "-",
    mode & 0o004 ? "r" : "-",
    mode & 0o002 ? "w" : "-",
    mode & 0o001 ? "x" : "-",
  ].join("")

  return type + perms
}

/**
 * Format ls -l time like GNU/BSD (simple stable version)
 */
function formatTime(date) {
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ]

  const m = months[date.getMonth()]
  const d = String(date.getDate()).padStart(2, " ")
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")

  return `${m} ${d} ${hh}:${mm}`
}

/**
 * Core ls implementation
 */
export function executeLs(args = [], ctx = {}) {
  const cwd = ctx.cwd || process.cwd()

  let showAll = false
  let long = false
  let target = cwd

  // ---- parse flags ----
  for (const arg of args) {
    if (arg === "-a") showAll = true
    else if (arg === "-l") long = true
    else if (arg === "-la" || arg === "-al") {
      showAll = true
      long = true
    } else if (!arg.startsWith("-")) {
      target = arg
    }
  }

  // ---- resolve path safely ----
  const dir = path.isAbsolute(target)
    ? target
    : path.join(cwd, target)

  let entries = fs.readdirSync(dir)

  // ---- hidden files ----
  if (!showAll) {
    entries = entries.filter(e => !e.startsWith("."))
  } else {
    // POSIX: include . and ..
    entries = [".", "..", ...entries]
  }

  // ---- stable ordering (GNU-like default sort) ----
  entries.sort((a, b) => a.localeCompare(b))

  // ---- long format ----
  if (long) {
    let total = 0
    const lines = []

    const fileLines = []

    for (const name of entries) {
      const full = path.join(dir, name)

      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        // for "." and ".." or broken symlinks in test env
        stat = {
          isDirectory: () => true,
          mode: 0o777,
          size: 0,
          mtime: new Date(),
        }
      }

      total += stat.size || 0

      const mode = formatMode(stat.mode || 0o777, stat.isDirectory())
      const links = 1

      const user = "user"
      const group = "user"

      const size = String(stat.size || 0).padStart(5, " ")
      const time = formatTime(stat.mtime || new Date())

      fileLines.push(
        `${mode} ${links} ${user} ${group} ${size} ${time} ${name}`
      )
    }

    return {
      stdout: `total ${Math.ceil(total / 1024)}\n` + fileLines.join("\n") + "\n",
      stderr: "",
      exitCode: 0
    }
  }

  // ---- short format ----
  return {
    stdout: entries.join("\n") + "\n",
    stderr: "",
    exitCode: 0
  }
}

// --- REAL BASH COMPARISON ---

function escapeForBash(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`
}

function runRealBashLs(args, cwd) {
  const cmd = `ls ${args.map(escapeForBash).join(" ")}`
  const result = spawnSync("bash", ["-lc", cmd], {
    encoding: "utf8",
    cwd
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.status
  }
}

// --- TESTS ---

describe("ls command - real bash comparison", () => {
  const testDir = fs.mkdtempSync("/tmp/ls-test-")

  // setup fixture files
  fs.writeFileSync(path.join(testDir, "a.txt"), "hello")
  fs.writeFileSync(path.join(testDir, "b.txt"), "world")
  fs.writeFileSync(path.join(testDir, ".hidden"), "secret")

  const run = async (args, ctx = {}) => {
    const bash = runRealBashLs(args, testDir)
    const result = await executeLs(args, { cwd: testDir, ...ctx })

    // normalize whitespace differences (ls ordering/format stability)
    expect(result.stdout.trim()).toBe(bash.stdout.trim())
  }

  it("basic ls", async () => {
    await run([])
  })

  it("ls -a shows hidden files", async () => {
    await run(["-a"])
  })

  it("ls with explicit directory", async () => {
    await run([testDir])
  })

  it("ls long format", async () => {
    await run(["-l"])
  })

  it("ls -la combined behavior", async () => {
    await run(["-l", "-a"])
  })
})
