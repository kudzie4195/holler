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
//                  (resend_api_key_holler), or is in SECRET_EXTRA_NAMES, or its VALUE is a URL that carries credentials. Only the NAME is ever
//                  printed: every secret value is masked in every line this script prints, also inside the context of another hit, and written
//                  as a JS string literal in any quote style (double, single with backslash escapes, template). A secret value shorter than
//                  8 characters cannot be found or masked reliably, so while the environment holds one, NO context text is printed at all
//                  (rule, name and file only).
//   inlined-read-left  (needs .next/server) a name that next.config.ts `env` inlines is still READ at runtime in a compiled server bundle
//                  (.js only), written `env?.NAME` or `env["NAME"]`. Such a reader sees the real variable on the server and the inlined value
//                  in the browser (the two renders can disagree).
//   inlined-optional-read  SOURCE under app/, components/, lib/ writes `process.env?.NAME` (or `env?.["NAME"]`) for a name that
//                  next.config.ts `env` inlines. Next documents only the plain `process.env.NAME` as replaced. Measured with this Next (Turbopack,
//                  round 34 second fix, build B6c): the `?.` form is replaced too, in the server and the browser bundle, so this is not a bug
//                  today; the rule keeps the documented form so a bundler that follows the documentation (webpack, a Next upgrade) cannot
//                  leave a runtime read in the browser or the server.
//                  The two rules above take the inlined names from INLINED_SWITCHES in lib/build-switches.ts (read as text), NOT from
//                  .next/required-server-files.json: Next writes `env: undefined` into that manifest on Vercel (round 34 review, P1-1), so a
//                  manifest-driven rule never ran there. Names the manifest does list are checked too. When INLINED_SWITCHES cannot be read
//                  the build FAILS (`inlined-names-unknown`) instead of skipping the rules.
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

const SECRET_WORDS = /(?:SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|APIKEY|ACCESSKEY|PRIVATEKEY)|(?:^|[^A-Za-z0-9])(?:KEYS?|PASS|PWD|LOGIN|JSON|JWT|DSN|CREDENTIALS?|PRIVATE)(?:[^A-Za-z0-9]|$)/i;
/** A connection string name: a database or cache word and URL, URI, DSN or CONNECTION (DATABASE_URL, POSTGRES_URL_NON_POOLING, REDIS_URI, db_connection_string). */
const CONNECTION_NAME = /(?:^|[^A-Za-z0-9])(?:DATABASE|DB|POSTGRES|POSTGRESQL|PG|MYSQL|MONGO|MONGODB|REDIS|AMQP|SQL|SUPABASE_DB)(?:[^A-Za-z0-9]|$).*(?:URL|URI|DSN|CONNECTION)|(?:^|[^A-Za-z0-9])(?:DATABASE|POSTGRES|POSTGRESQL|MYSQL|MONGODB)URL/i;
/** A URL that carries a password or a secret in it: scheme://user:pass@host, or ?token=, ?key=, ?apikey=, ?password=, ?secret=, ?sig= in the query. */
const URL_WITH_CREDENTIALS = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]*:[^/\s@]+@|[?&](?:[A-Za-z0-9_]*(?:token|key|secret|password|passwd|pwd|sig|signature|auth))=[^&\s]+/i;
/** True when a variable's value is a URL that holds credentials (whatever the variable is called). */
export function valueHasCredentials(value) {
  return typeof value === 'string' && URL_WITH_CREDENTIALS.test(value.trim());
}
/** True when the NAME alone says the value is a secret. */
function secretByName(name) {
  return SECRET_WORDS.test(name) || CONNECTION_NAME.test(name);
}
/** Names whose value is compared although the pattern may miss them (the owner account id, the Vercel alias of the Resend key). */
export const SECRET_EXTRA_NAMES = ['HOLLER_OWNER_USER_ID', 'resend_api_key_holler'];
// Never compared: public by nature (build metadata Vercel and npm set, NEXT_PUBLIC_*).
const NOT_SECRET = /^(?:NEXT_PUBLIC_|VERCEL_GIT_|npm_package_|npm_lifecycle_)/;
/** A name that may never be on the allow-list. */
const neverAllowed = (name, envKeys) => !/^[A-Za-z0-9_]+$/.test(name) || /^HOLLER_/i.test(name) || secretByName(name) || envKeys.some((k) => k.toLowerCase() === name.toLowerCase());
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
/** `}` then `= <x>.env`: the end of a destructuring pattern that reads from env. The pattern itself is found by destructurePatterns(). */
const DESTRUCTURE_END = new RegExp(`\\}\\s*(=)\\s*(?:${ID}\\s*\\.\\s*)*env(?![\\w$])`, 'g');
const MAX_PATTERN = 1500;
const NO_CONTEXT = '(context not printed: a secret value in this environment is shorter than 8 characters)';

