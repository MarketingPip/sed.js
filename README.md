# 🧵 Sed.js

A fully-featured, **pure JavaScript implementation of `sed`** (stream editor), designed to run in environments without native shell access. Includes support for a **virtual file system (VFS)**, making it ideal for browsers, sandboxes, and testing environments.

---

## ✨ Features

* ✅ Core `sed` command support (`s`, `p`, `d`, `a`, `i`, `c`, etc.)
* ✅ Addressing (line numbers, `$`, regex, ranges, steps, relative offsets)
* ✅ BRE → ERE regex conversion, plus native `-E`/`-r` extended mode
* ✅ POSIX character classes (`[:alpha:]`, `[:digit:]`, etc.)
* ✅ Grouped commands `{ ... }`
* ✅ Branching (`b`, `t`, `T`, labels)
* ✅ Hold space operations (`h`, `H`, `g`, `G`, `x`)
* ✅ Transliteration (`y///`)
* ✅ File read/write (`r`, `R`, `w`, `W`) via VFS
* ✅ `-n`, `-i`, `-E`/`-r`, `-e`, `-f`, `--posix`, `-s`/`--separate`, `-z`/`--null-data` CLI flags
* ✅ Multi-line pattern space (`N`, `D`, `P`)
* ✅ Virtual file system support
* ✅ Optional shell execution (`e` command and `s///e` flag) via a pluggable `shell` callback — disabled by default unless you supply one

---

## 📦 Installation

Just copy the file into your project:

```js
import sed from "./index.js";
```

No dependencies required.

---

## 🚀 Usage

### Basic Example

```js
const output = await sed("s/hello/world/", {
  stdin: "hello\nhello\n"
});

console.log(output);
// world
// world
```

---

### Using Files

```js
const fs = {
  "file.txt": "hello\nfoo\n"
};

const output = await sed("s/foo/bar/ file.txt", { fs });

console.log(output);
// hello
// bar

console.log(fs["file.txt"]);
// hello
// foo   <- unchanged: a plain (non -i) call never writes back to input files
```

(`vfs` still works as an alias for a plain-object `fs` — see the Filesystem section below for real-fs and memfs support.)

---

### In-place Editing (`-i`)

```js
await sed("-i s/foo/bar/ file.txt", { fs });
```

---

### Silent Mode (`-n`)

```js
await sed("-n s/foo/bar/p", {
  stdin: "foo\nbaz\n"
});
// bar
```

---

### Multiple Scripts

```js
await sed(["-e", "s/foo/bar/", "-e", "s/bar/baz/"], {
  stdin: "foo\n"
});
// baz
```

---

### POSIX Mode

Restricts the parser to POSIX-only syntax (no GNU extensions like `\+`, `\?`, step addresses, relative `+N` ranges, or the `Q`/`R`/`W`/`z`/`F` commands):

```js
await sed(["--posix", "1,3 p"], { stdin: "a\nb\nc\nd\n" });
```

---

### Multiple Files (`-s` / `--separate`)

Treats each file as its own stream (fresh line numbers, fresh `$`), while hold space still carries across files, matching real `sed -s`:

```js
const fs = { "a.txt": "1\n2\n", "b.txt": "3\n4\n" };
await sed(["-s", "$=", "a.txt", "b.txt"], { fs });
```

---

### NUL-Separated Records (`-z` / `--null-data`)

```js
await sed(["-z", "s/a/b/"], { stdin: "a\0a\0" });
```

---

### Shell Execution (`e` command)

The `e` command and `s///e` flag are **off by default**. To enable them, pass a `shell` callback that takes a command string and returns its stdout:

```js
await sed("s/.*/echo &/e", {
  stdin: "hello\n",
  shell: async (cmd) => {
    // wire this up to whatever you trust in your environment --
    // e.g. a subprocess, a WASM shell, a sandboxed evaluator, etc.
    return runInMySandbox(cmd);
  }
});
```

If `e` or `s///e` is used without a `shell` callback, it throws rather than silently no-oping.

---

## 🧠 Supported Commands

| Command                 | Description                          |
| ------------------------ | ------------------------------------ |
| `s///`                   | Substitute                           |
| `p`, `P`                 | Print                                |
| `d`, `D`                 | Delete                               |
| `a`, `i`, `c`             | Append / Insert / Change             |
| `y///`                   | Transliterate                        |
| `h`, `H`, `g`, `G`, `x`   | Hold space ops                       |
| `n`, `N`                 | Next line                            |
| `b`, `t`, `T`             | Branching                            |
| `{}`                      | Group commands                       |
| `=`                       | Print line number                    |
| `l`                       | List (escaped output, wraps at 70 cols) |
| `r`, `R`                  | Read file (whole file / one line)    |
| `w`, `W`                  | Write file (whole pattern / first line) |
| `q`, `Q`                  | Quit (with optional exit code)       |
| `z`                       | Zap (clear pattern space, GNU-only)  |
| `F`                       | Print current filename (GNU-only)    |
| `e`                       | Execute shell command (requires `shell` callback) |

