

test('convertAnsiHandlesSimpleEscapeSequence', () => {
  const result = convertAnsi('hello\\e[31mworld');
  expect(result).toBe('hello\x1b[31mworld');
});

test('convertAnsiHandlesX1bFormat', () => {
  const result = convertAnsi('start\\x1b[32mend');
  expect(result).toBe('start\x1b[32mend');
});

test('convertAnsiHandlesOctalFormat', () => {
  const result = convertAnsi('test\\033[1mbold');
  expect(result).toBe('test\x1b[1mbold');
});

test('convertAnsiHandlesCareatBracketFormat', () => {
  const result = convertAnsi('line\\^[[2Jclear');
  expect(result).toBe('line\x1b[2Jclear');
});

test('convertAnsiMultipleEscapeSequences', () => {
  const result = convertAnsi('\\e[31mred\\e[32mgreen\\e[0mreset');
  expect(result).toBe('\x1b[31mred\x1b[32mgreen\x1b[0mreset');
});

test('convertAnsiEmptyString', () => {
  const result = convertAnsi('');
  expect(result).toBe('');
});

test('convertAnsiNoEscapeSequences', () => {
  const result = convertAnsi('plain text without any escapes');
  expect(result).toBe('plain text without any escapes');
});

test('convertAnsiSingleCharacter', () => {
  const result = convertAnsi('A');
  expect(result).toBe('A');
});

test('convertAnsiWithMultipleFormattingCodes', () => {
  const result = convertAnsi('\\e[1;31;4mbold red on yellow');
  expect(result).toBe('\x1b[1;31;4mbold red on yellow');
});

test('convertAnsiWithNewlines', () => {
  const result = convertAnsi('\\e[2J\\e[Htest');
  expect(result).toBe('\x1b[2J\x1b[Htest');
});

test('convertAnsiMixedFormatTypes', () => {
  const result = convertAnsi('\\x1b[32mgreen\\e[34mblue\\033[1mbold');
  expect(result).toBe('\x1b[32mgreen\x1b[34mblue\x1b[1mbold');
});

test('convertAnsiWithNumbers', () => {
  const result = convertAnsi('value: \\e[31m42\\e[0mreset');
  expect(result).toBe('value: \x1b[31m42\x1b[0mreset');
});

test('convertAnsiSpecialCharactersPreserved', () => {
  const result = convertAnsi('tab\\teol\\enl');
  expect(result).toBe('tab\t\teenl');
});

test('convertAnsiLongEscapeSequence', () => {
  const result = convertAnsi('\\e[10;20Hmove\\e[48;5;123mcolor');
  expect(result).toBe('\x1b[10;20Hmove\x1b[48;5;123mcolor');
});

test('convertAnsiAllColorCodes', () => {
  const result = convertAnsi('\\e[30m\\e[31m\\e[32m\\e[33m\\e[34m\\e[35m\\e[36m\\e[37m');
  expect(result).toBe('\x1b[30m\x1b[31m\x1b[32m\x1b[33m\x1b[34m\x1b[35m\x1b[36m\x1b[37m');
});

test('convertAnsiInvalidSequenceNotModified', () => {
  const result = convertAnsi('\\e[invalid]code');
  expect(result).toContain('\x1b[invalid]code');
});

test('convertAnsiOnlyEscapeCodes', () => {
  const result = convertAnsi('\\e[31m\\e[0m');
  expect(result).toBe('\x1b[31m\x1b[0m');
});

test('convertAnsiCaseInsensitiveX1b', () => {
  const result = convertAnsi('test\\X1b[1mbold');
  expect(result).toBe('test\x1b[1mbold');
});

test('convertAnsiPartialMatchNotConverted', () => {
  const result = convertAnsi('partial\\x1 only');
  expect(result).toBe('partial\\x1 only');
});

test('convertAnsiConsecutiveEscapes', () => {
  const result = convertAnsi('\\e[31m\\e[1m\\e[4m');
  expect(result).toBe('\x1b[31m\x1b[1m\x1b[4m');
});

function convertAnsi(str) {
  return str
    .replace(/\\e\[/g, '\x1b[')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\x1b/gi, '\x1b')
    .replace(/\\033/g, '\x1b')
    .replace(/\\\^\[/g, '\x1b[');
}
