/**
 * Round 34 switch audit: fails when a browser chunk of the last build still reads a server variable at runtime.
 *
 * A variable without NEXT_PUBLIC_ is undefined in the browser, so a client component (the feed card) that reads one disagrees with the
 * server render whenever the owner sets it. Switches the browser needs are inlined at build (lib/build-switches.ts, next.config.ts `env`)
 * and leave no name in the chunk. This script lists every ENV_KEYS name except NEXT_PUBLIC_* (lib/build-switch-check.ts serverEnvNames)
 * and fails if any of them appears in a .js file under the browser output folder.
 *
 *   npm run build && npm run check:client-switches                  (reads .next/static)
 *   npm run check:client-switches -- path/to/.next/static          (another build's folder)
 *
 * Exit 0: no server variable in any browser chunk. Exit 1: names, files and the text around each hit are printed. Exit 2: no build found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chunkHits, serverEnvNames } from '../lib/build-switch-check';
import { INLINED_SWITCHES } from '../lib/build-switches';

const dir = process.argv[2] ?? join(process.cwd(), '.next', 'static');

function jsFiles(d: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

let files: string[] = [];
try {
  files = jsFiles(dir);
} catch {
  files = [];
}
if (files.length === 0) {
  console.error(`check-client-switches: no .js files under ${dir}. Run npm run build first.`);
  process.exit(2);
}

const names = serverEnvNames();
const hits = files.flatMap((f) => chunkHits(f.slice(dir.length + 1), readFileSync(f, 'utf8'), names));
console.log(`check-client-switches: ${files.length} browser chunks, ${names.length} server variable names (inlined at build: ${INLINED_SWITCHES.join(', ')})`);
if (hits.length === 0) {
  console.log('PASS: no server variable is read at runtime in a browser chunk.');
  process.exit(0);
}
for (const h of hits) console.log(`FAIL ${h.name} in ${h.file} (${h.envRead ? 'env read' : 'name present'}): ...${h.context}...`);
console.log(`FAIL: ${new Set(hits.map((h) => h.name)).size} server variable(s) read in browser chunks. Inline a switch the browser needs (lib/build-switches.ts) or decide it on the server and pass the result as a prop.`);
process.exit(1);
