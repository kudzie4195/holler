// After `npm run build`: prove from dist/ that this is a flags-off, keyless build and that the three optional
// native plugins (Firebase Messaging, RevenueCat, Apple sign-in) are separate chunks that start-up never loads. A Capacitor plugin only
// talks to native code once its chunk has been imported and called, so a chunk that nothing imports
// statically cannot be touched at launch. Exit 1 on any finding. Prints names only.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = ['FirebaseMessaging', 'Purchases', 'AppleSignIn'];
// This first test build must have every feature flag off and no RevenueCat key (TESTER-NOTES.md says so).
const FLAGS_OFF = ['VITE_APPLE_SIGN_IN', 'VITE_GOOGLE_SIGN_IN', 'VITE_PUSH_ENABLED', 'VITE_IOS_EXTERNAL_PURCHASE_LINK'];
const KEYS_EMPTY = ['VITE_REVENUECAT_IOS_KEY', 'VITE_REVENUECAT_ANDROID_KEY'];

/**
 * Check a built dist folder. Returns { startup, report, problems }; problems is empty when the build is
 * a flags-off, keyless one whose three optional plugins are lazy chunks that nothing loads at start-up.
 * dist/ gets the compiled VITE_ values as one object literal (import.meta.env), so the flags and keys
 * are read from there: a build made with push, Apple sign-in or a RevenueCat key on fails here.
 */
export function checkDist(dist) {
  const problems = [];
  const report = [];
  if (!existsSync(path.join(dist, 'index.html'))) {
    return { startup: [], report, problems: [`${dist}/index.html not found. Run npm run build first.`] };
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

  const entryCode = entries.map((e) => chunks[e] ?? '').join('\n');

  // The push gate must still be in the entry bundle: enabled only with the flag and a phone.
  if (!/enabled:[\w$.]+\.flags\.push&&[\w$]+\(\)/.test(entryCode)) problems.push('push gate "enabled: flags.push && isNative()" not found in the entry bundle');
  // The calm "not available" states must still be there (exact copy, not just the word).
  for (const text of ['Plans are not open in this build', 'Not available in this build']) {
    if (!entryCode.includes(text)) problems.push(`the text "${text}" is missing from the entry bundle`);
  }

  // The compiled VITE_ values: all flags false, no RevenueCat key. Names only in messages, never values.
  const env = /\{BASE_URL:[^{}]*VITE_APP_VERSION:[^{}]*\}/.exec(entryCode)?.[0] ?? null;
  if (!env) {
    problems.push('could not find the compiled VITE_ settings object in the entry bundle (build output changed; review this check)');
  } else {
    const val = (name) => new RegExp(`\\b${name}:(\`[^\`]*\`|![01]|[\\w$]+)`).exec(env)?.[1];
    for (const f of FLAGS_OFF) {
      const v = val(f);
      if (v !== undefined && v !== '`false`' && v !== '!1') problems.push(`${f} is on in this build (it must be false for the first test build)`);
    }
    for (const k of KEYS_EMPTY) {
      const v = val(k);
      if (v !== undefined && v !== '``') problems.push(`${k} is set in this build (it must be empty for the first test build)`);
    }
    report.push(`compiled settings: flags ${FLAGS_OFF.map((f) => `${f.replace('VITE_', '')}=${(val(f) ?? 'unset').replace(/`/g, '')}`).join(', ')}; RevenueCat keys ${KEYS_EMPTY.map((k) => ((val(k) ?? '``') === '``' ? 'empty' : 'SET')).join('/')}`);
  }
  for (const [f, code] of Object.entries(chunks)) {
    if (/\b(?:appl|goog)_[A-Za-z0-9]{8,}/.test(code)) problems.push(`${f} contains a RevenueCat public key (appl_ or goog_)`);
  }

  return { startup: [...startup], report, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(root, process.argv[2] ?? 'dist');
  const { startup, report, problems } = checkDist(dist);
  console.log(`start-up chunks (entry plus static imports): ${startup.join(', ')}`);
  for (const line of report) console.log(line);
  if (problems.length) {
    for (const p of problems) console.error(`check-dist-gating: ${p}`);
    process.exit(1);
  }
  console.log('check-dist-gating: ok, flags off, no RevenueCat key, and no optional native plugin is loaded at start-up');
}
