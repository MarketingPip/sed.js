function tr(argvOrString, input = "") {
  let argv;
  if (typeof argvOrString === 'string') {
    argv = argvOrString.split(/\s+/).filter(s => s !== '');
  } else if (Array.isArray(argvOrString)) {
    argv = [...argvOrString]; // Make a mutable copy
  } else {
    throw new Error('Invalid argvOrString. Must be a string or array.');
  }

  const CHAR_CLASSES = {
    'alnum': '0-9A-Za-z',
    'alpha': 'A-Za-z',
    'blank': '\t ',
    'cntrl': '\x00-\x1f\x7f',
    'digit': '0-9',
    'graph': '\x21-\x7e', // Printable characters, not including space
    'lower': 'a-z',
    'print': '\x20-\x7e', // Printable characters, including space
    'punct': '!-/:-@\\[-`{-~', // Covers 33-47, 58-64, 91-96, 123-126
    'space': '\t\n\v\f\r ',
    'upper': 'A-Z',
    'xdigit': '0-9A-Fa-f',
  };

  function expandRange(startChar, endChar) {
    const startCode = startChar.charCodeAt(0);
    const endCode = endChar.charCodeAt(0);

    if (startCode > endCode) {
      throw new Error(`Invalid range: ${startChar}-${endChar} (start char code ${startCode} is greater than end char code ${endCode})`);
    }

    const result = [];
    for (let i = startCode; i <= endCode; i++) {
      result.push(i);
    }
    return result;
  }

  // Parses escape sequences like \n, \t, \\, \NNN (octal), or literal chars.
  // Returns { value: byteCode, length: consumedChars }
  function parseEscapeSequence(str, pos) {
    const char = str[pos];
    
    // Standard single-character escapes
    switch (char) {
      case 'n': return { value: 0x0A, length: 1 };
      case 't': return { value: 0x09, length: 1 };
      case 'r': return { value: 0x0D, length: 1 };
      case 'b': return { value: 0x08, length: 1 }; // Backspace
      case 'f': return { value: 0x0C, length: 1 }; // Form feed
      case 'v': return { value: 0x0B, length: 1 }; // Vertical tab
      case '\\': return { value: 0x5C, length: 1 }; // Backslash literal
    }

    // Octal escape \NNN (1 to 3 digits)
    if (char >= '0' && char <= '7') {
      let octalValue = 0;
      let len = 0;
      for (let k = 0; k < 3 && (pos + k) < str.length; k++) {
        const digit = str[pos + k];
        if (digit >= '0' && digit <= '7') {
          octalValue = (octalValue * 8) + parseInt(digit, 10);
          len++;
        } else {
          // A non-octal digit terminated the sequence. E.g. \109 -> '9' is not octal.
          throw new Error(`Invalid octal digit '${digit}' in escape sequence at index ${pos + k}.`);
        }
      }
      if (len === 0) { // Should not happen if `char` was '0'-'7' and loop started.
        throw new Error(`Malformed octal escape sequence at index ${pos}`);
      }
      if (octalValue > 255) {
        throw new Error(`Octal value \\${octalValue.toString(8)} (${octalValue}) exceeds 255 at index ${pos}.`);
      }
      return { value: octalValue, length: len };
    }

    // Literal character after backslash (e.g., \x, \8, \9)
    return { value: char.charCodeAt(0), length: 1 };
  }

  // Expands a character set string into an array of unique byte codes (0-255).
  // `isSet2` affects how repeat syntax `[CHAR*]` is handled for infinite repetition.
  // Returns { bytes: number[], infiniteRepeatChar: number|null, isSingleRange: boolean, rangeStartChar: number, rangeEndChar: number }
  function expandSetInternal(setStr, isSet2 = false) {
    const resultBytes = [];
    const seenBytes = new Set(); // For ensuring uniqueness in the resulting byte array
    let infiniteRepeatChar = null; // Used for SET2's [CHAR*]
    let i = 0;
    let isSingleRange = false;
    let rangeStartChar = -1;
    let rangeEndChar = -1;

    // Helper to add unique bytes to resultBytes and seenBytes
    const addUniqueByte = (byte) => {
      if (!seenBytes.has(byte)) {
        seenBytes.add(byte);
        resultBytes.push(byte);
      }
    };
    const addUniqueBytes = (bytes) => {
        bytes.forEach(addUniqueByte);
    };

    while (i < setStr.length) {
      const char = setStr[i];

      if (char === '\\') {
        i++; // Move past '\'
        if (i >= setStr.length) throw new Error('Unterminated escape sequence.');
        const escapeResult = parseEscapeSequence(setStr, i);
        addUniqueByte(escapeResult.value);
        i += escapeResult.length;
        continue;
      }

      if (char === '[') {
        const closeBracketIndex = setStr.indexOf(']', i);
        if (closeBracketIndex === -1) {
          throw new Error('Unterminated character class, repeat, or equivalence class.');
        }
        const innerContent = setStr.substring(i + 1, closeBracketIndex);

        if (innerContent.startsWith(':') && innerContent.endsWith(':')) {
          const className = innerContent.substring(1, innerContent.length - 1);
          if (!CHAR_CLASSES[className]) {
            throw new Error(`Unknown character class: [:${className}:]`);
          }
          // Expand class string recursively, then add unique bytes to result
          const { bytes: classBytes } = expandSetInternal(CHAR_CLASSES[className]);
          addUniqueBytes(classBytes);
          i = closeBracketIndex + 1;
          continue;
        }

        if (innerContent.includes('*')) {
          const parts = innerContent.split('*');
          if (parts.length !== 2) {
            throw new Error(`Invalid repeat syntax: [${innerContent}]`);
          }
          const charToRepeatStr = parts[0];
          const repeatCountStr = parts[1];

          let charCodeToRepeat;
          if (charToRepeatStr.length === 2 && charToRepeatStr[0] === '\\') { // Single-char escape in repeat, e.g. "\n"
              const escapeResult = parseEscapeSequence(charToRepeatStr, 1);
              // Only allow valid single-byte escape sequences (including octal up to \377)
              if (escapeResult.length > 1 && !(charToRepeatStr[1] >= '0' && charToRepeatStr[1] <= '7' && escapeResult.length <= 3)) { 
                  throw new Error(`Invalid char in repeat syntax: [${charToRepeatStr}*${repeatCountStr}] must be a single character or simple escape.`);
              }
              charCodeToRepeat = escapeResult.value;
          } else if (charToRepeatStr.length === 1) { // Literal char in repeat
              charCodeToRepeat = charToRepeatStr.charCodeAt(0);
          } else {
              throw new Error(`Invalid char in repeat syntax: [${charToRepeatStr}*${repeatCountStr}] must be a single character or simple escape.`);
          }

          if (repeatCountStr === '') { // [CHAR*]
            if (isSet2) { // For SET2, this means infinite repeat
              infiniteRepeatChar = charCodeToRepeat;
            } else { // For SET1, means one instance for length calculation
              addUniqueByte(charCodeToRepeat);
            }
          } else { // [CHAR*NUM]
            const count = parseInt(repeatCountStr, 10);
            if (isNaN(count) || count < 0) {
              throw new Error(`Invalid repeat count in [${innerContent}]`);
            }
            for (let k = 0; k < count; k++) {
              resultBytes.push(charCodeToRepeat); // Repeat count adds to the bytes, duplicates are allowed here for length
              // Note: seenBytes is not updated for these repeats as they impact length, not uniqueness of mapping.
            }
          }
          i = closeBracketIndex + 1;
          continue;
        }

        if (innerContent.startsWith('=') && innerContent.endsWith('=')) {
          const eqChar = innerContent.substring(1, innerContent.length - 1);
          if (eqChar.length !== 1) {
            throw new Error(`Invalid equivalence class: [=${eqChar}=]`);
          }
          addUniqueByte(eqChar.charCodeAt(0));
          i = closeBracketIndex + 1;
          continue;
        }
      }

      if (i + 1 < setStr.length && setStr[i + 1] === '-' && i + 2 < setStr.length) {
        const startChar = char;
        const endChar = setStr[i + 2];
        
        // Ranges only support literal characters, not escapes (e.g. `\n-a` is invalid in GNU tr)
        if (startChar === '\\' || endChar === '\\') {
            throw new Error(`Escape sequences are not permitted as range boundaries: ${setStr.substring(i, i+3)}`);
        }
        
        const expanded = expandRange(startChar, endChar);
        addUniqueBytes(expanded);

        if (resultBytes.length === expanded.length && i === 0 && i + 3 === setStr.length) { // Check if it's the *only* thing in the set string
          isSingleRange = true;
          rangeStartChar = startChar.charCodeAt(0);
          rangeEndChar = endChar.charCodeAt(0);
        }
        i += 3; 
        continue;
      }

      addUniqueByte(char.charCodeAt(0));
      i++;
    }

    return { bytes: resultBytes, infiniteRepeatChar, isSingleRange, rangeStartChar, rangeEndChar };
  }

  // --- Flag Parsing ---
  let hasDelete = false;
  let hasSqueeze = false;
  let hasComplement = false;
  const positionalArgs = [];

  for (const arg of argv) {
    if (arg.startsWith('-')) {
      for (let i = 1; i < arg.length; i++) {
        const option = arg[i];
        if (option === 'd') hasDelete = true;
        else if (option === 's') hasSqueeze = true;
        else if (option === 'c') hasComplement = true;
        else throw new Error(`Invalid option: -${option}`);
      }
    } else {
      positionalArgs.push(arg);
    }
  }

  // --- Positional Argument Assignment (GNU tr compatible, allowing for complex test cases) ---
  let deleteSetString = '';
  let squeezeSetString = '';
  let xlateSet1String = '';
  let xlateSet2String = '';

  const pArgsRaw = [...positionalArgs]; // Work with a mutable copy

  // Error check for empty argument list
  if (pArgsRaw.length === 0) {
    if (hasDelete || hasSqueeze || hasComplement) {
        throw new Error('Missing character set argument(s) for operations.');
    }
    return ""; // `tr()` or `tr("")` with no flags
  }

  let currentPos = 0;

  // Handle delete and squeeze sets first if flags are present
  if (hasDelete) {
      if (currentPos >= pArgsRaw.length) throw new Error('Delete mode requires a set.');
      deleteSetString = pArgsRaw[currentPos++];
  }
  if (hasSqueeze) {
      if (currentPos >= pArgsRaw.length) {
          // If -s without its own explicit set, and -d took one, -s reuses the -d set.
          if (hasDelete && deleteSetString !== '') {
              squeezeSetString = deleteSetString;
          } else {
              throw new Error('Squeeze mode requires a set.');
          }
      } else {
          squeezeSetString = pArgsRaw[currentPos++];
      }
  }

  // Remaining arguments are for translation (SET1 and SET2)
  const remainingForTranslate = pArgsRaw.slice(currentPos);
  if (remainingForTranslate.length > 2) {
      throw new Error('Too many positional arguments for translation after delete/squeeze sets.');
  }
  if (remainingForTranslate.length >= 1) {
      xlateSet1String = remainingForTranslate[0];
  }
  if (remainingForTranslate.length >= 2) {
      xlateSet2String = remainingForTranslate[1];
  }

  // Special case: `tr -c SET1` without SET2 implicitly means `tr -dc SET1`.
  // This takes precedence over translate if SET2 is empty.
  if (hasComplement && !hasDelete && !hasSqueeze && xlateSet1String !== '' && xlateSet2String === '') {
      hasDelete = true; // Act as if -d was passed
      deleteSetString = xlateSet1String; // The delete set is now this xlateSet1String
      xlateSet1String = ''; // Clear for translation, as it's a delete operation now
  }
  
  // Error check for bare translate mode: `tr SET1` (without SET2 and no flags) must throw.
  if (!hasDelete && !hasSqueeze && !hasComplement && xlateSet1String !== '' && xlateSet2String === '') {
      throw new Error('Translate mode requires both SET1 and SET2.');
  }

  // --- Expand Sets and Apply Complement ---
  let { bytes: deleteTargetBytes } = expandSetInternal(deleteSetString);
  let { bytes: squeezeTargetBytes } = expandSetInternal(squeezeSetString);
  let { bytes: translateSet1Expanded, isSingleRange: set1IsSingleRange, rangeStartChar: set1RangeStartChar, rangeEndChar: set1RangeEndChar } = expandSetInternal(xlateSet1String);
  let { bytes: translateSet2Expanded, infiniteRepeatChar: infiniteRepeatCharForTranslate, isSingleRange: set2IsSingleRange, rangeStartChar: set2RangeStartChar, rangeEndChar: set2RangeEndChar } = expandSetInternal(xlateSet2String, true);

  // Apply complement to the relevant sets if `hasComplement` is true.
  if (hasComplement) {
    if (hasDelete) {
        const originalSet = new Set(deleteTargetBytes);
        deleteTargetBytes = Array.from({ length: 256 }, (_, i) => i).filter(i => !originalSet.has(i));
    }
    if (hasSqueeze) {
        const originalSet = new Set(squeezeTargetBytes);
        squeezeTargetBytes = Array.from({ length: 256 }, (_, i) => i).filter(i => !originalSet.has(i));
    }
    // Complement for translation applies to SET1. Only if translation is active.
    const isTranslationActive = xlateSet1String !== '' && (xlateSet2String !== '' || infiniteRepeatCharForTranslate !== null);
    if (isTranslationActive) { // Make sure this is not the `tr -c SET1` -> delete !SET1 case.
      const originalSet = new Set(translateSet1Expanded);
      translateSet1Expanded = Array.from({ length: 256 }, (_, i) => i).filter(i => !originalSet.has(i));
    }
  }

  // --- Initialize Lookup Tables ---
  const xlate = Array.from({ length: 256 }, (_, i) => i); // Identity mapping
  const deleteTable = Array(256).fill(false);
  const squeezeTable = Array(256).fill(false);

  // Populate deleteTable
  if (hasDelete) {
    new Set(deleteTargetBytes).forEach(byte => {
      deleteTable[byte] = true;
    });
  }

  // Populate squeezeTable
  if (hasSqueeze) {
    new Set(squeezeTargetBytes).forEach(byte => {
      squeezeTable[byte] = true;
    });
  }
  
  // Populate xlate table
  const isTranslationOperation = xlateSet1String !== '' && (xlateSet2String !== '' || infiniteRepeatCharForTranslate !== null);

  if (isTranslationOperation) {
    for (let i = 0; i < translateSet1Expanded.length; i++) {
      const fromChar = translateSet1Expanded[i];
      let toChar;

      if (i < translateSet2Expanded.length) {
        toChar = translateSet2Expanded[i];
      } else if (infiniteRepeatCharForTranslate !== null) {
        toChar = infiniteRepeatCharForTranslate;
      } else if (set1IsSingleRange && set2IsSingleRange && 
                 (set1RangeEndChar - set1RangeStartChar + 1) > (set2RangeEndChar - set2RangeStartChar + 1)) {
          // Special case for SET1 and SET2 both being simple ranges (e.g. a-c to x-y), and SET2 is shorter.
          // Extend SET2 by continuing its sequence (e.g. x-y becomes x-z for a-c)
          const offsetInSet1 = fromChar - set1RangeStartChar;
          toChar = set2RangeStartChar + offsetInSet1;
          // Ensure it doesn't go beyond 255.
          if (toChar > 255) toChar = set2RangeEndChar; // Fallback to last char if extension exceeds 255
      }
      else if (translateSet2Expanded.length > 0) {
        // General SET2 padding rule: repeat last char
        toChar = translateSet2Expanded[translateSet2Expanded.length - 1];
      } else {
        // SET1 char has no mapping and no padding rule applies for translate. Mark for deletion.
        deleteTable[fromChar] = true; 
        continue;
      }
      xlate[fromChar] = toChar;
    }
  }

  // --- Process Input ---
  let inputBytes;
  if (input instanceof Uint8Array) {
    inputBytes = input;
  } else if (typeof input === 'string') {
    inputBytes = new TextEncoder().encode(input);
  } else {
    inputBytes = new Uint8Array(0);
  }

  const outputBytes = [];
  let lastSqueezedOutputByte = -1; // Tracks the last *output* byte that was part of a squeeze-eligible run.

  for (let i = 0; i < inputBytes.length; i++) {
    const currentByte = inputBytes[i];

    // Step 1: Delete (applies to original input byte)
    if (deleteTable[currentByte]) {
      continue; // Skip this byte entirely
    }

    // Step 2: Translate (applies to non-deleted input byte)
    const translatedByte = xlate[currentByte];

    // Step 3: Squeeze (applies to translated byte)
    let skipDueToSqueeze = false;
    if (hasSqueeze) {
        if (squeezeTable[translatedByte]) { // Current char is eligible for squeezing
            if (translatedByte === lastSqueezedOutputByte) { // And it's a repeat of the last eligible one
                skipDueToSqueeze = true;
            }
            lastSqueezedOutputByte = translatedByte; // If not skipped, this becomes the new lastSqueezedOutputByte
        } else {
            // Current char is not in the squeeze set. It breaks any active squeeze sequence.
            lastSqueezedOutputByte = -1; // Reset to indicate no active squeeze sequence of an eligible char
        }
    }
    
    if (skipDueToSqueeze) {
        continue;
    }

    outputBytes.push(translatedByte);
  }

  return new TextDecoder().decode(new Uint8Array(outputBytes));
}


