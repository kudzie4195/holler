#!/usr/bin/env node
// Round 34 switch audit: fails when a browser chunk of the last build READS a server variable at runtime.
// Plain Node 22, no dependencies (it runs inside `npm run build`, so a Vercel build fails too).
//
//   npm run build                                       (next build, then this check)
//   npm run check:client-switches                       (this check alone, on .next/static)
//   node scripts/check-client-switches.mjs <folder>     (another build's browser folder)
//
// A variable without NEXT_PUBLIC_ is undefined in the browser, so a client component that reads one disagrees with the server render
// whenever the owner sets it. Switches the browser needs are inlined at build (lib/build-switches.ts, next.config.ts `env`): Next
// writes the value in place of the read, and no read is left.
//
// FAIL (exit 1), each a runtime read (NAME below is never NODE_ENV, NEXT_PUBLIC_* or a name in CLIENT_ENV_ALLOW):
//   env-member     `<x>.env.NAME` or `<x>.env?.NAME` for any NAME (listed in lib/env.ts or not)
//   env-literal    `<x>.env["NAME"]` (same exceptions)
//   env-dynamic    `<x>.env[<expression>]`: a lookup by a name held in a variable
//   env-destructure `{ NAME: a } = <x>.env` (any name except the exceptions)
//   env-alias      the env object itself handed to a variable or a call (`= <x>.env;`, `{...<x>.env}`, `<x>.env||{}`, `<x>.env??{}`),
//                  after which any name can be read
//   watched-member `.NAME` or `["NAME"]` for a watched name on any object (an alias or a copy of env): every HOLLER_* name, every
//                  *_SECRET and *_PASSWORD name, and every lib/env.ts ENV_KEYS name (NEXT_PUBLIC_* excepted). A *_KEY or *_TOKEN name
//                  not in ENV_KEYS is caught when it is read from env (env-member covers every name), not on other objects.
//   secret-value   the VALUE of a secret-like variable of the build's environment (8 characters or more; the raw text and its JSON-escaped
//                  form) appears in a chunk. Secret-like: the name holds SECRET, TOKEN, PASSWORD, KEY, LOGIN, JSON ... in any case and anywhere
//                  (resend_api_key_holler), or is in SECRET_EXTRA_NAMES. Only the NAME is ever printed: every secret value is masked
//                  in every line this script prints, also inside the context of another hit.
//   inlined-read-left  (needs .next/server and .next/required-server-files.json) a name that next.config.ts `env` inlines is still READ at
//                  runtime in a compiled server bundle (.js only), written `env?.NAME` or `env["NAME"]`. Such a reader sees the real variable
//                  on the server and the inlined value in the browser (the two renders can disagree).
//   inlined-optional-read  (same needs) SOURCE under app/, components/, lib/ writes `process.env?.NAME` (or `env?.["NAME"]`) for a name that
//                  next.config.ts `env` inlines. Next documents only the plain `process.env.NAME` as replaced. Measured with this Next (Turbopack,
//                  round 34 second fix, build B6c): the `?.` form is replaced too, in the server and the browser bundle, so this is not a bug
//                  today; the rule keeps the documented form so a bundler that follows the documentation (webpack, a Next upgrade) cannot
//                  leave a runtime read in the browser or the server.
// ALLOWED without a failure: NODE_ENV, NEXT_PUBLIC_*, and the names in CLIENT_ENV_ALLOW below (public by nature, each with its library).
// WARN only (exit 0): a watched name as a bare string ("HOLLER_X") or inside a sentence ("HOLLER_X is off, so ..."). Text that names a
// variable is not a read.
// Exit 2: no build found.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** ENV_KEYS from lib/env.ts, read as text (this script imports nothing). */
export function envKeysFromSource(src) {
  const m = /ENV_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src);
  return m ? [...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]) : [];
}

/**
 * Names a browser chunk may read at runtime because library code does, and the value is public by nature (a package name, a version, a
 * public config string). Taken from the published package files (node_modules or the npm tarball), each with the library that reads it.
 * To allow another name: add it here WITH the library and the reason it is safe. The list must never hold a HOLLER_* name, a name with
 * SECRET, TOKEN, PASSWORD, KEY, LOGIN or JSON in it, or any name of lib/env.ts ENV_KEYS: allowListProblems() fails the build if one does,
 * and tests/ops/client-switches.test.ts checks it too. Only switches go through next.config.ts `env` (lib/build-switches.ts).
 */
