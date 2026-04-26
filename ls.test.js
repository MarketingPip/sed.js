import { spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

// --- Implementation Logic (very small ls clone) ---

export async function executeLs(args = [], ctx = {}) {
  const cwd = ctx.cwd || process.cwd()

  let showAll = false
  let longFormat = false
  let target = cwd

  for (const arg of args) {
    if (arg === "-a") showAll = true
    else if (arg === "-l") longFormat = true
    else if (!arg.startsWith("-")) target = path.join(cwd, arg)
  }

  let entries = fs.readdirSync(target)

  if (!showAll) {
    entries = entries.filter((e) => !e.startsWith("."))
  }

  if (!longFormat) {
    return { stdout: entries.sort().join("\n") + "\n", stderr: "", exitCode: 0 }
  }

  // minimal long format (not full GNU parity, just stable output)
  let out = ""
  for (const entry of entries.sort()) {
    const stat = fs.statSync(path.join(target, entry))
    out += `${stat.isDirectory() ? "d" : "-"}--------- 1 user user ${stat.size} ${entry}\n`
  }

  return { stdout: out, stderr: "", exitCode: 0 }
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