import tr from "./tr";

describe("tr() core functionality", () => {

  // -------------------------
  // 1. BASIC TRANSLATION
  // -------------------------
  test("translate simple range", () => {
    expect(tr(["a-c", "x-z"], "abc")).toBe("xyz");
  });

  test("translate with extra chars untouched", () => {
    expect(tr(["a-c", "x-z"], "abcde")).toBe("xyzde");
  });

  test("translate single char", () => {
    expect(tr(["a", "b"], "a")).toBe("b");
  });

  test("translate multiple occurrences", () => {
    expect(tr(["a", "b"], "banana")).toBe("bbnbnb");
  });

  test("translate identity", () => {
    expect(tr(["a", "a"], "aaa")).toBe("aaa");
  });

  // -------------------------
  // 2. RANGE + PADDING
  // -------------------------
  test("set2 padding repeats last char", () => {
    expect(tr(["a-c", "X"], "abc")).toBe("XXX");
  });

  test("range extension behavior", () => {
    expect(tr(["a-c", "x-y"], "abc")).toBe("xyz");
  });

  test("longer set1 than set2", () => {
    expect(tr(["a-e", "12"], "abcde")).toBe("12222");
  });

  // -------------------------
  // 3. DELETE MODE
  // -------------------------
  test("delete single char", () => {
    expect(tr(["-d", "a"], "banana")).toBe("bnn");
  });

  test("delete range", () => {
    expect(tr(["-d", "a-c"], "abcdef")).toBe("def");
  });

  test("delete nothing if not present", () => {
    expect(tr(["-d", "x"], "abc")).toBe("abc");
  });

  test("delete all characters", () => {
    expect(tr(["-d", "a-z"], "abc")).toBe("");
  });

  // -------------------------
  // 4. SQUEEZE MODE
  // -------------------------
  test("squeeze repeated chars", () => {
    expect(tr(["-s", "a"], "aaabaaa")).toBe("aba");
  });

  test("squeeze different char unaffected", () => {
    expect(tr(["-s", "a"], "bbb")).toBe("bbb");
  });

  test("squeeze multiple runs", () => {
    expect(tr(["-s", "a"], "aaabaa")).toBe("aba");
  });

  test("squeeze mixed chars", () => {
    expect(tr(["-s", "ab"], "aaabbb")).toBe("ab");
  });

  // -------------------------
  // 5. DELETE + SQUEEZE
  // -------------------------
  test("delete then squeeze", () => {
    expect(tr(["-ds", "ab"], "aaabbbccc")).toBe("ccc");
  });

  test("delete before squeeze order", () => {
    expect(tr(["-ds", "a"], "aaabaaa")).toBe("b");
  });

  test("squeeze uses delete set if omitted", () => {
    expect(tr(["-ds", "a"], "aaabaaa")).toBe("b");
  });

  // -------------------------
  // 6. COMPLEMENT
  // -------------------------
  test("complement basic", () => {
    expect(tr(["-c", "a"], "abc")).toBe("aaa");
  });

  test("complement delete", () => {
    expect(tr(["-cd", "a"], "abc")).toBe("a");
  });

  test("complement squeeze", () => {
    expect(tr(["-cs", "a"], "bbbccc")).toBe("b");
  });

  test("complement full set", () => {
    expect(tr(["-c", "a-z"], "ABC")).toBe("aaa");
  });

  // -------------------------
  // 7. CHARACTER CLASSES
  // -------------------------
  test("lower to upper", () => {
    expect(tr(["[:lower:]", "[:upper:]"], "hello")).toBe("HELLO");
  });

  test("delete digits", () => {
    expect(tr(["-d", "[:digit:]"], "a1b2c3")).toBe("abc");
  });

  test("space class", () => {
    expect(tr(["-d", "[:space:]"], "a b\tc\n")).toBe("abc");
  });

  test("punct class", () => {
    expect(tr(["-d", "[:punct:]"], "a!b@c")).toBe("abc");
  });

  // -------------------------
  // 8. ESCAPE SEQUENCES
  // -------------------------
  test("tab escape", () => {
    expect(tr(["\\t", "_"], "a\tb")).toBe("a_b");
  });

  test("newline escape", () => {
    expect(tr(["\\n", "_"], "a\nb")).toBe("a_b");
  });

  test("backslash escape", () => {
    expect(tr(["\\\\", "_"], "a\\b")).toBe("a_b");
  });

  test("octal escape", () => {
    expect(tr(["\\141", "x"], "a")).toBe("x");
  });

  // -------------------------
  // 9. REPEAT SYNTAX
  // -------------------------
  test("repeat fixed count", () => {
    expect(tr(["a", "[b*3]"], "aaaa")).toBe("bbbb");
  });

  test("repeat infinite (set2)", () => {
    expect(tr(["a", "[b*]"], "aaaa")).toBe("bbbb");
  });

  test("repeat with escape char", () => {
    expect(tr(["a", "[\\n*2]"], "aa")).toBe("\n\n");
  });

  // -------------------------
  // 10. EQUIVALENCE CLASS
  // -------------------------
  test("equivalence class literal", () => {
    expect(tr(["[=a=]", "b"], "a")).toBe("b");
  });

  // -------------------------
  // 11. STRING ARG PARSING
  // -------------------------
  test("string argv form", () => {
    expect(tr("-s a", "aaab")).toBe("ab");
  });

  test("string with multiple args", () => {
    expect(tr("-d a", "banana")).toBe("bnn");
  });

  // -------------------------
  // 12. EDGE CASES
  // -------------------------
  test("empty input", () => {
    expect(tr(["a", "b"], "")).toBe("");
  });

  test("empty sets", () => {
    expect(() => tr(["-d"], "abc")).toThrow();
  });

  test("invalid range", () => {
    expect(() => tr(["z-a", "x"], "abc")).toThrow();
  });

  test("invalid class", () => {
    expect(() => tr(["[:fake:]"], "abc")).toThrow();
  });

  test("invalid repeat syntax", () => {
    expect(() => tr(["a", "[b**]"], "aaa")).toThrow();
  });

  test("missing SET2", () => {
    expect(() => tr(["a"], "abc")).toThrow();
  });

  test("too many args", () => {
    expect(() => tr(["a", "b", "c"], "abc")).toThrow();
  });

  // -------------------------
  // 13. UINT8ARRAY SUPPORT
  // -------------------------
  test("Uint8Array input", () => {
    const input = new TextEncoder().encode("abc");
    const result = tr(["a", "x"], input);
    expect(result).toBe("xbc");
  });

  // -------------------------
  // 14. ORDER OF OPERATIONS
  // -------------------------
  test("delete before translate", () => {
    expect(tr(["-d", "a", "a", "b"], "a")).toBe("");
  });

  test("translate before squeeze", () => {
    expect(tr(["-s", "b", "a", "b"], "aa")).toBe("b");
  });

  // -------------------------
  // 15. STRESS TEST
  // -------------------------
  test("large input deterministic", () => {
    const input = "a".repeat(100000);
    const out1 = tr(["a", "b"], input);
    const out2 = tr(["a", "b"], input);
    expect(out1).toBe(out2);
  });

});