/** @type {Record<string, string>} */
export const CLIENT_ENV_ALLOW = {
  // @supabase/ssr 0.12.x, dist/module/warnDeprecatedPackage.js: `typeof process !== "undefined" && process.env?.npm_package_name` and
  // `process.env.npm_package_name`, only to compare the app's package name with "@supabase/auth-helpers-*" and print a deprecation
  // warning. npm sets it to this app's own package name ("holler"), which is in package.json and public. Unset in the browser.
  npm_package_name: '@supabase/ssr: deprecation warning compares the app name; npm sets it from package.json, public',
  // The sibling npm lifecycle variable (package.json "version"), the same public kind of value; allowed so a library that reads the name
  // and the version together (the same warning style) does not stop a build. No library checked reads it yet.
  npm_package_version: 'npm lifecycle variable from package.json "version", public (no library checked reads it yet)',
  // @vercel/analytics 2.x and @vercel/speed-insights 2.x (dist/next/index.mjs, dist/react/index.mjs: getBasePath, bundled into the Next
  // entry too): behind `typeof process === "undefined" || typeof process.env === "undefined"` it returns
  // `process.env.REACT_APP_VERCEL_OBSERVABILITY_BASEPATH`, the generic React fallback for the path under which Vercel serves its
  // /insights script (the Next wrapper passes NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH, which is allowed anyway). A path, public in
  // every page's script tag; undefined in a Next build.
  REACT_APP_VERCEL_OBSERVABILITY_BASEPATH: '@vercel/analytics and @vercel/speed-insights: public path of the insights script',
  // Same files, getConfigString: `process.env.REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG`, the generic React fallback for the client
  // configuration string of the insights script (Vercel's build sets the NEXT_PUBLIC_ twin). Handed to the browser script by design.
  REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG: '@vercel/analytics and @vercel/speed-insights: public client config string for the browser script',
  // posthog-js 1.455.x, dist/module.js (exception tagging): `typeof process < "u"` then `process.env.POSTHOG_RELEASE_ID?.trim()`; a release
  // label (a version or commit id) attached to error reports, sent to PostHog from the browser, so public by design.
  POSTHOG_RELEASE_ID: 'posthog-js: release label attached to exception events, sent from the browser anyway',
};

const SECRET_WORDS = /(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY)|(?:^|[^A-Za-z0-9])(?:KEY|PASS|PWD|LOGIN|JSON|CREDENTIALS?|PRIVATE)(?:[^A-Za-z0-9]|$)/i;
/** Names whose value is compared although the pattern may miss them (the owner account id, the Vercel alias of the Resend key). */
export const SECRET_EXTRA_NAMES = ['HOLLER_OWNER_USER_ID', 'resend_api_key_holler'];
// Never compared: public by nature (build metadata Vercel and npm set, NEXT_PUBLIC_*).
const NOT_SECRET = /^(?:NEXT_PUBLIC_|VERCEL_GIT_|npm_package_|npm_lifecycle_)/;
/** A name that may never be on the allow-list. */
const neverAllowed = (name, envKeys) => !/^[A-Za-z0-9_]+$/.test(name) || /^HOLLER_/i.test(name) || SECRET_WORDS.test(name) || envKeys.some((k) => k.toLowerCase() === name.toLowerCase());
/**
 * Names of CLIENT_ENV_ALLOW that break the rule above (an empty list when the list is sound).
 * @param {string[]} [envKeys]
 * @param {Record<string, string>} [list]
 */
export function allowListProblems(envKeys = [], list = CLIENT_ENV_ALLOW) {
  return Object.keys(list).filter((n) => neverAllowed(n, envKeys));
}
/**
 * A name a browser chunk may read at runtime without failing the build.
 * @param {string} name
 * @param {string[]} [envKeys]
 * @param {Record<string, string>} [list]
 */
export function isAllowed(name, envKeys = [], list = CLIENT_ENV_ALLOW) {
  if (name === 'NODE_ENV' || name.startsWith('NEXT_PUBLIC_')) return true;
  return Object.prototype.hasOwnProperty.call(list, name) && !neverAllowed(name, envKeys);
}
// On objects other than env, *_KEY and *_TOKEN are left out: framework code is full of them (Next's PAGE_SEGMENT_KEY, HEAD_REQUEST_KEY).
// Every *_KEY variable is still caught when read from env (env-member, any name), and the real keys are in ENV_KEYS.
const WATCHED_PATTERN = /^(?:HOLLER_[A-Z0-9_]+|[A-Z0-9_]*_(?:SECRET|PASSWORD))$/;