---

## 📍 Addressing

Supports full sed-style addressing:

* Line numbers: `1`, `5`
* Last line: `$`
* Regex: `/pattern/`, with optional `I` (ignore case) and `M`/`m` (multiline) flags
* Ranges: `1,5`, `/start/,/end/`, `3,$`
* Step: `1~2` (every 2 lines starting at 1) — GNU extension
* Relative end: `/start/,+2` — GNU extension
* Negation: `/skip/!p`

Two-address ranges are stateful: once a range's end line is reached it closes and won't reopen on a later re-evaluation of the same line (relevant when a script uses `D`-restarts or `b`/`t`/`T` loops that revisit the same input line multiple times).

---

## 🔤 Regex Support

* Default: **BRE (Basic Regular Expressions)**
* Optional: **ERE (Extended)** via `-E` or `-r`
* POSIX classes:

  * `[[:digit:]]`
  * `[[:alpha:]]`
  * `[[:space:]]`
  * ...and the rest of the standard POSIX class set

Internally converted to JavaScript-compatible regex. GNU-only escapes (`\+`, `\?`, `\|`, `\<`, `\>`, `\U`/`\L`/`\u`/`\l`/`\E` in replacements) are recognized in default mode and rejected/literalized under `--posix`.

---

## 🗂 Filesystem: `fs` (and legacy `vfs`)

`options.fs` accepts several backend shapes, auto-detected:

| What you pass | Detected as | Example |
|---|---|---|
| Plain object | flat JSON store | `{ "file.txt": "content\n" }` |
| `require('fs/promises')`, memfs's `vol.promises`, any `{readFile, writeFile}` returning Promises | promise-style | `import fsp from 'node:fs/promises'` |
| `require('fs')`, memfs's default `fs` export | node-like (has `.promises`) | `import fs from 'node:fs'` |
| A bare memfs `Volume` instance, or any `{readFileSync, writeFileSync}` | sync | `Volume.fromJSON({...})` |

`options.vfs` is kept as a permanent alias for the plain-object case — existing code using `vfs` keeps working unchanged.

```js
// Plain object (same as the old `vfs`, just under the new name)
await sed('s/foo/bar/ file.txt', { fs: { 'file.txt': 'foo\n' } });

// Real filesystem
import fsp from 'node:fs/promises';
await sed('-i s/foo/bar/ ./notes.txt', { fs: fsp });

// memfs
import { fs as memfs } from 'memfs';
await sed('-i s/foo/bar/ /notes.txt', { fs: memfs });
```

Used for:

* Input files (bare file operands)
* Output files (`w`, `W`, `-i`)
* Read commands (`r`, `R`)
* Script files (`-f`)

For the plain-object/JSON backend, filenames are looked up as the object's *own* properties, so filenames like `"__proto__"` or `"constructor"` behave like any other filename rather than colliding with `Object.prototype`. For real-fs/memfs backends, filenames are passed straight through to the backend, which resolves relative paths against `process.cwd()` exactly like a real shell invocation would.

**Known tradeoff:** for real-fs/memfs backends, checking whether a file exists before reading it (used internally for file-operand validation) currently does two reads rather than one. This doesn't affect correctness, only I/O count — worth knowing if you're pointing this at very large files on a real filesystem.

### Non-mutating usage (`mutateVfs: false`)

By default (`mutateVfs: true`, matching the historical `vfs` behavior), writes made during a run (via `w`, `W`, or `-i`) mutate the object you passed in directly. If you don't want that — e.g. you're reusing the same input object across calls, or it's frozen/shared — pass `mutateVfs: false`. The engine then works off an internal copy, and your original object is never touched:

```js
const original = { 'file.txt': 'foo\n' };
const result = await sed('-i s/foo/bar/ file.txt', {
  fs: original,
  mutateVfs: false,
  returnFs: true,
});

original;      // still { 'file.txt': 'foo\n' } -- untouched
result.output; // '' (no stdout for -i)
result.fs;     // { 'file.txt': 'bar\n' } -- the updated state
```

`mutateVfs` only applies to the plain-object/JSON backend — real-fs and memfs backends are inherently stateful stores where "don't mutate" isn't a meaningful concept (their whole job is to be written to), so `mutateVfs: false` is a no-op for those.

### Getting the final state back out (`returnFs: true`)

