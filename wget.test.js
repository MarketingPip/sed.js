function wget(args) {
  if (!Array.isArray(args)) throw new Error('Arguments must be an array');
  if (args.length === 0) throw new Error('No arguments');

  const result = {
    urls: [],
    outputDocument: undefined,
    quiet: false,
    verbose: false,
    noVerbose: false,
    recursive: false,
    level: undefined,
    timeout: 900,
    tries: 20,
    userAgent: 'wget/1.0',
    directoryPrefix: undefined,
    spider: false,
    background: false,
    continue: false,
    mirror: false,
    noParent: false,
    pageRequisites: false,
    convertLinks: false,
    noCheckCertificate: false,
    forceDirectories: false,
    noDirectories: false,
    accept: undefined,
    reject: undefined,
    progress: undefined,
    headers: [],
    user: undefined,
    password: undefined,
    wait: undefined,
    randomWait: false,
    limitRate: undefined,
    postData: undefined,
    method: undefined,
    bodyData: undefined,
    loadCookies: undefined,
    saveCookies: undefined,
    keepSessionCookies: false,
    noHttpKeepAlive: false,
    noDnsCache: false,
    cutDirs: undefined,
    noHostDirectories: false,
    protocolDirectories: false,
    serverResponse: false,
    contentDisposition: false,
    restrictFileNames: undefined,
    ignoreLength: false,
    timestamping: false,
    adjustExtension: false,
    httpsOnly: false,
    bindAddress: undefined,
    dnsServers: undefined,
    inputFile: undefined,
    forceHtml: false,
    baseUrl: undefined
  };

  const protoRegex = /^(https?|ftp|file):\/\//;
  let stopProcessing = false;
  let i = 0;

  const shortFlagsWithValues = new Set(['O', 'T', 'l', 'U', 'P', 'w', 't', 'A', 'R', 'S_val', 'B', 'i']);
  const shortBooleanFlags = new Set(['q','v','r','b','c','m','p','k','x','E','N','F','nH','np','nd','nv','S']);

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--') {
      stopProcessing = true;
      i++;
      continue;
    }

    if (stopProcessing) {
      result.urls.push(arg);
      i++;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      return 'Usage: wget [OPTION]... [URL]...';
    }
    if (arg === '--version' || arg === '-V') {
      return 'GNU wget version 1.0';
    }

    // Handle long options with =
    if (arg.startsWith('--') && arg.length > 2) {
      const eqIdx = arg.indexOf('=');
      let key, val;
      if (eqIdx !== -1) {
        key = arg.slice(2, eqIdx);
        val = arg.slice(eqIdx + 1);
      } else {
        key = arg.slice(2);
        val = undefined;
      }

      const knownLongFlags = new Set([
        'output-document','quiet','verbose','no-verbose','recursive','level',
        'timeout','tries','user-agent','directory-prefix','spider','background',
        'continue','mirror','no-parent','page-requisites','convert-links',
        'no-check-certificate','force-directories','no-directories','accept',
        'reject','progress','header','user','password','wait','random-wait',
        'limit-rate','post-data','method','body-data','load-cookies','save-cookies',
        'keep-session-cookies','no-http-keep-alive','no-dns-cache','cut-dirs',
        'no-host-directories','protocol-directories','server-response',
        'content-disposition','restrict-file-names','ignore-length','timestamping',
        'adjust-extension','https-only','bind-address','dns-servers','input-file',
        'force-html','base'
      ]);
      if (!knownLongFlags.has(key)) throw new Error('Unrecognized flag: ' + arg);

      switch (key) {
        case 'output-document': result.outputDocument = val; break;
        case 'quiet': result.quiet = true; break;
        case 'verbose': result.verbose = true; break;
        case 'no-verbose': result.noVerbose = true; break;
        case 'recursive': result.recursive = true; break;
        case 'level':
          result.level = val === 'inf' ? Infinity : parseInt(val, 10);
          if (isNaN(result.level)) throw new Error('Invalid level value');
          break;
        case 'timeout': result.timeout = parseInt(val, 10); break;
        case 'tries': result.tries = parseInt(val, 10); break;
        case 'user-agent': result.userAgent = val; break;
        case 'directory-prefix': result.directoryPrefix = val; break;
        case 'spider': result.spider = true; break;
        case 'background': result.background = true; break;
        case 'continue': result.continue = true; break;
        case 'mirror':
          result.mirror = true;
          result.recursive = true;
          result.level = Infinity;
          result.noParent = true;
          result.convertLinks = true;
          break;
        case 'no-parent': result.noParent = true; break;
        case 'page-requisites': result.pageRequisites = true; break;
        case 'convert-links': result.convertLinks = true; break;
        case 'no-check-certificate': result.noCheckCertificate = true; break;
        case 'force-directories': result.forceDirectories = true; break;
        case 'no-directories': result.noDirectories = true; break;
        case 'accept': result.accept = val.split(','); break;
        case 'reject': result.reject = val.split(','); break;
        case 'progress': result.progress = val; break;
        case 'header': result.headers.push(val); break;
        case 'user': result.user = val; break;
        case 'password': result.password = val; break;
        case 'wait': result.wait = parseInt(val, 10); break;
        case 'random-wait': result.randomWait = true; break;
        case 'limit-rate': result.limitRate = val; break;
        case 'post-data': result.postData = val; result.method = 'POST'; break;
        case 'method': result.method = val; break;
        case 'body-data': result.bodyData = val; break;
        case 'load-cookies': result.loadCookies = val; break;
        case 'save-cookies': result.saveCookies = val; break;
        case 'keep-session-cookies': result.keepSessionCookies = true; break;
        case 'no-http-keep-alive': result.noHttpKeepAlive = true; break;
        case 'no-dns-cache': result.noDnsCache = true; break;
        case 'cut-dirs': result.cutDirs = parseInt(val, 10); break;
        case 'no-host-directories': result.noHostDirectories = true; break;
        case 'protocol-directories': result.protocolDirectories = true; break;
        case 'server-response': result.serverResponse = true; break;
        case 'content-disposition': result.contentDisposition = true; break;
        case 'restrict-file-names': result.restrictFileNames = val; break;
        case 'ignore-length': result.ignoreLength = true; break;
        case 'timestamping': result.timestamping = true; break;
        case 'adjust-extension': result.adjustExtension = true; break;
        case 'https-only': result.httpsOnly = true; break;
        case 'bind-address': result.bindAddress = val; break;
        case 'dns-servers': result.dnsServers = val; break;
        case 'input-file': result.inputFile = val; break;
        case 'force-html': result.forceHtml = true; break;
        case 'base': result.baseUrl = val; break;
      }
      i++;
      continue;
    }

    // Handle short options
    if (arg.startsWith('-') && arg.length >= 2 && !arg.startsWith('--')) {
      const flagPart = arg.slice(1);

      // Check for -O- special case
      if (arg === '-O-') {
        result.outputDocument = '-';
        i++;
        continue;
      }

      const flagsWithValues = ['O', 'T', 'l', 'U', 'P', 'w', 't', 'A', 'R', 'B', 'i'];
      let combined = flagPart;
      let charIdx = 0;

      while (charIdx < combined.length) {
        const ch = combined[charIdx];

        if (flagsWithValues.includes(ch) && charIdx < combined.length - 1) {
          // Value is rest of combined flag
          const val = combined.slice(charIdx + 1);
          switch (ch) {
            case 'O': result.outputDocument = val; break;
            case 'T': result.timeout = parseInt(val, 10); if (isNaN(result.timeout)) throw new Error('Invalid value'); break;
            case 'l': result.level = val === 'inf' ? Infinity : parseInt(val, 10); if (isNaN(result.level)) throw new Error('Invalid value'); break;
            case 'U': result.userAgent = val; break;
            case 'P': result.directoryPrefix = val; break;
            case 'w': result.wait = parseInt(val, 10); if (isNaN(result.wait)) throw new Error('Invalid value'); break;
            case 't': result.tries = parseInt(val, 10); if (isNaN(result.tries)) throw new Error('Invalid value'); break;
            case 'A': result.accept = val.split(','); break;
            case 'R': result.reject = val.split(','); break;
            case 'B': result.baseUrl = val; break;
            case 'i': result.inputFile = val; break;
          }
          break;
        } else if (flagsWithValues.includes(ch) && charIdx === combined.length - 1) {
          // Value is next arg
          if (i + 1 >= args.length) throw new Error('Missing value for -' + ch);
          const nextArg = args[i + 1];
          // Check that nextArg is not a URL when it should be a value
          switch (ch) {
            case 'O': result.outputDocument = nextArg; break;
            case 'T':
              result.timeout = parseInt(nextArg, 10);
              if (isNaN(result.timeout)) throw new Error('Invalid value for -T');
              break;
            case 'l':
              result.level = nextArg === 'inf' ? Infinity : parseInt(nextArg, 10);
              if (isNaN(result.level)) throw new Error('Invalid value for -l');
              break;
            case 'U': result.userAgent = nextArg; break;
            case 'P': result.directoryPrefix = nextArg; break;
            case 'w':
              result.wait = parseInt(nextArg, 10);
              if (isNaN(result.wait)) throw new Error('Invalid value for -w');
              break;
            case 't':
              result.tries = parseInt(nextArg, 10);
              if (isNaN(result.tries)) throw new Error('Invalid value for -t');
              break;
            case 'A': result.accept = nextArg.split(','); break;
            case 'R': result.reject = nextArg.split(','); break;
            case 'B': result.baseUrl = nextArg; break;
            case 'i': result.inputFile = nextArg; break;
          }
          i++;
          break;
        } else {
          // Boolean short flag
          switch (ch) {
            case 'q': result.quiet = true; break;
            case 'v': result.verbose = true; break;
            case 'r': result.recursive = true; break;
            case 'b': result.background = true; break;
            case 'c': result.continue = true; break;
            case 'm':
              result.mirror = true;
              result.recursive = true;
              result.level = Infinity;
              result.noParent = true;
              result.convertLinks = true;
              break;
            case 'p': result.pageRequisites = true; break;
            case 'k': result.convertLinks = true; break;
            case 'x': result.forceDirectories = true; break;
            case 'E': result.adjustExtension = true; break;
            case 'N': result.timestamping = true; break;
            case 'F': result.forceHtml = true; break;
            case 'S': result.serverResponse = true; break;
            case 'n':
              // Handle multi-char flags starting with n
              const rest = combined.slice(charIdx);
              if (rest === 'nd') {
                result.noDirectories = true;
                charIdx += 1;
              } else if (rest === 'nv') {
                result.noVerbose = true;
                charIdx += 1;
              } else if (rest === 'np') {
                result.noParent = true;
                charIdx += 1;
              } else if (rest === 'nH') {
                result.noHostDirectories = true;
                charIdx += 1;
              } else {
                throw new Error('Unrecognized flag: -' + rest);
              }
              break;
            default:
              throw new Error('Unrecognized flag: -' + ch);
          }
          charIdx++;
        }
      }
      i++;
      continue;
    }

    // URL or positional arg
    if (protoRegex.test(arg)) {
      result.urls.push(arg);
    } else {
      throw new Error('Invalid argument: ' + arg);
    }

    i++;
  }

  // Set default level when recursive is set but no level specified
  if (result.recursive && result.level === undefined) {
    result.level = 5;
  }

  // Mutual exclusivity checks
  if (result.noDirectories && result.forceDirectories) {
    throw new Error('Mutually exclusive flags');
  }
  if (result.quiet && result.verbose) {
    throw new Error('Mutually exclusive flags');
  }
  if (result.outputDocument && result.spider) {
    throw new Error('Mutually exclusive flags');
  }

  // URL requirement check (unless inputFile is specified)
  if (result.urls.length === 0 && !result.inputFile) {
    throw new Error('No URL');
  }

  return result;
}



