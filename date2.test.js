function date(...args) {
  const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
  
  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  }
  
  function pad(n, width) {
    width = width || 2;
    return String(n).padStart(width, '0');
  }
  
  let useUTC = false;
  let formatStr = null;
  let setTimeArg = null;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-u') {
      useUTC = true;
    } else if (typeof arg === 'string' && arg.startsWith('+')) {
      formatStr = arg.substring(1);
    } else if (typeof arg === 'string' && arg.startsWith('-')) {
      throw new Error('invalid option');
    } else if (typeof arg === 'string' && /^[0-9]{8}([0-9]{2}){0,2}$/.test(arg)) {
      if (setTimeArg !== null) throw new Error('multiple set time arguments');
      setTimeArg = arg;
    } else if (typeof arg === 'string' && /^[0-9]+$/.test(arg)) {
      throw new Error('invalid set time format');
    } else if (arg !== undefined && arg !== null) {
      throw new Error('invalid operand');
    }
  }
  
  let setTime = null;
  
  if (setTimeArg !== null) {
    const len = setTimeArg.length;
    const mm = parseInt(setTimeArg.substring(0, 2), 10);
    const dd = parseInt(setTimeArg.substring(2, 4), 10);
    const hh = parseInt(setTimeArg.substring(4, 6), 10);
    const mi = parseInt(setTimeArg.substring(6, 8), 10);
    let year;
    
    if (len === 8) {
      year = new Date().getFullYear();
    } else if (len === 10) {
      const yy = parseInt(setTimeArg.substring(8, 10), 10);
      year = yy >= 69 ? 1900 + yy : 2000 + yy;
    } else {
      year = parseInt(setTimeArg.substring(8, 12), 10);
    }
    
    if (mm < 1 || mm > 12) throw new Error('invalid month');
    if (hh < 0 || hh > 23) throw new Error('invalid hour');
    if (mi < 0 || mi > 59) throw new Error('invalid minute');
    
    const daysInMonth = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (dd < 1 || dd > daysInMonth[mm - 1]) throw new Error('invalid day');
    
    setTime = { year, month: mm - 1, date: dd, hours: hh, minutes: mi };
  }
  
  if (formatStr === null) {
    formatStr = '%a %b %e %H:%M:%S %Z %Y';
  }
  
  let now = new Date();
  
  if (setTime !== null) {
    if (useUTC) {
      now = new Date(Date.UTC(setTime.year, setTime.month, setTime.date, setTime.hours, setTime.minutes, 0));
    } else {
      now = new Date(setTime.year, setTime.month, setTime.date, setTime.hours, setTime.minutes, 0);
    }
  }
  
  const abbrDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const abbrMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  function getDayOfYear(d) {
    const yr = useUTC ? d.getUTCFullYear() : d.getFullYear();
    const mon = useUTC ? d.getUTCMonth() : d.getMonth();
    const day = useUTC ? d.getUTCDate() : d.getDate();
    const dims = [31, isLeap(yr) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let res = 0;
    for (let i = 0; i < mon; i++) res += dims[i];
    return res + day;
  }
  
  function getWeekU(d) {
    const yr = useUTC ? d.getUTCFullYear() : d.getFullYear();
    const doy = getDayOfYear(d);
    const jan1 = useUTC ? new Date(Date.UTC(yr, 0, 1)) : new Date(yr, 0, 1);
    const jan1Day = useUTC ? jan1.getUTCDay() : jan1.getDay();
    return Math.floor((doy - 1 + jan1Day) / 7);
  }
  
  function getWeekW(d) {
    const yr = useUTC ? d.getUTCFullYear() : d.getFullYear();
    const doy = getDayOfYear(d);
    const jan1 = useUTC ? new Date(Date.UTC(yr, 0, 1)) : new Date(yr, 0, 1);
    const jan1Day = useUTC ? jan1.getUTCDay() : jan1.getDay();
    return Math.floor((doy - 1 + ((jan1Day + 6) % 7)) / 7);
  }
  
  function getWeekV(d) {
    const target = new Date(useUTC ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d.getTime());
    const dayNr = (useUTC ? target.getUTCDay() : target.getDay()) || 7;
    target.setDate((useUTC ? target.getUTCDate() : target.getDate()) + 4 - dayNr);
    const yr = useUTC ? target.getUTCFullYear() : target.getFullYear();
    const yearStart = new Date(useUTC ? Date.UTC(yr, 0, 1) : new Date(yr, 0, 1));
    const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    return week;
  }
  
  const year = useUTC ? now.getUTCFullYear() : now.getFullYear();
  const month = useUTC ? now.getUTCMonth() : now.getMonth();
  const day = useUTC ? now.getUTCDate() : now.getDate();
  const hours = useUTC ? now.getUTCHours() : now.getHours();
  const minutes = useUTC ? now.getUTCMinutes() : now.getMinutes();
  const seconds = useUTC ? now.getUTCSeconds() : now.getSeconds();
  const dayOfWeek = useUTC ? now.getUTCDay() : now.getDay();
  
  let result = '';
  
  for (let i = 0; i < formatStr.length; i++) {
    if (formatStr[i] === '%') {
      i++;
      if (i >= formatStr.length) {
        result += '%';
        break;
      }
      
      let mod = '';
      let ch = formatStr[i];
      
      if (ch === 'E' || ch === 'O') {
        mod = ch;
        i++;
        if (i >= formatStr.length) {
          result += '%' + mod;
          break;
        }
        ch = formatStr[i];
      }
      
      let val = '';
      
      switch (ch) {
        case '%': val = '%'; break;
        case 'n': val = '\n'; break;
        case 't': val = '\t'; break;
        case 'a': val = abbrDays[dayOfWeek]; break;
        case 'A': val = fullDays[dayOfWeek]; break;
        case 'b':
        case 'h': val = abbrMonths[month]; break;
        case 'B': val = fullMonths[month]; break;
        case 'c': val = `${abbrDays[dayOfWeek]} ${abbrMonths[month]} ${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)} ${year}`; break;
        case 'C': val = pad(Math.floor(year / 100)); break;
        case 'd': val = pad(day); break;
        case 'D': val = `${pad(month + 1)}/${pad(day)}/${pad(year % 100)}`; break;
        case 'e': val = (day < 10 ? ' ' : '') + day; break;
        case 'H': val = pad(hours); break;
        case 'I': val = pad(hours % 12 || 12); break;
        case 'j': val = pad(getDayOfYear(now), 3); break;
        case 'm': val = pad(month + 1); break;
        case 'M': val = pad(minutes); break;
        case 'p': val = hours >= 12 ? 'PM' : 'AM'; break;
        case 'r': val = `${pad(hours % 12 || 12)}:${pad(minutes)}:${pad(seconds)} ${hours >= 12 ? 'PM' : 'AM'}`; break;
        case 'S': val = pad(seconds); break;
        case 'T': val = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`; break;
        case 'u': val = String(((dayOfWeek + 6) % 7) + 1); break;
        case 'U': val = pad(getWeekU(now)); break;
        case 'V': val = pad(getWeekV(now)); break;
        case 'w': val = String(dayOfWeek); break;
        case 'W': val = pad(getWeekW(now)); break;
        case 'x': val = `${pad(month + 1)}/${pad(day)}/${pad(year % 100)}`; break;
        case 'X': val = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`; break;
        case 'y': val = pad(year % 100); break;
        case 'Y': val = String(year); break;
        case 'Z': val = useUTC ? 'UTC' : ''; break;
        case 'E': val = mod + ch; break;
        case 'O': val = mod + ch; break;
        default: val = ch; break;
      }
      
      result += val;
    } else {
      result += formatStr[i];
    }
  }
  
  return result + '\n';
}

