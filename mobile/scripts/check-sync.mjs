// After `npx cap sync` (or `cap copy`): the web assets inside both native projects must be exactly dist/.
// Capacitor adds two files of its own (cordova.js, cordova_plugins.js); nothing else may differ.
// Exit 1 on any missing, extra or changed file. Prints names and sizes, never contents.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPACITOR_OWN = new Set(['cordova.js', 'cordova_plugins.js']);
const TARGETS = ['ios/App/App/public', 'android/app/src/main/assets/public'];

function files(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const dist = path.join(root, 'dist');
if (!existsSync(dist)) {
  console.error('check-sync: dist/ is missing. Run npm run build first.');
  process.exit(1);
}
const distFiles = files(dist);
let bad = 0;
console.log(`dist/: ${distFiles.length} files`);
for (const t of TARGETS) {
  const dir = path.join(root, t);
  if (!existsSync(dir)) {
    console.error(`check-sync: ${t} does not exist. Run npx cap sync.`);
    bad++;
    continue;
  }
  const have = files(dir);
  const missing = distFiles.filter((f) => !have.includes(f));
  const extra = have.filter((f) => !distFiles.includes(f) && !CAPACITOR_OWN.has(f));
  const changed = distFiles.filter((f) => have.includes(f) && sha(path.join(dist, f)) !== sha(path.join(dir, f)));
  const own = have.filter((f) => CAPACITOR_OWN.has(f));
  console.log(`${t}: ${have.length} files (${own.length} added by Capacitor: ${own.join(', ') || 'none'}); missing ${missing.length}, extra ${extra.length}, changed ${changed.length}`);
  for (const [label, list] of [['missing', missing], ['extra', extra], ['changed', changed]]) {
    for (const f of list) console.error(`check-sync: ${t}: ${label}: ${f}`);
    bad += list.length;
  }
}
if (bad) process.exit(1);
console.log('check-sync: ok, both native projects hold exactly dist/');