test('wget throws when args is not an array', () => {
  expect(() => wget('http://example.com')).toThrow();
});

test('wget throws when args is null', () => {
  expect(() => wget(null)).toThrow();
});

test('wget throws when args is undefined', () => {
  expect(() => wget(undefined)).toThrow();
});

test('wget throws when args is a number', () => {
  expect(() => wget(42)).toThrow();
});

test('wget throws when args is an object', () => {
  expect(() => wget({})).toThrow();
});

test('wget throws when args is empty array', () => {
  expect(() => wget([])).toThrow('No arguments');
});

test('wget --help returns usage string containing Usage', () => {
  const result = wget(['--help']);
  expect(result).toContain('Usage');
});

test('wget -h returns usage string', () => {
  const result = wget(['-h']);
  expect(result).toContain('Usage');
});

test('wget --version returns version string', () => {
  const result = wget(['--version']);
  expect(result).toContain('wget');
});

test('wget -V returns version string', () => {
  const result = wget(['-V']);
  expect(result).toContain('wget');
});

test('wget with http URL returns result with urls', () => {
  const result = wget(['http://example.com']);
  expect(result.urls).toContain('http://example.com');
});

test('wget with https URL returns result with urls', () => {
  const result = wget(['https://example.com']);
  expect(result.urls).toContain('https://example.com');
});

