import memfs from 'https://esm.sh/memfs';
const { vol, Volume } = memfs;
 
// --- Configuration ---
const LIMIT_GB = 50;
const GB_TO_BYTES = 1024 ** 3;
const LIMIT_BYTES = LIMIT_GB * GB_TO_BYTES;

// We'll use a WeakMap to track "virtual" sizes of files 
// so we don't have to pollute the actual file content string.
const virtualSizes = new Map();

/**
 * Calculates current total size, accounting for virtual hacks
 */
const getFsSize = () => {
  const json = vol.toJSON();
  return Object.entries(json).reduce((acc, [path, content]) => {
    // Priority 1: Check if we have a virtual size tracked for this path
    if (virtualSizes.has(path)) return acc + virtualSizes.get(path);
    
    // Priority 2: Standard size calculation
    if (typeof content === 'string') return acc + content.length;
    if (content instanceof Uint8Array) return acc + content.byteLength;
    return acc;
  }, 0);
};

// --- Monkey Patching ---

const originalWriteFileSync = Volume.prototype.writeFileSync;

Volume.prototype.writeFileSync = function (path, data, options) {
  let incomingSize;
  let actualData = data;

  // Handle the Virtual Size Object { __bytes: number }
  if (data && typeof data === 'object' && typeof data.__bytes === 'number') {
    incomingSize = data.__bytes;
    actualData = `[Virtual File: ${incomingSize} bytes]`; // Tiny placeholder
    virtualSizes.set(path, incomingSize); 
  } else {
    incomingSize = typeof data === 'string' ? data.length : (data.byteLength || 0);
    virtualSizes.delete(path); // If overwritten with real data, remove virtual tracking
  }

  // Calculate Net Change
  let existingSize = 0;
  try {
    const stats = this.statSync(path);
    existingSize = virtualSizes.get(path) || stats.size;
  } catch {}

  const currentTotal = getFsSize();

  if (currentTotal - existingSize + incomingSize > LIMIT_BYTES) {
    const err = new Error(`ENOSPC: no space left on device, limit ${LIMIT_GB}GB reached`);
    err.code = 'ENOSPC';
    throw err;
  }

  return originalWriteFileSync.apply(this, [path, actualData, options]);
};

/**
 * The 'df' implementation wired to the patched volume
 */
function displayDf(driveName) {
  const usedBytes = getFsSize();
  const availBytes = Math.max(0, LIMIT_BYTES - usedBytes);
  const usePercentage = ((usedBytes / LIMIT_BYTES) * 100).toFixed(1);

  const toGb = (bytes) => (bytes / GB_TO_BYTES).toFixed(1) + 'G';

  console.log('Filesystem      Size    Used    Avail   Use%  Mounted on');
  console.log(
    `${driveName.padEnd(15)} ` +
    `${(LIMIT_GB + 'G').padEnd(7)} ` +
    `${toGb(usedBytes).padEnd(7)} ` +
    `${toGb(availBytes).padEnd(7)} ` +
    `${usePercentage}%`.padEnd(5) +
    ' /'
  );
}

// --- Execution ---

try {
  
  // Create the directory structure first
  vol.mkdirSync('/etc', { recursive: true });
  vol.mkdirSync('/home/user', { recursive: true });
  
  // 1. Write a real small file
  vol.writeFileSync('/etc/motd', 'Welcome to the patched shell!');

  // 2. Write a "Fake" 30GB file (uses almost zero RAM)
  vol.writeFileSync('/home/user/big_disk_image.iso', { __bytes: 30 * GB_TO_BYTES });

  console.log('Initial State:');
  displayDf('/dev/memfs');

  // 3. Try to write something that exceeds the remaining 20GB
  console.log('\nAttempting to write another 21GB...');
  vol.writeFileSync('/overflow.bin', { __bytes: 21 * GB_TO_BYTES });

} catch (e) {
  console.error('\nSystem Error:', e.message);
}

// Show final state after catch
console.log('\nFinal State:');
displayDf('/dev/memf');

/*
import memfs from 'https://esm.sh/memfs';

const { vol } = memfs;

// 1. Setup: Create a virtual filesystem structure
const mockFiles = {
  '/etc/config.json': JSON.stringify({ theme: 'dark' }),
  '/var/log/system.log': 'A'.repeat(1024 * 1024 * 5), // 5MB log file
  '/home/user/photo.jpg': 'B'.repeat(1024 * 1024 * 25), // 25MB "image"
};

vol.fromJSON(mockFiles);

 **
 * Simulates the 'df' command
 * @param {string} driveName - The display name of the drive
 * @param {number} totalGb - The virtual total size in GB
 *
function displayDf(driveName, totalGb) {
  // Constants for calculation
  const GB_TO_BYTES = 1024 ** 3;
  const totalBytes = totalGb * GB_TO_BYTES;

  // Calculate used space by traversing the volume
  const usedBytes = calculateUsedSpace(vol.toJSON());
  const availBytes = totalBytes - usedBytes;
  const usePercentage = Math.round((usedBytes / totalBytes) * 100);

  // Formatting helper (to match your requested output)
  const toGb = (bytes) => (bytes / GB_TO_BYTES).toFixed(0) + 'G';

  console.log('Filesystem      Size  Used  Avail  Use%  Mounted on');
  console.log(
    `${driveName.padEnd(15)} ` +
    `${toGb(totalBytes).padEnd(5)} ` +
    `${toGb(usedBytes).padEnd(5)} ` +
    `${toGb(availBytes).padEnd(6)} ` +
    `${usePercentage}%`.padEnd(5) +
    ' /'
  );
}

// Helper to sum up sizes of all strings in the memfs JSON export
function calculateUsedSpace(jsonStructure) {
  return Object.values(jsonStructure).reduce((acc, content) => {
    return acc + (content ? content.length : 0);
  }, 0);
}

// Run the simulation
displayDf('/dev/memfs', 50);
*/
