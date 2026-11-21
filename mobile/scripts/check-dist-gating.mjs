// After `npm run build`: prove from dist/ that the three optional native plugins (Firebase Messaging,
// RevenueCat, Apple sign-in) are separate chunks that start-up never loads. A Capacitor plugin only
// talks to native code once its chunk has been imported and called, so a chunk that nothing imports
// statically cannot be touched at launch. Exit 1 on any finding. Prints names only.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, process.argv[2] ?? 'dist');
const PLUGINS = ['FirebaseMessaging', 'Purchases', 'AppleSignIn'];

if (!existsSync(path.join(dist, 'index.html'))) {
  console.error(`check-dist-gating: ${dist}/index.html not found. Run npm run build first.`);
  process.exit(1);
}

const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const entries = [...html.matchAll(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"/g)].map((m) => path.basename(m[1]));
const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.\/(assets\/[^"]+\.js)"/g)].map((m) => path.basename(m[1]));
const assets = path.join(dist, 'assets');
const chunks = Object.fromEntries(readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(path.join(assets, f), 'utf8')]));

// Static edges: `import ... from"./x.js"`, `import"./x.js"`, `export ... from"./x.js"`. Dynamic ones are import(`./x.js`).
const staticDeps = (code) => {
  const out = new Set();
  for (const m of code.matchAll(/(?:^|[;}\n])\s*(?:import|export)\s*(?:[^"'`;(]*?\bfrom\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g)) out.add(m[1]);
  return out;
};
const dynamicDeps = (code) => new Set([...code.matchAll(/\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g)].map((m) => m[1]));

// Everything reachable at launch through static edges from the entry script(s) and preloads.
const startup = new Set();
const queue = [...entries, ...preloads];
while (queue.length) {
  const f = queue.pop();
  if (startup.has(f) || !chunks[f]) continue;
  startup.add(f);
  for (const d of staticDeps(chunks[f])) queue.push(d);
}

const problems = [];
const report = [];
for (const name of PLUGINS) {
  const re = new RegExp('[\\w$]+\\(`' + name + '`\\s*,\\s*\\{web');
  const holders = Object.keys(chunks).filter((f) => re.test(chunks[f]));
  if (holders.length !== 1) {
    problems.push(`${name}: expected the plugin to be registered in exactly one chunk, found ${holders.length}`);
    continue;
  }
  const chunk = holders[0];
  const importers = Object.keys(chunks).filter((f) => dynamicDeps(chunks[f]).has(chunk));
  const staticImporters = Object.keys(chunks).filter((f) => staticDeps(chunks[f]).has(chunk));
  report.push(`${name}: registered only in ${chunk}; dynamic import() from ${importers.join(', ') || '(none)'}; static imports from ${staticImporters.join(', ') || '(none)'}; loaded at start-up: ${startup.has(chunk) ? 'YES' : 'no'}`);
  if (startup.has(chunk)) problems.push(`${name}: chunk ${chunk} is reachable at start-up`);
  // A plugin's own lazy web fallback may import it back; that is fine while the fallback is itself not a start-up chunk.
  const bad = staticImporters.filter((f) => startup.has(f));
  if (bad.length) problems.push(`${name}: chunk ${chunk} is statically imported by start-up chunk ${bad.join(', ')}`);
  if (!importers.length) problems.push(`${name}: chunk ${chunk} is never imported (dead code or a build change; review)`);
  // The plugin's own web fallback must not have been inlined into the entry either.
  for (const e of entries) if (chunks[e] && re.test(chunks[e])) problems.push(`${name}: registered inside the entry chunk ${e}`);
}

// The gates themselves must still be in the entry bundle: push enabled only with the flag and a phone.
const entryCode = entries.map((e) => chunks[e] ?? '').join('\n');
if (!/enabled:[\w$.]+\.flags\.push&&[\w$]+\(\)/.test(entryCode)) problems.push('push gate "enabled: flags.push && isNative()" not found in the entry bundle');
if (!/unavailable/.test(entryCode)) problems.push('the "unavailable" paywall/push states are missing from the entry bundle');

console.log(`start-up chunks (entry plus static imports): ${[...startup].join(', ')}`);
for (const line of report) console.log(line);
if (problems.length) {
  for (const p of problems) console.error(`check-dist-gating: ${p}`);
  process.exit(1);
}
console.log('check-dist-gating: ok, no optional native plugin is loaded at start-up');