test('wget with ftp URL returns result with urls', () => {
  const result = wget(['ftp://example.com/file.txt']);
  expect(result.urls).toContain('ftp://example.com/file.txt');
});

test('wget with file URL returns result with urls', () => {
  const result = wget(['file:///tmp/test.txt']);
  expect(result.urls).toContain('file:///tmp/test.txt');
});

test('wget throws when no URL is provided', () => {
  expect(() => wget(['-q'])).toThrow('No URL');
});

test('wget throws on URL without protocol', () => {
  expect(() => wget(['example.com'])).toThrow();
});

test('wget throws on unrecognized flag', () => {
  expect(() => wget(['--invalid-flag', 'http://example.com'])).toThrow();
});

test('wget supports multiple URLs', () => {
  const result = wget(['http://example.com', 'http://example.org']);
  expect(result.urls.length).toBe(2);
  expect(result.urls).toContain('http://example.com');
  expect(result.urls).toContain('http://example.org');
});

test('wget -O sets output document', () => {
  const result = wget(['-O', 'output.html', 'http://example.com']);
  expect(result.outputDocument).toBe('output.html');
});

test('wget --output-document sets output document', () => {
  const result = wget(['--output-document=index.html', 'http://example.com']);
  expect(result.outputDocument).toBe('index.html');
});

