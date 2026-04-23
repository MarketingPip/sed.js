# 🧵 Sed.js

A fully-featured, **pure JavaScript implementation of `sed`** (stream editor), designed to run in environments without native shell access. Includes support for a **virtual file system (VFS)**, making it ideal for browsers, sandboxes, and testing environments.

---

## ✨ Features

* ✅ Core `sed` command support (`s`, `p`, `d`, `a`, `i`, `c`, etc.)
* ✅ Addressing (line numbers, `$`, regex, ranges, steps)
* ✅ BRE → ERE regex conversion
* ✅ POSIX character classes (`[:alpha:]`, `[:digit:]`, etc.)
* ✅ Grouped commands `{ ... }`
* ✅ Branching (`b`, `t`, `T`, labels)
* ✅ Hold space operations (`h`, `H`, `g`, `G`, `x`)
* ✅ Transliteration (`y///`)
* ✅ File read/write (`r`, `w`, `R`, `W`) via VFS
* ✅ `-n`, `-i`, `-E/-r`, `-e` CLI flags
* ✅ Multi-line pattern space (`N`, `D`)
* ✅ Virtual file system support
* ❌ No shell execution (`e` command intentionally disabled)

---

## 📦 Installation

Just copy the file into your project:

```js
import sed from "./sed.js";
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

## 🧠 Supported Commands

| Command                 | Description              |
| ----------------------- | ------------------------ |
| `s///`                  | Substitute               |
| `p`, `P`                | Print                    |
| `d`, `D`                | Delete                   |
| `a`, `i`, `c`           | Append / Insert / Change |
| `y///`                  | Transliterate            |
| `h`, `H`, `g`, `G`, `x` | Hold space ops           |
| `n`, `N`                | Next line                |
| `b`, `t`, `T`           | Branching                |
| `{}`                    | Group commands           |
| `=`                     | Print line number        |
| `l`                     | List (escaped output)    |
| `r`, `R`                | Read file                |
| `w`, `W`                | Write file               |
| `q`, `Q`                | Quit                     |

---

## 📍 Addressing

Supports full sed-style addressing:

* Line numbers: `1`, `5`
* Last line: `$`
* Regex: `/pattern/`
* Ranges: `1,5`, `/start/,/end/`
* Step: `1~2` (every 2 lines starting at 1)
* Relative: `+2`

Negation:

```sh
/skip/!p
```

---

## 🔤 Regex Support

* Default: **BRE (Basic Regular Expressions)**
* Optional: **ERE (Extended)** via `-E` or `-r`
* POSIX classes:

  * `[[:digit:]]`
  * `[[:alpha:]]`
  * `[[:space:]]`

Internally converted to JavaScript-compatible regex.

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
* Output files (`w`, `W`)
* Read commands (`r`, `R`)

---

## ⚠️ Limitations

* ❌ No real filesystem access (VFS only)
* ❌ No shell execution (`e` command disabled)
* ⚠️ Regex differences vs GNU sed (JS engine limitations)
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

   * Builds command AST

4. **Executor**

   * Applies commands line-by-line
   * Maintains pattern/hold space

5. **VFS Integration**

   * Simulates file I/O

---

## 📄 API

### `sed(commandStr, options)`

#### Parameters

* `commandStr` (`string | string[]`)

  * CLI-style command or argument array

* `options`

  * `stdin`: string input
  * `vfs`: `{ [filename]: string }`

#### Returns

* `Promise<string>` → output

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
