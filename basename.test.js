import { spawnSync } from 'child_process';
/**
 * JavaScript implementation of the basename utility
 */
export function basename(args) {
  let paths = [];
  let suffix = null;
  let multipleMode = false;

  // 1. Argument Parsing
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-a" || arg === "--multiple") {
      multipleMode = true;
    } else if (arg === "-s" || arg === "--suffix") {
      suffix = args[++i];
      multipleMode = true;
    } else if (arg.startsWith("-s=")) {
      suffix = arg.split("=")[1];
      multipleMode = true;
    } else {
      paths.push(arg);
    }
  }

  // Classic mode: basename PATH [SUFFIX]
  if (!multipleMode && paths.length > 1) {
    suffix = paths[1];
    paths = [paths[0]];
  }

  const processPath = (p) => {
    if (p === "" || p === undefined) return "";
    
    // Remove trailing slashes (POSIX)
    let result = p.replace(/\/+$/, "");
    
    // Handle root "/"
    if (result === "") return "/";

    // Get final component
    const lastSlashIndex = result.lastIndexOf("/");
    if (lastSlashIndex !== -1) {
      result = result.substring(lastSlashIndex + 1);
    }

    // Remove suffix
    if (suffix && result.endsWith(suffix) && result !== suffix) {
      result = result.slice(0, -suffix.length);
    }

    return result;
  };

  return paths.map(processPath).join("\n");
}

describe("basename command - Real Bash Comparison", () => {
  
  /**
   * Helper to run real system basename and compare with our JS version
   */
  const compareWithBash = (cmdArgs) => {
    // 1. Get real bash output
    const bashResult = spawnSync('basename', cmdArgs, { encoding: 'utf8' });
    const expected = bashResult.stdout.trimEnd();

    // 2. Get our JS output
    const actual = basename(cmdArgs);

    // 3. Compare
    expect(actual).toBe(expected);
  };

  describe("basic usage", () => {
    it("should extract basename from absolute path", () => {
      compareWithBash(["/usr/bin/sort"]);
    });

    it("should extract basename from relative path", () => {
      compareWithBash(["./path/to/file.txt"]);
    });

    it("should handle filename without directory", () => {
      compareWithBash(["file.txt"]);
    });

    it("should handle path ending with slash", () => {
      compareWithBash(["/path/to/dir/"]);
    });
  });

  describe("suffix removal", () => {
    it("should remove suffix when specified", () => {
      compareWithBash(["/path/to/file.txt", ".txt"]);
    });

    it("should not remove suffix if not matching", () => {
      compareWithBash(["/path/to/file.txt", ".md"]);
    });

    it("should handle -s option", () => {
      compareWithBash(["-s", ".txt", "/path/to/file.txt"]);
    });
  });

  describe("multiple files with -a", () => {
    it("should handle multiple paths with -a", () => {
      compareWithBash(["-a", "/path/one.txt", "/path/two.txt"]);
    });

    it("should handle -a with -s", () => {
      compareWithBash(["-a", "-s", ".txt", "/path/one.txt", "/path/two.txt"]);
    });
  });
});
