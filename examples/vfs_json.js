import sed from "https://esm.sh/gh/MarketingPip/sed.js/";

const fs = {"/notes.txt": "foo\nhello foo\n"}

// Edit it in place
await sed("-i s/foo/bar/g /notes.txt", { fs });

// Read the result
console.log(fs);
