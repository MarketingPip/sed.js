import sed from './src/index.js'; // Assuming sed.js is the library to use
import * as execa from 'execa';

const myVfs = {
  "notes.txt": "Hello, this is a test file containing the word hello."
};

// Simulating the fake shell with execa and custom command logic
async function fakeShell(cmd) {
  console.log(`Running command: ${cmd}`);
  
  if (cmd === "whoami") {
    return "user";
  } else {
    return "unknown command";
  }
}

// Test function that uses sed.js
async function runSed(command, stdin = null) {
  try {
    let result;
    if (!stdin) {
      result = await sed(command, { vfs: myVfs, shell: fakeShell });
    } else {
      result = await sed(command, { stdin, shell: fakeShell });
    }
    return { success: true, data: result, error: null };
  } catch (err) {
    return { success: false, data: null, error: err.message };
  }
}

export { runSed };

// Example Test Case with Jest
describe('Sed.js Tests', () => {
  it('should replace "hello" with "hi"', async () => {
    const command = 's/hello/hi/ notes.txt';
    const result = await runSed(command);
    
    // Check if "hello" was replaced with "hi"
    expect(result.data).toBe('Hello, this is a test file containing the word hi.');
  });

  it('should handle stdin correctly', async () => {
    const command = 's/test/TEST/';
    const stdin = 'This is a test string.';
    
    const result = await runSed(command, stdin);
    
    expect(result.data).toBe('This is a TEST string.');
  });


 describe('Basic Substitution', () => {
    it('should be case-sensitive by default', async () => {
      const stdin = 'Hello hello HELLO';
      const result = await runSed('s/hello/hi/', stdin);
      // Only the lowercase version should change
      expect(result.data).toBe('Hello hi HELLO');
    });

    it('should only replace the first occurrence per line by default', async () => {
      const stdin = 'apple apple apple';
      const result = await runSed('s/apple/orange/', stdin);
      expect(result.data).toBe('orange apple apple');
    });
  });

  describe('Flags', () => {
    it('should replace all occurrences with the global (g) flag', async () => {
      const stdin = 'apple apple apple';
      const result = await runSed('s/apple/orange/g', stdin);
      expect(result.data).toBe('orange orange orange');
    });

   it('should handle complex multi-stage transformations (case conversion, hold space, and conditional addressing)', async () => {
  // Input: One line with vowels, one line without
      const stdin = `sed is powerful\nxyz`;
    
      /**
       * The Command Explained:
       * 1. -e 's/[a-z]/\U&/g' -> Convert all lowercase to UPPERCASE (GNU extension)
       * 2. -e '/[AEIOU]/ { ... }' -> If the line contains a vowel:
       * h;          -> Copy line to Hold Space
       * s/./*/g;    -> Replace all chars with '*' (the mask)
       * G;          -> Append Hold Space to current line (separated by \n)
       * s/\n/ /;    -> Replace the newline with a space to put them on one line
       */
      const command = "-e 's/[a-z]/\\U&/g' -e '/[AEIOU]/ { h; s/./*/g; G; s/\\n/ /; }'";
      
      const result = await runSed(command, stdin);
    
      // Assertions
      expect(result.success).toBe(true);
      
      // Line 1 should be masked + uppercase because it has vowels
      // Line 2 should ONLY be uppercase because it lacks vowels
      const expectedOutput = `*************** SED IS POWERFUL\nXYZ`;
      expect(result.data).toBe(expectedOutput);
    });

    it('should support combined flags (gI)', async () => {
      const stdin = 'Hello hello HELLO';
      const result = await runSed('s/hello/hi/gI', stdin);
      expect(result.data).toBe('hi hi hi');
    });
  });

  describe('Regex and Special Characters', () => {
    it('should handle basic regex patterns (dot)', async () => {
      const stdin = 'cat cot cut';
      const result = await runSed('s/c.t/dog/g', stdin);
      expect(result.data).toBe('dog dog dog');
    });

    it('should handle start of line (^) and end of line ($) anchors', async () => {
      const stdin = 'test results for test';
      const startRes = await runSed('s/^test/FINAL/', stdin);
      const endRes = await runSed('s/test$/FINAL/', stdin);
      
      expect(startRes.data).toBe('FINAL results for test');
      expect(endRes.data).toBe('test results for FINAL');
    });
  });

  describe('File System Operations (VFS)', () => {
    it('should read from the virtual file system', async () => {
      // notes.txt: "Hello, this is a test file containing the word hello."
      const command = 's/test/demo/ notes.txt';
      const result = await runSed(command);
      expect(result.data).toContain('demo file');
    });

    it('should throw or return error for non-existent files', async () => {
      const command = 's/foo/bar/ ghost.txt';
      const result = await runSed(command);
      expect(result.error).toBe('sed: ghost.txt: No such file or directory');
    });
  });

  describe('Multiple Lines', () => {
    it('should process substitution on every line of a multi-line string', async () => {
      const stdin = "line one\nline two\nline three";
      const result = await runSed('s/line/row/g', stdin);
      expect(result.data).toBe("row one\nrow two\nrow three");
    });
  });
  
});
