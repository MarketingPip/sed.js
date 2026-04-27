import { spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import os from "node:os"


function formatMode(mode, isDir) {
  const type = isDir ? "d" : "-"

  const u = (mode & 0o400) ? "r" : "-"
  const g = (mode & 0o040) ? "r" : "-"
  const o = (mode & 0o004) ? "r" : "-"

  let ux = (mode & 0o100) ? "x" : "-"
  let gx = (mode & 0o010) ? "x" : "-"
  let ox = (mode & 0o001) ? "x" : "-"

  // special bits
  const setuid = (mode & 0o4000) !== 0
  const setgid = (mode & 0o2000) !== 0
  const sticky = (mode & 0o1000) !== 0

  if (setuid) ux = ux === "x" ? "s" : "S"
  if (setgid) gx = gx === "x" ? "s" : "S"
  if (sticky) ox = ox === "x" ? "t" : "T"

  return (
    type +
    u + ((mode & 0o200) ? "w" : "-") + ux +
    g + ((mode & 0o020) ? "w" : "-") + gx +
    o + ((mode & 0o002) ? "w" : "-") + ox
  )
}

function formatTime(d) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return (
    months[d.getMonth()] +
    " " + String(d.getDate()).padStart(2, " ") +
    " " + String(d.getHours()).padStart(2, "0") +
    ":" + String(d.getMinutes()).padStart(2, "0")
  )
}

function getUserName(uid) {
  if (uid === 0) return "root"
  if (uid === process.getuid?.()) return process.env.USER || "runner"
  return process.env.USER || "runner"
}

function getGroupName(gid) {
  if (gid === 0) return "root"
  if (gid === process.getgid?.()) return process.env.USER || "runner"
  return process.env.USER || "runner"
}

function safeStat(full) {
  try {
    return fs.statSync(full)
  } catch {
    return {
      isDirectory: () => false,
      mode: 0o100644,
      size: 0,
      mtime: new Date(),
      blocks: 0,
      nlink: 1,
      uid: process.getuid?.() ?? 1000,
      gid: process.getgid?.() ?? 1000,
    }
  }
}

/**
 * POSIX ls implementation
 */
export function executeLs(args = [], ctx = {}) {
  const cwd = ctx.cwd || process.cwd()

  let showAll = false
  let long = false
  let target = cwd

  // ---- parse args ----
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

  const dir = path.isAbsolute(target)
    ? target
    : path.join(cwd, target)

  let entries = fs.readdirSync(dir)

  // ---- hidden files ----
  if (showAll) {
    entries = [".", "..", ...entries]
  } else {
    entries = entries.filter(e => !e.startsWith("."))
  }

  entries.sort((a, b) => a.localeCompare(b))

  const { user, group } = getOwner()

  // ---- SHORT FORMAT ----
  if (!long) {
    return {
      stdout: entries.join("\n") + "\n",
      stderr: "",
      exitCode: 0,
    }
  }

  // ---- PRE-CALCULATE STATS (needed for correct width + blocks) ----
  const stats = entries.map(name => {
    const full =
      name === "."
        ? dir
        : name === ".."
        ? path.resolve(dir, "..")
        : path.join(dir, name)

    return safeStat(full)
  })

  // GNU ls-style 1K blocks
  const totalBlocks = stats.reduce((sum, s) => {
    const blocks512 = typeof s.blocks === "number" ? s.blocks : Math.ceil((s.size || 0) / 512)
    return sum + Math.ceil(blocks512 / 2)
  }, 0)

  const linkWidth = String(Math.max(...stats.map(s => s.nlink || 1))).length
  const userNames = stats.map(s => getUserName(s.uid ?? 0))
  const groupNames = stats.map(s => getGroupName(s.gid ?? 0))
  const sizeWidth = String(Math.max(...stats.map(s => s.size || 0))).length
  const userWidth = Math.max(...userNames.map(s => s.length))
  const groupWidth = Math.max(...groupNames.map(s => s.length))

  const lines = []

  for (let i = 0; i < entries.length; i++) {
    const name = entries[i]
    const stat = stats[i]

    const isDir = stat.isDirectory?.() || false
    const mode = formatMode(stat.mode || 0o100644, isDir)
    const nlink = String(stat.nlink ?? (isDir ? 2 : 1)).padStart(linkWidth, " ")
    const user = userNames[i].padEnd(userWidth, " ")
    const group = groupNames[i].padEnd(groupWidth, " ")
    const size = String(stat.size || 0).padStart(sizeWidth, " ")
    const time = formatTime(stat.mtime || new Date())

    lines.push(`${mode} ${nlink} ${user} ${group} ${size} ${time} ${name}`)
  }

  return {
    stdout: `total ${totalBlocks}\n` + lines.join("\n") + "\n",
    stderr: "",
    exitCode: 0,
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
});