test('wget -O - outputs to stdout', () => {
  const result = wget(['-O', '-', 'http://example.com']);
  expect(result.outputDocument).toBe('-');
});

test('wget -O- outputs to stdout', () => {
  const result = wget(['-O-', 'http://example.com']);
  expect(result.outputDocument).toBe('-');
});

test('wget -q sets quiet mode', () => {
  const result = wget(['-q', 'http://example.com']);
  expect(result.quiet).toBeTruthy();
});

test('wget --quiet sets quiet mode', () => {
  const result = wget(['--quiet', 'http://example.com']);
  expect(result.quiet).toBeTruthy();
});

test('wget -v sets verbose mode', () => {
  const result = wget(['-v', 'http://example.com']);
  expect(result.verbose).toBeTruthy();
});

test('wget --verbose sets verbose mode', () => {
  const result = wget(['--verbose', 'http://example.com']);
  expect(result.verbose).toBeTruthy();
});

test('wget -nv sets no-verbose mode', () => {
  const result = wget(['-nv', 'http://example.com']);
  expect(result.noVerbose).toBeTruthy();
});

test('wget --no-verbose sets no-verbose mode', () => {
  const result = wget(['--no-verbose', 'http://example.com']);
  expect(result.noVerbose).toBeTruthy();
});

test('wget -r sets recursive mode', () => {
  const result = wget(['-r', 'http://example.com']);
  expect(result.recursive).toBeTruthy();
});

test('wget --recursive sets recursive mode', () => {
  const result = wget(['--recursive', 'http://example.com']);
  expect(result.recursive).toBeTruthy();
});

test('wget -l sets recursion depth', () => {
  const result = wget(['-r', '-l', '5', 'http://example.com']);
  expect(result.level).toBe(5);
});

test('wget --level sets recursion depth', () => {
  const result = wget(['-r', '--level=3', 'http://example.com']);
  expect(result.level).toBe(3);
});

test('wget -l inf sets infinite recursion depth', () => {
  const result = wget(['-r', '-l', 'inf', 'http://example.com']);
  expect(result.level).toBe(Infinity);
});

