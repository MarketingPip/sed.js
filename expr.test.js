function expr(args) {
  if (!args || args.length === 0) {
    throw new Error('Empty arguments');
  }
  
  for (const arg of args) {
    if (arg === null || arg === undefined) {
      throw new Error('Invalid argument');
    }
  }
  
  // length operation
  if (args[0] === 'length') {
    if (args.length !== 2) throw new Error('Invalid expression');
    return String(args[1].length);
  }
  
  // substr operation - 1-based index, 0 treated as 1
  if (args[1] === 'substr') {
    if (args.length !== 4) throw new Error('Invalid expression');
    const str = args[0];
    let start = parseInt(args[2], 10);
    const len = parseInt(args[3], 10);
    if (isNaN(start) || isNaN(len)) throw new Error('Invalid numeric arguments');
    start = start === 0 ? 1 : start;
    return str.substring(start - 1, start - 1 + len);
  }
  
  // index operation
  if (args[1] === 'index') {
    if (args.length !== 3) throw new Error('Invalid expression');
    const str = args[0];
    const substr = args[2];
    if (substr === '') return '0';
    const idx = str.indexOf(substr);
    return String(idx === -1 ? 0 : idx + 1);
  }
  
  // match operation
  if (args[1] === ':') {
    if (args.length !== 3) throw new Error('Invalid expression');
    const str = args[0];
    const pattern = args[2];
    const regex = new RegExp('^' + pattern);
    const match = str.match(regex);
    return match ? String(match[0].length) : '0';
  }
  
  // Multi-operation expressions - evaluate left to right
  if (args.length > 3) {
    let result = args[0];
    for (let i = 1; i < args.length - 1; i += 2) {
      const op = args[i];
      const right = args[i + 1];
      result = applyBinaryOp(result, op, right);
    }
    return String(result);
  }
  
  // Binary operations
  const left = args[0];
  const op = args[1];
  const right = args[2];
  
  return String(applyBinaryOp(left, op, right));
}

function applyBinaryOp(left, op, right) {
  // Handle empty strings in comparisons
  if (left === '' && right === '' && (op === '=' || op === '!=')) {
    return op === '=' ? 1 : 0;
  }
  
  const leftNum = parseInt(left, 10);
  const rightNum = parseInt(right, 10);
  
  // Arithmetic operations
  if (['+', '-', '*', '/', '%'].includes(op)) {
    if (isNaN(leftNum) || isNaN(rightNum)) throw new Error('Invalid numeric arguments');
    
    switch (op) {
      case '+': return leftNum + rightNum;
      case '-': return leftNum - rightNum;
      case '*': return leftNum * rightNum;
      case '/':
        if (rightNum === 0) throw new Error('Division by zero');
        return leftNum / rightNum;
      case '%':
        if (rightNum === 0) throw new Error('Division by zero');
        return leftNum % rightNum;
    }
  }
  
  // Comparison operators
  if (op === '=') return leftNum === rightNum ? 1 : 0;
  if (op === '!=') return leftNum !== rightNum ? 1 : 0;
  if (op === '>') return leftNum > rightNum ? 1 : 0;
  if (op === '<') return leftNum < rightNum ? 1 : 0;
  
  // Logical operators
  if (op === '&') {
    const leftVal = leftNum === 0 ? 0 : 1;
    const rightVal = rightNum === 0 ? 0 : 1;
    return leftVal && rightVal ? 1 : 0;
  }
  if (op === '|') {
    if (leftNum === 0) return rightNum;
    return leftNum;
  }
  
  throw new Error('Invalid operator');
}




