function date(argv, mockOptions = {}) {
  const PROGRAM_NAME = "date";

  const time_spec_string = [
    "hours", "minutes",
    "date", "seconds", "ns",
  ];
  const time_spec_map = {
    "date": 0,
    "seconds": 1,
    "ns": 2,
    "hours": 3,
    "minutes": 4
  };

  const rfc_email_format = "%a, %d %b %Y %H:%M:%S %z";

  const DEBUG_DATE_PARSING_OPTION = 'debug-date-parsing';
  const RESOLUTION_OPTION = 'resolution';
  const RFC_3339_OPTION = 'rfc-3339';

  // Short options map: char -> canonical key used in parsedOptions
  const short_options_map = {
    'd': 'd',
    'f': 'f',
    'I': 'I',
    'r': 'r',
    'R': 'R',
    's': 's',
    'u': 'u',
  };

  // Long options map: long name -> canonical key used in parsedOptions
  const long_options_map = {
    'date': 'd',
    'debug': DEBUG_DATE_PARSING_OPTION,
    'file': 'f',
    'iso-8601': 'I',
    'reference': 'r',
    'resolution': RESOLUTION_OPTION,
    'rfc-email': 'R',
    'rfc-822': 'R',
    'rfc-2822': 'R',
    'rfc-3339': RFC_3339_OPTION,
    'set': 's',
    'uct': 'u',
    'utc': 'u',
    'universal': 'u',
  };

  const DATE_FMT_LANGINFO_DEFAULT = "%a %b %e %H:%M:%S %Z %Y";

  let capturedStderr = '';
  const stderrFn = mockOptions.stderr || ((msg) => { capturedStderr += msg; });

  function error(status, message) {
    if (message) {
      stderrFn(`${PROGRAM_NAME}: ${message}\n`);
    }
    if (status !== 0) {
      throw new Error(message || "Error");
    }
  }

  // --- Mocks and System Calls ---
  const gettime = () => mockOptions.now || new Date();
  const getenv = (name) => (mockOptions.env && mockOptions.env[name] !== undefined) ? mockOptions.env[name] : process.env[name];
  const stat = (path) => {
    if (mockOptions.fileMtimes && mockOptions.fileMtimes[path]) {
      return { mtime: mockOptions.fileMtimes[path] };
    }
    error(1, `cannot stat '${path}': No such file or directory`);
  };
  const readFileSync = (path) => {
    if (mockOptions.fileContents && mockOptions.fileContents[path]) {
      return mockOptions.fileContents[path];
    }
    error(1, `cannot open '${path}': No such file or directory`);
  };
  const settime = (dateObj) => {
    if (mockOptions.mockSetTime) {
      return mockOptions.mockSetTime(dateObj);
    }
    return true;
  };
  // Returns resolution in nanoseconds (1 = 1ns, 1000000 = 1ms)
  const gettime_res = () => mockOptions.mockGetTimeResolution ? mockOptions.mockGetTimeResolution() : 1;

  // --- Argument Parsing ---
  function parseArgs(cliArgs) {
    const parsedOptions = {};
    const positionalArgs = [];
    let i = 0;

    const requiresArg = (optChar) => ['d', 'f', 'r', 's'].includes(optChar);

    while (i < cliArgs.length) {
      const arg = cliArgs[i];
      if (arg.startsWith('--')) {
        const eqIndex = arg.indexOf('=');
        let optionName, optionValue;
        if (eqIndex > -1) {
          optionName = arg.substring(2, eqIndex);
          optionValue = arg.substring(eqIndex + 1);
        } else {
          optionName = arg.substring(2);
          optionValue = true;
        }

        const canonicalKey = long_options_map[optionName];
        if (!canonicalKey) {
          error(1, `unknown option '${arg}'`);
        }

        if (canonicalKey === 'I' || canonicalKey === RFC_3339_OPTION) {
          parsedOptions[canonicalKey] = (optionValue === true) ? '' : optionValue;
        } else {
          parsedOptions[canonicalKey] = optionValue;
        }
        i++;
      } else if (arg.startsWith('-') && arg.length > 1) {
        const shortOptChar = arg[1];
        const canonicalKey = short_options_map[shortOptChar];

        if (!canonicalKey) {
          error(1, `invalid option -- '${shortOptChar}'`);
        }

        if (arg.length > 2) { // e.g., -Idate, -dSTRING
          parsedOptions[canonicalKey] = arg.substring(2);
        } else {
          if (requiresArg(shortOptChar)) {
            i++;
            if (i >= cliArgs.length) error(1, `option requires an argument -- '${shortOptChar}'`);
            parsedOptions[canonicalKey] = cliArgs[i];
          } else {
            // -I without value maps to empty string, others to true
            parsedOptions[canonicalKey] = (canonicalKey === 'I') ? '' : true;
          }
        }
        i++;
      } else {
        positionalArgs.push(arg);
        i++;
      }
    }
    return { options: parsedOptions, args: positionalArgs };
  }

  // --- Timezone-aware Date Utilities ---

  const pad = (num, length, char = '0') => {
    let s = String(num);
    while (s.length < length) {
      s = char + s;
    }
    return s;
  };

  // Parses a date string (absolute or relative). Returns { date: Date, tz: string|null }
  function parseDatetime(dateStr, baseDate, defaultTzString) {
    let parsedDate = null;
    let explicitTz = null;

    // 1. Try JavaScript's native Date parsing
    const nativeParsed = new Date(dateStr);
    if (!isNaN(nativeParsed.getTime())) {
      parsedDate = nativeParsed;
      const tzMatch = dateStr.match(/\s([A-Z]{2,5}|[A-Z][a-z]+\/[A-Z_a-z]+|UTC[+-]\d+|[+-]\d{4})\s*$/i);
      if (tzMatch) {
        const matchedTz = tzMatch[1];
        if (['UTC', 'GMT', 'Z'].includes(matchedTz.toUpperCase())) explicitTz = 'UTC';
        else if (matchedTz.match(/^[+-]\d{4}$/)) explicitTz = null; // numeric offset, leave to JS
        else explicitTz = matchedTz;
      }
    }
    if (parsedDate) return { date: parsedDate, tz: explicitTz };

    // 2. Try relative date parsing
    const effectiveBaseDate = createTzAwareDate(baseDate, defaultTzString);
    const relativeDate = new Date(effectiveBaseDate.getTime());

    const lowerDateStr = dateStr.toLowerCase();

    const setDayOfWeek = (targetDay, modifier) => {
      const currentDay = relativeDate.getUTCDay();
      let daysDiff = targetDay - currentDay;
      if (modifier === 'next') {
        if (daysDiff <= 0) daysDiff += 7;
      } else if (modifier === 'last') {
        if (daysDiff >= 0) daysDiff -= 7;
        relativeDate.setUTCHours(0, 0, 0, 0);
      }
      relativeDate.setUTCDate(relativeDate.getUTCDate() + daysDiff);
    };

    if (lowerDateStr.includes('tomorrow')) {
      relativeDate.setUTCDate(relativeDate.getUTCDate() + 1);
      return { date: relativeDate, tz: explicitTz };
    }
    if (lowerDateStr.includes('yesterday')) {
      relativeDate.setUTCDate(relativeDate.getUTCDate() - 1);
      return { date: relativeDate, tz: explicitTz };
    }

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < dayNames.length; i++) {
      if (lowerDateStr.includes(`next ${dayNames[i]}`)) {
        setDayOfWeek(i, 'next');
        return { date: relativeDate, tz: explicitTz };
      }
      if (lowerDateStr.includes(`last ${dayNames[i]}`)) {
        setDayOfWeek(i, 'last');
        return { date: relativeDate, tz: explicitTz };
      }
    }

    return { date: null, tz: null };
  }

  // Parses MMDDhhmm[[CC]YY][.ss] format
  function parsePosixDate(dateStr, baseDate, targetTz) {
    const regex = /^(\d{2})(\d{2})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?(?:\.(\d{2}))?$/;
    const match = dateStr.match(regex);
    if (!match) return null;

    let [, month, day, hour, minute, cc, yy, ss] = match;
    month = parseInt(month, 10);
    day = parseInt(day, 10);
    hour = parseInt(hour, 10);
    minute = parseInt(minute, 10);
    ss = ss ? parseInt(ss, 10) : 0;

    let year;
    if (cc && yy) {
      year = parseInt(cc + yy, 10);
    } else if (yy) {
      year = parseInt(yy, 10);
      year += (year >= 69) ? 1900 : 2000;
    } else {
      year = baseDate.getFullYear();
    }

    if (targetTz === 'UTC' || targetTz === 'UTC0') {
      return new Date(Date.UTC(year, month - 1, day, hour, minute, ss, 0));
    } else {
      return new Date(year, month - 1, day, hour, minute, ss, 0);
    }
  }

  // Returns offset in minutes (positive = UTC+, negative = UTC-)
  function getTzOffsetMinutesAtDate(dateObj, tzString) {
    const tz = (tzString === 'UTC0') ? 'UTC' : tzString;
    if (tz === 'UTC') return 0;

    const formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: tz, hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(dateObj);

    const y  = parseInt(parts.find(p => p.type === 'year')?.value, 10);
    const mo = parseInt(parts.find(p => p.type === 'month')?.value, 10);
    const d  = parseInt(parts.find(p => p.type === 'day')?.value, 10);
    const h  = parseInt(parts.find(p => p.type === 'hour')?.value, 10);
    const mi = parseInt(parts.find(p => p.type === 'minute')?.value, 10);
    const s  = parseInt(parts.find(p => p.type === 'second')?.value, 10);

    const dateInTargetTzAsUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    return (dateInTargetTzAsUtc.getTime() - dateObj.getTime()) / (1000 * 60);
  }

  function formatTzOffset(offsetMinutes, format) {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absOffsetMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absOffsetMinutes / 60);
    const minutes = absOffsetMinutes % 60;
    const seconds = 0;
    const pad2 = (n) => String(n).padStart(2, '0');

    if (format === 'hhmm')    return `${sign}${pad2(hours)}${pad2(minutes)}`;
    if (format === 'hh:mm')   return `${sign}${pad2(hours)}:${pad2(minutes)}`;
    if (format === 'hh:mm:ss') return `${sign}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    if (format === 'precision') {
      if (minutes === 0 && seconds === 0) return `${sign}${pad2(hours)}`;
      if (seconds === 0)                  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
      return `${sign}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }
    return '';
  }

  // Creates a Date object whose UTC components represent the local time in tzString
  function createTzAwareDate(dateObj, tzString) {
    const targetTz = (tzString === 'UTC0') ? 'UTC' : tzString;
    if (targetTz === 'UTC') return new Date(dateObj.getTime());
    const offsetMinutes = getTzOffsetMinutesAtDate(dateObj, targetTz);
    return new Date(dateObj.getTime() + offsetMinutes * 60 * 1000);
  }

  // Returns the timezone abbreviation string for a given date in the given tz
  function getTzAbbreviation(dateObj, tzString) {
    const tz = (tzString === 'UTC0') ? 'UTC' : tzString;
    if (tz === 'UTC') return 'UTC';
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short'
      });
      const parts = formatter.formatToParts(dateObj);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : tz;
    } catch (e) {
      return tz;
    }
  }

  function getISOWeekNumber(d) {
    const target = new Date(d.getTime());
    target.setUTCHours(0, 0, 0, 0);
    target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  }

  function getISOWeekYear(d) {
    const target = new Date(d.getTime());
    target.setUTCHours(0, 0, 0, 0);
    target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
    return target.getUTCFullYear();
  }

  function getWeekNumber(date, firstDayOfWeek) {
    const d = new Date(date.getTime());
    d.setUTCHours(0, 0, 0, 0);
    const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const jan1DayOfWeek = jan1.getUTCDay();
    const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / (1000 * 60 * 60 * 24));
    let adjustedDayOfYear = dayOfYear;
    if (jan1DayOfWeek > firstDayOfWeek) {
      adjustedDayOfYear -= (jan1DayOfWeek - firstDayOfWeek);
    } else if (jan1DayOfWeek < firstDayOfWeek) {
      adjustedDayOfYear += (firstDayOfWeek - jan1DayOfWeek);
    }
    return Math.max(0, Math.floor(adjustedDayOfYear / 7));
  }

  function getDayOfYear(dateObj) {
    const startOfYear = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 1));
    return Math.floor((dateObj.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }

  function getQuarter(dateObj) {
    return Math.floor(dateObj.getUTCMonth() / 3) + 1;
  }

  // The main formatting function
  function show_date_formatter(format, dateObj, tzString, useCLocale = false) {
    const effectiveTz = (tzString === 'UTC0') ? 'UTC' : tzString;
    const d = createTzAwareDate(dateObj, effectiveTz);

    const formatIntl = (options) => {
      options.timeZone = effectiveTz;
      return new Intl.DateTimeFormat('en-US', options).format(dateObj);
    };

    let output = '';
    for (let i = 0; i < format.length; i++) {
      if (format[i] !== '%') {
        output += format[i];
        continue;
      }

      i++; // move past '%'
      let flag = '';
      while (i < format.length && ['-', '_', '0', '+', '^', '#'].includes(format[i])) {
        flag += format[i++];
      }
      let width = '';
      while (i < format.length && /\d/.test(format[i])) {
        width += format[i++];
      }
      width = width ? parseInt(width, 10) : 0;

      let modifier = '';
      if (i < format.length && ['E', 'O'].includes(format[i])) {
        modifier = format[i++];
      }

      // Handle multi-character specifiers: %:z, %::z, %:::z
      let char;
      if (format[i] === ':') {
        // Peek ahead to count colons and check for trailing 'z'
        let colons = 0;
        let j = i;
        while (j < format.length && format[j] === ':') { colons++; j++; }
        if (j < format.length && format[j] === 'z') {
          char = ':'.repeat(colons) + 'z';
          i = j; // i will be incremented after switch
        } else {
          char = format[i];
        }
      } else {
        char = format[i];
      }

      let value = '';

      const applyFlags = (str) => {
        let s = String(str);
        if (flag.includes('-')) {
          s = s.replace(/^0+/, '') || '0';
        } else if (flag.includes('_')) {
          s = s.replace(/^0+/, '') || '0';
          if (width > 0) s = s.padStart(width, ' ');
        } else if (flag.includes('0') && width > 0) {
          s = s.padStart(width, '0');
        } else if (width > 0) {
          s = s.padStart(width, '0');
        }
        if (flag.includes('^')) s = s.toUpperCase();
        else if (flag.includes('#')) s = s.toLowerCase();
        return s;
      };

      switch (char) {
        case '%': value = '%'; break;
        case 'a': value = formatIntl({ weekday: 'short' }); break;
        case 'A': value = formatIntl({ weekday: 'long' }); break;
        case 'b': value = formatIntl({ month: 'short' }); break;
        case 'B': value = formatIntl({ month: 'long' }); break;
        case 'c': {
          const weekday = formatIntl({ weekday: 'short' });
          const month   = formatIntl({ month: 'short' });
          const dayStr  = pad(d.getUTCDate(), 2, ' ');
          const hh      = pad(d.getUTCHours(), 2);
          const mm      = pad(d.getUTCMinutes(), 2);
          const ss      = pad(d.getUTCSeconds(), 2);
          const yr      = d.getUTCFullYear();
          const tzAbbr  = getTzAbbreviation(dateObj, effectiveTz);
          value = `${weekday} ${month} ${dayStr} ${hh}:${mm}:${ss} ${tzAbbr} ${yr}`;
          break;
        }
        case 'C': value = pad(Math.floor(d.getUTCFullYear() / 100), 2); break;
        case 'd': value = pad(d.getUTCDate(), 2); break;
        case 'D': value = `${pad(d.getUTCMonth() + 1, 2)}/${pad(d.getUTCDate(), 2)}/${pad(d.getUTCFullYear() % 100, 2)}`; break;
        case 'e': value = pad(d.getUTCDate(), 2, ' '); break;
        case 'F': {
          let yr = d.getUTCFullYear();
          let yrStr = (flag.includes('+') && yr > 9999 ? '+' : '') + pad(yr, 4);
          value = `${yrStr}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
          break;
        }
        case 'g': value = pad(getISOWeekYear(d) % 100, 2); break;
        case 'G': value = pad(getISOWeekYear(d), 4); break;
        case 'h': value = formatIntl({ month: 'short' }); break;
        case 'H': value = pad(d.getUTCHours(), 2); break;
        case 'I': value = pad(d.getUTCHours() % 12 || 12, 2); break;
        case 'j': value = pad(getDayOfYear(d), 3); break;
        case 'k': value = pad(d.getUTCHours(), 2, ' '); break;
        case 'l': value = pad(d.getUTCHours() % 12 || 12, 2, ' '); break;
        case 'm': value = pad(d.getUTCMonth() + 1, 2); break;
        case 'M': value = pad(d.getUTCMinutes(), 2); break;
        case 'n': value = '\n'; break;
        case 'N': {
          const ns = dateObj.getUTCMilliseconds() * 1000000;
          value = pad(ns, width > 0 ? width : 9);
          break;
        }
        case 'p': {
          const h12 = formatIntl({ hour: 'numeric', hourCycle: 'h12' });
          value = h12.slice(-2).toUpperCase();
          break;
        }
        case 'P': {
          const h12 = formatIntl({ hour: 'numeric', hourCycle: 'h12' });
          value = h12.slice(-2).toLowerCase();
          break;
        }
        case 'q': value = String(getQuarter(d)); break;
        case 'r':
          value = formatIntl({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h12' });
          break;
        case 'R': value = `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}`; break;
        case 's': value = String(Math.floor(dateObj.getTime() / 1000)); break;
        case 'S': value = pad(d.getUTCSeconds(), 2); break;
        case 't': value = '\t'; break;
        case 'T': value = `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`; break;
        case 'u': value = String(d.getUTCDay() === 0 ? 7 : d.getUTCDay()); break;
        case 'U': value = pad(getWeekNumber(d, 0), 2); break;
        case 'V': value = pad(getISOWeekNumber(d), 2); break;
        case 'w': value = String(d.getUTCDay()); break;
        case 'W': value = pad(getWeekNumber(d, 1), 2); break;
        case 'x': value = formatIntl({ year: 'numeric', month: '2-digit', day: '2-digit' }); break;
        case 'X': value = formatIntl({ hour: '2-digit', minute: '2-digit', second: '2-digit' }); break;
        case 'y': value = pad(d.getUTCFullYear() % 100, 2); break;
        case 'Y': {
          let yr = d.getUTCFullYear();
          if (flag.includes('+') && yr > 9999) {
            value = '+' + String(yr);
          } else {
            value = String(yr);
          }
          break;
        }
        case 'z':    value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'hhmm'); break;
        case ':z':   value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'hh:mm'); break;
        case '::z':  value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'hh:mm:ss'); break;
        case ':::z': value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'precision'); break;
        case 'Z':
          value = getTzAbbreviation(dateObj, effectiveTz);
          break;
        default:
          value = '%' + (flag || '') + (width || '') + (modifier || '') + char;
          break;
      }
      output += applyFlags(value);
    }
    return output;
  }

  function adjust_resolution(format) {
    let copy = '';
    let adjusted = false;
    for (let i = 0; i < format.length; i++) {
      if (format[i] === '%') {
        if (format[i + 1] === '-' && format[i + 2] === 'N') {
          copy += `%9N`;
          i += 2;
          adjusted = true;
        } else {
          copy += format[i];
          if (format[i + 1] === '%') {
            copy += format[i + 1];
            i++;
          }
        }
      } else {
        copy += format[i];
      }
    }
    return adjusted ? copy : null;
  }

  // --- Main Logic ---
  let datestr = null;
  let set_datestr = null;
  let set_date = false;
  let format = null;
  let format_in_c_locale = false;
  let get_resolution = false;
  let batch_file = null;
  let reference = null;
  let tzstring = null;
  let debug_date_parsing = false;

  const { options, args } = parseArgs(argv);

  // Process options (all keys are now canonical short chars or special constants)
  for (const optKey in options) {
    switch (optKey) {
      case 'd': datestr = options[optKey]; break;
      case DEBUG_DATE_PARSING_OPTION: debug_date_parsing = true; break;
      case 'f': batch_file = options[optKey]; break;
      case RESOLUTION_OPTION: get_resolution = true; break;
      case RFC_3339_OPTION: {
        const rfc_3339_formats = [
          "%Y-%m-%d",
          "%Y-%m-%d %H:%M:%S%:z",
          "%Y-%m-%d %H:%M:%S.%N%:z"
        ];
        const arg = options[optKey];
        const mappedIndex = ["date", "seconds", "ns"].indexOf(arg);
        if (mappedIndex === -1) {
          error(1, `invalid argument '${arg}' for '--rfc-3339'`);
        }
        format = rfc_3339_formats[mappedIndex];
        format_in_c_locale = true;
        break;
      }
      case 'I': {
        const iso_8601_formats = [
          "%Y-%m-%d",
          "%Y-%m-%dT%H:%M:%S%:z",
          "%Y-%m-%dT%H:%M:%S,%N%:z",
          "%Y-%m-%dT%H%:::z",
          "%Y-%m-%dT%H:%M%:z"
        ];
        const arg = options[optKey];
        const argToIndexMap = { "": 0, "date": 0, "hours": 3, "minutes": 4, "seconds": 1, "ns": 2 };
        const mappedIndex = argToIndexMap[arg];
        if (mappedIndex === undefined) {
          error(1, `invalid argument '${arg}' for '--iso-8601'`);
        }
        if (format !== null) {
          error(1, "multiple output formats specified");
        }
        format = iso_8601_formats[mappedIndex];
        format_in_c_locale = true;
        break;
      }
      case 'r': reference = options[optKey]; break;
      case 'R':
        if (format !== null) {
          error(1, "multiple output formats specified");
        }
        format = rfc_email_format;
        format_in_c_locale = true;
        break;
      case 's': set_datestr = options[optKey]; set_date = true; break;
      case 'u': tzstring = "UTC0"; break;
    }
  }

  // Process positional arguments
  let positionalFormat = null;

  for (const arg of args) {
    if (arg.startsWith('+')) {
      if (positionalFormat) error(1, "multiple output formats specified");
      positionalFormat = arg.substring(1);
    } else {
      const dateSourceOptions = (datestr ? 1 : 0) + (batch_file ? 1 : 0) + (reference ? 1 : 0) + (get_resolution ? 1 : 0);
      if (dateSourceOptions) {
        error(1, `the argument '${arg}' lacks a leading '+';\nwhen using an option to specify date(s), any non-option\nargument must be a format string beginning with '+'`);
      }
      if (set_date) {
        error(1, `the argument '${arg}' lacks a leading '+';\nwhen using an option to specify date(s), any non-option\nargument must be a format string beginning with '+'`);
      }
      set_datestr = arg;
      set_date = true;
    }
  }

  if (positionalFormat) {
    if (format !== null) error(1, "multiple output formats specified");
    format = positionalFormat;
  }

  // Check for mutually exclusive options related to date source
  const option_specified_date = (datestr ? 1 : 0) + (batch_file ? 1 : 0) + (reference ? 1 : 0) + (get_resolution ? 1 : 0);

  if (option_specified_date > 1) {
    error(1, "the options to specify dates for printing are mutually exclusive");
  }

  if (set_date && option_specified_date) {
    error(1, "the options to print and set the time may not be used together");
  }

  if (!format) {
    format = DATE_FMT_LANGINFO_DEFAULT;
  }

  const format_res = adjust_resolution(format) || format;

  if (!tzstring) {
    tzstring = getenv("TZ") || 'UTC';
  }

  let finalOutput = '';
  let ok = true;
  let when = gettime();

  if (batch_file !== null) {
    let fileContents;
    try {
      fileContents = readFileSync(batch_file);
    } catch (e) {
      // error() already threw if file not found; rethrow
      throw e;
    }

    const lines = fileContents.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const { date: parsedDate, tz: explicitTzFromBatch } = parseDatetime(line, gettime(), tzstring);
      const effectiveTzForBatch = explicitTzFromBatch || tzstring;

      if (!parsedDate || isNaN(parsedDate.getTime())) {
        stderrFn(`${PROGRAM_NAME}: invalid date "${line}"\n`);
        ok = false;
      } else {
        finalOutput += show_date_formatter(format_res, parsedDate, effectiveTzForBatch, format_in_c_locale) + '\n';
      }
    }
  } else {
    let valid_date = true;
    let explicitTz = null;

    if (reference !== null) {
      try {
        when = stat(reference).mtime;
      } catch (e) {
        throw e;
      }
    } else if (get_resolution) {
      // --resolution: output "0.000000001" for 1ns resolution
      // Format is "%s.%N". We need when=epoch+0ms but gettime_res()ns.
      // %s outputs floor(dateObj.getTime()/1000) = 0
      // %N outputs dateObj.getUTCMilliseconds()*1000000
      // For 1ns resolution: we need %N to output "000000001"
      // But JS only has ms precision, so we fake it: store res in a side channel
      when = new Date(0);
      // We'll handle --resolution output specially below
    } else if (set_date && set_datestr) {
      const { date: parsed, tz: parsedExplicitTz } = parseDatetime(set_datestr, gettime(), tzstring);
      if (!parsed || isNaN(parsed.getTime())) {
        const posixParsed = parsePosixDate(set_datestr, gettime(), tzstring);
        if (!posixParsed || isNaN(posixParsed.getTime())) {
          valid_date = false;
        } else {
          when = posixParsed;
        }
      } else {
        when = parsed;
        explicitTz = parsedExplicitTz;
      }
    } else if (datestr) {
      const { date: parsed, tz: parsedExplicitTz } = parseDatetime(datestr, gettime(), tzstring);
      if (!parsed || isNaN(parsed.getTime())) {
        valid_date = false;
      } else {
        when = parsed;
        explicitTz = parsedExplicitTz;
      }
    }

    if (!valid_date) {
      error(1, `invalid date '${datestr || set_datestr}'`);
    }

    if (set_date) {
      if (!settime(when)) {
        error(1, "cannot set date");
        ok = false;
      }
    }

    if (debug_date_parsing) {
      stderrFn(`output format: "${format}"\n`);
    }

    if (get_resolution) {
      // Special handling: produce "0.NNNNNNNNN" where N = resolution in ns
      const resNs = gettime_res(); // e.g. 1 for 1ns
      const seconds = '0';
      const nanoStr = String(resNs).padStart(9, '0');
      finalOutput = `${seconds}.${nanoStr}`;
    } else {
      const effectiveTzForDisplay = explicitTz || tzstring;
      finalOutput = show_date_formatter(format_res, when, effectiveTzForDisplay, format_in_c_locale);
    }
  }

  // Remove trailing newline added by batch processing if format doesn't contain %n
  if (!format.includes('%n') && finalOutput.endsWith('\n') && batch_file === null) {
    finalOutput = finalOutput.slice(0, -1);
  }

  if (!ok) {
    // Partial success in batch mode: already printed what we could, just return what we have
    return finalOutput;
  }

  return finalOutput;
}




test('date() returns current date and time by default (UTC mock)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // Friday, March 15, 2024
  const expectedOutput = 'Fri Mar 15 10:30:00 UTC 2024';
  expect(date([], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe(expectedOutput);
});

test('date([]) with no explicit TZ uses system TZ (mocked)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // Friday, March 15, 2024
  // If system TZ is America/New_York (UTC-0500), local time would be 05:30:00.
  const expectedOutput = 'Fri Mar 15 05:30:00 EST 2024';
  expect(date([], { now: TEST_DATE_UTC, env: { TZ: 'America/New_York' } })).toBe(expectedOutput);
});

test('date(["+%Y-%m-%d"]) formats to year-month-day (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%Y-%m-%d'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-15');
});

test('date(["+%H:%M:%S"]) formats to hour:minute:second (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%H:%M:%S'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('10:30:00');
});

test('date(["+%Z"]) shows timezone abbreviation (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%Z'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('UTC');
});

test('date(["+%z"]) shows numeric timezone offset (+0000 for UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%z'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('+0000');
});

test('date(["+%::z"]) shows numeric timezone offset with colon to second precision', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%::z'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('+00:00:00');
});

test('date(["+%a, %d %b %Y %H:%M:%S %z"]) matches RFC 5322 format (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%a, %d %b %Y %H:%M:%S %z'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('Fri, 15 Mar 2024 10:30:00 +0000');
});

test('date(["-u"]) forces UTC output', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['-u'], { now: TEST_DATE_UTC, env: { TZ: 'America/New_York' } })).toBe('Fri Mar 15 10:30:00 UTC 2024');
});

test('date(["-u", "+%z"]) shows +0000 for UTC', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['-u', '+%z'], { now: TEST_DATE_UTC, env: { TZ: 'America/New_York' } })).toBe('+0000');
});

test('date(["-d", "2023-01-01"]) displays specified date (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // irrelevant 'now'
  expect(date(['-d', '2023-01-01', '+%Y-%m-%d'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2023-01-01');
});

test('date(["-d", "next Friday"]) displays relative date (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // MOCK_CURRENT_DATE is a Friday
  const nextFriday = new Date('2024-03-22T00:00:00.000Z'); // The *start* of next Friday in UTC
  expect(date(['-d', 'next Friday', '+%Y-%m-%d'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-22');
});

test('date(["-d", "tomorrow"]) displays tomorrow (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  const tomorrow = new Date('2024-03-16T10:30:00.000Z');
  expect(date(['-d', 'tomorrow', '+%Y-%m-%d %H:%M:%S'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-16 10:30:00');
});

test('date(["-d", "last monday"]) displays last monday (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // Friday
  const lastMonday = new Date('2024-03-11T00:00:00.000Z');
  expect(date(['-d', 'last monday', '+%Y-%m-%d'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-11');
});

test('date(["-d", "2024-03-15 10:30:00 UTC", "+%z"]) with explicit TZ in string', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // irrelevant 'now'
  expect(date(['-d', '2024-03-15 10:30:00 UTC', '+%z'], { now: TEST_DATE_UTC, env: { TZ: 'America/New_York' } })).toBe('+0000');
});

test('date(["--iso-8601"]) outputs in default ISO 8601 format (date)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['--iso-8601'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-15');
});

test('date(["--iso-8601=hours"]) outputs in ISO 8601 with hours precision', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['--iso-8601=hours'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-15T10+00');
});

test('date(["--iso-8601=seconds"]) outputs in ISO 8601 with seconds precision', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['--iso-8601=seconds'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-15T10:30:00+00:00');
});

test('date(["--iso-8601=ns"]) outputs in ISO 8601 with nanoseconds precision (JS will be ms)', () => {
  const TEST_DATE_MS_PRECISION = new Date('2024-03-15T10:30:00.123Z');
  expect(date(['--iso-8601=ns'], { now: TEST_DATE_MS_PRECISION, env: { TZ: 'UTC' } })).toBe('2024-03-15T10:30:00,123000000+00:00');
});

test('date(["-R"]) outputs in RFC 5322 (RFC Email) format', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['-R'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('Fri, 15 Mar 2024 10:30:00 +0000');
});

test('date(["--rfc-3339=date"]) outputs in RFC 3339 date-only format', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['--rfc-3339=date'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-15');
});

test('date(["--rfc-3339=seconds"]) outputs in RFC 3339 with seconds precision', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['--rfc-3339=seconds'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-15 10:30:00+00:00');
});

test('date(["--rfc-3339=ns"]) outputs in RFC 3339 with nanoseconds precision (JS will be ms)', () => {
  const TEST_DATE_MS_PRECISION = new Date('2024-03-15T10:30:00.123Z');
  expect(date(['--rfc-3339=ns'], { now: TEST_DATE_MS_PRECISION, env: { TZ: 'UTC' } })).toBe('2024-03-15 10:30:00.123000000+00:00');
});

test('date(["-r", "file.txt", "+%Y-%m-%d %H:%M:%S"]) displays reference file mtime', () => {
  const mockMtime = new Date('2023-01-01T12:00:00.000Z');
  expect(date(['-r', 'file.txt', '+%Y-%m-%d %H:%M:%S'], {
    now: new Date(), // irrelevant
    env: { TZ: 'UTC' },
    fileMtimes: { 'file.txt': mockMtime }
  })).toBe('2023-01-01 12:00:00');
});

test('date(["-r", "nonexistent.txt"]) throws error for non-existent reference file', () => {
  expect(() => date(['-r', 'nonexistent.txt'], { now: new Date(), env: { TZ: 'UTC' } })).toThrow(/nonexistent\.txt/);
});

test('date(["--resolution"]) outputs timestamp resolution (mocked)', () => {
  // Assuming a mocked gettime_res() that returns 1 for nanosecond resolution
  expect(date(['--resolution'], {
    now: new Date(),
    env: { TZ: 'UTC' },
    mockGetTimeResolution: () => 1
  })).toBe('0.000000001');
});

test('date(["-s", "2025-01-01", "+%Y-%m-%d"]) attempts to set time and displays it', () => {
  let setDateAttempted = null;
  const mockSetTime = (d) => { setDateAttempted = d; return true; };
  const output = date(['-s', '2025-01-01', '+%Y-%m-%d'], {
    now: new Date(), // irrelevant
    env: { TZ: 'UTC' },
    mockSetTime: mockSetTime
  });
  expect(setDateAttempted.toISOString()).toContain('2025-01-01');
  expect(output).toBe('2025-01-01');
});

test('date(["-s", "2025-01-01", "+%Y-%m-%d"]) reports failure if setTime fails', () => {
  let setDateAttempted = null;
  const mockSetTime = (d) => { setDateAttempted = d; return false; }; // Simulate failure
  expect(() => date(['-s', '2025-01-01', '+%Y-%m-%d'], {
    now: new Date(),
    env: { TZ: 'UTC' },
    mockSetTime: mockSetTime
  })).toThrow(/cannot set date/);
  expect(setDateAttempted.toISOString()).toContain('2025-01-01');
});

test('date(["010112002025", "+%Y-%m-%d %H:%M"]) sets time with positional argument (YYYY)', () => {
  let setDateAttempted = null;
  const mockSetTime = (d) => { setDateAttempted = d; return true; };
  const output = date(['010112002025', '+%Y-%m-%d %H:%M'], {
    now: new Date(),
    env: { TZ: 'UTC' },
    mockSetTime: mockSetTime
  });
  expect(setDateAttempted.toISOString()).toContain('2025-01-01T12:00');
  expect(output).toBe('2025-01-01 12:00');
});

test('date(["01011200.30", "+%S"]) sets time with seconds precision', () => {
  let setDateAttempted = null;
  const mockSetTime = (d) => { setDateAttempted = d; return true; };
  const output = date(['01011200.30', '+%S'], {
    now: new Date(),
    env: { TZ: 'UTC' },
    mockSetTime: mockSetTime
  });
  expect(setDateAttempted.getSeconds()).toBe(30);
  expect(output).toBe('30');
});

test('date(["-f", "dates.txt", "+%Y"]) processes multiple dates from file', () => {
  const fileContents = '2023-01-01\n2024-02-02\n';
  const expectedOutput = '2023\n2024\n';
  expect(date(['-f', 'dates.txt', '+%Y'], {
    now: new Date(),
    env: { TZ: 'UTC' },
    fileContents: { 'dates.txt': fileContents }
  })).toBe(expectedOutput);
});

test('date(["-f", "-"]) processes multiple dates from stdin (mocked)', () => {
  const fileContents = '2023-01-01\n2024-02-02\n'; // Simulate stdin
  const expectedOutput = '2023\n2024\n';
  expect(date(['-f', '-', '+%Y'], {
    now: new Date(),
    env: { TZ: 'UTC' },
    fileContents: { '-': fileContents } // Mock stdin
  })).toBe(expectedOutput);
});

test('date(["-f", "nonexistent.txt"]) throws error for non-existent file for batch conversion', () => {
  expect(() => date(['-f', 'nonexistent.txt'], { now: new Date(), env: { TZ: 'UTC' } })).toThrow(/nonexistent\.txt/);
});

test('date(["-f", "dates.txt"]) with invalid date in file produces error for that line but continues', () => {
  const fileContents = '2023-01-01\ninvalid-date\n2024-02-02\n';
  // Assuming the `date` function returns an object with output and errorOutput for batch processing
  // or prints errors to stderr and continues for success lines.
  // For `toThrow`, it means the process would exit, so if partial success is allowed, it should not throw.
  // Original C code prints error and continues (for `batch_convert`).
  // Mocking `stderr` for this case:
  let capturedStderr = '';
  const mockStderr = (msg) => { capturedStderr += msg + '\n'; };
  const result = date(['-f', 'dates.txt', '+%Y'], {
    now: new Date(),
    env: { TZ: 'UTC' },
    fileContents: { 'dates.txt': fileContents },
    stderr: mockStderr
  });
  expect(result).toBe('2023\n2024\n');
  expect(capturedStderr).toContain('invalid date "invalid-date"');
});

test('date(["invalid-option"]) throws error for unknown option', () => {
  expect(() => date(['--invalid-option'], { now: new Date() })).toThrow(/unknown option/);
});

test('date(["-d", "tomorrow", "-r", "file.txt"]) throws error for mutually exclusive options', () => {
  expect(() => date(['-d', 'tomorrow', '-r', 'file.txt'], { now: new Date() })).toThrow(/mutually exclusive/);
});

test('date(["-s", "tomorrow", "-d", "yesterday"]) throws error for print and set together', () => {
  expect(() => date(['-s', 'tomorrow', '-d', 'yesterday'], { now: new Date() })).toThrow(/print and set the time may not be used together/);
});

test('date(["+%Y", "+%m"]) throws error for multiple output formats', () => {
  expect(() => date(['+%Y', '+%m'], { now: new Date() })).toThrow(/multiple output formats specified/);
});

test('date(["invalid-date-string"]) throws error for invalid date argument without +', () => {
  expect(() => date(['invalid-date-string'], { now: new Date() })).toThrow(/invalid date/);
});

test('date(["--debug"]) does not affect normal output (UTC)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  const expectedOutput = 'Fri Mar 15 10:30:00 UTC 2024';
  let capturedStderr = '';
  const mockStderr = (msg) => { capturedStderr += msg + '\n'; };
  const output = date(['--debug'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' }, stderr: mockStderr });
  expect(output).toBe(expectedOutput);
  expect(capturedStderr).toContain('output format: "%a %b %e %H:%M:%S %Z %Y"');
});

// Test format flags: -, _, 0, +, ^, #
test('date(["+%-H"]) removes padding for hour (10)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%-H'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('10');
});

test('date(["+%-H"]) removes padding for hour (01)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T01:30:00.000Z');
  expect(date(['+%-H'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('1');
});

test('date(["+%_d"]) pads day with space (01)', () => {
  const TEST_DATE_UTC = new Date('2024-03-01T10:30:00.000Z');
  expect(date(['+%_d'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe(' 1');
});

test('date(["+%0m"]) pads month with zero (03)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%0m'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('03');
});

test('date(["+%+Y"]) pads year with zeros and sign for >4 digits (mocked for future year)', () => {
  const TEST_DATE_FAR_FUTURE_UTC = new Date('10000-03-15T10:30:00.000Z');
  expect(date(['+%+Y'], { now: TEST_DATE_FAR_FUTURE_UTC, env: { TZ: 'UTC' } })).toBe('+10000');
});

test('date(["+%^A"]) converts weekday to uppercase', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // Friday
  expect(date(['+%^A'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('FRIDAY');
});

test('date(["+%#A"]) converts weekday to opposite case (lowercase)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // Friday
  expect(date(['+%#A'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('friday');
});

test('date(["+%N"]) outputs nanoseconds (JS will be milliseconds * 10^6)', () => {
  const TEST_DATE_MS_PRECISION = new Date('2024-03-15T10:30:00.123Z');
  expect(date(['+%N'], { now: TEST_DATE_MS_PRECISION, env: { TZ: 'UTC' } })).toBe('123000000');
});

test('date(["+%s"]) outputs seconds since epoch', () => {
  const TEST_DATE_UTC = new Date('1970-01-01T00:00:00.000Z'); // Epoch
  expect(date(['+%s'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('0');
  const TEST_DATE_LATER_UTC = new Date('2024-03-15T10:30:00.000Z');
  // Expected value calculated: Math.floor(new Date('2024-03-15T10:30:00.000Z').getTime() / 1000)
  expect(date(['+%s'], { now: TEST_DATE_LATER_UTC, env: { TZ: 'UTC' } })).toBe('1710508200');
});

test('date(["+%D"]) outputs date as %m/%d/%y', () => {
  const TEST_DATE_UTC = new Date('2024-03-05T10:30:00.000Z');
  expect(date(['+%D'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('03/05/24');
});

test('date(["+%F"]) outputs date as %+4Y-%m-%d', () => {
  const TEST_DATE_UTC = new Date('2024-03-05T10:30:00.000Z');
  expect(date(['+%F'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024-03-05');
});

test('date(["+%R"]) outputs time as %H:%M', () => {
  const TEST_DATE_UTC = new Date('2024-03-05T10:30:00.000Z');
  expect(date(['+%R'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('10:30');
});

test('date(["+%T"]) outputs time as %H:%M:%S', () => {
  const TEST_DATE_UTC = new Date('2024-03-05T10:30:00.000Z');
  expect(date(['+%T'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('10:30:00');
});

test('date(["+%U"]) outputs week number (Sunday as first day)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // Week starts on March 10th (Sunday)
  expect(date(['+%U'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('10');
});

test('date(["+%V"]) outputs ISO week number (Monday as first day)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // ISO week starts on March 11th (Monday)
  expect(date(['+%V'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('11');
});

test('date(["+%W"]) outputs week number (Monday as first day)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // Week starts on March 11th (Monday)
  expect(date(['+%W'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('10');
});

test('date(["+%x"]) outputs locale date representation (en-US mock)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%x'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('03/15/2024');
});

test('date(["+%X"]) outputs locale time representation (en-US mock)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%X'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('10:30:00 AM');
});

test('date(["+%y"]) outputs last two digits of year', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%y'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('24');
});

test('date(["+%q"]) outputs quarter of year (Q1)', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // March is Q1
  expect(date(['+%q'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('1');
});

test('date(["+%q"]) outputs quarter of year (Q2)', () => {
  const TEST_DATE_UTC = new Date('2024-04-15T10:30:00.000Z'); // April is Q2
  expect(date(['+%q'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2');
});

test('date(["+%C"]) outputs century', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%C'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('20');
});

test('date(["+%n%t"]) outputs newline and tab', () => {
  expect(date(['+%n%t'], { now: new Date(), env: { TZ: 'UTC' } })).toBe('\n\t');
});

test('date(["+%j"]) outputs day of year', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z'); // March 15th
  expect(date(['+%j'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('075');
});

test('date(["+%%"]) outputs literal percent sign', () => {
  expect(date(['+%%'], { now: new Date(), env: { TZ: 'UTC' } })).toBe('%');
});

test('date(["-I", "+%Y-%m-%d"]) throws error due to multiple output formats', () => {
  expect(() => date(['-I', '+%Y-%m-%d'], { now: new Date() })).toThrow(/multiple output formats specified/);
});

test('date(["-I", "-R"]) throws error due to multiple output formats', () => {
  expect(() => date(['-I', '-R'], { now: new Date() })).toThrow(/multiple output formats specified/);
});

test('date(["--rfc-3339=invalid"]) throws error for invalid RFC 3339 format option', () => {
  expect(() => date(['--rfc-3339=invalid'], { now: new Date() })).toThrow(/invalid argument/);
});

test('date(["-Iinvalid"]) throws error for invalid ISO 8601 format option', () => {
  expect(() => date(['-Iinvalid'], { now: new Date() })).toThrow(/invalid argument/);
});

test('date(["-s", "invalid date"]) throws error for invalid date with -s', () => {
  expect(() => date(['-s', 'invalid date'], { now: new Date() })).toThrow(/invalid date/);
});

test('date(["invalid", "+%Y"]) throws error for non-option argument without + if options used', () => {
  expect(() => date(['-d', 'today', 'invalid', '+%Y'], { now: new Date() })).toThrow(/lacks a leading '\+'/);
});

test('date(["+%-9N"]) for resolution width (mocked 9 for ns)', () => {
  const TEST_DATE_MS_PRECISION = new Date('2024-03-15T10:30:00.123456789Z');
  // For JS, this will be 123000000, so width is 9
  expect(date(['+%-9N'], {
    now: TEST_DATE_MS_PRECISION,
    env: { TZ: 'UTC' },
    mockGetTimeResolution: () => 1
  })).toBe('123000000');
});

test('date(["+%+Y"]) for year less than 4 digits, no plus sign', () => {
  const TEST_DATE_UTC = new Date('2024-03-15T10:30:00.000Z');
  expect(date(['+%+Y'], { now: TEST_DATE_UTC, env: { TZ: 'UTC' } })).toBe('2024');
});