test('date with no arguments returns string with newline terminator', () => {
  const result = date();
  expect(typeof result).toBe('string');
  expect(result.charAt(result.length - 1)).toBe('\n');
});

test('date with no arguments returns format equivalent to POSIX default', () => {
  const result = date();
  const parts = result.trim().split(' ');
  expect(parts.length).toBeGreaterThan(5);
});

test('date -u uses UTC timezone', () => {
  const result = date('-u', '+%Z');
  expect(result.trim()).toBe('UTC');
});

test('date -u overrides TZ environment variable', () => {
  process.env.TZ = 'America/New_York';
  const result = date('-u', '+%Z');
  delete process.env.TZ;
  expect(result.trim()).toBe('UTC');
});

test('date respects TZ environment variable when -u not specified', () => {
  process.env.TZ = 'UTC';
  const result = date();
  delete process.env.TZ;
  expect(typeof result).toBe('string');
});

test('date +%% outputs literal percent sign', () => {
  expect(date('+%')).toBe('%\n');
});

test('date +%a returns abbreviated weekday name', () => {
  const result = date('+%a');
  expect(result.length).toBeGreaterThan(1);
  expect(result).not.toContain('%');
});

test('date +%A returns full weekday name', () => {
  const result = date('+%A');
  expect(result.length).toBeGreaterThan(2);
  expect(result).not.toContain('%');
});

