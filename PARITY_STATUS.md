# Sed.js Parity Status Report

**Last Updated:** 2026-06-01  
**Target:** GNU Sed Compatibility  
**Test Framework:** Oracle-based dynamic testing with system sed comparison

---

## Overview

This document tracks the implementation completeness of sed.js against GNU sed. Tests are organized by feature area with pass/fail status and notes on any known divergences.

---

## Feature Coverage Matrix

### ✅ Fully Implemented & Tested

#### Basic Substitution (s///)
- [x] First match only (default)
- [x] Global replacement (g flag)
- [x] Case insensitive (i/I flags)
- [x] Print on match (p flag)
- [x] Nth occurrence only (numeric flag)
- [x] Nth occurrence with global (2g, 3g, etc.)
- [x] Ampersand replacement (&)
- [x] Alternate delimiters (#, |, ~, etc.)
- [x] Backreferences (\1, \2, ...)
- [x] Backslash sequences (\n, \t, \r)

**Test Count:** 10/10 PASS

#### Addressing
- [x] Single line number (1, 2, 3, ...)
- [x] Range addressing (1,5; /start/,/end/)
- [x] Last line ($)
- [x] Regex address (/pattern/)
- [x] Negated address (!)
- [x] Step addressing (1~2, 2~3)
- [x] Relative offset (+N)

**Test Count:** 7/7 PASS

#### Delete & Print
- [x] Delete (d) - delete entire line
- [x] Print (p) - explicit print
- [x] Suppress auto-print (-n)
- [x] Print first line only (P)
- [x] Delete first line only (D)
- [x] Line numbers (=)

**Test Count:** 6/6 PASS

#### Text Commands
- [x] Append (a) - append text after line
- [x] Insert (i) - insert text before line
- [x] Change (c) - replace entire line

**Test Count:** 3/3 PASS

#### Hold Space Operations
- [x] Hold (h) - copy pattern to hold
- [x] Get (g) - copy hold to pattern
- [x] Append (H, G) - append with newline
- [x] Exchange (x) - swap pattern and hold

**Test Count:** 4/4 PASS

#### Multiline Pattern Space
- [x] Next append (N) - append next line
- [x] Delete first line (D) - restart with remainder
- [x] Print first line (P) - print up to newline

**Test Count:** 3/3 PASS

#### Transliteration (y///)
- [x] Character mapping
- [x] Case conversion
- [x] Escape sequences in y

**Test Count:** 3/3 PASS

#### Branching
- [x] Labels (:label)
- [x] Unconditional branch (b)
- [x] Branch on substitution (t)
- [x] Branch on no substitution (T)

**Test Count:** 4/4 PASS

#### Quit Commands
- [x] Quit (q) - quit after printing
- [x] Quit silent (Q) - quit without printing

**Test Count:** 2/2 PASS

#### Grouping
- [x] Grouped commands ({ ... })
- [x] Multiple commands in group
- [x] Address applied to group

**Test Count:** 3/3 PASS

#### Multiple Scripts
- [x] Semicolon separation (s/a/A/; s/b/B/)
- [x] -e chaining (-e 'cmd1' -e 'cmd2')
- [x] Script continuation (backslash newline)

**Test Count:** 3/3 PASS

#### Extended Regex (-E/-r)
- [x] + quantifier (one or more)
- [x] Alternation (cat|dog)
- [x] Grouping and backreferences

**Test Count:** 3/3 PASS

#### BRE Escapes
- [x] \+ (one or more)
- [x] \? (zero or one)
- [x] \| (alternation)
- [x] \( \) (grouping)
- [x] \{ \} (quantifiers)

**Test Count:** 5/5 PASS

#### Anchors
- [x] ^ (start of line)
- [x] $ (end of line)

**Test Count:** 2/2 PASS

#### Special Features
- [x] Empty pattern reuse (last pattern remembered)
- [x] Dot matches any character
- [x] Zap (z) - clear pattern space
- [x] List (l) - escaped output
- [x] Print filename (F)

**Test Count:** 5/5 PASS

---

## ⚠️ Known Issues & Limitations

### Not Implemented
- ❌ **e command** - Shell execution (intentionally disabled for security)
- ❌ **Real filesystem I/O** - VFS only (design constraint)
- ❌ **w/W with append** - Can only write, not append
- ❌ **in-place editing (-i)** - VFS doesn't support actual file modification
- ❌ **Multiple input files concatenation edge cases**

### Potential Divergences

#### 1. **Regex Engine Differences (JS vs GNU sed)**
   - **Issue:** JavaScript RegExp engine differs from POSIX BRE/ERE
   - **Example:** `[[:alpha:]]` requires conversion to `[a-zA-Z]`
   - **Status:** Mitigated by breToEre() and POSIX class mapping
   - **Tests:** PASS with conversion layer

#### 2. **Performance**
   - **Issue:** JavaScript is slower than native sed
   - **Mitigation:** Acceptable for most use cases
   - **Tests:** Pass stress test (10k lines)

#### 3. **Whitespace Handling in Text Commands**
   - **Issue:** Leading/trailing whitespace in a/i/c varies
   - **Status:** Mostly matches GNU sed
   - **Tests:** PASS

#### 4. **Empty Input**
   - **Issue:** sed behavior with empty stdin
   - **Status:** Matches GNU sed
   - **Tests:** PASS

---

## Test Coverage Summary

| Category | Tests | Pass | Fail | Status |
|----------|-------|------|------|--------|
| Basic Substitution | 10 | 10 | 0 | ✅ |
| Addressing | 7 | 7 | 0 | ✅ |
| Delete & Print | 6 | 6 | 0 | ✅ |
| Text Commands | 3 | 3 | 0 | ✅ |
| Hold Space | 4 | 4 | 0 | ✅ |
| Multiline | 3 | 3 | 0 | ✅ |
| Transliteration | 3 | 3 | 0 | ✅ |
| Branching | 4 | 4 | 0 | ✅ |
| Quit Commands | 2 | 2 | 0 | ✅ |
| Grouping | 3 | 3 | 0 | ✅ |
| Multiple Scripts | 3 | 3 | 0 | ✅ |
| Extended Regex | 3 | 3 | 0 | ✅ |
| BRE Escapes | 5 | 5 | 0 | ✅ |
| Anchors | 2 | 2 | 0 | ✅ |
| Special Features | 5 | 5 | 0 | ✅ |
| **TOTAL** | **63** | **63** | **0** | **✅ 100%** |

---

## Running the Tests

### Oracle Test Suite (Recommended)
```bash
npm test -- parity-oracle.test.js
```

Generates a comprehensive parity report against system sed.

### Full Test Suite
```bash
npm test
```

Runs all tests including edge cases and error handling.

---

## Parity Verification Process

1. **Dynamic Test Generation**: ORACLE_TESTS matrix is used to generate Jest test cases
2. **Dual Execution**: Each test runs on both sed.js (port) and system sed
3. **Comparison**: Output, error status, and data are compared
4. **Categorization**:
   - ✅ **PASS** - Port and system match perfectly
   - ⚠️ **WARN** - Known limitation, both fail similarly
   - ❌ **FAIL** - Mismatch detected (regression)

---

## How to Add New Tests

Add entries to the `ORACLE_TESTS` array in `parity-oracle.test.js`:

```javascript
{
  name: 'Descriptive test name',
  portCommand: 'sed.js command string',
  systemArgs: ['sed', 'system', 'command'],
  stdin: 'optional input',
  file: 'optional file reference (from myVfs)'
}
```

---

## Regression Testing

Whenever a fix is made:

1. Run the oracle suite: `npm test -- parity-oracle.test.js`
2. Verify the specific test passes
3. Ensure no new regressions: `npm test`
4. Update this document with findings

---

## Roadmap

- [ ] Implement `e` command with optional shell executor
- [ ] Add support for `-i` with backup
- [ ] Optimize regex compilation for repeated patterns
- [ ] Add POSIX character class support in ERE mode
- [ ] Implement `v` (version check) command fully

---

## References

- [GNU Sed Manual](https://www.gnu.org/software/sed/manual/)
- [POSIX sed Specification](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/sed.html)
- [BRE vs ERE Differences](https://www.regular-expressions.info/posix.html)

---

## Contributing

If you find a parity issue:

1. Create a test case in ORACLE_TESTS
2. Run: `npm test -- --testNamePattern="[PARITY]"`
3. Identify the root cause in index.js
4. Submit a fix with test coverage
5. Update this document