test('wget --level=inf sets infinite recursion depth', () => {
  const result = wget(['-r', '--level=inf', 'http://example.com']);
  expect(result.level).toBe(Infinity);
});

test('wget -T sets timeout', () => {
  const result = wget(['-T', '30', 'http://example.com']);
  expect(result.timeout).toBe(30);
});

test('wget --timeout sets timeout', () => {
  const result = wget(['--timeout=60', 'http://example.com']);
  expect(result.timeout).toBe(60);
});

test('wget -t sets number of retries', () => {
  const result = wget(['-t', '3', 'http://example.com']);
  expect(result.tries).toBe(3);
});

test('wget --tries sets number of retries', () => {
  const result = wget(['--tries=5', 'http://example.com']);
  expect(result.tries).toBe(5);
});

test('wget -U sets user agent', () => {
  const result = wget(['-U', 'MyAgent/1.0', 'http://example.com']);
  expect(result.userAgent).toBe('MyAgent/1.0');
});

test('wget --user-agent sets user agent', () => {
  const result = wget(['--user-agent=MyAgent/1.0', 'http://example.com']);
  expect(result.userAgent).toBe('MyAgent/1.0');
});

test('wget -P sets directory prefix', () => {
  const result = wget(['-P', '/tmp/downloads', 'http://example.com']);
  expect(result.directoryPrefix).toBe('/tmp/downloads');
});

test('wget --directory-prefix sets directory prefix', () => {
  const result = wget(['--directory-prefix=/tmp/downloads', 'http://example.com']);
  expect(result.directoryPrefix).toBe('/tmp/downloads');
});

test('wget --spider sets spider mode', () => {
  const result = wget(['--spider', 'http://example.com']);
  expect(result.spider).toBeTruthy();
});

test('wget -b sets background mode', () => {
  const result = wget(['-b', 'http://example.com']);
  expect(result.background).toBeTruthy();
});

test('wget --background sets background mode', () => {
  const result = wget(['--background', 'http://example.com']);
  expect(result.background).toBeTruthy();
});

test('wget -c sets continue mode', () => {
  const result = wget(['-c', 'http://example.com']);
  expect(result.continue).toBeTruthy();
});

test('wget --continue sets continue mode', () => {
  const result = wget(['--continue', 'http://example.com']);
  expect(result.continue).toBeTruthy();
});

test('wget -m sets mirror mode and implies recursive', () => {
  const result = wget(['-m', 'http://example.com']);
  expect(result.mirror).toBeTruthy();
  expect(result.recursive).toBeTruthy();
});

test('wget --mirror sets mirror mode with implied flags', () => {
  const result = wget(['--mirror', 'http://example.com']);
  expect(result.mirror).toBeTruthy();
  expect(result.recursive).toBeTruthy();
  expect(result.level).toBe(Infinity);
  expect(result.noParent).toBeTruthy();
  expect(result.convertLinks).toBeTruthy();
});

test('wget -np sets no-parent', () => {
  const result = wget(['-r', '-np', 'http://example.com']);
  expect(result.noParent).toBeTruthy();
});

test('wget --no-parent sets no-parent', () => {
  const result = wget(['-r', '--no-parent', 'http://example.com']);
  expect(result.noParent).toBeTruthy();
});

test('wget -p sets page-requisites', () => {
  const result = wget(['-p', 'http://example.com']);
  expect(result.pageRequisites).toBeTruthy();
});

test('wget --page-requisites sets page-requisites', () => {
  const result = wget(['--page-requisites', 'http://example.com']);
  expect(result.pageRequisites).toBeTruthy();
});

test('wget -k sets convert-links', () => {
  const result = wget(['-k', 'http://example.com']);
  expect(result.convertLinks).toBeTruthy();
});

test('wget --convert-links sets convert-links', () => {
  const result = wget(['--convert-links', 'http://example.com']);
  expect(result.convertLinks).toBeTruthy();
});

test('wget --no-check-certificate disables certificate check', () => {
  const result = wget(['--no-check-certificate', 'https://example.com']);
  expect(result.noCheckCertificate).toBeTruthy();
});

test('wget -x sets force-directories', () => {
  const result = wget(['-x', 'http://example.com']);
  expect(result.forceDirectories).toBeTruthy();
});