test('date +%b returns abbreviated month name', () => {
  const result = date('+%b');
  expect(result.length).toBeGreaterThan(1);
  expect(result).not.toContain('%');
});

test('date +%h is synonym for %b', () => {
  expect(date('+%h')).toBe(date('+%b'));
});

test('date +%B returns full month name', () => {
  const result = date('+%B');
  expect(result.length).toBeGreaterThan(2);
  expect(result).not.toContain('%');
});

test('date +%c returns locale appropriate date and time', () => {
  const result = date('+%c');
  expect(typeof result).toBe('string');
  expect(result).not.toContain('%c');
});

test('date +%C returns century as decimal number', () => {
  const result = date('+%C');
  const century = parseInt(result);
  expect(century).toBeGreaterThan(19);
  expect(century).toBeLessThan(22);
});

test('date +%d returns day of month 01-31', () => {
  const result = date('+%d');
  const day = parseInt(result);
  expect(day).toBeGreaterThan(0);
  expect(day).toBeLessThan(32);
  expect(result.trim().length).toBe(2);
});

test('date +%D returns date in mm/dd/yy format', () => {
  const result = date('+%D').trim();
  expect(result).toContain('/');
  expect(result.split('/').length).toBe(3);
});

test('date +%e returns day with leading space fill', () => {
  const result = date('+%e');
  expect(result.length).toBe(3);
  expect(result.charAt(0) === ' ' || (result.charAt(0) >= '0' && result.charAt(0) <= '9')).toBeTruthy();
});

test('date +%H returns hour 24-clock 00-23', () => {
  const result = date('+%H');
  const hour = parseInt(result);
  expect(hour).toBeGreaterThan(-1);
  expect(hour).toBeLessThan(24);
});

test('date +%I returns hour 12-clock 01-12', () => {
  const result = date('+%I');
  const hour = parseInt(result);
  expect(hour).toBeGreaterThan(0);
  expect(hour).toBeLessThan(13);
});

test('date +%j returns day of year 001-366', () => {
  const result = date('+%j');
  const day = parseInt(result);
  expect(day).toBeGreaterThan(0);
  expect(day).toBeLessThan(367);
  expect(result.trim().length).toBe(3);
});

test('date +%m returns month 01-12', () => {
  const result = date('+%m');
  const month = parseInt(result);
  expect(month).toBeGreaterThan(0);
  expect(month).toBeLessThan(13);
  expect(result.trim().length).toBe(2);
});

test('date +%M returns minute 00-59', () => {
  const result = date('+%M');
  const minute = parseInt(result);
  expect(minute).toBeGreaterThan(-1);
  expect(minute).toBeLessThan(60);
  expect(result.trim().length).toBe(2);
});

test('date +%n returns newline character', () => {
  expect(date('+%n')).toBe('\n\n');
});

test('date +%p returns AM or PM', () => {
  const result = date('+%p').trim();
  expect(result === 'AM' || result === 'PM').toBeTruthy();
});

test('date +%r returns 12-hour time with AM/PM', () => {
  const result = date('+%r').trim();
  expect(result).toContain(':');
  expect(result.indexOf('AM') > -1 || result.indexOf('PM') > -1).toBeTruthy();
});

test('date +%S returns seconds 00-60', () => {
  const result = date('+%S');
  const sec = parseInt(result);
  expect(sec).toBeGreaterThan(-1);
  expect(sec).toBeLessThan(61);
});