/** True for a name the check watches as a member on any object. */
export function isWatched(name, envKeys = []) {
  return !isAllowed(name, envKeys) && (WATCHED_PATTERN.test(name) || envKeys.includes(name));
}

const ID = '[A-Za-z_$][\\w$]*';
const ENV = `(?<![\\w$])env`; // the property or variable named env (process.env, a polyfill's n.default.env)
const RULES = [
  { rule: 'env-member', re: new RegExp(`${ENV}\\s*(?:\\?\\.|\\.)\\s*(${ID})`, 'g'), name: (m) => m[1] },
  { rule: 'env-literal', re: new RegExp(`${ENV}\\s*(?:\\?\\.)?\\[\\s*(["'\`])([^"'\`]+)\\1\\s*\\]`, 'g'), name: (m) => m[2] },
  { rule: 'env-dynamic', re: new RegExp(`${ENV}\\s*(?:\\?\\.)?\\[\\s*(?!["'\`])`, 'g'), name: () => null },
  // The object itself: `= x.env;` `f(x.env)` `{...x.env}` `x.env||{}` `x.env??{}`. A comparison (`void 0!==x.env`, a typeof-style guard) is not a copy.
  { rule: 'env-alias', re: new RegExp(`(?:(?<![=!<>])=(?!=)|[(,]|\\.\\.\\.)\\s*(?:${ID}\\s*\\.\\s*)*env\\s*(?=[,;)}]|\\|\\||\\?\\?)`, 'g'), name: () => null },
];
const DESTRUCTURE = new RegExp(`\\{([^{}]{1,600})\\}\\s*=\\s*(?:${ID}\\s*\\.\\s*)*env(?![\\w$])`, 'g');

/** Smallest secret value that is compared and masked. Shorter text is too common in a chunk to mean anything. */
export const MIN_SECRET_LENGTH = 8;

/** The texts to look for: each secret value as it is, and as a JSON string body (a bundler may escape quotes, slashes and newlines). Longest first. */
function needlesOf(secrets) {
  /** @type {{name: string, text: string}[]} */
  const out = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') continue;
    const raw = value.trim();
    if (raw.length < MIN_SECRET_LENGTH) continue;
    out.push({ name, text: raw });
    const escaped = JSON.stringify(raw).slice(1, -1);
    if (escaped !== raw) out.push({ name, text: escaped });
  }
  return out.sort((a, b) => b.text.length - a.text.length);
}

/** `text` with every secret value replaced by fill(length) (the same length by default, so positions stay put). */
/**
 * @param {string} text
 * @param {Record<string, string>} secrets
 * @param {(length: number) => string} [fill]
 */
export function maskSecrets(text, secrets, fill = (n) => '*'.repeat(n)) {
  let out = text;
  for (const n of needlesOf(secrets)) if (out.includes(n.text)) out = out.split(n.text).join(fill(n.text.length));
  return out;
}

/**
 * Every runtime read in one chunk's text, and every mention (warning) of a watched name. A secret value in `opts.secrets` is never
 * copied into a result: the chunk is masked (same length) before any context or name is taken from it.
 * @param {string} file
 * @param {string} rawText
 * @param {{ envKeys?: string[], secrets?: Record<string, string> }} [opts]
 * @returns {{ reads: {file: string, rule: string, name: string | null, context: string}[], mentions: {file: string, name: string, context: string}[] }}
 */