/** Index of the `{` that opens the pattern closed by the `}` at `close`, scanning backwards (quotes are skipped), or -1 when not found. */
function openingBrace(text, close) {
  let depth = 0;
  let quote = null;
  for (let i = close; i >= 0 && close - i < MAX_PATTERN; i--) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '}') depth++;
    else if (ch === '{' && --depth === 0) return i;
  }
  return -1;
}

/** The entries of an object pattern body at depth 0: `a`, `a:b`, `a=1`, `a:{b}`, `"a":b`, `[k]:v`, `...r`. Quotes and brackets are skipped. */
function patternEntries(body) {
  const entries = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if ((ch === ',' && depth === 0) || i === body.length) {
      const e = body.slice(start, i).trim();
      if (e) entries.push(e);
      start = i + 1;
    }
  }
  return entries;
}

/**
 * Every `{ ... } = <x>.env` in the text: the position of the `=`, the names read (rule env-destructure), and whether the pattern could not be
 * taken apart or copies the whole object (`...rest`, `[computed]`; reported as env-alias or env-dynamic). A pattern may hold defaults and nested
 * patterns (`{ npm_package_name: e = {}, HOLLER_LSR_ENABLED: t }`): only the keys at depth 0 are names read from env.
 * @param {string} text
 * @returns {{ eq: number, at: number, length: number, names: string[], alias: boolean, dynamic: boolean }[]}
 */
export function destructurePatterns(text) {
  const out = [];
  for (const m of text.matchAll(DESTRUCTURE_END)) {
    const close = m.index;
    const open = openingBrace(text, close);
    const eq = m.index + m[0].indexOf('=');
    if (open < 0) {
      out.push({ eq, at: close, length: m[0].length, names: [], alias: true, dynamic: false });
      continue;
    }
    const names = [];
    let alias = false;
    let dynamic = false;
    for (const e of patternEntries(text.slice(open + 1, close))) {
      if (e.startsWith('...')) alias = true;
      else if (e.startsWith('[')) dynamic = true;
      else {
        const k = /^(?:["']([^"']+)["']|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*))/.exec(e);
        if (k) names.push(k[1] ?? k[2] ?? k[3]);
        else alias = true; // an entry that cannot be read: fail closed
      }
    }
    out.push({ eq, at: open, length: m.index + m[0].length - open, names, alias, dynamic });
  }
  return out;
}

/** Smallest secret value that is compared and masked. Shorter text is too common in a chunk to mean anything; see hasShortSecret. */
export const MIN_SECRET_LENGTH = 8;

/** True when the environment holds a secret-like value of 1 to MIN_SECRET_LENGTH - 1 characters: it cannot be found or masked reliably, so no context text is printed. */
export function hasShortSecret(secrets) {
  return Object.values(secrets).some((v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length < MIN_SECRET_LENGTH);
}

/** `raw` as the body of a JS string literal written with `quote` (a quote character, or '`'), the way a bundler writes it. */
function escapeForLiteral(raw, quote) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\u2028') out += '\\u2028';
    else if (ch === '\u2029') out += '\\u2029';
    else if (quote === '`' && ch === '$' && raw[i + 1] === '{') out += '\\$';
    else out += ch;
  }
  return out;
}

/**
 * The texts to look for: each secret value as it is, as the body of a JSON string, and as the body of a JS literal in each quote style
 * (double, single, template; SWC writes a value that holds double quotes, such as a Firebase service-account JSON, in single quotes with
 * every backslash doubled), each also with `/` written `\/`. Longest first.
 */
