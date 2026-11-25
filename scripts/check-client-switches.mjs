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
// FAIL (exit 1), each a runtime read:
//   env-member     `<x>.env.NAME` or `<x>.env?.NAME` for any NAME except NODE_ENV and NEXT_PUBLIC_* (listed or not)
//   env-literal    `<x>.env["NAME"]` (same exceptions)
//   env-dynamic    `<x>.env[<expression>]`: a lookup by a name held in a variable
//   env-destructure `{ NAME: a } = <x>.env` (any name except the exceptions)
//   env-alias      the env object itself handed to a variable or a call (`= <x>.env;`), after which any name can be read
//   watched-member `.NAME` or `["NAME"]` for a watched name on any object (an alias or a copy of env): every HOLLER_* name, every
//                  *_SECRET and *_PASSWORD name, and every lib/env.ts ENV_KEYS name (NEXT_PUBLIC_* excepted). A *_KEY or *_TOKEN name
//                  not in ENV_KEYS is caught when it is read from env (env-member covers every name), not on other objects.
//   secret-value   the VALUE of a secret-like variable of the build's environment (12 characters or more) appears in a chunk (the name
//                  is printed, never the value)
// WARN only (exit 0): a watched name as a bare string ("HOLLER_X") or inside a sentence ("HOLLER_X is off, so ..."). Text that names a
// variable is not a read.
// Exit 2: no build found.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** ENV_KEYS from lib/env.ts, read as text (this script imports nothing). */
export function envKeysFromSource(src) {
  const m = /ENV_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src);
  return m ? [...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]) : [];
}

const ALLOWED = (name) => name === 'NODE_ENV' || name.startsWith('NEXT_PUBLIC_');
// On objects other than env, *_KEY and *_TOKEN are left out: framework code is full of them (Next's PAGE_SEGMENT_KEY, HEAD_REQUEST_KEY).
// Every *_KEY variable is still caught when read from env (env-member, any name), and the real keys are in ENV_KEYS.
const WATCHED_PATTERN = /^(?:HOLLER_[A-Z0-9_]+|[A-Z0-9_]*_(?:SECRET|PASSWORD))$/;
const SECRET_NAME = /(?:SECRET|KEY|TOKEN|PASSWORD|LOGIN|_JSON)$/i;

/** True for a name the check watches as a member on any object. */
export function isWatched(name, envKeys = []) {
  return !ALLOWED(name) && (WATCHED_PATTERN.test(name) || envKeys.includes(name));
}

const ID = '[A-Za-z_$][\\w$]*';
const ENV = `(?<![\\w$])env`; // the property or variable named env (process.env, a polyfill's n.default.env)
const RULES = [
  { rule: 'env-member', re: new RegExp(`${ENV}\\s*(?:\\?\\.|\\.)\\s*(${ID})`, 'g'), name: (m) => m[1] },
  { rule: 'env-literal', re: new RegExp(`${ENV}\\s*(?:\\?\\.)?\\[\\s*(["'\`])([^"'\`]+)\\1\\s*\\]`, 'g'), name: (m) => m[2] },
  { rule: 'env-dynamic', re: new RegExp(`${ENV}\\s*(?:\\?\\.)?\\[\\s*(?!["'\`])`, 'g'), name: () => null },
  { rule: 'env-alias', re: new RegExp(`[=(,]\\s*(?:${ID}\\s*\\.\\s*)*env\\s*(?=[,;)}])`, 'g'), name: () => null },
];
const DESTRUCTURE = new RegExp(`\\{([^{}]{1,600})\\}\\s*=\\s*(?:${ID}\\s*\\.\\s*)*env(?![\\w$])`, 'g');

/**
 * Every runtime read in one chunk's text, and every mention (warning) of a watched name.
 * @param {string} file
 * @param {string} text
 * @param {{ envKeys?: string[], secrets?: Record<string, string> }} [opts]
 * @returns {{ reads: {file: string, rule: string, name: string | null, context: string}[], mentions: {file: string, name: string, context: string}[] }}
 */