export function scanChunk(file, rawText, opts = {}) {
  const envKeys = opts.envKeys ?? [];
  const secrets = opts.secrets ?? {};
  const text = maskSecrets(rawText, secrets); // same length, so every index below also holds in rawText
  const reads = [];
  const ctx = (at, len) => text.slice(Math.max(0, at - 80), at + len + 40).replace(/\s+/g, ' ');
  const envSpans = [];
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      envSpans.push([m.index, m.index + m[0].length]);
      // `{ A: a } = x.env;` is reported once, by the destructuring rule below, not also as an alias.
      if (r.rule === 'env-alias' && m[0].startsWith('=') && /\}\s*$/.test(text.slice(Math.max(0, m.index - 4), m.index))) continue;
      const name = r.name(m);
      if (name !== null && isAllowed(name, envKeys)) continue;
      reads.push({ file, rule: r.rule, name, context: ctx(m.index, m[0].length) });
    }
  }
  for (const m of text.matchAll(DESTRUCTURE)) {
    const names = [...m[1].matchAll(new RegExp(`(?:^|,)\\s*(?:\\.\\.\\.\\s*)?(${ID}|["'][^"']+["'])`, 'g'))].map((x) => x[1].replace(/^["']|["']$/g, ''));
    envSpans.push([m.index, m.index + m[0].length]);
    for (const name of names) if (!isAllowed(name, envKeys)) reads.push({ file, rule: 'env-destructure', name, context: ctx(m.index, m[0].length) });
  }
  // A watched name used as a property on any object (an alias of env, a copied env object).
  for (const m of text.matchAll(new RegExp(`(?:\\?\\.|\\.)\\s*(${ID})|\\[\\s*(["'\`])(${ID})\\2\\s*\\]`, 'g'))) {
    const name = m[1] ?? m[3];
    if (!isWatched(name, envKeys)) continue;
    if (envSpans.some(([a, b]) => m.index >= a && m.index < b)) continue; // already reported by an env rule
    reads.push({ file, rule: 'watched-member', name, context: ctx(m.index, m[0].length) });
  }
  // The value of a secret-like variable inside the chunk (compared on the raw text; only the NAME is reported).
  for (const n of needlesOf(secrets)) {
    if (rawText.includes(n.text) && !reads.some((r) => r.rule === 'secret-value' && r.name === n.name)) reads.push({ file, rule: 'secret-value', name: n.name, context: '(value not printed)' });
  }
  // Mentions: a watched name anywhere else (a bare string or a sentence). Never a failure.
  const mentions = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9_$])[A-Za-z0-9_]+(?![A-Za-z0-9_$])/g)) {
    if (!isWatched(m[0], envKeys)) continue;
    if (reads.some((r) => r.name === m[0])) continue;
    mentions.push({ file, name: m[0], context: ctx(m.index, m[0].length) });
  }
  return { reads, mentions };
}

/**
 * Secret-like variables of this environment (their values are compared and masked, never printed). A name is secret-like when it holds
 * SECRET, TOKEN, PASSWORD, KEY, LOGIN, JSON ... in any case and anywhere (resend_api_key_holler), or is in SECRET_EXTRA_NAMES. This covers
 * every secret of lib/env.ts ENV_KEYS and .env.example (tests/ops/client-switches.test.ts proves it for both lists).
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function secretValues(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && isSecretName(k)) out[k] = v;
  return out;
}

/** True when `name` is one whose value secretValues() compares. */
export function isSecretName(name) {
  return !NOT_SECRET.test(name) && name !== 'NODE_ENV' && (SECRET_WORDS.test(name) || SECRET_EXTRA_NAMES.includes(name));
}

function jsFiles(d) {
  const out = [];
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Names that next.config.ts `env` inlines in this build (.next/required-server-files.json config.env), or null when the build does not say. */
export function inlinedNamesOfBuild(nextDir) {
  try {
    const cfg = JSON.parse(readFileSync(join(nextDir, 'required-server-files.json'), 'utf8'));
    return Object.keys(cfg?.config?.env ?? {});
  } catch {
    return null;
  }
}

/**
 * A server-bundle read of an inlined name that Next did not replace: `env?.NAME`, `env.NAME` or `env["NAME"]` still in the text. Next
 * replaces only the plain `process.env.NAME`; any other form is read at runtime in the server while the browser holds the inlined value.
 * @param {string} file
 * @param {string} text
 * @param {string[]} names
 */
export function scanServerForInlinedReads(file, text, names) {
  const out = [];
  for (const name of names) {
    if (!text.includes(name)) continue;
    const re = new RegExp(`(?<![\\w$])env\\s*(?:\\?\\.\\s*|\\.\\s*|\\??\\.?\\[\\s*["'\`])${name}(?![\\w$])`, 'g');
    for (const m of text.matchAll(re)) {
      out.push({ file, rule: 'inlined-read-left', name, context: text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30).replace(/\s+/g, ' ') });
      break; // one line per file and name
    }
  }
  return out;
}

/** Source files of the app (not tests, not generated) that could read an inlined switch. */
function sourceFiles(d) {
  const out = [];
  for (const f of readdirSync(d)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(?:tsx?|jsx?|mjs)$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

/**
 * Source that writes an inlined name with an optional chain: `process.env?.NAME`, `env?.NAME`, `env?.["NAME"]`. Comment lines are skipped.
 * @param {string} file
 * @param {string} text
 * @param {string[]} names
 */
export function scanSourceForOptionalReads(file, text, names) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    for (const name of names) {
      if (!line.includes(name)) continue;
      if (new RegExp(`(?<![\\w$])env\\s*\\?\\.\\s*(?:\\[\\s*["'\`])?${name}(?![\\w$])`).test(line)) {
        out.push({ file: `${file}:${i + 1}`, rule: 'inlined-optional-read', name, context: line.trim().slice(0, 160) });
      }
    }
  }
  return out;
}

