import sed from './src/index.js';

const makeVfs = () => ({
  "notes.txt": "Hello, this is a test file containing the word hello.",
  "multi.txt": "one\ntwo\nthree\nfour\nfive",
  "empty.txt": "",
  "numbers.txt": "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"
});

async function runSed(command, opts = {}) {
  try {
    const result = await sed(command, opts);
    return { success: true, data: result, error: null };
  } catch (err) {
    return { success: false, data: null, error: err.message };
  }
}

describe('Sed.js (API-CORRECT)', () => {

  /* -----------------------------
   * BASIC SUBSTITUTION
   * ----------------------------- */
  describe('Substitution', () => {
    it('basic replace', async () => {
      const r = await runSed("s/hello/hi/", {
        stdin: "hello hello"
      });
      expect(r.data).toBe("hi hello");
    });

    it('global replace', async () => {
      const r = await runSed("s/hello/hi/g", {
        stdin: "hello hello"
      });
      expect(r.data).toBe("hi hi");
    });

    it('case insensitive', async () => {
      const r = await runSed("s/hello/hi/I", {
        stdin: "Hello hello HELLO"
      });
      expect(r.data).toBe("hi hi hi");
    });

    it('backreferences', async () => {
      const r = await runSed("s/(\\w+) (\\w+)/\\2 \\1/", {
        stdin: "hello world"
      });
      expect(r.data).toBe("world hello");
    });

    it('ampersand', async () => {
      const r = await runSed("s/foo/[&]/g", {
        stdin: "foo foo"
      });
      expect(r.data).toBe("[foo] [foo]");
    });
  });

  /* -----------------------------
   * MULTI SCRIPT
   * ----------------------------- */
  describe('Multiple Scripts', () => {
    it('array -e usage', async () => {
      const r = await runSed(
        ["-e", "s/foo/bar/", "-e", "s/bar/baz/"],
        { stdin: "foo\n" }
      );
      expect(r.data).toBe("baz");
    });

    it('sequential transforms', async () => {
      const r = await runSed(
        ["-e", "s/a/A/g", "-e", "s/b/B/g"],
        { stdin: "abc" }
      );
      expect(r.data).toBe("ABc");
    });
  });

  /* -----------------------------
   * SILENT MODE
   * ----------------------------- */
  describe('-n (silent)', () => {
    it('prints only with p', async () => {
      const r = await runSed(
        "-n s/foo/bar/p",
        { stdin: "foo\nbaz\n" }
      );
      expect(r.data.trim()).toBe("bar");
    });

    it('suppresses output', async () => {
      const r = await runSed("-n", {
        stdin: "hello"
      });
      expect(r.data).toBe("");
    });
  });

  /* -----------------------------
   * VFS (IN-PLACE ONLY)
   * ----------------------------- */
  describe('VFS (-i)', () => {
    it('modifies file in-place', async () => {
      const vfs = makeVfs();

      await runSed(
        ["-i", "s/hello/hi/g", "notes.txt"],
        { vfs }
      );

      expect(vfs["notes.txt"]).toContain("hi");
    });

    it('does not return output when using -i', async () => {
      const vfs = makeVfs();

      const r = await runSed(
        ["-i", "s/foo/bar/", "notes.txt"],
        { vfs }
      );

      expect(r.data === undefined || r.data === "").toBe(true);
    });

    it('handles missing file', async () => {
      const vfs = makeVfs();

      const r = await runSed(
        ["-i", "s/x/y/", "ghost.txt"],
        { vfs }
      );

      expect(r.success).toBe(false);
    });
  });

  /* -----------------------------
   * MULTILINE
   * ----------------------------- */
  describe('Multiline', () => {
    it('applies per line', async () => {
      const r = await runSed("s/line/row/g", {
        stdin: "line one\nline two"
      });

      expect(r.data).toBe("row one\nrow two");
    });

    it('preserves newlines', async () => {
      const r = await runSed("s/a/A/g", {
        stdin: "a\na\na"
      });

      expect(r.data.split("\n").length).toBe(3);
    });
  });

  /* -----------------------------
   * REGEX
   * ----------------------------- */
  describe('Regex', () => {
    it('dot wildcard', async () => {
      const r = await runSed("s/c.t/dog/g", {
        stdin: "cat cot cut"
      });
      expect(r.data).toBe("dog dog dog");
    });

    it('anchors', async () => {
      const start = await runSed("s/^test/OK/", {
        stdin: "test value"
      });

      const end = await runSed("s/value$/OK/", {
        stdin: "test value"
      });

      expect(start.data).toBe("OK value");
      expect(end.data).toBe("test OK");
    });
  });

  /* -----------------------------
   * EDGE CASES
   * ----------------------------- */
  describe('Edge Cases', () => {
    it('empty input', async () => {
      const r = await runSed("s/a/b/", { stdin: "" });
      expect(r.data).toBe("");
    });

    it('no match', async () => {
      const r = await runSed("s/x/y/", { stdin: "abc" });
      expect(r.data).toBe("abc");
    });

    it('large input', async () => {
      const big = "a\n".repeat(5000);

      const r = await runSed("s/a/b/g", {
        stdin: big
      });

      expect(r.data.includes("a")).toBe(false);
    });
  });

  /* -----------------------------
   * REAL WORLD
   * ----------------------------- */
  describe('Real-world', () => {
    it('duplicate lines', async () => {
      const r = await runSed("p", {
        stdin: "x"
      });

      expect(r.data).toBe("x\nx");
    });

    it('simple pipeline transform', async () => {
      const r = await runSed(
        ["-e", "s/foo/bar/", "-e", "s/bar/baz/"],
        { stdin: "foo foo" }
      );

      expect(r.data).toBe("baz foo");
    });
  });

});
