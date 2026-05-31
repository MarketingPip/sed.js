const { execFileSync } = require('child_process');

function tr(argvOrString, input = "") {
  let argv;
  if (typeof argvOrString === 'string') {
    argv = argvOrString.split(/\s+/).filter(s => s !== '');
  } else if (Array.isArray(argvOrString)) {
    argv = [...argvOrString];
  } else {
    throw new Error('Invalid argvOrString. Must be a string or array.');
  }

  const CHAR_CLASSES = {
    'alnum': '0-9A-Za-z',
    'alpha': 'A-Za-z',
    'blank': '\t ',
    'cntrl': '\x00-\x1f\x7f',
    'digit': '0-9',
    'graph': '\x21-\x7e',
    'lower': 'a-z',
    'print': '\x20-\x7e',
    'punct': '!-/:-@\\[-`{-~',
    'space': '\t\n\v\f\r ',
    'upper': 'A-Z',
    'xdigit': '0-9A-Fa-f',
  };

  function expandRange(startChar, endChar) {
    const startCode = startChar.charCodeAt(0);
    const endCode = endChar.charCodeAt(0);
    if (startCode > endCode) {
      throw new Error(`range-endpoints of '${startChar}-${endChar}' are in reverse collating sequence order`);
    }
    const result = [];
    for (let i = startCode; i <= endCode; i++) {
      result.push(i);
    }
    return result;
  }

  function parseEscapeSequence(str, pos) {
    const char = str[pos];
    switch (char) {
      case 'n': return { value: 0x0A, length: 1 };
      case 't': return { value: 0x09, length: 1 };
      case 'r': return { value: 0x0D, length: 1 };
      case 'b': return { value: 0x08, length: 1 };
      case 'f': return { value: 0x0C, length: 1 };
      case 'v': return { value: 0x0B, length: 1 };
      case '\\': return { value: 0x5C, length: 1 };
    }
    if (char >= '0' && char <= '7') {
      let octalValue = 0;
      let len = 0;
      for (let k = 0; k < 3 && (pos + k) < str.length; k++) {
        const digit = str[pos + k];
        if (digit >= '0' && digit <= '7') {
          octalValue = (octalValue * 8) + parseInt(digit, 10);
          len++;
        } else {
          throw new Error(`Invalid octal digit '${digit}' in escape sequence at index ${pos + k}.`);
        }
      }
      if (octalValue > 255) {
        throw new Error(`Octal value \\${octalValue.toString(8)} (${octalValue}) exceeds 255 at index ${pos}.`);
      }
      return { value: octalValue, length: len };
    }
    return { value: char.charCodeAt(0), length: 1 };
  }

  function expandSetInternal(setStr, isSet2 = false, allowDynamicRepeat = false) {
    const segments = [];
    let hasInfiniteRepeat = false;
    let infiniteRepeatChar = null;
    let i = 0;

    while (i < setStr.length) {
      const char = setStr[i];

      if (char === '\\') {
        i++;
        if (i >= setStr.length) throw new Error('Unterminated escape sequence.');
        const escapeResult = parseEscapeSequence(setStr, i);
        segments.push({ type: 'bytes', bytes: [escapeResult.value] });
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
          const classResult = expandSetInternal(CHAR_CLASSES[className]);
          segments.push({ type: 'bytes', bytes: classResult.bytes });
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
          if (charToRepeatStr.length === 2 && charToRepeatStr[0] === '\\') {
            const escapeResult = parseEscapeSequence(charToRepeatStr, 1);
            if (escapeResult.length > 1 && !(charToRepeatStr[1] >= '0' && charToRepeatStr[1] <= '7' && escapeResult.length <= 3)) {
              throw new Error(`Invalid char in repeat syntax: [${charToRepeatStr}*${repeatCountStr}] must be a single character or simple escape.`);
            }
            charCodeToRepeat = escapeResult.value;
          } else if (charToRepeatStr.length === 1) {
            charCodeToRepeat = charToRepeatStr.charCodeAt(0);
          } else {
            throw new Error(`Invalid char in repeat syntax: [${charToRepeatStr}*${repeatCountStr}] must be a single character or simple escape.`);
          }

          if (repeatCountStr === '') {
            if (!isSet2) {
              throw new Error('the [c*] repeat construct may not appear in string1');
            }
            if (!allowDynamicRepeat) {
              throw new Error('the [c*] construct may appear in string2 only when translating');
            }
            if (hasInfiniteRepeat) {
              throw new Error('only one [c*] repeat construct may appear in string2');
            }
            hasInfiniteRepeat = true;
            infiniteRepeatChar = charCodeToRepeat;
            segments.push({ type: 'dynamic', char: charCodeToRepeat });
          } else {
            const count = parseInt(repeatCountStr, 10);
            if (isNaN(count) || count < 0) {
              throw new Error(`Invalid repeat count in [${innerContent}]`);
            }
            if (!isSet2) {
              throw new Error('the [c*] repeat construct may not appear in string1');
            }
            if (count === 0) {
              if (!allowDynamicRepeat) {
                throw new Error('the [c*] construct may appear in string2 only when translating');
              }
              if (hasInfiniteRepeat) {
                throw new Error('only one [c*] repeat construct may appear in string2');
              }
              hasInfiniteRepeat = true;
              infiniteRepeatChar = charCodeToRepeat;
              segments.push({ type: 'dynamic', char: charCodeToRepeat });
            } else {
              const repeatedBytes = [];
              for (let k = 0; k < count; k++) {
                repeatedBytes.push(charCodeToRepeat);
              }
              segments.push({ type: 'bytes', bytes: repeatedBytes });
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
          segments.push({ type: 'bytes', bytes: [eqChar.charCodeAt(0)] });
          i = closeBracketIndex + 1;
          continue;
        }
      }

      if (i + 1 < setStr.length && setStr[i + 1] === '-' && i + 2 < setStr.length) {
        const startChar = char;
        const endChar = setStr[i + 2];
        if (startChar === '\\' || endChar === '\\') {
          throw new Error(`Escape sequences are not permitted as range boundaries: ${setStr.substring(i, i+3)}`);
        }
        const expanded = expandRange(startChar, endChar);
        segments.push({ type: 'bytes', bytes: expanded });
        i += 3;
        continue;
      }

      segments.push({ type: 'bytes', bytes: [char.charCodeAt(0)] });
      i++;
    }

    const resultBytes = [];
    for (const segment of segments) {
      if (segment.type === 'bytes') {
        resultBytes.push(...segment.bytes);
      }
    }

    return { bytes: resultBytes, hasInfiniteRepeat, infiniteRepeatChar, segments };
  }

  let hasDelete = false;
  let hasSqueeze = false;
  let hasComplement = false;
  let hasTruncate = false;
  const positionalArgs = [];

  for (const arg of argv) {
    if (arg.startsWith('-')) {
      for (let i = 1; i < arg.length; i++) {
        const option = arg[i];
        if (option === 'd') hasDelete = true;
        else if (option === 's') hasSqueeze = true;
        else if (option === 'c' || option === 'C') hasComplement = true;
        else if (option === 't') hasTruncate = true;
        else throw new Error(`Invalid option: -${option}`);
      }
    } else {
      positionalArgs.push(arg);
    }
  }

  if (positionalArgs.length === 0) {
    throw new Error('missing operand');
  }

  let set1String = '';
  let set2String = '';

  if (hasDelete && hasSqueeze) {
    if (positionalArgs.length < 1) throw new Error('missing operand');
    set1String = positionalArgs[0];
    if (positionalArgs.length < 2) throw new Error('missing operand');
    set2String = positionalArgs[1];
    if (positionalArgs.length > 2) throw new Error('extra operand');
  } else if (hasDelete) {
    if (positionalArgs.length < 1) throw new Error('missing operand');
    set1String = positionalArgs[0];
    if (positionalArgs.length > 1) throw new Error('extra operand');
  } else if (hasSqueeze) {
    if (positionalArgs.length < 1) throw new Error('missing operand');
    set1String = positionalArgs[0];
    if (positionalArgs.length >= 2) {
      set2String = positionalArgs[1];
    }
    if (positionalArgs.length > 2) throw new Error('extra operand');
  } else {
    if (positionalArgs.length < 1) throw new Error('missing operand');
    set1String = positionalArgs[0];
    if (positionalArgs.length < 2) {
      throw new Error('missing operand');
    }
    set2String = positionalArgs[1];
    if (positionalArgs.length > 2) throw new Error('extra operand');
  }

  const isTranslateActive = set2String !== '' && !hasDelete;

  let { bytes: set1Bytes } = expandSetInternal(set1String);
  let set2Result = expandSetInternal(set2String, true, isTranslateActive);
  let set2Bytes = set2Result.bytes;
  let set2HasInfinite = set2Result.hasInfiniteRepeat;
  let set2Infinite = set2Result.infiniteRepeatChar;
  let set2Segments = set2Result.segments;

  if (hasTruncate && set2Bytes.length > 0 && set1Bytes.length > set2Bytes.length) {
    set1Bytes = set1Bytes.slice(0, set2Bytes.length);
  }

  const allBytes = Array.from({ length: 256 }, (_, i) => i);

  if (hasComplement) {
    const originalSet = new Set(set1Bytes);
    set1Bytes = allBytes.filter(i => !originalSet.has(i));
  }

  if (set2HasInfinite) {
    const explicitChars = set2Bytes.length;
    const expansion = Math.max(0, set1Bytes.length - explicitChars);
    set2Bytes = [];
    for (const segment of set2Segments) {
      if (segment.type === 'bytes') {
        set2Bytes.push(...segment.bytes);
      } else if (segment.type === 'dynamic') {
        for (let k = 0; k < expansion; k++) {
          set2Bytes.push(segment.char);
        }
      }
    }
  }

  const xlate = Array.from({ length: 256 }, (_, i) => i);
  const deleteTable = Array(256).fill(false);
  const squeezeTable = Array(256).fill(false);

  const isDeleteOpActive = hasDelete;
  const isSqueezeOpActive = hasSqueeze;

  if (isDeleteOpActive) {
    new Set(set1Bytes).forEach(byte => deleteTable[byte] = true);
  }

  if (isTranslateActive) {
    const set2Length = set2Bytes.length;
    const set1Length = set1Bytes.length;

    for (let i = 0; i < set1Length; i++) {
      const fromChar = set1Bytes[i];
      let toChar;

      if (i < set2Length) {
        toChar = set2Bytes[i];
      } else if (set2Length > 0) {
        toChar = set2Bytes[set2Length - 1];
      } else {
        deleteTable[fromChar] = true;
        continue;
      }
      xlate[fromChar] = toChar;
    }
  }

  if (isSqueezeOpActive) {
    let squeezeBytes;
    if (hasDelete) {
      squeezeBytes = set2Bytes;
    } else if (isTranslateActive) {
      squeezeBytes = set2Bytes;
    } else {
      squeezeBytes = set1Bytes;
    }
    new Set(squeezeBytes).forEach(byte => squeezeTable[byte] = true);
  }

  let inputBytes;
  if (input instanceof Uint8Array) {
    inputBytes = input;
  } else if (typeof input === 'string') {
    inputBytes = new TextEncoder().encode(input);
  } else {
    inputBytes = new Uint8Array(0);
  }

  const outputBytes = [];
  let lastSqueezedOutputByte = -1;

  for (let i = 0; i < inputBytes.length; i++) {
    const currentByte = inputBytes[i];

    if (deleteTable[currentByte]) {
      continue;
    }

    const translatedByte = xlate[currentByte];

    let skipDueToSqueeze = false;
    if (isSqueezeOpActive) {
      if (squeezeTable[translatedByte]) {
        if (translatedByte === lastSqueezedOutputByte) {
          skipDueToSqueeze = true;
        }
        lastSqueezedOutputByte = translatedByte;
      } else {
        lastSqueezedOutputByte = -1;
      }
    }

    if (skipDueToSqueeze) {
      continue;
    }

    outputBytes.push(translatedByte);
  }

  return new TextDecoder().decode(new Uint8Array(outputBytes));
}

// ============================================================================
// TEST RUNNER - Uses execFileSync for direct argument passing (no shell)
// ============================================================================

function runSystemTr(args, input) {
  try {
    const result = execFileSync('tr', args, { input, encoding: 'utf-8', timeout: 5000 });
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.stderr || e.message };
  }
}