test('wget --force-directories sets force-directories', () => {
  const result = wget(['--force-directories', 'http://example.com']);
  expect(result.forceDirectories).toBeTruthy();
});

test('wget -nd sets no-directories', () => {
  const result = wget(['-nd', 'http://example.com']);
  expect(result.noDirectories).toBeTruthy();
});

test('wget --no-directories sets no-directories', () => {
  const result = wget(['--no-directories', 'http://example.com']);
  expect(result.noDirectories).toBeTruthy();
});

test('wget -A sets accept patterns as array', () => {
  const result = wget(['-A', '*.html,*.css', 'http://example.com']);
  expect(result.accept).toContain('*.html');
  expect(result.accept).toContain('*.css');
});

test('wget --accept sets accept patterns', () => {
  const result = wget(['--accept=*.jpg,*.png', 'http://example.com']);
  expect(result.accept).toContain('*.jpg');
  expect(result.accept).toContain('*.png');
});

test('wget -R sets reject patterns as array', () => {
  const result = wget(['-R', '*.gif,*.bmp', 'http://example.com']);
  expect(result.reject).toContain('*.gif');
  expect(result.reject).toContain('*.bmp');
});

test('wget --reject sets reject patterns', () => {
  const result = wget(['--reject=*.pdf', 'http://example.com']);
  expect(result.reject).toContain('*.pdf');
});

test('wget --progress sets progress type bar', () => {
  const result = wget(['--progress=bar', 'http://example.com']);
  expect(result.progress).toBe('bar');
});

test('wget --progress sets progress type dot', () => {
  const result = wget(['--progress=dot', 'http://example.com']);
  expect(result.progress).toBe('dot');
});

test('wget --progress=dot:mega sets progress style', () => {
  const result = wget(['--progress=dot:mega', 'http://example.com']);
  expect(result.progress).toBe('dot:mega');
});

test('wget --header adds custom header', () => {
  const result = wget(['--header=Accept: application/json', 'http://example.com']);
  expect(result.headers).toContain('Accept: application/json');
});

test('wget supports multiple --header flags', () => {
  const result = wget(['--header=Accept: application/json', '--header=Authorization: Bearer token', 'http://example.com']);
  expect(result.headers).toContain('Accept: application/json');
  expect(result.headers).toContain('Authorization: Bearer token');
});

test('wget --user sets username', () => {
  const result = wget(['--user=admin', 'http://example.com']);
  expect(result.user).toBe('admin');
});

test('wget --password sets password', () => {
  const result = wget(['--user=admin', '--password=secret', 'http://example.com']);
  expect(result.user).toBe('admin');
  expect(result.password).toBe('secret');
});

test('wget -w sets wait seconds between requests', () => {
  const result = wget(['-w', '2', 'http://example.com']);
  expect(result.wait).toBe(2);
});

test('wget --wait sets wait seconds between requests', () => {
  const result = wget(['--wait=5', 'http://example.com']);
  expect(result.wait).toBe(5);
});

test('wget --random-wait enables random wait', () => {
  const result = wget(['--random-wait', 'http://example.com']);
  expect(result.randomWait).toBeTruthy();
});

test('wget --limit-rate limits download speed', () => {
  const result = wget(['--limit-rate=100k', 'http://example.com']);
  expect(result.limitRate).toBe('100k');
});

test('wget --post-data sends POST data', () => {
  const result = wget(['--post-data=key=value', 'http://example.com']);
  expect(result.postData).toBe('key=value');
  expect(result.method).toBe('POST');
});

test('wget --method sets HTTP method', () => {
  const result = wget(['--method=PUT', 'http://example.com']);
  expect(result.method).toBe('PUT');
});

test('wget --body-data sends body data', () => {
  const result = wget(['--body-data={"key":"value"}', 'http://example.com']);
  expect(result.bodyData).toBe('{"key":"value"}');
});

test('wget throws when -O has no value', () => {
  expect(() => wget(['-O'])).toThrow();
});

test('wget throws when -T has no value', () => {
  expect(() => wget(['-T', 'http://example.com'])).toThrow();
});

test('wget throws when -l has no value in recursive mode', () => {
  expect(() => wget(['-r', '-l'])).toThrow();
});