Rather than diffing your VFS object before/after (fragile, and doesn't work at all with `mutateVfs: false` or with real-fs backends), pass `returnFs: true` to get the final state back directly in the result:

```js
const result = await sed('-i s/foo/bar/ file.txt', { fs: vfs, returnFs: true });
result.fs; // snapshot of the filesystem after the run
```

For the JSON backend this is always available. For memfs, it uses the Volume's `toJSON()` if present. For real OS filesystem backends, `result.fs` is `null` — there's no well-defined "whole filesystem as JSON" for that case (check `Object.keys(result)` won't help here; inspect the actual files on disk instead).

Combining `options.exitCode` and `options.returnFs` gives you `{ output, exitCode, fs }` all at once; using neither still returns a bare string exactly as before, so existing code is unaffected.

### File-event observability (`onFsEvent`)

For anything more granular than a before/after snapshot — logging, auditing, progress reporting, or just not wanting to think about snapshots at all — pass a callback and get called for every read/write:

```js
await sed('-i s/foo/bar/ file.txt', {
  fs: vfs,
  onFsEvent(event) {
    // { type: 'read' | 'write' | 'missing', filename, found?, size? }
    console.log(event);
  },
});
```

This works identically regardless of backend (JSON, real fs, memfs), since it's implemented at the adapter layer rather than by any individual backend. An error thrown inside your callback is swallowed rather than propagated — a bad listener should never break the actual sed run.

---

## ⚠️ Limitations

* ⚠️ Shell execution (`e`, `s///e`) is opt-in only — you must supply a `shell` callback; there is no built-in subprocess spawning
* ⚠️ Regex differences vs GNU sed are possible in rare edge cases (JS engine limitations)
* ⚠️ Performance may differ from native sed
* ⚠️ Real-fs/memfs backends do two reads per file-operand check (see the filesystem section above)

---

## 🧪 Advanced Example

```js
const vfs = {
  "input.txt": "apple\nbanana\ncherry\n"
};

const result = await sed(
  "-n /a/ { s/a/A/g; p }",
  { fs: vfs, stdin: vfs["input.txt"] }
);

console.log(result);
// Apple
// bAnAnA
```

---

## 🏗 Architecture

1. **Regex Utilities**

   * Converts BRE → JS-compatible regex
   * Handles POSIX classes

2. **Lexer**

   * Tokenizes sed scripts

3. **Parser**

   * Builds a command tree, then flattens groups into a single instruction
     list (so labels inside `{...}` are visible to branches outside it,
     matching how GNU sed compiles scripts)

4. **Executor**

   * Applies commands line-by-line
   * Maintains pattern space, hold space, and per-range activation state
   * Handles deferred output (`a`, `r`, `R`) and GNU's "missing trailing
     newline" output semantics

5. **FS Adapter**

   * Normalizes plain-object, `fs/promises`-style, sync-`fs`-style, and
     memfs backends behind one async `{has, get, set, snapshot}` interface
   * Handles the non-mutating clone path, the `returnFs` snapshot, and
     `onFsEvent` dispatch

---

## 📄 API

### `sed(commandStr, options)`

#### Parameters

* `commandStr` (`string | string[]`)

  * CLI-style command or argument array (e.g. `"s/a/b/"` or `["-n", "-e", "p"]`)

* `options`

  * `stdin` — string input
  * `fs` — filesystem backend; plain object, `fs/promises`-style, `fs`-like, memfs `Volume`, or memfs's `fs` export (see the Filesystem section above)
  * `vfs` — legacy alias for `fs` when passing a plain object; still fully supported
  * `mutateVfs` — `boolean`, default `true`; set `false` to avoid mutating the object passed as `fs`/`vfs` (JSON backend only)
  * `returnFs` — `boolean`, default `false`; include a snapshot of the final filesystem state in the result
  * `onFsEvent` — `(event: {type, filename, found?, size?}) => void`, called for every file read/write/missing-check
  * `shell` — `async (command: string) => string`, optional callback enabling the `e` command and `s///e` flag
  * `posix` — `boolean`, equivalent to passing `--posix`
  * `nullData` — `boolean`, equivalent to passing `-z`/`--null-data`
  * `separate` — `boolean`, equivalent to passing `-s`/`--separate`
  * `exitCode` — `boolean`; when `true`, includes `exitCode` in the result

#### Returns

* `Promise<string>` — output (default, when neither `exitCode` nor `returnFs` is set)
* `Promise<{ output: string, exitCode?: number, fs?: object | null }>` — when `exitCode` and/or `returnFs` is `true`; only the requested fields are present

#### Errors

Throws an `Error` (with a `.code` matching GNU sed's exit codes) for:

* Script syntax errors
* Missing files (filesystem lookup failures)
* Runaway scripts (step/output-size safety limits, to guard against infinite loops)

---

## 💡 Use Cases

* Browser-based CLI emulators
* Online code editors
* Teaching tools for `sed`
* Sandboxed environments
* Testing text transformations

---

## 📝 License

MIT (or your preferred license)

* docs for each command
* or a demo playground UI