export function scanChunk(file, text, opts = {}) {
  const envKeys = opts.envKeys ?? [];
  const reads = [];
  const ctx = (at, len) => text.slice(Math.max(0, at - 80), at + len + 40).replace(/\s+/g, ' ');
  const envSpans = [];
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      envSpans.push([m.index, m.index + m[0].length]);
      // `{ A: a } = x.env;` is reported once, by the destructuring rule below, not also as an alias.
      if (r.rule === 'env-alias' && m[0].startsWith('=') && /\}\s*$/.test(text.slice(Math.max(0, m.index - 4), m.index))) continue;
      const name = r.name(m);
      if (name !== null && ALLOWED(name)) continue;
      reads.push({ file, rule: r.rule, name, context: ctx(m.index, m[0].length) });
    }
  }
  for (const m of text.matchAll(DESTRUCTURE)) {
    const names = [...m[1].matchAll(new RegExp(`(?:^|,)\\s*(?:\\.\\.\\.\\s*)?(${ID}|["'][^"']+["'])`, 'g'))].map((x) => x[1].replace(/^["']|["']$/g, ''));
    envSpans.push([m.index, m.index + m[0].length]);
    for (const name of names) if (!ALLOWED(name)) reads.push({ file, rule: 'env-destructure', name, context: ctx(m.index, m[0].length) });
  }
  // A watched name used as a property on any object (an alias of env, a copied env object).
  for (const m of text.matchAll(new RegExp(`(?:\\?\\.|\\.)\\s*(${ID})|\\[\\s*(["'\`])(${ID})\\2\\s*\\]`, 'g'))) {
    const name = m[1] ?? m[3];
    if (!isWatched(name, envKeys)) continue;
    if (envSpans.some(([a, b]) => m.index >= a && m.index < b)) continue; // already reported by an env rule
    reads.push({ file, rule: 'watched-member', name, context: ctx(m.index, m[0].length) });
  }
  for (const [name, value] of Object.entries(opts.secrets ?? {})) {
    if (typeof value === 'string' && value.trim().length >= 12 && text.includes(value.trim())) reads.push({ file, rule: 'secret-value', name, context: '(value not printed)' });
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
 * Secret-like variables of this environment (their values are compared, never printed).
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function secretValues(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!ALLOWED(k) && SECRET_NAME.test(k) && typeof v === 'string') out[k] = v;
  return out;
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

/**
 * @param {string[]} [argv]
 * @param {(line: string) => void} [log]
 * @returns {0 | 1 | 2}
 */
export function main(argv = process.argv.slice(2), log = console.log) {
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
  const secrets = secretValues();
  const reads = [];
  const mentions = [];
  for (const f of files) {
    const r = scanChunk(relative(dir, f), readFileSync(f, 'utf8'), { envKeys, secrets });
    reads.push(...r.reads);
    mentions.push(...r.mentions);
  }
  log(`check-client-switches: ${files.length} browser chunks; any env read of any name except NODE_ENV and NEXT_PUBLIC_*; on any object: HOLLER_*, *_SECRET, *_PASSWORD and ${envKeys.length} ENV_KEYS names`);
  for (const m of mentions) log(`WARN ${m.name} named in text (not a read) in ${m.file}: ...${m.context}...`);
  if (reads.length === 0) {
    log('PASS: no server variable is read at runtime in a browser chunk.');
    return 0;
  }
  for (const r of reads) log(`FAIL ${r.rule}${r.name ? ` ${r.name}` : ''} in ${r.file}: ...${r.context}...`);
  log(`FAIL: ${reads.length} runtime read(s) of server variables in browser chunks. Inline a switch the browser needs (lib/build-switches.ts) or decide it on the server and pass the result as a prop.`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