/**
 * @param {string[]} [argv]
 * @param {(line: string) => void} [rawLog]
 * @param {string} [root] the project folder whose app/, components/ and lib/ sources are checked (the repo root)
 * @returns {0 | 1 | 2}
 */
export function main(argv = process.argv.slice(2), rawLog = console.log, root = ROOT) {
  const secrets = secretValues();
  // Safety net: no line this script prints may hold a secret value (each hit's text is already masked; this also covers file names).
  const log = (line) => rawLog(maskSecrets(line, secrets, () => '[redacted]'));
  const dir = argv[0] ?? join(process.cwd(), '.next', 'static');
  let files = [];
  try {
    files = jsFiles(dir);
  } catch {
    files = [];
  }
  if (files.length === 0) {
    log(`check-client-switches: no .js files under ${dir}. Run next build first.`);
    return 2;
  }
  let envKeys = [];
  try {
    envKeys = envKeysFromSource(readFileSync(join(ROOT, 'lib', 'env.ts'), 'utf8'));
  } catch {
    envKeys = [];
  }
  const bad = allowListProblems(envKeys);
  if (bad.length > 0) {
    log(`FAIL allow-list: ${bad.join(', ')} may not be in CLIENT_ENV_ALLOW (HOLLER_*, secret-like and lib/env.ts names are never allowed).`);
    return 1;
  }
  const reads = [];
  const mentions = [];
  for (const f of files) {
    const r = scanChunk(relative(dir, f), readFileSync(f, 'utf8'), { envKeys, secrets });
    reads.push(...r.reads);
    mentions.push(...r.mentions);
  }
  log(
    `check-client-switches: ${files.length} browser chunks; any env read of any name except NODE_ENV, NEXT_PUBLIC_* and ${Object.keys(CLIENT_ENV_ALLOW).length} allowed library names; on any object: HOLLER_*, *_SECRET, *_PASSWORD and ${envKeys.length} ENV_KEYS names; ${Object.keys(secrets).length} secret values compared`,
  );
  // The server bundles must hold no unreplaced read of an inlined name (only when this build left them: .next/server beside .next/static).
  const nextDir = dirname(dir);
  const inlined = basename(dir) === 'static' ? inlinedNamesOfBuild(nextDir) : null;
  if (inlined && inlined.length > 0 && existsSync(join(nextDir, 'server'))) {
    let serverFiles = 0;
    for (const f of jsFiles(join(nextDir, 'server'))) {
      serverFiles++;
      reads.push(...scanServerForInlinedReads(relative(nextDir, f), maskSecrets(readFileSync(f, 'utf8'), secrets), inlined));
    }
    log(`check-client-switches: ${serverFiles} server files checked for an unreplaced read of ${inlined.length} inlined name(s)`);
  } else {
    log('check-client-switches: server bundles not checked (no .next/server or no inlined name)');
  }
  // The source must write each inlined name in the plain documented form (see inlined-optional-read above).
  if (inlined && inlined.length > 0) {
    let sourceCount = 0;
    for (const sub of ['app', 'components', 'lib']) {
      if (!existsSync(join(root, sub))) continue;
      for (const f of sourceFiles(join(root, sub))) {
        sourceCount++;
        reads.push(...scanSourceForOptionalReads(relative(root, f), maskSecrets(readFileSync(f, 'utf8'), secrets), inlined));
      }
    }
    log(`check-client-switches: ${sourceCount} source files checked for process.env?.NAME on ${inlined.length} inlined name(s)`);
  }
  for (const m of mentions) log(`WARN ${m.name} named in text (not a read) in ${m.file}: ...${m.context}...`);
  if (reads.length === 0) {
    log('PASS: no server variable is read at runtime in a browser chunk.');
    return 0;
  }
  for (const r of reads) log(`FAIL ${r.rule}${r.name ? ` ${r.name}` : ''} in ${r.file}: ...${r.context}...`);
  log(
    `FAIL: ${reads.length} read(s) that break the switch rule. A switch the browser needs: list it in lib/build-switches.ts INLINED_SWITCHES (read it as plain process.env.NAME). ` +
      'A name a LIBRARY reads that is public by nature: add it to CLIENT_ENV_ALLOW in scripts/check-client-switches.mjs with the library and why it is safe (never HOLLER_*, a secret, or a lib/env.ts name). ' +
      'Anything else: decide it on the server and pass the result as a prop.',
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
