import memfs from "https://esm.sh/memfs";
const { fs } = memfs;

import sed from "https://esm.sh/gh/MarketingPip/sed.js/";

// Create the file in the in-memory filesystem
fs.writeFileSync("/notes.txt", "foo\nhello foo\n", "utf8");

// Edit it in place
await sed("-i s/foo/bar/g /notes.txt", { fs });

// Read the result
console.log(fs.readFileSync("/notes.txt", "utf8"));
