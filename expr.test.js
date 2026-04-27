function expr(args) {
  if (!args || args.length === 0) throw new Error('Empty arguments');

  // Precedence levels per POSIX
  const precedence = {
    '|': 1,
    '&': 2,
    '=': 3, '>': 3, '<': 3, '>=': 3, '<=': 3, '!=': 3,
    '+': 4, '-': 4,
    '*': 5, '/': 5, '%': 5,
    ':': 6
  };

  const values = [];
  const operators = [];

  const applyOp = () => {
    const right = values.pop();
    const left = values.pop();
    const op = operators.pop();
    
    // POSIX Logic for Comparisons & Arithmetic
    const lNum = parseInt(left, 10);
    const rNum = parseInt(right, 10);
    const bothNumeric = !isNaN(lNum) && !isNaN(rNum);

    switch (op) {
      case '|': 
        return (left !== '0' && left !== '') ? left : right;
      case '&': 
        return (left !== '0' && left !== '' && right !== '0' && right !== '') ? left : '0';
      case '+': return String(lNum + rNum);
      case '-': return String(lNum - rNum);
      case '*': return String(lNum * rNum);
      case '/': 
        if (rNum === 0) throw new Error('division by zero');
        return String(Math.trunc(lNum / rNum)); // Integer division
      case '%': 
        if (rNum === 0) throw new Error('division by zero');
        return String(lNum % rNum);
      case ':':
        const res = String(left).match(new RegExp('^' + right));
        return res ? String(res[0].length) : '0';
      case '=':  return (bothNumeric ? lNum === rNum : left === right) ? '1' : '0';
      case '!=': return (bothNumeric ? lNum !== rNum : left !== right) ? '1' : '0';
      case '>':  return (bothNumeric ? lNum > rNum : left > right) ? '1' : '0';
      case '<':  return (bothNumeric ? lNum < rNum : left < right) ? '1' : '0';
      case '>=': return (bothNumeric ? lNum >= rNum : left >= right) ? '1' : '0';
      case '<=': return (bothNumeric ? lNum <= rNum : left <= right) ? '1' : '0';
    }
  };

  for (let i = 0; i < args.length; i++) {
    const token = args[i];

    if (token === '(') {
      operators.push(token);
    } else if (token === ')') {
      while (operators.length > 0 && operators[operators.length - 1] !== '(') {
        values.push(applyOp());
      }
      operators.pop(); // Remove '('
    } else if (precedence[token]) {
      while (operators.length > 0 && 
             operators[operators.length - 1] !== '(' && 
             precedence[operators[operators.length - 1]] >= precedence[token]) {
        values.push(applyOp());
      }
      operators.push(token);
    } else if (token === 'length') { // XSI Extension
      values.push(String(args[++i].length));
    } else {
      values.push(token);
    }
  }

  while (operators.length > 0) {
    values.push(applyOp());
  }

  return values[0];
}

function applyBinaryOp(left, op, right) {
  // 1. Try numeric conversion
  const lNum = Number(left);
  const rNum = Number(right);
  const isNumeric = !isNaN(lNum) && !isNaN(rNum) && left !== '' && right !== '';

  // Logical | (OR)
  if (op === '|') {
    return (left !== '0' && left !== '') ? left : right;
  }
  
  // Logical & (AND)
  if (op === '&') {
    return (left !== '0' && left !== '' && right !== '0' && right !== '') ? left : '0';
  }

  // Comparisons
  if (['=', '>', '<', '>=', '<=', '!='].includes(op)) {
    let result;
    if (isNumeric) {
      if (op === '=') result = lNum === rNum;
      if (op === '>') result = lNum > rNum;
      if (op === '<') result = lNum < rNum;
      if (op === '>=') result = lNum >= rNum;
      if (op === '<=') result = lNum <= rNum;
      if (op === '!=') result = lNum !== rNum;
    } else {
      // POSIX: Lexicographical comparison for strings
      if (op === '=') result = left === right;
      if (op === '>') result = left > right;
      if (op === '<') result = left < right;
      if (op === '!=') result = left !== right;
      // Note: >= and <= should also be string-based here
    }
    return result ? '1' : '0';
  }

  // Arithmetic (Must be numeric)
  if (['+', '-', '*', '/', '%'].includes(op)) {
    if (!isNumeric) throw new Error('non-integer argument');
    if ((op === '/' || op === '%') && rNum === 0) throw new Error('division by zero');
    
    switch (op) {
      case '+': return lNum + rNum;
      case '-': return lNum - rNum;
      case '*': return lNum * rNum;
      case '/': return Math.floor(lNum / rNum); // POSIX uses integer division
      case '%': return lNum % rNum;
    }
  }

  // Regex Match
  if (op === ':') {
    const regex = new RegExp('^' + right);
    const match = String(left).match(regex);
    return match ? String(match[0].length) : '0';
  }

  throw new Error('syntax error');
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
test('expr 1 + 1 * 2 evaluates left to right returns 3', () => {
  expect(expr(['1', '+', '1', '*', '2'])).toBe('3');
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