test('wget throws when -U has no value', () => {
  expect(() => wget(['-U'])).toThrow();
});

test('wget throws when -P has no value', () => {
  expect(() => wget(['-P'])).toThrow();
});

test('wget throws when -w has no value', () => {
  expect(() => wget(['-w'])).toThrow();
});

test('wget throws when -t has non-numeric value', () => {
  expect(() => wget(['-t', 'abc', 'http://example.com'])).toThrow();
});

test('wget throws when -T has non-numeric value', () => {
  expect(() => wget(['-T', 'abc', 'http://example.com'])).toThrow();
});

test('wget throws when -l has invalid value', () => {
  expect(() => wget(['-r', '-l', 'abc', 'http://example.com'])).toThrow();
});

test('wget -nd and -x are mutually exclusive', () => {
  expect(() => wget(['-nd', '-x', 'http://example.com'])).toThrow();
});

test('wget --no-directories and --force-directories are mutually exclusive', () => {
  expect(() => wget(['--no-directories', '--force-directories', 'http://example.com'])).toThrow();
});

test('wget -q and -v are mutually exclusive', () => {
  expect(() => wget(['-q', '-v', 'http://example.com'])).toThrow();
});

test('wget --quiet and --verbose are mutually exclusive', () => {
  expect(() => wget(['--quiet', '--verbose', 'http://example.com'])).toThrow();
});

test('wget -O and --spider are mutually exclusive', () => {
  expect(() => wget(['-O', 'file.html', '--spider', 'http://example.com'])).toThrow();
});

test('wget supports combined short flags -qv is invalid', () => {
  expect(() => wget(['-qv', 'http://example.com'])).toThrow();
});

test('wget supports combined short flags -rc', () => {
  const result = wget(['-rc', 'http://example.com']);
  expect(result.recursive).toBeTruthy();
  expect(result.continue).toBeTruthy();
});

test('wget supports combined short flags -rpk', () => {
  const result = wget(['-rpk', 'http://example.com']);
  expect(result.recursive).toBeTruthy();
  expect(result.pageRequisites).toBeTruthy();
  expect(result.convertLinks).toBeTruthy();
});

test('wget -- ends option processing', () => {
  const result = wget(['--', '-not-a-flag']);
  expect(result.urls).toContain('-not-a-flag');
});

test('wget -- cuts off further flags allowing URL with dash', () => {
  const result = wget(['-q', '--', 'http://example.com']);
  expect(result.quiet).toBeTruthy();
  expect(result.urls).toContain('http://example.com');
});

test('wget handles multiple flags and URLs', () => {
  const result = wget(['-r', '-l', '3', '-q', '-O', 'output.html', 'http://example.com', 'http://example.org']);
  expect(result.recursive).toBeTruthy();
  expect(result.level).toBe(3);
  expect(result.quiet).toBeTruthy();
  expect(result.outputDocument).toBe('output.html');
  expect(result.urls.length).toBe(2);
});

test('wget default tries value when not specified', () => {
  const result = wget(['http://example.com']);
  expect(result.tries).toBe(20);
});

test('wget default timeout value when not specified', () => {
  const result = wget(['http://example.com']);
  expect(result.timeout).toBe(900);
});

test('wget default level value when not specified', () => {
  const result = wget(['-r', 'http://example.com']);
  expect(result.level).toBe(5);
});

test('wget default userAgent when not specified', () => {
  const result = wget(['http://example.com']);
  expect(result.userAgent).toContain('wget');
});

test('wget --load-cookies sets cookie file', () => {
  const result = wget(['--load-cookies=cookies.txt', 'http://example.com']);
  expect(result.loadCookies).toBe('cookies.txt');
});

test('wget --save-cookies sets save cookies file', () => {
  const result = wget(['--save-cookies=cookies.txt', 'http://example.com']);
  expect(result.saveCookies).toBe('cookies.txt');
});

test('wget --keep-session-cookies enables session cookies', () => {
  const result = wget(['--keep-session-cookies', 'http://example.com']);
  expect(result.keepSessionCookies).toBeTruthy();
});

test('wget --no-http-keep-alive disables keep-alive', () => {
  const result = wget(['--no-http-keep-alive', 'http://example.com']);
  expect(result.noHttpKeepAlive).toBeTruthy();
});