test('expr 1 + 1 returns 2', () => {
  expect(expr(['1', '+', '1'])).toBe('2');
});
test('expr 10 - 3 returns 7', () => {
  expect(expr(['10', '-', '3'])).toBe('7');
});
test('expr 5 * 5 returns 25', () => {
  expect(expr(['5', '*', '5'])).toBe('25');
});
test('expr 10 / 2 returns 5', () => {
  expect(expr(['10', '/', '2'])).toBe('5');
});
test('expr 10 % 3 returns 1', () => {
  expect(expr(['10', '%', '3'])).toBe('1');
});
test('expr 1 + 1 * 2 evaluates left to right returns 4', () => {
  expect(expr(['1', '+', '1', '*', '2'])).toBe('4');
});
test('expr 1 = 1 returns 1', () => {
  expect(expr(['1', '=', '1'])).toBe('1');
});
test('expr 1 = 2 returns 0', () => {
  expect(expr(['1', '=', '2'])).toBe('0');
});
test('expr 1 != 2 returns 1', () => {
  expect(expr(['1', '!=', '2'])).toBe('1');
});
test('expr 5 > 3 returns 1', () => {
  expect(expr(['5', '>', '3'])).toBe('1');
});
test('expr 2 < 3 returns 1', () => {
  expect(expr(['2', '<', '3'])).toBe('1');
});
test('expr 5 & 2 returns 1', () => {
  expect(expr(['5', '&', '2'])).toBe('1');
});
test('expr 0 & 2 returns 0', () => {
  expect(expr(['0', '&', '2'])).toBe('0');
});
test('expr 0 | 2 returns 2', () => {
  expect(expr(['0', '|', '2'])).toBe('2');
});
test('expr 1 | 2 returns 1', () => {
  expect(expr(['1', '|', '2'])).toBe('1');
});
test('expr length abc returns 3', () => {
  expect(expr(['length', 'abc'])).toBe('3');
});
test('expr length empty string returns 0', () => {
  expect(expr(['length', ''])).toBe('0');
});
test('expr substr abcdef 1 3 returns abc', () => {
  expect(expr(['abcdef', 'substr', '1', '3'])).toBe('abc');
});
test('expr substr abcdef 0 2 returns ab (1-based index edge case)', () => {
  expect(expr(['abcdef', 'substr', '0', '2'])).toBe('ab');
});
test('expr index abcdef b returns 2', () => {
  expect(expr(['abcdef', 'index', 'b'])).toBe('2');
});
test('expr index abcdef z returns 0', () => {
  expect(expr(['abcdef', 'index', 'z'])).toBe('0');
});
test('expr match abc a returns 1', () => {
  expect(expr(['abc', ':', 'a'])).toBe('1');
});
test('expr match abc ab returns 2', () => {
  expect(expr(['abc', ':', 'ab'])).toBe('2');
});
test('expr length null throws error', () => {
  expect(() => expr([null])).toThrow();
});
test('expr length undefined throws error', () => {
  expect(() => expr([undefined])).toThrow();
});
test('expr 10 / 0 throws on division by zero', () => {
  expect(() => expr(['10', '/', '0'])).toThrow();
});
test('expr 1 + ab throws on non-numeric addition', () => {
  expect(() => expr(['1', '+', 'ab'])).toThrow();
});
test('expr with empty arguments throws', () => {
  expect(() => expr([])).toThrow();
});
test('expr empty string comparison returns 1', () => {
  expect(expr(['', '=', ''])).toBe('1');
});
test('expr substr string 0 0 returns empty string', () => {
  expect(expr(['hello', 'substr', '0', '0'])).toBe('');
});
test('expr index string empty set returns 0', () => {
  expect(expr(['hello', 'index', ''])).toBe('0');
});
test('expr logical and 0 and 0 returns 0', () => {
  expect(expr(['0', '&', '0'])).toBe('0');
});
test('expr logical or 0 and 0 returns 0', () => {
  expect(expr(['0', '|', '0'])).toBe('0');
});
test('expr match with regex special characters returns correct length', () => {
  expect(expr(['abc123', ':', '[a-z]+'])).toBe('3');
});
test('expr match with no match returns 0', () => {
  expect(expr(['abc', ':', 'xyz'])).toBe('0');
});
test('expr invalid operator throws', () => {
  expect(() => expr(['1', '@', '2'])).toThrow();
});
