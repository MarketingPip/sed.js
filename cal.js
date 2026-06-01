
// util-linux cal command implementation in JavaScript
// Based on cal.c from util-linux master branch

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Constants
const DAY_LEN = 3;
const DAYS_IN_WEEK = 7;
const MAXDAYS = 42;
const SPACE = -1;
const MONTHS_IN_YEAR_ROW = 3;
const MONTHS_IN_YEAR = 12;
const SMALLEST_YEAR = 1;

const GREGORIAN = -2147483648;
const ISO = -2147483648;
const GB1752 = 1752;
const DEFAULT_REFORM_YEAR = 1752;
const JULIAN = 2147483647;

const SUNDAY = 0;
const MONDAY = 1;
const NONEDAY = 7;

const REFORMATION_MONTH = 9;
const NUMBER_MISSING_DAYS = 11;
const YDAY_AFTER_MISSING = 258;

const DAYS_IN_MONTH = [
  [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
];

function leapYear(reformYear, year) {
  if (year <= reformYear) return year % 4 === 0;
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function dayInYear(reformYear, day, month, year) {
  const leap = leapYear(reformYear, year) ? 1 : 0;
  for (let i = 1; i < month; i++) day += DAYS_IN_MONTH[leap][i];
  return day;
}

function dayInWeek(reformYear, day, month, year) {
  const reform = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const old = [5, 1, 0, 3, 5, 1, 3, 6, 2, 4, 0, 2];

  if (year !== reformYear + 1) {
    year -= month < 3 ? 1 : 0;
  } else {
    year -= (month < 3 ? 1 : 0) + 14;
  }

  if (reformYear < year || 
      (year === reformYear && REFORMATION_MONTH < month) ||
      (year === reformYear && month === REFORMATION_MONTH && 13 < day)) {
    return ((year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + reform[month - 1] + day) % DAYS_IN_WEEK);
  }

  if (year < reformYear ||
      (year === reformYear && month < REFORMATION_MONTH) ||
      (year === reformYear && month === REFORMATION_MONTH && day < 3)) {
    return ((year + Math.floor(year / 4) + old[month - 1] + day) % DAYS_IN_WEEK);
  }

  return NONEDAY;
}

function centerStr(src, width) {
  src = src.trim();
  if (src.length >= width) return src.slice(0, width);
  const left = Math.floor((width - src.length) / 2);
  const right = width - src.length - left;
  return " ".repeat(left) + src + " ".repeat(right);
}

function leftStr(src, width) {
  src = src.trim();
  if (src.length >= width) return src.slice(0, width);
  return src + " ".repeat(width - src.length);
}

function monthnameToNumber(name) {
  const lower = name.toLowerCase();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (MONTH_NAMES[i].toLowerCase() === lower) return i + 1;
  }
  for (let i = 0; i < MONTH_SHORT.length; i++) {
    if (MONTH_SHORT[i].toLowerCase() === lower) return i + 1;
  }
  return -1;
}

function calFillMonth(month, year, reformYear, weekstart, julian) {
  let firstWeekDay = dayInWeek(reformYear, 1, month, year);

  let j = julian ? dayInYear(reformYear, 1, month, year) : 1;

  let monthDays = j + DAYS_IN_MONTH[leapYear(reformYear, year) ? 1 : 0][month];

  if (weekstart) {
    firstWeekDay -= weekstart;
    if (firstWeekDay < 0) firstWeekDay = DAYS_IN_WEEK - weekstart;
    monthDays += weekstart - 1;
  }

  const days = new Array(MAXDAYS).fill(SPACE);

  for (let i = 0; i < MAXDAYS; i++) {
    if (firstWeekDay > 0) {
      days[i] = SPACE;
      firstWeekDay--;
      continue;
    }
    if (j < monthDays) {
      if (year === reformYear && month === REFORMATION_MONTH && (j === 3 || j === 247)) {
        j += NUMBER_MISSING_DAYS;
      }
      days[i] = j;
      j++;
      continue;
    }
    days[i] = SPACE;
  }

  return days;
}

function calOutputHeader(months, reformYear, weekstart, julian, weektype, headerHint, headerYear, gutterWidth) {
  const dayWidth = julian ? DAY_LEN + 1 : DAY_LEN;
  const weekWidth = dayWidth * DAYS_IN_WEEK - 1;

  const lines = [];

  // Build day headings
  let dayHeadings = "";
  for (let i = 0; i < DAYS_IN_WEEK; i++) {
    const wd = (i + weekstart) % DAYS_IN_WEEK;
    if (i > 0) dayHeadings += " ";
    dayHeadings += centerStr(WEEKDAYS[wd], dayWidth - 1);
  }

  if (headerHint || headerYear) {
    let monthLine = "";
    for (let idx = 0; idx < months.length; idx++) {
      if (idx > 0) monthLine += " ".repeat(gutterWidth);
      monthLine += centerStr(MONTH_NAMES[months[idx].month - 1], weekWidth);
    }
    lines.push(monthLine);

    if (!headerYear) {
      let yearLine = "";
      for (let idx = 0; idx < months.length; idx++) {
        if (idx > 0) yearLine += " ".repeat(gutterWidth);
        yearLine += centerStr(String(months[idx].year).padStart(4, '0'), weekWidth);
      }
      lines.push(yearLine);
    }
  } else {
    let headerLine = "";
    for (let idx = 0; idx < months.length; idx++) {
      if (idx > 0) headerLine += " ".repeat(gutterWidth);
      headerLine += centerStr(MONTH_NAMES[months[idx].month - 1] + " " + String(months[idx].year).padStart(4, '0'), weekWidth);
    }
    lines.push(headerLine);
  }

  let headingLine = "";
  for (let idx = 0; idx < months.length; idx++) {
    if (idx > 0) headingLine += " ".repeat(gutterWidth);
    if (weektype) {
      if (julian) {
        headingLine += " ".repeat(dayWidth - 1) + dayHeadings;
      } else {
        headingLine += " ".repeat(dayWidth) + dayHeadings;
      }
    } else {
      headingLine += dayHeadings;
    }
  }
  lines.push(headingLine);

  return lines;
}

function calOutputMonths(months, reformYear, weekstart, julian, weektype, reqMonth, reqYear, reqDay, gutterWidth) {
  const dayWidth = julian ? DAY_LEN + 1 : DAY_LEN;
  const lines = [];
  const firstwork = weekstart === SUNDAY ? 1 : 0;

  for (let weekLine = 0; weekLine < MAXDAYS / DAYS_IN_WEEK; weekLine++) {
    let line = "";
    for (let idx = 0; idx < months.length; idx++) {
      if (idx > 0) line += " ".repeat(gutterWidth);

      let reqday = 0;
      if (months[idx].month === reqMonth && months[idx].year === reqYear) {
        if (julian) {
          reqday = reqDay;
        } else {
          reqday = reqDay + 1 - dayInYear(reformYear, 1, months[idx].month, months[idx].year);
        }
      }

      let skip = dayWidth - 1;

      for (let d = DAYS_IN_WEEK * weekLine; d < DAYS_IN_WEEK * weekLine + DAYS_IN_WEEK; d++) {
        if (months[idx].days[d] > 0) {
          line += String(months[idx].days[d]).padStart(skip, ' ');
        } else {
          line += " ".repeat(skip);
        }

        if (skip < dayWidth) skip++;
      }
    }
    lines.push(line);
  }

  return lines;
}

function calVertOutputHeader(months, reformYear, weekstart, julian, weektype, headerHint, headerYear, gutterWidth) {
  const dayWidth = julian ? DAY_LEN + 1 : DAY_LEN;
  const monthWidth = dayWidth * (MAXDAYS / DAYS_IN_WEEK);

  const lines = [];

  let headerLine = " ".repeat(dayWidth + 1);

  if (headerHint || headerYear) {
    for (let idx = 0; idx < months.length; idx++) {
      if (idx > 0) headerLine += " ".repeat(gutterWidth);
      headerLine += leftStr(MONTH_NAMES[months[idx].month - 1], monthWidth);
    }
    lines.push(headerLine);

    if (!headerYear) {
      let yearLine = " ".repeat(dayWidth + 1);
      for (let idx = 0; idx < months.length; idx++) {
        if (idx > 0) yearLine += " ".repeat(gutterWidth);
        yearLine += leftStr(String(months[idx].year).padStart(4, '0'), monthWidth);
      }
      lines.push(yearLine);
    }
  } else {
    for (let idx = 0; idx < months.length; idx++) {
      if (idx > 0) headerLine += " ".repeat(gutterWidth);
      headerLine += leftStr(MONTH_NAMES[months[idx].month - 1] + " " + String(months[idx].year).padStart(4, '0'), monthWidth);
    }
    lines.push(headerLine);
  }

  return lines;
}

function calVertOutputMonths(months, reformYear, weekstart, julian, weektype, reqMonth, reqYear, reqDay, gutterWidth) {
  const dayWidth = julian ? DAY_LEN + 1 : DAY_LEN;
  const lines = [];

  for (let i = 0; i < DAYS_IN_WEEK; i++) {
    const wd = (i + weekstart) % DAYS_IN_WEEK;
    let line = leftStr(WEEKDAYS[wd], dayWidth - 1) + " ";

    for (let idx = 0; idx < months.length; idx++) {
      if (idx > 0) line += " ".repeat(gutterWidth);

      let reqday = 0;
      if (months[idx].month === reqMonth && months[idx].year === reqYear) {
        if (julian) {
          reqday = reqDay;
        } else {
          reqday = reqDay + 1 - dayInYear(reformYear, 1, months[idx].month, months[idx].year);
        }
      }

      let skip = dayWidth;
      for (let week = 0; week < MAXDAYS / DAYS_IN_WEEK; week++) {
        const d = i + DAYS_IN_WEEK * week;

        if (months[idx].days[d] > 0) {
          line += String(months[idx].days[d]).padStart(skip, ' ');
        } else {
          line += " ".repeat(skip);
        }
        skip = dayWidth;
      }
    }
    lines.push(line);
  }

  return lines;
}

function cal(...args) {
  let reformYear = DEFAULT_REFORM_YEAR;
  let weekstart = SUNDAY;
  let spanMonths = 0;
  let numMonths = 0;
  let julian = false;
  let vertical = false;
  let weektype = 0;
  let monthsInRow = 0;
  let gutterWidth = 2;
  let headerYear = false;
  let headerHint = false;
  let yflag = false;
  let Yflag = false;
  let cols = -1;

  let reqDay = 0;
  let reqMonth = 0;
  let reqYear = 0;

  const now = new Date();
  let today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Argument parsing
  let i = 0;
  while (i < args.length) {
    let arg = args[i];
    if (arg === null || arg === undefined || arg === '') {
      i++;
      continue;
    }

    // Handle combined short options like -n6, -yj, etc.
    if (typeof arg === 'string' && arg.startsWith('-') && arg.length > 2 && !arg.startsWith('--')) {
      const flags = arg.slice(1);
      for (let f = 0; f < flags.length; f++) {
        const flag = flags[f];
        if (flag === '1') numMonths = 1;
        else if (flag === '3') { numMonths = 3; spanMonths = 1; }
        else if (flag === 's') weekstart = SUNDAY;
        else if (flag === 'm') weekstart = MONDAY;
        else if (flag === 'j') julian = true;
        else if (flag === 'y') yflag = true;
        else if (flag === 'Y') Yflag = true;
        else if (flag === 'S') spanMonths = 1;
        else if (flag === 'v') vertical = true;
        else if (flag === 'w') weektype = weekstart === SUNDAY ? 0x200 : 0x100;
        else if (flag === 'n') {
          // -n6 style: extract leading digits, continue with remaining flags
          const rest = flags.slice(f + 1);
          let digits = '';
          let r = 0;
          while (r < rest.length && rest[r] >= '0' && rest[r] <= '9') {
            digits += rest[r];
            r++;
          }
          if (digits) {
            numMonths = parseInt(digits);
          } else {
            i++;
            if (i >= args.length) throw new Error("Missing argument for -n");
            numMonths = parseInt(args[i]);
          }
          // Process remaining flags after the number
          if (r < rest.length) {
            const remaining = rest.slice(r);
            for (let rf = 0; rf < remaining.length; rf++) {
              const rflag = remaining[rf];
              if (rflag === '1') numMonths = 1;
              else if (rflag === '3') { numMonths = 3; spanMonths = 1; }
              else if (rflag === 's') weekstart = SUNDAY;
              else if (rflag === 'm') weekstart = MONDAY;
              else if (rflag === 'j') julian = true;
              else if (rflag === 'y') yflag = true;
              else if (rflag === 'Y') Yflag = true;
              else if (rflag === 'S') spanMonths = 1;
              else if (rflag === 'v') vertical = true;
              else if (rflag === 'w') weektype = weekstart === SUNDAY ? 0x200 : 0x100;
              else throw new Error(`invalid option -- '${rflag}'`);
            }
          }
          break;
        }
        else throw new Error(`invalid option -- '${flag}'`);
      }
      i++;
      continue;
    }

    if (arg === '-1' || arg === '--one') {
      numMonths = 1;
    } else if (arg === '-3' || arg === '--three') {
      numMonths = 3;
      spanMonths = 1;
    } else if (arg === '-s' || arg === '--sunday') {
      weekstart = SUNDAY;
    } else if (arg === '-m' || arg === '--monday') {
      weekstart = MONDAY;
    } else if (arg === '-j' || arg === '--julian') {
      julian = true;
    } else if (arg === '-y' || arg === '--year') {
      yflag = true;
    } else if (arg === '-Y' || arg === '--twelve') {
      Yflag = true;
    } else if (arg === '-n' || arg === '--months') {
      i++;
      if (i >= args.length) throw new Error("Missing argument for -n");
      numMonths = parseInt(args[i]);
    } else if (arg === '-S' || arg === '--span') {
      spanMonths = 1;
    } else if (arg === '-w' || arg === '--week') {
      weektype = weekstart === SUNDAY ? 0x200 : 0x100;
    } else if (arg === '--iso') {
      reformYear = ISO;
    } else if (arg === '--reform') {
      i++;
      if (i >= args.length) throw new Error("Missing argument for --reform");
      const val = String(args[i]).toLowerCase();
      if (val === 'gregorian' || val === 'iso') reformYear = GREGORIAN;
      else if (val === '1752') reformYear = GB1752;
      else if (val === 'julian') reformYear = JULIAN;
      else throw new Error(`invalid --reform value: '${args[i]}'`);
    } else if (arg === '-v' || arg === '--vertical') {
      vertical = true;
    } else if (arg === '-c' || arg === '--columns') {
      i++;
      if (i >= args.length) throw new Error("Missing argument for -c");
      if (args[i] === 'auto') cols = -2;
      else cols = parseInt(args[i]);
    } else if (arg === '-V' || arg === '--version') {
      return "cal from util-linux 2.43";
    } else if (arg === '-h' || arg === '--help') {
      return "Usage: cal [options] [[[day] month] year]";
    } else {
      // Check for special dates and month names
      if (typeof arg === 'string') {
        const lower = arg.toLowerCase();
        if (lower === 'tomorrow') {
          today = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
          i++;
          continue;
        } else if (lower === 'today') {
          i++;
          continue;
        } else if (lower === 'yesterday') {
          today = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
          i++;
          continue;
        } else if (lower === 'now') {
          i++;
          continue;
        }

        const mNum = monthnameToNumber(arg);
        if (mNum > 0) {
          reqMonth = mNum;
          reqYear = today.getFullYear();
          i++;
          continue;
        }
      }

      // Collect remaining positional arguments
      const positional = [];
      for (let j = i; j < args.length; j++) {
        const a = args[j];
        if (a === null || a === undefined || a === '') {
          continue;
        }
        if (typeof a === 'string') {
          const lower = a.toLowerCase();
          if (lower === 'tomorrow') {
            today = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
            continue;
          } else if (lower === 'yesterday') {
            today = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
            continue;
          } else if (lower === 'today' || lower === 'now') {
            continue;
          }
          const mNum = monthnameToNumber(a);
          if (mNum > 0) {
            positional.push(mNum);
            continue;
          }
        }
        const num = parseInt(a);
        if (isNaN(num)) throw new Error(`failed to parse timestamp or unknown month name: ${a}`);
        positional.push(num);
      }

      if (positional.length === 1) {
        reqYear = positional[0];
        if (reqYear < SMALLEST_YEAR) throw new Error("illegal year value: use positive integer");
        if (reqYear === JULIAN) throw new Error("illegal year value");
        reqMonth = 1;
        reqDay = 1;
        numMonths = MONTHS_IN_YEAR;
        headerYear = true;
        yflag = true;
      } else if (positional.length === 2) {
        let m = positional[0], y = positional[1];
        if (typeof m === 'string') {
          const mNum = monthnameToNumber(m);
          if (mNum < 0) throw new Error(`unknown month name: ${m}`);
          m = mNum;
        }
        if (m < 1 || m > MONTHS_IN_YEAR) throw new Error("illegal month value: use 1-12");
        reqMonth = m;
        reqYear = y;
        reqDay = 1;
      } else if (positional.length >= 3) {
        let d = positional[0], m = positional[1], y = positional[2];
        if (typeof m === 'string') {
          const mNum = monthnameToNumber(m);
          if (mNum < 0) throw new Error(`unknown month name: ${m}`);
          m = mNum;
        }
        if (m < 1 || m > MONTHS_IN_YEAR) throw new Error("illegal month value: use 1-12");
        reqYear = y;
        reqMonth = m;
        reqDay = d;
        const leap = leapYear(reformYear, reqYear) ? 1 : 0;
        const dm = DAYS_IN_MONTH[leap][reqMonth];
        if (reqDay < 1 || reqDay > dm) throw new Error(`illegal day value: use 1-${dm}`);
        reqDay = dayInYear(reformYear, reqDay, reqMonth, reqYear);
      }

      break;
    }

    i++;
  }

  if (reqYear === 0) {
    reqYear = today.getFullYear();
  }
  if (reqMonth === 0) {
    reqMonth = today.getMonth() + 1;
  }
  if (reqDay === 0) {
    reqDay = dayInYear(reformYear, today.getDate(), today.getMonth() + 1, today.getFullYear());
  }

  if (yflag || Yflag) {
    gutterWidth = 3;
    if (!numMonths) numMonths = MONTHS_IN_YEAR;
    if (yflag) {
      reqMonth = 1;
      headerYear = true;
    }
  }

  if (vertical) {
    gutterWidth = 1;
  }

  if (numMonths > 1 && monthsInRow === 0) {
    monthsInRow = MONTHS_IN_YEAR_ROW;
    if (cols > 0) monthsInRow = cols;
    else if (cols === -2) monthsInRow = MONTHS_IN_YEAR_ROW;
  } else if (!monthsInRow) {
    monthsInRow = 1;
  }

  if (!numMonths) numMonths = 1;

  const dayWidth = julian ? DAY_LEN + 1 : DAY_LEN;
  const weekWidth = dayWidth * DAYS_IN_WEEK - 1;

  const yearLen = 4;
  for (const monthName of MONTH_NAMES) {
    if (weekWidth < monthName.length + yearLen + 1) {
      headerHint = true;
      break;
    }
  }

  let month = yflag ? 1 : reqMonth;
  let year = reqYear;

  if (spanMonths) {
    let newMonth = month - Math.floor(numMonths / 2);
    if (newMonth < 1) {
      newMonth = Math.abs(newMonth);
      year -= Math.floor(newMonth / MONTHS_IN_YEAR) + 1;
      if (newMonth > MONTHS_IN_YEAR) newMonth %= MONTHS_IN_YEAR;
      month = MONTHS_IN_YEAR - newMonth;
    } else {
      month = newMonth;
    }
  }

  const allLines = [];
  const rows = Math.floor((numMonths - 1) / monthsInRow);

  for (let row = 0; row <= rows; row++) {
    let monthsInThisRow = monthsInRow;
    if (row === rows && numMonths % monthsInRow > 0) {
      monthsInThisRow = numMonths % monthsInRow;
    }

    const months = [];
    for (let _ = 0; _ < monthsInThisRow; _++) {
      const m = {
        month: month,
        year: year,
        days: calFillMonth(month, year, reformYear, weekstart, julian),
        weeks: new Array(MAXDAYS / DAYS_IN_WEEK).fill(SPACE)
      };
      months.push(m);
      month++;
      if (month > MONTHS_IN_YEAR) {
        month = 1;
        year++;
      }
    }

    if (vertical) {
      if (row > 0) allLines.push("");
      allLines.push(...calVertOutputHeader(months, reformYear, weekstart, julian, weektype,
                                           headerHint, headerYear, gutterWidth));
      allLines.push(...calVertOutputMonths(months, reformYear, weekstart, julian, weektype,
                                           reqMonth, reqYear, reqDay, gutterWidth));
    } else {
      allLines.push(...calOutputHeader(months, reformYear, weekstart, julian, weektype,
                                       headerHint, headerYear, gutterWidth));
      allLines.push(...calOutputMonths(months, reformYear, weekstart, julian, weektype,
                                       reqMonth, reqYear, reqDay, gutterWidth));
    }
  }

  while (allLines.length > 0 && allLines[allLines.length - 1].trim() === "") {
    allLines.pop();
  }

  return allLines.join("\n");
}

export default cal