function runJsTr(args, input) {
  try {
    const result = tr(args, input);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function compare(args, input) {
  const sys = runSystemTr(args, input);
  const js = runJsTr(args, input);

  if (!js.success && !sys.success) return 'PASS';
  if (!js.success) return { status: 'JS_ERR', js, sys };
  if (!sys.success) return { status: 'SYS_ERR', js, sys };
  if (js.result !== sys.result) return { status: 'MISMATCH', js, sys };

  return 'PASS';
}

const tests = [
  [['a', 'b'], 'a', 'basic translate'],
  [['a-c', 'x-z'], 'abc', 'range translate'],
  [['a-c', 'x-z'], 'abcde', 'range translate with extra'],
  [['a', 'b'], 'banana', 'multiple occurrences'],
  [['a', 'a'], 'aaa', 'identity'],
  [['a-c', 'X'], 'abc', 'set2 padding'],
  [['a-c', 'x-y'], 'abc', 'range padding'],
  [['a-e', '12'], 'abcde', 'longer set1'],
  [['-d', 'a'], 'banana', 'delete single'],
  [['-d', 'a-c'], 'abcdef', 'delete range'],
  [['-d', 'x'], 'abc', 'delete nothing'],
  [['-d', 'a-z'], 'abc', 'delete all'],
  [['-s', 'a'], 'aaabaaa', 'squeeze repeated'],
  [['-s', 'a'], 'bbb', 'squeeze unaffected'],
  [['-s', 'a'], 'aaabaa', 'squeeze multiple runs'],
  [['-s', 'ab'], 'aaabbb', 'squeeze mixed'],
  [['-s', 'ab'], 'ababab', 'squeeze no consecutive'],
  [['-s', 'ab'], 'aabbbaa', 'squeeze overlapping'],
  [['-s', 'aab'], 'aaabaaa', 'squeeze duplicate set1'],
  [['-s', 'aba'], 'aaabaaa', 'squeeze duplicate set1 b'],
  [['-s', 'aab'], 'bbb', 'squeeze duplicate set1 unaffected'],
  [['-ds', 'ab', 'c'], 'aaabbbccc', 'delete then squeeze'],
  [['-ds', 'a', 'b'], 'aaabaaa', 'delete before squeeze'],
  [['-ds', 'ab', 'c'], 'ccc', 'delete nothing squeeze'],
  [['-c', 'a', 'b'], 'abc', 'complement basic'],
  [['-c', 'a', 'b'], 'aaa', 'complement all same'],
  [['-c', 'a-z', 'A'], 'ABC123', 'complement full set'],
  [['-c', 'a', 'bc'], 'bbb', 'complement with longer set2'],
  [['-c', 'a', 'bc'], 'ccc', 'complement with longer set2 c'],
  [['-c', 'a', 'bc'], 'ddd', 'complement with longer set2 d'],
  [['-c', 'a', 'bc'], 'bbbccc', 'complement with longer set2 mixed'],
  [['-cd', 'a'], 'abc', 'complement delete'],
  [['-cd', 'a'], 'aaa', 'complement delete all same'],
  [['-cd', 'a-z'], 'ABC', 'complement delete full set'],
  [['-cs', 'a'], 'bbbccc', 'complement squeeze'],
  [['-cs', 'a'], 'aaabaaa', 'complement squeeze unaffected'],
  [['-cs', 'a', 'b'], 'bbbccc', 'complement squeeze translate'],
  [['-cs', 'a', 'b'], 'aaabaaa', 'complement squeeze translate mixed'],
  [['-cs', 'a', 'bc'], 'bbb', 'complement squeeze translate longer'],
  [['-cs', 'a', 'bc'], 'ccc', 'complement squeeze translate longer c'],
  [['-cs', 'a', 'bc'], 'aaabccc', 'complement squeeze translate longer mixed'],
  [['-cds', 'a', 'b'], 'aaabaaa', 'cds basic'],
  [['-cds', 'a', 'b'], 'abba', 'cds with b'],
  [['-cds', 'ab', 'c'], 'aaabbbccc', 'cds delete ab'],
  [['-cds', 'ab', 'c'], 'ccc', 'cds delete ab only c'],
  [['-cds', 'a', 'bc'], 'aaabbbccc', 'cds with longer squeeze'],
  [['[:lower:]', '[:upper:]'], 'hello', 'lower to upper'],
  [['-d', '[:digit:]'], 'a1b2c3', 'delete digits'],
  [['-d', '[:space:]'], 'a b\tc\n', 'delete space'],
  [['-d', '[:punct:]'], 'a!b@c', 'delete punct'],
  [['-s', '[:lower:]', '[:upper:]'], 'hello', 'squeeze lower to upper'],
  [['\\t', '_'], 'a\tb', 'tab escape'],
  [['\\n', '_'], 'a\nb', 'newline escape'],
  [['\\\\', '_'], 'a\\b', 'backslash escape'],
  [['\\141', 'x'], 'a', 'octal escape'],
  [['\\0', 'x'], '\x00', 'octal zero'],
  [['\\377', 'x'], '\xff', 'octal 377'],
  [['\\r', 'x'], 'a\rb', 'carriage return escape'],
  [['\\b', 'x'], 'a\bb', 'backspace escape'],
  [['\\f', 'x'], 'a\fb', 'form feed escape'],
  [['\\v', 'x'], 'a\vb', 'vertical tab escape'],
  [['\\7', 'x'], '\x07', 'octal 7'],
  [['\\77', 'x'], '?', 'octal 77'],
  [['a', '[b*3]'], 'aaaa', 'repeat fixed'],
  [['a', '[b*]'], 'aaaa', 'repeat infinite'],
  [['a', '[\\n*2]'], 'aa', 'repeat with escape'],
  [['a', '[x*0]'], 'aaa', 'repeat zero'],
  [['ab', '[x*0]'], 'ab', 'repeat zero set1=2'],
  [['abc', '[x*0]'], 'abc', 'repeat zero set1=3'],
  [['a', '[x*0]y'], 'a', 'repeat zero with suffix'],
  [['ab', '[x*0]y'], 'ab', 'repeat zero with suffix set1=2'],
  [['abc', '[x*0]y'], 'abc', 'repeat zero with suffix set1=3'],
  [['abcd', '[x*0]y'], 'abcd', 'repeat zero with suffix set1=4'],
  [['a', 'y[x*0]'], 'a', 'repeat zero with prefix'],
  [['ab', 'y[x*0]'], 'ab', 'repeat zero with prefix set1=2'],
  [['abc', 'y[x*0]'], 'abc', 'repeat zero with prefix set1=3'],
  [['abc', '[x*1]y'], 'abc', 'repeat one with suffix'],
  [['abc', '[x*2]y'], 'abc', 'repeat two with suffix'],
  [['abc', '[x*]y'], 'abc', 'repeat infinite with suffix'],
  [['abcd', '[x*0]y'], 'abcd', 'repeat zero with suffix set1=4'],
  [['abcd', '[x*1]y'], 'abcd', 'repeat one with suffix set1=4'],
  [['abcd', '[x*2]y'], 'abcd', 'repeat two with suffix set1=4'],
  [['abcd', '[x*]y'], 'abcd', 'repeat infinite with suffix set1=4'],
  [['abc', 'y[x*1]'], 'abc', 'repeat one with prefix'],
  [['abc', 'y[x*2]'], 'abc', 'repeat two with prefix'],
  [['abc', 'y[x*]'], 'abc', 'repeat infinite with prefix'],
  [['abc', '[x*1][y*1]'], 'abc', 'two repeats'],
  [['abc', '[x*2][y*1]'], 'abc', 'two repeats mixed'],
  [['abc', 'y[x*]z'], 'abc', 'repeat with multiple other'],
  [['abcd', 'y[x*]z'], 'abcd', 'repeat with multiple other set1=4'],
  [['abcde', 'y[x*]z'], 'abcde', 'repeat with multiple other set1=5'],
  [['abc', 'y[x*0]z'], 'abc', 'repeat zero with multiple other'],
  [['abcd', 'y[x*0]z'], 'abcd', 'repeat zero with multiple other set1=4'],
  [['a', 'y[x*]z'], 'a', 'repeat with more other than set1'],
  [['ab', 'yz[x*]'], 'ab', 'repeat with more other prefix than set1'],
  [['[a*]', 'xy'], 'aaa', 'error infinite in set1'],
  [['[a*0]', 'xy'], 'aaa', 'error zero in set1'],
  [['-d', '[a*0]'], 'aaa', 'error zero in set1 delete'],
  [['-s', '[a*0]'], 'aaa', 'error zero in set1 squeeze'],
  [['abc', '[x*][y*]'], 'abc', 'error multiple infinite'],
  [['abc', '[x*0][y*0]'], 'abc', 'error multiple zero'],
  [['[=a=]', 'b'], 'a', 'equivalence'],
  [['[=b=]', 'x'], 'b', 'equivalence b'],
  [['[=1=]', 'x'], '1', 'equivalence digit'],
  [['-t', 'a-c', 'x'], 'abc', 'truncate basic'],
  [['-t', 'a-c', 'xy'], 'abc', 'truncate partial'],
  [['-t', 'a', 'bc'], 'a', 'truncate single'],
  [['-t', 'a-c', '[x*]'], 'abc', 'truncate with infinite'],
  [['-t', 'a-c', '[x*0]'], 'abc', 'truncate with zero'],
  [['-t', 'a', ''], 'abc', 'truncate empty set2'],
  [['a', 'b'], '', 'empty input'],
  [['', ''], 'abc', 'empty sets translate'],
  [['-d', ''], 'abc', 'empty delete'],
  [['-s', ''], 'abc', 'empty squeeze'],
  [['z-a', 'x'], 'abc', 'invalid range'],
  [['[:fake:]'], 'abc', 'invalid class'],
  [['a', '[b**]'], 'aaa', 'invalid repeat'],
  [['a'], 'abc', 'missing SET2'],
  [['a', 'b', 'c'], 'abc', 'too many args'],
  [[], 'abc', 'no args'],
  [['-d'], 'abc', 'delete no set'],
  [['-s'], 'abc', 'squeeze no set'],
  [['-ds', 'a'], 'abc', 'ds missing set2'],
  [['-d', 'a', 'b'], 'abc', 'delete extra arg'],
  [['-s', 'a', 'b', 'c'], 'abc', 'squeeze too many args'],
  [['-c', 'a'], 'abc', 'complement missing set2'],
  [['-c', 'a', 'b', 'c'], 'abc', 'complement too many'],
  [['-d', 'a', 'a', 'b'], 'a', 'delete before translate'],
  [['-s', 'b', 'a', 'b'], 'aa', 'translate before squeeze'],
  [['a', 'b'], 'a\xffb', 'binary input'],
  [['\\xff', 'x'], '\xff', 'high byte escape'],
  [['aab', 'xyz'], 'aab', 'duplicate set1'],
  [['aba', 'xyz'], 'aba', 'duplicate set1 pattern'],
  [['baa', 'xyz'], 'baa', 'duplicate set1 pattern b'],
  [['aab', 'x'], 'aab', 'duplicate set1 padding'],
  [['aab', 'xyzw'], 'aab', 'duplicate set1 longer set2'],
  [['aab', 'xy'], 'aab', 'duplicate set1 set2 shorter'],
  [['aaa', 'xyz'], 'aaa', 'triple duplicate set1'],
  [['aab', '[x*]y'], 'aab', 'duplicate set1 with infinite'],
  [['aab', '[x*]'], 'aab', 'duplicate set1 with infinite only'],
  [['aab', 'y[x*]'], 'aab', 'duplicate set1 with infinite prefix'],
  [['abc', 'xxy'], 'abc', 'duplicate set2'],
  [['abc', 'xxx'], 'abc', 'triple duplicate set2'],
  [['a-z', 'A-Z'], 'hello', 'lower to upper range'],
  [['0-9', 'a-j'], '12345', 'digit range'],
  [['!-/', 'a-g'], '!"#$%&', 'punct range'],
  [['[:alpha:]', 'x'], 'abc123', 'alpha class'],
  [['-d', '[:alpha:]'], 'abc123', 'delete alpha'],
  [['-s', '[:space:]'], 'a  b\t\tc', 'squeeze space'],
  [['[:alnum:]', 'x'], 'abc123!@#', 'alnum class'],
  [['[:punct:]', 'x'], '!@#abc', 'punct class'],
  [['[:upper:]', '[:lower:]'], 'HELLO', 'upper to lower'],
  [['[:xdigit:]', 'x'], 'deadBEEF', 'xdigit class'],
  [['[:cntrl:]', 'x'], '\x00\x01\x02', 'cntrl class'],
  [['[:graph:]', 'x'], 'abc!@#', 'graph class'],
  [['[:print:]', 'x'], 'abc !@#', 'print class'],
  [['[:blank:]', 'x'], 'a\t b', 'blank class'],
  [['-s', 'a', 'bc'], 'aa', 'squeeze translate single'],
  [['-s', 'a', 'bc'], 'aaa', 'squeeze translate triple'],
  [['-s', 'ab', 'cd'], 'aaabbb', 'squeeze translate mixed'],
  [['-s', 'ab', 'cd'], 'ababab', 'squeeze translate alternating'],
  [['-s', 'ab', 'cd'], 'aabbbaa', 'squeeze translate pattern'],
  [['-s', 'aab', 'xyz'], 'aaabaaa', 'squeeze translate duplicate set1'],
  [['-s', 'aab', 'xyz'], 'bbb', 'squeeze translate duplicate set1 unaffected'],
  [['-s', 'a', '[x*0]'], 'aaa', 'squeeze with zero repeat'],
  [['-s', 'a', '[x*1]'], 'aaa', 'squeeze with one repeat'],
  [['-s', 'ab', '[x*0]'], 'aaabbb', 'squeeze with zero repeat mixed'],
  [['-s', 'ab', '[x*]'], 'aaabbb', 'squeeze with infinite repeat'],
  [['-ds', 'a', '[x*0]'], 'aaabaaa', 'ds with zero repeat'],
  [['-ds', 'a', '[x*1]'], 'aaabaaa', 'ds with one repeat'],
  [['-ds', 'ab', '[x*0]'], 'aaabbbccc', 'ds with zero repeat mixed'],
  [['-ds', 'ab', '[x*]'], 'aaabbbccc', 'ds with infinite repeat'],
  [['-cds', 'a', '[x*0]'], 'aaabaaa', 'cds with zero repeat'],
  [['-cds', 'a', '[x*]'], 'aaabaaa', 'cds with infinite repeat'],
  [['-cs', 'a', '[x*0]'], 'bbbccc', 'cs with zero repeat'],
  [['-cs', 'a', '[x*]'], 'bbbccc', 'cs with infinite repeat'],
];

describe('tr compatibility suite', function () {
  tests.forEach(([args, input, description]) => {
    it(description, function () {
      const result = compare(args, input);

      if (result === 'PASS') return;

      if (result.status === 'JS_ERR') {
        throw new Error(
          `JS errored: ${result.js.error}\nSystem result: ${JSON.stringify(result.sys.result)}`
        );
      }

      if (result.status === 'SYS_ERR') {
        throw new Error(
          `System errored: ${result.sys.error}\nJS result: ${JSON.stringify(result.js.result)}`
        );
      }

      if (result.status === 'MISMATCH') {
        expect(result.js.result).to.equal(
          result.sys.result,
          `JS result: ${JSON.stringify(result.js.result)}\nSystem result: ${JSON.stringify(result.sys.result)}`
        );
      }
    });
  });
});