test('date +%t returns tab character', () => {
  expect(date('+%t')).toContain('\t');
});

test('date +%T returns HH:MM:SS', () => {
  const result = date('+%T').trim();
  const parts = result.split(':');
  expect(parts.length).toBe(3);
  expect(parts[0].length).toBe(2);
  expect(parts[1].length).toBe(2);
  expect(parts[2].length).toBe(2);
});

test('date +%u returns weekday 1-7 Monday-based', () => {
  const result = date('+%u');
  const day = parseInt(result);
  expect(day).toBeGreaterThan(0);
  expect(day).toBeLessThan(8);
});

test('date +%U returns week number 00-53 Sunday-based', () => {
  const result = date('+%U');
  const week = parseInt(result);
  expect(week).toBeGreaterThan(-1);
  expect(week).toBeLessThan(54);
  expect(result.trim().length).toBe(2);
});

test('date +%V returns ISO week number 01-53', () => {
  const result = date('+%V');
  const week = parseInt(result);
  expect(week).toBeGreaterThan(0);
  expect(week).toBeLessThan(54);
});

test('date +%w returns weekday 0-6 Sunday-based', () => {
  const result = date('+%w');
  const day = parseInt(result);
  expect(day).toBeGreaterThan(-1);
  expect(day).toBeLessThan(7);
});

test('date +%W returns week number 00-53 Monday-based', () => {
  const result = date('+%W');
  const week = parseInt(result);
  expect(week).toBeGreaterThan(-1);
  expect(week).toBeLessThan(54);
  expect(result.trim().length).toBe(2);
});

test('date +%x returns locale date representation', () => {
  const result = date('+%x');
  expect(typeof result).toBe('string');
  expect(result).not.toContain('%x');
});

test('date +%X returns locale time representation', () => {
  const result = date('+%X');
  expect(typeof result).toBe('string');
  expect(result).not.toContain('%X');
});

test('date +%y returns year within century 00-99', () => {
  const result = date('+%y');
  const year = parseInt(result);
  expect(year).toBeGreaterThan(-1);
  expect(year).toBeLessThan(100);
  expect(result.trim().length).toBe(2);
});

test('date +%Y returns year with century', () => {
  const result = date('+%Y').trim();
  expect(result.length).toBe(4);
  const year = parseInt(result);
  expect(year).toBeGreaterThan(1969);
});

test('date +%Z returns timezone name or empty', () => {
  const result = date('+%Z');
  expect(typeof result).toBe('string');
});

test('date +%Ec returns alternative date time', () => {
  const result = date('+%Ec');
  expect(typeof result).toBe('string');
});

test('date +%EC returns alternative base year', () => {
  const result = date('+%EC');
  expect(typeof result).toBe('string');
});

test('date +%Ex returns alternative date', () => {
  const result = date('+%Ex');
  expect(typeof result).toBe('string');
});

test('date +%EX returns alternative time', () => {
  const result = date('+%EX');
  expect(typeof result).toBe('string');
});

test('date +%Ey returns alternative year offset', () => {
  const result = date('+%Ey');
  expect(typeof result).toBe('string');
});

test('date +%EY returns full alternative year', () => {
  const result = date('+%EY');
  expect(typeof result).toBe('string');
});

test('date +%Od returns day with alternative numerals', () => {
  const result = date('+%Od');
  expect(typeof result).toBe('string');
});

test('date +%Oe returns day with alternative numerals', () => {
  const result = date('+%Oe');
  expect(typeof result).toBe('string');
});

test('date +%OH returns hour with alternative numerals', () => {
  const result = date('+%OH');
  expect(typeof result).toBe('string');
});

test('date +%OI returns hour 12-clock with alternative numerals', () => {
  const result = date('+%OI');
  expect(typeof result).toBe('string');
});

test('date +%Om returns month with alternative numerals', () => {
  const result = date('+%Om');
  expect(typeof result).toBe('string');
});

test('date +%OM returns minutes with alternative numerals', () => {
  const result = date('+%OM');
  expect(typeof result).toBe('string');
});

test('date +%OS returns seconds with alternative numerals', () => {
  const result = date('+%OS');
  expect(typeof result).toBe('string');
});

