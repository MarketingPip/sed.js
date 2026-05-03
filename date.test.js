function date(argv, mockOptions = {}) {
  const PROGRAM_NAME = "date";

  const time_spec_string = [
    "hours", "minutes",
    "date", "seconds", "ns",
  ];
  const time_spec_map = {
    "date": 0, // TIME_SPEC_DATE (corresponds to index 2 in original time_spec array)
    "seconds": 1, // TIME_SPEC_SECONDS (corresponds to index 3)
    "ns": 2,      // TIME_SPEC_NS (corresponds to index 4)
    "hours": 3,   // TIME_SPEC_HOURS (corresponds to index 0)
    "minutes": 4  // TIME_SPEC_MINUTES (corresponds to index 1)
  };

  const rfc_email_format = "%a, %d %b %Y %H:%M:%S %z";

  const DEBUG_DATE_PARSING_OPTION = 'debug-date-parsing';
  const RESOLUTION_OPTION = 'resolution';
  const RFC_3339_OPTION = 'rfc-3339';

  const short_options_map = {
    'd': 'date',
    'f': 'file',
    'I': 'iso-8601',
    'r': 'reference',
    'R': 'rfc-email',
    's': 'set',
    'u': 'utc',
  };

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
    if (status !== 0) { // Equivalent to EXIT_FAILURE
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
  const gettime_res = () => mockOptions.mockGetTimeResolution ? mockOptions.mockGetTimeResolution() : 1; // Default to nanosecond precision (1ns)


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
          optionValue = true; // Flag without value means true
        }

        const mappedOpt = long_options_map[optionName];
        if (!mappedOpt) {
          error(1, `unrecognized option '${arg}'`);
        }

        if (mappedOpt === 'I' || mappedOpt === RFC_3339_OPTION) {
          parsedOptions[mappedOpt] = (optionValue === true) ? '' : optionValue;
        } else {
          parsedOptions[mappedOpt] = optionValue;
        }
        i++;
      } else if (arg.startsWith('-') && arg.length > 1) {
        const shortOpt = arg[1];
        const mappedOpt = short_options_map[shortOpt];

        if (!mappedOpt) {
          error(1, `invalid option -- '${shortOpt}'`);
        }

        if (arg.length > 2) { // e.g., -Idate, -dSTRING
          parsedOptions[mappedOpt] = arg.substring(2);
        } else {
          if (requiresArg(shortOpt)) {
            i++;
            if (i >= cliArgs.length) error(1, `option requires an argument -- '${shortOpt}'`);
            parsedOptions[mappedOpt] = cliArgs[i];
          } else { // -I, -R, -u
            parsedOptions[mappedOpt] = (mappedOpt === 'I') ? '' : true; // -I without value maps to empty string, others to true
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

  // Helper for padding
  const pad = (num, length, char = '0') => {
    let s = String(num);
    while (s.length < length) {
      s = char + s;
    }
    return s;
  };

  // Parses a date string, which can be an absolute date or a relative date.
  // Returns { date: Date, tz: string|null }
  function parseDatetime(dateStr, baseDate, defaultTzString) {
    let parsedDate = null;
    let explicitTz = null;

    // 1. Try JavaScript's native Date parsing first
    // This handles ISO, RFC, and many common formats, including embedded timezones.
    const nativeParsed = new Date(dateStr);
    if (!isNaN(nativeParsed.getTime())) {
      parsedDate = nativeParsed;
      // Try to extract an explicit TZ from the string (heuristic, not foolproof)
      const tzMatch = dateStr.match(/\s([A-Z]{2,5}(?:[+-]\d{4})?|\w+\/[A-Z_]+)\s*$/i);
      if (tzMatch) {
        const matchedTz = tzMatch[1];
        // Common abbreviations that Intl.DateTimeFormat understands
        if (['UTC', 'GMT', 'Z'].includes(matchedTz.toUpperCase())) explicitTz = 'UTC';
        else if (matchedTz.match(/^[+-]\d{4}$/)) explicitTz = 'UTC' + matchedTz.replace('+', '-').replace(/(\d{2})(\d{2})/, '$1:$2'); // '+0400' -> 'UTC-04:00'
        else explicitTz = matchedTz; // Assume it's a valid TZ identifier
      }
    }
    if (parsedDate) return { date: parsedDate, tz: explicitTz };


    // 2. Try relative date parsing (operates on components in `defaultTzString`)
    // Create a date that, when using getUTC* methods, gives the local time components for defaultTzString
    const d = new Date(baseDate.getTime()); 
    
    // Adjust baseDate to its interpretation in the target timezone for relative calculations
    const effectiveBaseDate = createTzAwareDate(baseDate, defaultTzString);
    const relativeDate = new Date(effectiveBaseDate.getTime());

    const lowerDateStr = dateStr.toLowerCase();

    // Helper for setting day of week (works on `relativeDate` which is tz-aware)
    const setDayOfWeek = (targetDay, modifier) => { // targetDay: 0 (Sun) - 6 (Sat)
      const currentDay = relativeDate.getUTCDay(); // Use UTC methods on tz-aware date
      let daysDiff = targetDay - currentDay;
      if (modifier === 'next') {
        if (daysDiff <= 0) daysDiff += 7;
      } else if (modifier === 'last') {
        if (daysDiff >= 0) daysDiff -= 7;
        relativeDate.setUTCHours(0, 0, 0, 0); // For 'last', reset to start of day in target TZ
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
    
    return { date: null, tz: null }; // Failed to parse
  }

  // Parses MMDDhhmm[[CC]YY][.ss] format. Assumes input refers to *local* time in `targetTz`.
  function parsePosixDate(dateStr, baseDate, targetTz) {
    const regex = /^(\d{2})(\d{2})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?(?:\.(\d{2}))?$/;
    const match = dateStr.match(regex);

    if (!match) {
      return null;
    }

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
      const currentYear = baseDate.getFullYear();
      year = parseInt(yy, 10);
      if (year >= 69) {
        year += 1900;
      } else {
        year += 2000;
      }
    } else {
      year = baseDate.getFullYear();
    }
    
    // Use Intl.DateTimeFormat to find the UTC equivalent of this local time in `targetTz`
    const isoString = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(ss, 2)}`;
    
    // Create a Date object from this string, interpreting it in the target timezone.
    // This is tricky as `new Date()` parses as local/UTC based on string format.
    // The most reliable way is often to use the `Intl.DateTimeFormat` again to parse.
    // For simplicity, if targetTz is UTC, interpret as UTC. Otherwise, assume local system interpretation
    // and let `createTzAwareDate` align it later.

    if (targetTz === 'UTC' || targetTz === 'UTC0') {
      return new Date(Date.UTC(year, month - 1, day, hour, minute, ss, 0));
    } else {
      // This will create a Date object where its components in the *system's local TZ* match the inputs.
      // E.g., for "01011200", in New York, it's 12:00 NY time.
      return new Date(year, month - 1, day, hour, minute, ss, 0);
    }
  }

  // Calculates the actual timezone offset in minutes for a given dateObj and tzString.
  // Returns positive for UTC+ (East), negative for UTC- (West).
  function getTzOffsetMinutesAtDate(dateObj, tzString) {
    if (tzString === 'UTC' || tzString === 'UTC0') return 0;
    
    // Use Intl.DateTimeFormat to get components of dateObj in targetTz
    const formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: tzString, hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(dateObj);

    const y = parseInt(parts.find(p => p.type === 'year')?.value, 10);
    const mo = parseInt(parts.find(p => p.type === 'month')?.value, 10);
    const d = parseInt(parts.find(p => p.type === 'day')?.value, 10);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value, 10);
    const mi = parseInt(parts.find(p => p.type === 'minute')?.value, 10);
    const s = parseInt(parts.find(p => p.type === 'second')?.value, 10);

    // Create a UTC date from these components. This represents the 'local time in targetTz' as a UTC timestamp.
    const dateInTargetTzAsUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    
    // The difference between this UTC representation of the local time and the original dateObj's UTC time
    // is the actual offset of the target timezone from UTC *at this specific date/time*.
    // e.g., if dateObj is 10:00Z, and targetTz local is 06:00, then dateInTargetTzAsUtc is 06:00Z.
    // offset = (06:00Z - 10:00Z) = -4 hours.
    return (dateInTargetTzAsUtc.getTime() - dateObj.getTime()) / (1000 * 60);
  }

  // Formats the timezone offset string (+HHMM, +HH:MM, etc.)
  function formatTzOffset(offsetMinutes, format) {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absOffsetMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absOffsetMinutes / 60);
    const minutes = absOffsetMinutes % 60;
    const seconds = 0; 

    const pad2 = (n) => String(n).padStart(2, '0');

    if (format === 'hhmm') {
      return `${sign}${pad2(hours)}${pad2(minutes)}`;
    } else if (format === 'hh:mm') {
      return `${sign}${pad2(hours)}:${pad2(minutes)}`;
    } else if (format === 'hh:mm:ss') {
      return `${sign}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    } else if (format === 'precision') {
      if (minutes === 0 && seconds === 0) {
        return `${sign}${pad2(hours)}`;
      } else if (seconds === 0) {
        return `${sign}${pad2(hours)}:${pad2(minutes)}`;
      } else {
        return `${sign}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
      }
    }
    return '';
  }

  // Creates a Date object where its UTC components represent the local time
  // in the given timezone. This allows using getUTC* methods to access
  // components for that timezone consistently for calculations.
  function createTzAwareDate(dateObj, tzString) {
    const targetTz = tzString === 'UTC0' ? 'UTC' : tzString;
    if (targetTz === 'UTC') return new Date(dateObj.getTime());

    const offsetMinutes = getTzOffsetMinutesAtDate(dateObj, targetTz);
    return new Date(dateObj.getTime() + offsetMinutes * 60 * 1000);
  }

  // ISO week number and year helper functions (from https://weeknumber.net/how-to/javascript, adapted for UTC)
  function getISOWeekNumber(d) {
    const target = new Date(d.getTime());
    target.setUTCHours(0, 0, 0, 0);
    target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7)); // Thursday in current week
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  }

  function getISOWeekYear(d) {
    const target = new Date(d.getTime());
    target.setUTCHours(0, 0, 0, 0);
    target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
    return target.getUTCFullYear();
  }

  // Calculates week number for %U (Sunday as first day) and %W (Monday as first day)
  function getWeekNumber(date, firstDayOfWeek) { // 0 for Sunday, 1 for Monday
    const d = new Date(date.getTime());
    d.setUTCHours(0, 0, 0, 0);

    const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const jan1DayOfWeek = jan1.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    // Day of year (0-indexed)
    const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / (1000 * 60 * 60 * 24));

    // Calculate week number based on firstDayOfWeek
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
    const diff = dateObj.getTime() - startOfYear.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
  }

  function getQuarter(dateObj) {
    return Math.floor(dateObj.getUTCMonth() / 3) + 1;
  }

  // The main formatting function
  function show_date_formatter(format, dateObj, tzString, useCLocale = false) {
    const locale = useCLocale ? 'en-US' : 'en-US';
    const effectiveTz = tzString === 'UTC0' ? 'UTC' : tzString;
    
    // Create an intermediate Date object whose UTC components reflect the effectiveTz's local time
    const d = createTzAwareDate(dateObj, effectiveTz);

    // Helper to format a part of the original dateObj *into* the effective timezone
    const formatIntl = (options) => {
      options.timeZone = effectiveTz;
      return new Intl.DateTimeFormat(locale, options).format(dateObj);
    };

    let output = '';
    for (let i = 0; i < format.length; i++) {
      if (format[i] === '%') {
        i++; // Move past '%'
        let flag = '';
        while (['-', '_', '0', '+', '^', '#'].includes(format[i])) {
          flag += format[i];
          i++;
        }
        let width = '';
        while (/\d/.test(format[i])) {
          width += format[i];
          i++;
        }
        width = width ? parseInt(width, 10) : 0;

        let modifier = '';
        if (['E', 'O'].includes(format[i])) { // Not fully implemented for JS Intl API
          modifier = format[i];
          i++;
        }

        const char = format[i];
        let value = '';
        let numValue;

        // Helper to apply flags
        const applyFlags = (str) => {
          let currentStr = String(str);

          if (flag.includes('-')) {
            currentStr = currentStr.replace(/^0+/, '');
          } else if (flag.includes('_')) {
            currentStr = currentStr.replace(/^0+/, ' ');
          } else if (flag.includes('0') && width > 0) {
            currentStr = pad(currentStr, width, '0');
          } else if (!flag.includes('-') && !flag.includes('_') && width > 0) { // Default padding is '0'
            currentStr = pad(currentStr, width, '0');
          }

          if (flag.includes('^')) {
            currentStr = currentStr.toUpperCase();
          } else if (flag.includes('#')) {
            currentStr = currentStr.toLowerCase();
          }
          return currentStr;
        };

        switch (char) {
          case '%': value = '%'; break;
          case 'a': value = formatIntl({ weekday: 'short' }); break;
          case 'A': value = formatIntl({ weekday: 'long' }); break;
          case 'b': value = formatIntl({ month: 'short' }); break;
          case 'B': value = formatIntl({ month: 'long' }); break;
          case 'c': // Default: Fri Mar 15 10:30:00 UTC 2024
            const weekday = formatIntl({ weekday: 'short' });
            const month = formatIntl({ month: 'short' });
            const dayOfMonth = pad(d.getUTCDate(), 2, ' ');
            const hours = pad(d.getUTCHours(), 2);
            const minutes = pad(d.getUTCMinutes(), 2);
            const seconds = pad(d.getUTCSeconds(), 2);
            const year = d.getUTCFullYear();
            const tzAbbr = formatIntl({ timeZoneName: 'short' });
            value = `${weekday} ${month} ${dayOfMonth} ${hours}:${minutes}:${seconds} ${tzAbbr} ${year}`;
            break;
          case 'C': numValue = Math.floor(d.getUTCFullYear() / 100); value = pad(numValue, 2); break;
          case 'd': numValue = d.getUTCDate(); value = pad(numValue, 2); break;
          case 'D': value = `${pad(d.getUTCMonth() + 1, 2)}/${pad(d.getUTCDate(), 2)}/${pad(d.getUTCFullYear() % 100, 2)}`; break;
          case 'e': numValue = d.getUTCDate(); value = pad(numValue, 2, ' '); break;
          case 'F': 
            let fullYear = d.getUTCFullYear();
            let yearStr = (flag.includes('+') && fullYear > 9999 ? '+' : '') + pad(fullYear, 4);
            value = `${yearStr}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
            break;
          case 'g': numValue = getISOWeekYear(d) % 100; value = pad(numValue, 2); break;
          case 'G': numValue = getISOWeekYear(d); value = pad(numValue, 4); break;
          case 'h': value = formatIntl({ month: 'short' }); break;
          case 'H': numValue = d.getUTCHours(); value = pad(numValue, 2); break;
          case 'I': numValue = d.getUTCHours() % 12 || 12; value = pad(numValue, 2); break;
          case 'j': numValue = getDayOfYear(d); value = pad(numValue, 3); break;
          case 'k': numValue = d.getUTCHours(); value = pad(numValue, 2, ' '); break;
          case 'l': numValue = d.getUTCHours() % 12 || 12; value = pad(numValue, 2, ' '); break;
          case 'm': numValue = d.getUTCMonth() + 1; value = pad(numValue, 2); break;
          case 'M': numValue = d.getUTCMinutes(); value = pad(numValue, 2); break;
          case 'n': value = '\n'; break;
          case 'N':
            numValue = dateObj.getUTCMilliseconds() * 1000000;
            value = pad(numValue, width > 0 ? width : 9); // Pad to 9 for nanoseconds
            break;
          case 'p': value = formatIntl({ hour: 'numeric', hourCycle: 'h12' }).slice(-2); break;
          case 'P': value = formatIntl({ hour: 'numeric', hourCycle: 'h12' }).slice(-2).toLowerCase(); break;
          case 'q': numValue = getQuarter(d); value = String(numValue); break;
          case 'r': // locale's 12-hour clock time (e.g., 11:11:04 PM)
            value = formatIntl({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h12', timeZoneName: 'short' });
            break;
          case 'R': value = `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}`; break;
          case 's': numValue = Math.floor(dateObj.getTime() / 1000); value = String(numValue); break;
          case 'S': numValue = d.getUTCSeconds(); value = pad(numValue, 2); break;
          case 't': value = '\t'; break;
          case 'T': value = `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`; break;
          case 'u': numValue = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); value = String(numValue); break;
          case 'U': numValue = getWeekNumber(d, 0); value = pad(numValue, 2); break;
          case 'V': numValue = getISOWeekNumber(d); value = pad(numValue, 2); break;
          case 'w': numValue = d.getUTCDay(); value = String(numValue); break;
          case 'W': numValue = getWeekNumber(d, 1); value = pad(numValue, 2); break;
          case 'x': value = formatIntl({ year: 'numeric', month: '2-digit', day: '2-digit' }); break;
          case 'X': value = formatIntl({ hour: '2-digit', minute: '2-digit', second: '2-digit' }); break;
          case 'y': numValue = d.getUTCFullYear() % 100; value = pad(numValue, 2); break;
          case 'Y': value = String(d.getUTCFullYear()); break;
          case 'z': value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'hhmm'); break;
          case ':z': value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'hh:mm'); break;
          case '::z': value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'hh:mm:ss'); break;
          case ':::z': value = formatTzOffset(getTzOffsetMinutesAtDate(dateObj, effectiveTz), 'precision'); break;
          case 'Z':
            value = formatIntl({ timeZoneName: 'short' });
            if (effectiveTz === 'UTC' && value === '') value = 'UTC'; // Fallback for UTC if Intl fails
            break;
          default:
            value = '%' + char; // Unrecognized format sequence
            break;
        }
        output += applyFlags(value);
      } else {
        output += format[i];
      }
    }
    return output;
  }

  // Adjusts the format string for %-N resolution based on gettime_res
  function adjust_resolution(format) {
    let copy = '';
    let adjusted = false;
    for (let i = 0; i < format.length; i++) {
      if (format[i] === '%') {
        if (format[i+1] === '-' && format[i+2] === 'N') {
          copy += `%9N`; // Assuming nanosecond precision (always 9 for JS mock)
          i += 2;
          adjusted = true;
        } else {
          copy += format[i];
          if (format[i+1] === '%') { // Handle %%
            copy += format[i+1];
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
  let tzstring = null; // Default timezone for operations and display
  let parsedTzFromDateStr = null; // Explicit TZ if parsed from -d or -s string
  let debug_date_parsing = false;

  const { options, args } = parseArgs(argv);

  // Process options
  for (const optKey in options) {
    switch (optKey) {
      case 'd': datestr = options[optKey]; break;
      case DEBUG_DATE_PARSING_OPTION: debug_date_parsing = true; break;
      case 'f': batch_file = options[optKey]; break;
      case RESOLUTION_OPTION: get_resolution = true; break;
      case RFC_3339_OPTION: {
        const rfc_3339_formats = [
          "%Y-%m-%d",                     // date
          "%Y-%m-%d %H:%M:%S%:z",         // seconds
          "%Y-%m-%d %H:%M:%S.%N%:z"       // ns
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
          "%Y-%m-%d",                     // date
          "%Y-%m-%dT%H:%M:%S%:z",         // seconds
          "%Y-%m-%dT%H:%M:%S,%N%:z",      // ns
          "%Y-%m-%dT%H%:z",               // hours
          "%Y-%m-%dT%H:%M%:z"             // minutes
        ];
        const arg = options[optKey];
        let mappedIndex;
        if (arg === '') {
          mappedIndex = time_spec_map.date; // Default for -I is date precision
        } else {
          const argToIndexMap = { "hours": 3, "minutes": 4, "date": 0, "seconds": 1, "ns": 2 };
          mappedIndex = argToIndexMap[arg];
        }

        if (mappedIndex === undefined || mappedIndex === -1) {
          error(1, `invalid argument '${arg}' for '--iso-8601'`);
        }
        format = iso_8601_formats[mappedIndex];
        format_in_c_locale = true;
        break;
      }
      case 'r': reference = options[optKey]; break;
      case 'R': format = rfc_email_format; format_in_c_locale = true; break;
      case 's': set_datestr = options[optKey]; set_date = true; break;
      case 'u': tzstring = "UTC0"; break;
    }
  }

  // Process positional arguments
  let positionalFormat = null;
  let positionalSetDateStr = null;

  for (const arg of args) {
    if (arg.startsWith('+')) {
      if (positionalFormat) error(1, "multiple output formats specified");
      positionalFormat = arg.substring(1);
    } else {
      if (positionalSetDateStr) error(1, `extra operand '${arg}'`);
      positionalSetDateStr = arg;
    }
  }

  if (positionalFormat) {
    if (format) error(1, "multiple output formats specified");
    format = positionalFormat;
  }
  
  if (positionalSetDateStr) {
    const dateSourceOptions = (datestr ? 1 : 0) + (batch_file ? 1 : 0) + (reference ? 1 : 0) + (get_resolution ? 1 : 0);
    if (dateSourceOptions) {
        error(1, `the argument '${positionalSetDateStr}' lacks a leading '+';\nwhen using an option to specify date(s), any non-option\nargument must be a format string beginning with '+'`);
    }
    set_datestr = positionalSetDateStr;
    set_date = true;
  }

  // Check for mutually exclusive options related to date source
  let option_specified_date = (datestr ? 1 : 0) + (batch_file ? 1 : 0) + (reference ? 1 : 0) + (get_resolution ? 1 : 0);

  if (option_specified_date > 1) {
    error(1, "the options to specify dates for printing are mutually exclusive");
  }

  if (set_date && option_specified_date) {
    error(1, "the options to print and set the time may not be used together");
  }

  // Default format if none specified
  if (!format) {
    if (get_resolution) {
      format = "%s.%N"; // This is handled by formatter now, not special return
    } else {
      format = DATE_FMT_LANGINFO_DEFAULT;
    }
  }
  
  const format_res = adjust_resolution(format) || format;

  if (!tzstring) {
    tzstring = getenv("TZ") || 'UTC0'; // Default to UTC if no TZ is set
  }

  let finalOutput = '';
  let ok = true;
  let when = gettime(); // Default to 'now'

  if (batch_file !== null) {
    let fileContents;
    let inputFilenameForError = batch_file;

    try {
      fileContents = readFileSync(batch_file);
    } catch (e) {
      error(1, `${inputFilenameForError}: ${e.message}`);
    }

    const lines = fileContents.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
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
  } else { // Single date processing
    let valid_date = true;
    let explicitTz = null;

    if (reference !== null) {
      try {
        when = stat(reference).mtime;
      } catch (e) {
        error(1, e.message);
      }
    } else if (get_resolution) {
      // For --resolution, date object is conceptually epoch + 1 nanosecond (mocked)
      // The format "%s.%N" will then yield 0.000000001
      when = new Date(0); 
      when.setUTCMilliseconds(gettime_res() / 1000000); // Set milliseconds for %N to pick up
    } else if (set_datestr) {
      const { date: parsed, tz: parsedExplicitTz } = parseDatetime(set_datestr, gettime(), tzstring);
      if (!parsed || isNaN(parsed.getTime())) {
        // Try POSIX-style MMDDhhmm[[CC]YY][.ss]
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
    // If no specific date option, `when` remains `gettime()` (now)

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

    // If an explicit TZ was found in the date string, it overrides the default tzstring for display
    const effectiveTzForDisplay = explicitTz || tzstring;
    finalOutput = show_date_formatter(format_res, when, effectiveTzForDisplay, format_in_c_locale);
  }

  // Remove trailing newline if it's not explicitly part of the format string (e.g., %n)
  if (!format.includes('%n') && finalOutput.endsWith('\n')) {
    finalOutput = finalOutput.slice(0, -1);
  }

  if (!ok) {
    error(1, `Errors encountered during date processing.`);
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
