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

### Using Files (VFS)

```js
const vfs = {
  "file.txt": "hello\nfoo\n"
};

await sed("s/foo/bar/", {
  vfs,
  stdin: ""
});

console.log(vfs["file.txt"]);
// hello
// bar
```

---

### In-place Editing (`-i`)

```js
await sed("-i s/foo/bar/ file.txt", { vfs });
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
const vfs = { "a.txt": "1\n2\n", "b.txt": "3\n4\n" };
await sed(["-s", "$=", "a.txt", "b.txt"], { vfs });
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

## 🗂 Virtual File System (VFS)

The VFS is a simple object:

```js
const vfs = {
  "file.txt": "content\n"
};
```

Used for:

* Input files
* Output files (`w`, `W`, `-i`)
* Read commands (`r`, `R`)
* Script files (`-f`)

Filenames are looked up as the VFS object's *own* properties, so filenames like `"__proto__"` or `"constructor"` behave like any other filename rather than colliding with `Object.prototype`.

---

## ⚠️ Limitations

* ❌ No real filesystem access (VFS only)
* ⚠️ Shell execution (`e`, `s///e`) is opt-in only — you must supply a `shell` callback; there is no built-in subprocess spawning
* ⚠️ Regex differences vs GNU sed are possible in rare edge cases (JS engine limitations)
* ⚠️ Performance may differ from native sed

---

## 🧪 Advanced Example

```js
const vfs = {
  "input.txt": "apple\nbanana\ncherry\n"
};

const result = await sed(
  "-n /a/ { s/a/A/g; p }",
  { vfs, stdin: vfs["input.txt"] }
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

5. **VFS Integration**

   * Simulates file I/O for input, output, script, and read/write commands

---

## 📄 API

### `sed(commandStr, options)`

#### Parameters

* `commandStr` (`string | string[]`)

  * CLI-style command or argument array (e.g. `"s/a/b/"` or `["-n", "-e", "p"]`)

* `options`

  * `stdin` — string input
  * `vfs` — `{ [filename]: string }`, a plain object used as the virtual filesystem
  * `shell` — `async (command: string) => string`, optional callback enabling the `e` command and `s///e` flag
  * `posix` — `boolean`, equivalent to passing `--posix`
  * `nullData` — `boolean`, equivalent to passing `-z`/`--null-data`
  * `separate` — `boolean`, equivalent to passing `-s`/`--separate`
  * `exitCode` — `boolean`; when `true`, resolves to `{ output, exitCode }` instead of a bare string

#### Returns

* `Promise<string>` — output (default)
* `Promise<{ output: string, exitCode: number }>` — when `options.exitCode` is `true`

#### Errors

Throws an `Error` (with a `.code` matching GNU sed's exit codes) for:

* Script syntax errors
* Missing files (VFS lookup failures)
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