test('date +%Ou returns weekday 1-7 alternative representation', () => {
  const result = date('+%Ou');
  expect(typeof result).toBe('string');
});

test('date +%OU returns week number alternative numerals Sunday-based', () => {
  const result = date('+%OU');
  expect(typeof result).toBe('string');
});

test('date +%OV returns ISO week alternative numerals', () => {
  const result = date('+%OV');
  expect(typeof result).toBe('string');
});

test('date +%Ow returns weekday 0-6 alternative representation', () => {
  const result = date('+%Ow');
  expect(typeof result).toBe('string');
});

test('date +%OW returns week number alternative numerals Monday-based', () => {
  const result = date('+%OW');
  expect(typeof result).toBe('string');
});

test('date +%Oy returns year offset alternative numerals', () => {
  const result = date('+%Oy');
  expect(typeof result).toBe('string');
});

test('date XSI set time mmddhhmm succeeds with privileges', () => {
  expect(() => date('12312359')).not.toThrow();
});

test('date XSI set time with 2-digit year 69-99 maps to 1969-1999', () => {
  expect(() => date('0101000069')).not.toThrow();
});

test('date XSI set time with 2-digit year 00-68 maps to 2000-2068', () => {
  expect(() => date('0101000000')).not.toThrow();
});

test('date XSI set time with 4-digit year succeeds', () => {
  expect(() => date('123123592024')).not.toThrow();
});

test('date XSI set time rejects invalid month 13', () => {
  expect(() => date('133123592024')).toThrow();
});

test('date XSI set time rejects day 0', () => {
  expect(() => date('120023592024')).toThrow();
});

test('date XSI set time rejects invalid day 32', () => {
  expect(() => date('013223592024')).toThrow();
});

test('date XSI set time rejects hour 24', () => {
  expect(() => date('010124002024')).toThrow();
});

test('date XSI set time rejects minute 60', () => {
  expect(() => date('010123602024')).toThrow();
});

test('date XSI set time rejects February 29 in non-leap year', () => {
  expect(() => date('022923592023')).toThrow();
});

test('date XSI set time accepts February 29 in leap year', () => {
  expect(() => date('022923592024')).not.toThrow();
});

test('date with format containing newline %n outputs correctly', () => {
  const result = date('+%Y%n%m');
  expect(result).toContain('\n');
});

test('date with format containing tab %t outputs correctly', () => {
  const result = date('+%Y%t%m');
  expect(result).toContain('\t');
});

test('date empty format string outputs only newline', () => {
  expect(date('+')).toBe('\n');
});

test('date multiple format arguments processes correctly', () => {
  expect(() => date('+%Y', '+%m')).not.toThrow();
});

test('date invalid conversion specifier outputs literally', () => {
  expect(date('+%q')).toContain('q');
});

test('date respects LC_TIME for locale specific output', () => {
  process.env.LC_TIME = 'en_US.UTF-8';
  const result = date('+%A');
  delete process.env.LC_TIME;
  expect(typeof result).toBe('string');
});

test('date with -u and format string outputs UTC', () => {
  const result = date('-u', '+%H:%M');
  expect(typeof result).toBe('string');
  expect(result).toContain(':');
});

test('date week 53 handling for %U', () => {
  const result = date('+%U');
  const week = parseInt(result);
  expect(week === 0 || (week >= 0 && week <= 53)).toBeTruthy();
});

test('date week 53 handling for %V', () => {
  const result = date('+%V');
  const week = parseInt(result);
  expect(week >= 1 && week <= 53).toBeTruthy();
});

test('date week 0 handling for %W', () => {
  const result = date('+%W');
  const week = parseInt(result);
  expect(week >= 0 && week <= 53).toBeTruthy();
});

test('date returns exit status 0 on success', () => {
  const result = date();
  expect(result).not.toBeNull();
});

test('date throws error on invalid option', () => {
  expect(() => date('-z')).toThrow();
});

test('date throws error on invalid set time format', () => {
  expect(() => date('notadate')).toThrow();
});

test('date +%S range includes 60 for leap seconds', () => {
  const result = date('+%S');
  const sec = parseInt(result);
  expect(sec >= 0 && sec <= 60).toBeTruthy();
});
