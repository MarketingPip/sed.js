import { sed } from './src/index.js'; // Assuming sed.js is the library to use
import execa from 'execa';

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
async function runSed(command, stdin = '') {
  try {
    let result;
    if (!stdin) {
      result = await sed(command, { vfs: myVfs, shell: fakeShell });
    } else {
      result = await sed(command, { stdin, shell: fakeShell });
    }
    console.log('Result:', result);
    return result;
  } catch (err) {
    console.error('Error:', err.message);
  }
}

export { runSed };

// Example Test Case with Jest
describe('Sed.js Tests', () => {
  it('should replace "hello" with "hi"', async () => {
    const command = 's/hello/hi/ notes.txt';
    const result = await runSed(command);
    
    // Check if "hello" was replaced with "hi"
    expect(result).toBe('Hi, this is a test file containing the word hi.');
  });

  it('should handle stdin correctly', async () => {
    const command = 's/test/TEST/';
    const stdin = 'This is a test string.';
    
    const result = await runSed(command, stdin);
    
    expect(result).toBe('This is a TEST string.');
  });
});
