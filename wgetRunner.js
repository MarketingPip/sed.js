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
 // wget-runner.js

// EXPECTED:
// - you provide: wget(parser)
// - you provide: fs (must support mkdir, writeFile, readFile)
// - you provide: path (path-browserify compatible)

export function createWgetRunner({ wget, fs, path, fetchImpl }) {
  if (!wget) throw new Error("Missing wget parser");
  if (!fs) throw new Error("Missing fs implementation");
  if (!path) throw new Error("Missing path implementation");

  const fetchFn = fetchImpl || globalThis.fetch;
  if (!fetchFn) throw new Error("No fetch available");

  async function run(args) {
    const opts = wget(args);
    const visited = new Set();

    for (const url of opts.urls) {
      await fetchRecursive(url, opts, visited, 0);
    }
  }

  async function fetchRecursive(url, opts, visited, depth) {
    if (visited.has(url)) return;
     

    if (opts.level !== undefined && depth > opts.level) return;

    log(opts, `[GET] ${url}`);

    const res = await fetchWithRetry(url, opts);
    if (!res) return;
    visited.add(url);
    const contentType = res.headers.get("content-type") || "";
    const buffer = new Uint8Array(await res.arrayBuffer());

    const filePath = resolveFilePath(url, opts);

    if (!opts.spider) {
      await saveFile(filePath, buffer, opts);
    }

    // recurse HTML
    if (opts.recursive && contentType.includes("text/html")) {
      const html = new TextDecoder().decode(buffer);
      const links = extractLinks(html, url);

      for (const link of links) {
        if (!shouldDownload(link, opts)) continue;
        if (opts.noParent) {
  const base = new URL(url);
  const next = new URL(link);

  if (!next.pathname.startsWith(path.dirname(base.pathname))) {
    continue;
  }
}

        await delayIfNeeded(opts);
        await fetchRecursive(link, opts, visited, depth + 1);
      }
    }
  }

  async function fetchWithRetry(url, opts) {
    for (let i = 0; i < opts.tries; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          opts.timeout * 1000
        );

        const res = await fetchFn(url, {
          method: opts.method || (opts.postData ? "POST" : "GET"),
          headers: buildHeaders(opts),
          body: opts.postData || opts.bodyData,
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (opts.serverResponse) {
          log(opts, `${res.status} ${res.statusText}`);
        }

        return res;
      } catch (err) {
        if (i === opts.tries - 1) {
          if (!opts.quiet) console.error("Failed:", url);
          return null;
        }
      }
    }
  }

  async function saveFile(filePath, buffer, opts) {
    await ensureDir(path.dirname(filePath));

    if (opts.continue) {
      try {
        const existing = await fs.readFile(filePath);
        buffer = concat(existing, buffer);
      } catch {}
    }

    await fs.writeFile(filePath, buffer);

    if (!opts.quiet) {
      console.log("Saved:", filePath);
    }
  }

  async function ensureDir(dir) {
    if (!dir || dir === "." || dir === "/") return;
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {}
  }

  function resolveFilePath(url, opts) {
    const u = new URL(url);

    let filePath = u.pathname;

    if (filePath.endsWith("/")) {
      filePath += "index.html";
    }

    if (opts.adjustExtension && !filePath.endsWith(".html")) {
      filePath += ".html";
    }

    if (opts.noDirectories) {
      filePath = path.basename(filePath);
    }

    if (opts.directoryPrefix) {
      filePath = path.join(opts.directoryPrefix, filePath);
    }

    return normalizePath(filePath);
  }

  function normalizePath(p) {
    // remove leading slash for browser FS
    return p.replace(/^\/+/, "");
  }

  function extractLinks(html, baseUrl) {
    const links = new Set();
    const regex = /href=["']([^"'#]+)["']/gi;

    let match;
    while ((match = regex.exec(html))) {
      try {
        const abs = new URL(match[1], baseUrl).href;
        links.add(abs);
      } catch {}
    }

    return [...links];
  }

  function shouldDownload(url, opts) {
    const pathname = new URL(url).pathname;

    if (opts.accept) {
      if (!opts.accept.some(ext => pathname.endsWith(ext))) {
        return false;
      }
    }

    if (opts.reject) {
      if (opts.reject.some(ext => pathname.endsWith(ext))) {
        return false;
      }
    }

    if (opts.httpsOnly && !url.startsWith("https://")) {
      return false;
    }

    return true;
  }

  function buildHeaders(opts) {
    const headers = {
      "User-Agent": opts.userAgent
    };

    for (const h of opts.headers) {
      const [k, ...rest] = h.split(":");
      headers[k.trim()] = rest.join(":").trim();
    }

    if (opts.user && opts.password) {
      const token = btoa(`${opts.user}:${opts.password}`);
      headers["Authorization"] = `Basic ${token}`;
    }

    return headers;
  }

  function delayIfNeeded(opts) {
    let wait = opts.wait || 0;

    if (opts.randomWait) {
      wait = Math.random() * wait;
    }

    if (!wait) return Promise.resolve();

    return new Promise(res => setTimeout(res, wait * 1000));
  }

  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function log(opts, msg) {
    if (opts.quiet) return;
    if (opts.noVerbose) return;
    if (opts.verbose || !opts.quiet) {
      console.log(msg);
    }
  }

  return { run };
}

const fs = {
  async writeFile(p, data) {
    console.log("WRITE", p, data.length);
  },
  async mkdir() {},
  async readFile() {
    throw new Error("not found");
  }
};
import path from "https://esm.sh/path-browserify";
const { run } = createWgetRunner({
  wget,
  fs,
  path
});//

/* await run([
  "-r",
  "-l", "3",
  "--verbose",
  "--no-parent",
  "https://httpbin.org/links/10/0"
]);*/

//await run(["-r", "-l", "2", "--spider", "--verbose", "https://httpbin.org/links/5/0"]); // no write.. 
 
//await run(["-r", "-np", "--verbose", "https://httpbin.org/links/5/0"]);

//await run(["-r", "-l", "1", "--verbose", "https://httpbin.org/links/5/0"]);
  
/* await run([
  "-r",
  "-np",
  "--verbose",
  "https://httpbin.org/links/5/0/../../"
]); not working */ 