test('wget --no-dns-cache disables DNS cache', () => {
  const result = wget(['--no-dns-cache', 'http://example.com']);
  expect(result.noDnsCache).toBeTruthy();
});

test('wget --cut-dirs sets number of directories to cut', () => {
  const result = wget(['--cut-dirs=2', 'http://example.com']);
  expect(result.cutDirs).toBe(2);
});

test('wget -nH disables host directories', () => {
  const result = wget(['-nH', 'http://example.com']);
  expect(result.noHostDirectories).toBeTruthy();
});

test('wget --no-host-directories disables host directories', () => {
  const result = wget(['--no-host-directories', 'http://example.com']);
  expect(result.noHostDirectories).toBeTruthy();
});

test('wget --protocol-directories enables protocol directories', () => {
  const result = wget(['--protocol-directories', 'http://example.com']);
  expect(result.protocolDirectories).toBeTruthy();
});

test('wget -S sets server response flag', () => {
  const result = wget(['-S', 'http://example.com']);
  expect(result.serverResponse).toBeTruthy();
});

test('wget --server-response sets server response flag', () => {
  const result = wget(['--server-response', 'http://example.com']);
  expect(result.serverResponse).toBeTruthy();
});

test('wget --content-disposition enables content disposition', () => {
  const result = wget(['--content-disposition', 'http://example.com']);
  expect(result.contentDisposition).toBeTruthy();
});

test('wget --restrict-file-names sets file name restriction mode', () => {
  const result = wget(['--restrict-file-names=unix', 'http://example.com']);
  expect(result.restrictFileNames).toBe('unix');
});

test('wget --ignore-length ignores content-length header', () => {
  const result = wget(['--ignore-length', 'http://example.com']);
  expect(result.ignoreLength).toBeTruthy();
});

test('wget --timestamping sets timestamping mode', () => {
  const result = wget(['--timestamping', 'http://example.com']);
  expect(result.timestamping).toBeTruthy();
});

test('wget -N sets timestamping mode', () => {
  const result = wget(['-N', 'http://example.com']);
  expect(result.timestamping).toBeTruthy();
});

test('wget --adjust-extension adjusts file extensions', () => {
  const result = wget(['--adjust-extension', 'http://example.com']);
  expect(result.adjustExtension).toBeTruthy();
});

test('wget -E adjusts file extensions', () => {
  const result = wget(['-E', 'http://example.com']);
  expect(result.adjustExtension).toBeTruthy();
});

test('wget --https-only restricts to HTTPS only', () => {
  const result = wget(['--https-only', 'http://example.com']);
  expect(result.httpsOnly).toBeTruthy();
});

test('wget --bind-address sets bind address', () => {
  const result = wget(['--bind-address=192.168.1.1', 'http://example.com']);
  expect(result.bindAddress).toBe('192.168.1.1');
});

test('wget --dns-servers sets custom DNS servers', () => {
  const result = wget(['--dns-servers=8.8.8.8,8.8.4.4', 'http://example.com']);
  expect(result.dnsServers).toBe('8.8.8.8,8.8.4.4');
});

test('wget -i reads URLs from file', () => {
  const result = wget(['-i', 'urls.txt']);
  expect(result.inputFile).toBe('urls.txt');
});

test('wget --input-file reads URLs from file', () => {
  const result = wget(['--input-file=urls.txt']);
  expect(result.inputFile).toBe('urls.txt');
});

test('wget -F forces HTML input', () => {
  const result = wget(['-F', 'http://example.com']);
  expect(result.forceHtml).toBeTruthy();
});

test('wget --force-html forces HTML input', () => {
  const result = wget(['--force-html', 'http://example.com']);
  expect(result.forceHtml).toBeTruthy();
});

test('wget --base sets base URL for relative links in input file', () => {
  const result = wget(['--base=http://example.com', '-i', 'urls.txt']);
  expect(result.baseUrl).toBe('http://example.com');
});

test('wget -B sets base URL', () => {
  const result = wget(['-B', 'http://example.com', '-i', 'urls.txt']);
  expect(result.baseUrl).toBe('http://example.com');
});
