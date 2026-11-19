// Refuse to build when a secret-looking value sits in a VITE_ variable. First step of `npm run build`.
// Reads the env files Vite reads (later files win), then the shell. Prints names, never values.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClientEnvProblems, parseEnv } from './clientEnvRules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['.env', '.env.production', '.env.local', '.env.production.local'];

const vars = {};
const read = [];
for (const name of FILES) {
  const file = path.join(ROOT, name);
  if (!existsSync(file)) continue;
  read.push(name);
  Object.assign(vars, parseEnv(readFileSync(file, 'utf8')));
}
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('VITE_')) vars[key] = value;
}

const problems = findClientEnvProblems(vars);
const errors = problems.filter((p) => p.level === 'error');
for (const p of problems.filter((x) => x.level === 'warn')) console.warn(`check-client-env: warning: ${p.message}`);

if (!errors.length) {
  const n = Object.keys(vars).filter((k) => k.startsWith('VITE_')).length;
  console.log(`check-client-env: ${n} VITE_ variable(s) from ${read.join(', ') || 'the shell'}, nothing secret`);
  process.exit(0);
}
console.error('\ncheck-client-env: refusing to build. VITE_ variables are compiled into the app and readable by anyone:\n');
for (const p of errors) console.error(`  x ${p.message}\n`);
console.error('Fix the env file and build again. If one of these already went into a build, roll the credential.\n');
process.exit(1);
