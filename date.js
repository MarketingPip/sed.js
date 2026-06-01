export function date(argv, mockOptions = {}) {
  const PROGRAM_NAME = "date";

  const rfc_email_format = "%a, %d %b %Y %H:%M:%S %z";
  const DEBUG_OPTION    = 'debug-date-parsing';
  const RESOLUTION_OPT  = 'resolution';
  const RFC_3339_OPT    = 'rfc-3339';

  // Canonical keys used in parsedOptions (short char or special constant)
  const short_options_map = { d:'d', f:'f', I:'I', r:'r', R:'R', s:'s', u:'u' };
  const long_options_map  = {
    'date':'d', 'debug':DEBUG_OPTION, 'file':'f', 'iso-8601':'I',
    'reference':'r', 'resolution':RESOLUTION_OPT, 'rfc-email':'R',
    'rfc-822':'R', 'rfc-2822':'R', 'rfc-3339':RFC_3339_OPT,
    'set':'s', 'uct':'u', 'utc':'u', 'universal':'u',
  };

  const DEFAULT_FMT = "%a %b %e %H:%M:%S %Z %Y";

  const stderrFn = mockOptions.stderr || (() => {});

  function error(status, message) {
    if (message) stderrFn(`${PROGRAM_NAME}: ${message}\n`);
    if (status !== 0) throw new Error(message || "Error");
  }

  // System-call abstraction layer (all mockable)
  const gettime       = () => mockOptions.now || new Date();
  const getenv        = (k) => (mockOptions.env && mockOptions.env[k] !== undefined)
                                 ? mockOptions.env[k] : process.env[k];
  const stat          = (path) => {
    if (mockOptions.fileMtimes && mockOptions.fileMtimes[path])
      return { mtime: mockOptions.fileMtimes[path] };
    error(1, `cannot stat '${path}': No such file or directory`);
  };
  const readFile      = (path) => {
    if (mockOptions.fileContents && mockOptions.fileContents[path] !== undefined)
      return mockOptions.fileContents[path];
    error(1, `cannot open '${path}': No such file or directory`);
  };
  const settime       = (d) => mockOptions.mockSetTime ? mockOptions.mockSetTime(d) : true;
  const gettime_res   = () => mockOptions.mockGetTimeResolution
                                ? mockOptions.mockGetTimeResolution() : 1;

  // ─── Argument Parsing ────────────────────────────────────────────────────────

  function parseArgs(cliArgs) {
    const opts = {}, posArgs = [];
    const needsArg = (c) => 'dfrs'.includes(c);
    let i = 0;
    while (i < cliArgs.length) {
      const arg = cliArgs[i];
      if (arg.startsWith('--')) {
        const eq = arg.indexOf('=');
        const name = eq > -1 ? arg.slice(2, eq)  : arg.slice(2);
        const val  = eq > -1 ? arg.slice(eq + 1) : true;
        const key  = long_options_map[name];
        if (!key) error(1, `unrecognized option '${arg}'`);
        opts[key] = (key === 'I' || key === RFC_3339_OPT)
                      ? (val === true ? '' : val)
                      : val;
        i++;
      } else if (arg.startsWith('-') && arg.length > 1) {
        const c   = arg[1];
        const key = short_options_map[c];
        if (!key) error(1, `invalid option -- '${c}'`);
        if (arg.length > 2) {
          opts[key] = arg.slice(2);
        } else if (needsArg(c)) {
          if (++i >= cliArgs.length) error(1, `option requires an argument -- '${c}'`);
          opts[key] = cliArgs[i];
        } else {
          opts[key] = (key === 'I') ? '' : true;
        }
        i++;
      } else {
        posArgs.push(arg); i++;
      }
    }
    return { opts, posArgs };
  }

  // ─── Timezone helpers ────────────────────────────────────────────────────────

  const normTz = (tz) => (tz === 'UTC0' ? 'UTC' : tz);

  // Minutes east of UTC (positive = east/ahead, e.g. +05:30 = +330)
  function tzOffsetMinutes(dateObj, tz) {
    tz = normTz(tz);
    if (tz === 'UTC') return 0;
    const f = new Intl.DateTimeFormat('en-US', {
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      timeZone: tz, hourCycle:'h23'
    });
    const p = f.formatToParts(dateObj);
    const get = (t) => parseInt(p.find(x => x.type === t).value, 10);
    const localAsUtc = new Date(Date.UTC(get('year'), get('month')-1, get('day'),
                                         get('hour'), get('minute'), get('second')));
    return (localAsUtc - dateObj) / 60000;
  }

  // A Date whose .getUTC*() methods return the wall-clock values for `tz`
  function tzDate(dateObj, tz) {
    tz = normTz(tz);
    if (tz === 'UTC') return new Date(dateObj.getTime());
    return new Date(dateObj.getTime() + tzOffsetMinutes(dateObj, tz) * 60000);
  }

  function tzAbbrev(dateObj, tz) {
    tz = normTz(tz);
    if (tz === 'UTC') return 'UTC';
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName:'short' })
                           .formatToParts(dateObj);
      return (parts.find(p => p.type === 'timeZoneName') || {}).value || tz;
    } catch { return tz; }
  }

  function fmtOffset(mins, style) {
    const sign = mins >= 0 ? '+' : '-';
    const abs  = Math.abs(mins);
    const hh   = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm   = String(abs % 60).padStart(2, '0');
    const ss   = '00';
    switch (style) {
      case 'hhmm':    return `${sign}${hh}${mm}`;
      case 'hh:mm':   return `${sign}${hh}:${mm}`;
      case 'hh:mm:ss':return `${sign}${hh}:${mm}:${ss}`;
      case 'minimal': // %:::z — omit :mm if zero
        return (mm === '00') ? `${sign}${hh}` : `${sign}${hh}:${mm}`;
      default: return '';
    }
  }

  // ─── ISO week helpers ─────────────────────────────────────────────────────────

  function isoWeekYear(d) {   // d has UTC components = target-TZ wall clock
    const t = new Date(d); t.setUTCHours(0,0,0,0);
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return t.getUTCFullYear();
  }
  function isoWeekNum(d) {
    const t = new Date(d); t.setUTCHours(0,0,0,0);
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  }
  function weekNum(d, firstDay) {  // firstDay: 0=Sun, 1=Mon
    // Oracle-verified algorithm: count complete firstDay-starting weeks before this date.
    // All days before the year's first firstDay are week 0.
    const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const doy  = Math.floor((d - jan1) / 86400000); // 0-indexed day of year
    const dow  = d.getUTCDay();                       // 0=Sun
    // Day-of-week adjusted so firstDay=0
    const dowAdj     = (dow - firstDay + 7) % 7;
    // Day-of-year of the firstDay of this week (0-indexed); may be negative
    const dayOfStart = doy - dowAdj;
    if (dayOfStart < 0) return 0;
    return Math.floor(dayOfStart / 7) + 1;
  }
  function dayOfYear(d) {
    return Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000) + 1;
  }

  // ─── Formatter ───────────────────────────────────────────────────────────────

  function formatDate(fmt, dateObj, tz) {
    tz = normTz(tz);
    const d   = tzDate(dateObj, tz);        // local-time components via getUTC*
    const off = tzOffsetMinutes(dateObj, tz);

    const intl = (opts) =>
      new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(dateObj);

    const pad  = (n, w=2, c='0') => String(n).padStart(w, c);

    let out = '';
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') { out += fmt[i]; continue; }
      i++;

      // Flags
      let flags = '';
      while (i < fmt.length && '-_0+^#'.includes(fmt[i])) flags += fmt[i++];
      // Width
      let wStr = '';
      while (i < fmt.length && /\d/.test(fmt[i])) wStr += fmt[i++];
      const width = wStr ? parseInt(wStr) : 0;
      // E/O modifier (accepted but not specially handled)
      if (i < fmt.length && 'EO'.includes(fmt[i])) i++;

      // Multi-colon %z variants
      let spec;
      if (fmt[i] === ':') {
        let colons = 0, j = i;
        while (j < fmt.length && fmt[j] === ':') { colons++; j++; }
        if (j < fmt.length && fmt[j] === 'z') { spec = ':'.repeat(colons) + 'z'; i = j; }
        else spec = fmt[i];
      } else {
        spec = fmt[i];
      }

      let val;
      switch (spec) {
        case '%': val = '%'; break;
        case 'n': val = '\n'; break;
        case 't': val = '\t'; break;
        case 'a': val = intl({ weekday:'short' }); break;
        case 'A': val = intl({ weekday:'long'  }); break;
        case 'b':
        case 'h': val = intl({ month:'short' }); break;
        case 'B': val = intl({ month:'long'  }); break;
        case 'c':
          // GNU %c = "%a %b %e %T %Y"  (NO timezone)
          val = `${intl({weekday:'short'})} ${intl({month:'short'})} ${pad(d.getUTCDate(),2,' ')} `
              + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} `
              + `${d.getUTCFullYear()}`;
          break;
        case 'C': val = pad(Math.floor(d.getUTCFullYear() / 100)); break;
        case 'd': val = pad(d.getUTCDate()); break;
        case 'D': val = `${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())}/${pad(d.getUTCFullYear()%100)}`; break;
        case 'e': val = pad(d.getUTCDate(), 2, ' '); break;
        case 'F': {
          const yr = d.getUTCFullYear();
          const yrStr = (flags.includes('+') && yr > 9999) ? '+' + yr : pad(yr, 4);
          val = `${yrStr}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
          break;
        }
        case 'g': val = pad(isoWeekYear(d) % 100); break;
        case 'G': val = String(isoWeekYear(d)); break;
        case 'H': val = pad(d.getUTCHours()); break;
        case 'I': val = pad(d.getUTCHours() % 12 || 12); break;
        case 'j': val = pad(dayOfYear(d), 3); break;
        case 'k': val = pad(d.getUTCHours(), 2, ' '); break;
        case 'l': val = pad(d.getUTCHours() % 12 || 12, 2, ' '); break;
        case 'm': val = pad(d.getUTCMonth() + 1); break;
        case 'M': val = pad(d.getUTCMinutes()); break;
        case 'N': {
          const ns = dateObj.getUTCMilliseconds() * 1000000;
          val = String(ns).padStart(width > 0 ? width : 9, '0');
          break;
        }
        case 'p': val = d.getUTCHours() >= 12 ? 'PM' : 'AM'; break;
        case 'P': val = d.getUTCHours() >= 12 ? 'pm' : 'am'; break;
        case 'q': val = String(Math.floor(d.getUTCMonth() / 3) + 1); break;
        case 'r':
          val = `${pad(d.getUTCHours() % 12 || 12)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} `
              + (d.getUTCHours() >= 12 ? 'PM' : 'AM');
          break;
        case 'R': val = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; break;
        case 's': val = String(Math.floor(dateObj.getTime() / 1000)); break;
        case 'S': val = pad(d.getUTCSeconds()); break;
        case 'T': val = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; break;
        case 'u': val = String(d.getUTCDay() || 7); break;
        case 'U': val = pad(weekNum(d, 0)); break;
        case 'V': val = pad(isoWeekNum(d)); break;
        case 'w': val = String(d.getUTCDay()); break;
        case 'W': val = pad(weekNum(d, 1)); break;
        case 'x': val = `${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())}/${pad(d.getUTCFullYear()%100)}`; break;
        case 'X': val = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; break;
        case 'y': val = pad(d.getUTCFullYear() % 100); break;
        case 'Y': {
          const yr = d.getUTCFullYear();
          val = (flags.includes('+') && yr > 9999) ? '+' + yr : String(yr);
          break;
        }
        case 'z':    val = fmtOffset(off, 'hhmm');    break;
        case ':z':   val = fmtOffset(off, 'hh:mm');   break;
        case '::z':  val = fmtOffset(off, 'hh:mm:ss'); break;
        case ':::z': val = fmtOffset(off, 'minimal'); break;
        case 'Z':    val = tzAbbrev(dateObj, tz);     break;
        default:     val = '%' + flags + wStr + spec; break;
      }

      // Apply flags
      val = String(val);
      if (spec === 'n' || spec === 't') { out += val; continue; }

      // Natural (default) widths for padding
      const naturalWidth = {
        d:2, e:2, H:2, I:2, j:3, k:2, l:2, m:2, M:2, S:2, U:2, V:2, W:2,
        y:2, C:2, g:2, G:4, N:9, u:1, w:1, q:1
      }[spec] || 0;

      const effectiveWidth = width > 0 ? width : naturalWidth;

      if (flags.includes('-')) {
        val = val.replace(/^[ 0]+/, '') || '0';
      } else if (flags.includes('_')) {
        val = val.replace(/^[ 0]+/, '') || '0';
        if (effectiveWidth > 0) val = val.padStart(effectiveWidth, ' ');
      } else if (effectiveWidth > 0) {
        val = val.padStart(effectiveWidth, '0');
      }
      if (flags.includes('^'))      val = val.toUpperCase();
      else if (flags.includes('#')) val = val.toUpperCase(); // GNU: # = alt case = uppercase
      out += val;
    }
    return out;
  }

  // ─── Date string parser ──────────────────────────────────────────────────────
  // Mirrors GNU date's strategy: delegate to the C library strptime / getdate,
  // which in practice means: try JS native parse, then handle relative modifiers.
  // Key oracle insight: "DATE MODIFIER" parses as native Date for the DATE part;
  // relative modifiers (tomorrow/next X/last X) are applied on top of it.

  function parseStr(str, baseDateObj, displayTz) {
    // GNU date uses the *display* timezone when parsing bare dates like "2023-01-01"
    // (they are interpreted as local midnight in displayTz).
    // JS new Date("2023-01-01") treats it as UTC midnight (ISO 8601 date-only = UTC).
    // So we must handle the two cases:

    const lower = str.toLowerCase().trim();

    // Tokenise: split into a date/time part and optional modifiers
    const modifiers = [];
    let base = lower;

    // Extract known relative modifiers
    const relativeRe = /\b(tomorrow|yesterday|\d+\s+(?:second|minute|hour|day|week|month|year)s?|(?:next|last)\s+(?:sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/gi;
    const found = [];
    base = lower.replace(relativeRe, (m) => { found.push(m.toLowerCase()); return ''; }).trim();

    // Parse the base date/time portion
    let when = null;
    if (base === '' || base === 'now') {
      when = new Date(baseDateObj.getTime());
    } else {
      // Try native parse first
      const nativeTry = new Date(base);
      if (!isNaN(nativeTry.getTime())) {
        when = nativeTry;
      } else {
        // Try interpreting bare date (YYYY-MM-DD) as local midnight in displayTz
        const bareDate = base.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (bareDate) {
          const [, y, mo, d] = bareDate.map(Number);
          // Build UTC timestamp for midnight of that date in displayTz
          const tz = normTz(displayTz);
          if (tz === 'UTC') {
            when = new Date(Date.UTC(y, mo-1, d, 0, 0, 0));
          } else {
            // Use a heuristic: create the date at midnight UTC first,
            // then adjust for the tz offset at that approximate moment
            const approx = new Date(Date.UTC(y, mo-1, d, 12, 0, 0));
            const off = tzOffsetMinutes(approx, tz);
            when = new Date(Date.UTC(y, mo-1, d, 0, 0, 0) - off * 60000);
          }
        } else {
          return null;
        }
      }
    }

    // Apply relative modifiers in order
    for (const mod of found) {
      const d = tzDate(when, displayTz);  // wall-clock view

      if (mod === 'tomorrow') {
        when = new Date(when.getTime() + 86400000);
      } else if (mod === 'yesterday') {
        when = new Date(when.getTime() - 86400000);
      } else {
        // next/last WEEKDAY  or  N units
        const nxLast = mod.match(/^(next|last)\s+(\w+)$/);
        const amount = mod.match(/^(\d+)\s+(\w+)$/);
        if (nxLast) {
          const [, dir, dayName] = nxLast;
          const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
          const abbr = ['sun','mon','tue','wed','thu','fri','sat'];
          const target = days.indexOf(dayName) !== -1
                           ? days.indexOf(dayName)
                           : abbr.indexOf(dayName);
          if (target === -1) continue;

          const cur = d.getUTCDay();
          let diff;
          if (dir === 'next') {
            // Oracle: "next X" from X = 0 days (stay), from before X = forward, from after X = wrap
            diff = (target - cur + 7) % 7;
          } else {
            // Oracle: "last X" from X = 0 days (stay), from after X = back, from before X = wrap back
            diff = -((cur - target + 7) % 7);
          }
          when = new Date(when.getTime() + diff * 86400000);
        } else if (amount) {
          const [, n, unit] = amount;
          const num = parseInt(n, 10);
          const unitMap = {
            second:1000, seconds:1000, minute:60000, minutes:60000,
            hour:3600000, hours:3600000, day:86400000, days:86400000,
            week:604800000, weeks:604800000
          };
          if (unitMap[unit]) when = new Date(when.getTime() + num * unitMap[unit]);
        }
      }
    }
    return when;
  }

  // Parses POSIX MMDDhhmm[[CC]YY][.ss]
  function parsePosix(str, baseDate, tz) {
    const m = str.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?(?:\.(\d{2}))?$/);
    if (!m) return null;
    let [, mo, dd, hh, mi, cc, yy, ss] = m;
    [mo, dd, hh, mi, ss] = [mo, dd, hh, mi, ss || '0'].map(Number);
    let yr;
    if (cc && yy) yr = parseInt(cc + yy, 10);
    else if (yy)  yr = parseInt(yy, 10) >= 69 ? 1900 + parseInt(yy) : 2000 + parseInt(yy);
    else           yr = baseDate.getFullYear();
    if (normTz(tz) === 'UTC')
      return new Date(Date.UTC(yr, mo-1, dd, hh, mi, ss));
    return new Date(yr, mo-1, dd, hh, mi, ss);
  }

  // ─── Main logic ───────────────────────────────────────────────────────────────

  let datestr=null, setstr=null, setDate=false, fmt=null, fmtCLocale=false;
  let getRes=false, batchFile=null, reference=null, tz=null, debug=false;

  const { opts, posArgs } = parseArgs(argv);

  for (const key of Object.keys(opts)) {
    switch (key) {
      case 'd': datestr = opts[key]; break;
      case DEBUG_OPTION: debug = true; break;
      case 'f': batchFile = opts[key]; break;
      case RESOLUTION_OPT: getRes = true; break;
      case RFC_3339_OPT: {
        const map = { date:"%Y-%m-%d", seconds:"%Y-%m-%d %H:%M:%S%:z", ns:"%Y-%m-%d %H:%M:%S.%N%:z" };
        if (!map[opts[key]]) error(1, `invalid argument '${opts[key]}' for '--rfc-3339'`);
        if (fmt !== null) error(1, "multiple output formats specified");
        fmt = map[opts[key]]; fmtCLocale = true; break;
      }
      case 'I': {
        const map = {
          '':"%Y-%m-%d", date:"%Y-%m-%d", seconds:"%Y-%m-%dT%H:%M:%S%:z",
          ns:"%Y-%m-%dT%H:%M:%S,%N%:z", hours:"%Y-%m-%dT%H%:z", minutes:"%Y-%m-%dT%H:%M%:z"
        };
        if (map[opts[key]] === undefined) error(1, `invalid argument '${opts[key]}' for '--iso-8601'`);
        if (fmt !== null) error(1, "multiple output formats specified");
        fmt = map[opts[key]]; fmtCLocale = true; break;
      }
      case 'r': reference = opts[key]; break;
      case 'R':
        if (fmt !== null) error(1, "multiple output formats specified");
        fmt = rfc_email_format; fmtCLocale = true; break;
      case 's': setstr = opts[key]; setDate = true; break;
      case 'u': tz = 'UTC'; break;
    }
  }

  for (const arg of posArgs) {
    if (arg.startsWith('+')) {
      if (fmt !== null) error(1, "multiple output formats specified");
      fmt = arg.slice(1);
    } else {
      const hasDateSrc = !!(datestr || batchFile || reference || getRes);
      if (hasDateSrc || setDate)
        error(1, `the argument '${arg}' lacks a leading '+';\nwhen using an option to specify date(s), any non-option\nargument must be a format string beginning with '+'`);
      setstr = arg; setDate = true;
    }
  }

  const dateSrcs = (datestr?1:0) + (batchFile?1:0) + (reference?1:0) + (getRes?1:0);
  if (dateSrcs > 1) error(1, "the options to specify dates for printing are mutually exclusive");
  if (setDate && dateSrcs) error(1, "the options to print and set the time may not be used together");

  if (!fmt) fmt = DEFAULT_FMT;
  if (!tz)  tz  = normTz(getenv('TZ') || 'UTC');

  // ─── Batch mode ──────────────────────────────────────────────────────────────
  if (batchFile !== null) {
    const contents = readFile(batchFile);  // throws if not found
    let output = '', ok = true;
    for (const raw of contents.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const when = parseStr(line, gettime(), tz);
      if (!when || isNaN(when.getTime())) {
        stderrFn(`${PROGRAM_NAME}: invalid date "${line}"\n`);
        ok = false;
      } else {
        output += formatDate(fmt, when, tz) + '\n';
      }
    }
    return output;   // partial output on error (matches GNU behavior)
  }

  // ─── Single-date mode ─────────────────────────────────────────────────────────
  let when = gettime();

  if (reference !== null) {
    when = stat(reference).mtime;  // stat() throws if not found
  } else if (getRes) {
    // Handled as special output below
  } else if (setDate && setstr) {
    const parsed = parseStr(setstr, gettime(), tz);
    if (!parsed || isNaN(parsed.getTime())) {
      const posix = parsePosix(setstr, gettime(), tz);
      if (!posix || isNaN(posix.getTime())) error(1, `invalid date '${setstr}'`);
      when = posix;
    } else {
      when = parsed;
    }
  } else if (datestr) {
    const parsed = parseStr(datestr, gettime(), tz);
    if (!parsed || isNaN(parsed.getTime())) error(1, `invalid date '${datestr}'`);
    when = parsed;
  }

  if (setDate) {
    if (!settime(when)) error(1, "cannot set date");
  }

  if (debug) stderrFn(`output format: "${fmt}"\n`);

  if (getRes) {
    const resNs = gettime_res();
    return '0.' + String(resNs).padStart(9, '0');
  }

  return formatDate(fmt, when, tz);
}