function needlesOf(secrets) {
  /** @type {{name: string, text: string}[]} */
  const out = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') continue;
    const raw = value.trim();
    if (raw.length < MIN_SECRET_LENGTH) continue;
    const forms = new Set([raw, JSON.stringify(raw).slice(1, -1), escapeForLiteral(raw, '"'), escapeForLiteral(raw, "'"), escapeForLiteral(raw, '`')]);
    for (const f of [...forms]) if (f.includes('/')) forms.add(f.replaceAll('/', '\\/'));
    for (const text of forms) out.push({ name, text });
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
  // A secret value under MIN_SECRET_LENGTH characters cannot be masked reliably: print names only.
  const hideContext = hasShortSecret(secrets);
  const ctx = (at, len) => (hideContext ? NO_CONTEXT : text.slice(Math.max(0, at - 80), at + len + 40).replace(/\s+/g, ' '));
  const envSpans = [];
  const patterns = destructurePatterns(text);
  const patternEq = new Set(patterns.map((p) => p.eq));
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      envSpans.push([m.index, m.index + m[0].length]);
      // `{ A: a } = x.env;` is reported once, by the destructuring rule below, not also as an alias (only when that rule took the pattern apart).
      if (r.rule === 'env-alias' && m[0].startsWith('=') && patternEq.has(m.index)) continue;
      const name = r.name(m);
      if (name !== null && isAllowed(name, envKeys)) continue;
      reads.push({ file, rule: r.rule, name, context: ctx(m.index, m[0].length) });
    }
  }
  for (const p of patterns) {
    envSpans.push([p.at, p.at + p.length]);
    for (const name of p.names) if (!isAllowed(name, envKeys)) reads.push({ file, rule: 'env-destructure', name, context: ctx(p.at, p.length) });
    if (p.dynamic) reads.push({ file, rule: 'env-dynamic', name: null, context: ctx(p.at, p.length) });
    if (p.alias) reads.push({ file, rule: 'env-alias', name: null, context: ctx(p.at, p.length) });
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
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && (isSecretName(k) || (!NOT_SECRET.test(k) && valueHasCredentials(v)))) out[k] = v;
  return out;
}

/** True when `name` is one whose value secretValues() compares because of the NAME (a URL whose value holds credentials is also compared; see valueHasCredentials). */
export function isSecretName(name) {
  return !NOT_SECRET.test(name) && name !== 'NODE_ENV' && (secretByName(name) || SECRET_EXTRA_NAMES.includes(name));
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

/** INLINED_SWITCHES from lib/build-switches.ts, read as text (this script imports nothing). null when the list cannot be found. */
export function inlinedSwitchesFromSource(src) {
  const m = /INLINED_SWITCHES\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]\s*as const/.exec(src);
  return m ? [...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]) : null;
}

/**
 * Names that next.config.ts `env` inlines in this build, from .next/required-server-files.json config.env, or null when the build does not
 * say. Vercel builds never say: Next writes `env: undefined` there when experimental.runtimeServerDeploymentId is on. Used only to ADD
 * names to the ones INLINED_SWITCHES gives; it is never the only source.
 */
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
  // The inlined names: INLINED_SWITCHES in the source (always there, on Vercel too), plus any name this build's manifest lists.
  const nextDir = dirname(dir);
  let inlined = null;
  try {
    inlined = inlinedSwitchesFromSource(readFileSync(join(root, 'lib', 'build-switches.ts'), 'utf8'));
  } catch {
    inlined = null;
  }
  if (inlined === null) {
    log(`FAIL inlined-names-unknown: INLINED_SWITCHES was not found in ${join(root, 'lib', 'build-switches.ts')}. The server-bundle and source rules cannot run, so the build stops instead of skipping them.`);
    return 1;
  }
  const fromBuild = basename(dir) === 'static' ? inlinedNamesOfBuild(nextDir) : null;
  const names = [...new Set([...inlined, ...(fromBuild ?? [])])];
  const shown = (list) => (hasShortSecret(secrets) ? list.map((r) => ({ ...r, context: NO_CONTEXT })) : list);
  // The server bundles must hold no unreplaced read of an inlined name (only when this build left them: .next/server beside .next/static).
  if (names.length > 0 && basename(dir) === 'static' && existsSync(join(nextDir, 'server'))) {
    let serverFiles = 0;
    for (const f of jsFiles(join(nextDir, 'server'))) {
      serverFiles++;
      reads.push(...shown(scanServerForInlinedReads(relative(nextDir, f), maskSecrets(readFileSync(f, 'utf8'), secrets), names)));
    }
    log(`check-client-switches: ${serverFiles} server files checked for an unreplaced read of ${names.length} inlined name(s) (${inlined.length} from lib/build-switches.ts${fromBuild && fromBuild.length > 0 ? `, ${fromBuild.length} from the build manifest` : ', none from the build manifest'})`);
  } else {
    log(`check-client-switches: server bundles not checked (${names.length === 0 ? 'no inlined name' : 'no .next/server beside the browser folder'})`);
  }
  // The source must write each inlined name in the plain documented form (see inlined-optional-read above).
  if (names.length > 0) {
    let sourceCount = 0;
    for (const sub of ['app', 'components', 'lib']) {
      if (!existsSync(join(root, sub))) continue;
      for (const f of sourceFiles(join(root, sub))) {
        sourceCount++;
        reads.push(...shown(scanSourceForOptionalReads(relative(root, f), maskSecrets(readFileSync(f, 'utf8'), secrets), names)));
      }
    }
    log(`check-client-switches: ${sourceCount} source files checked for process.env?.NAME on ${names.length} inlined name(s)`);
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
