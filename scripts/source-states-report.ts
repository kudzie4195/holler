/**
 * Read-only snapshot of every source's state (PLAN-2.0 item 2.4, round 15 unit H).
 *
 * Input: scripts/fixtures/source-states-live/ (health.psv, runs.psv, now.txt): the holler_source_health rows and the 3 newest
 * holler_scan_runs rows per source, copied from READ-ONLY `select` results on the live database (Nov 22 2026 02:36 UTC).
 * Adapters, kinds, cadences and the env each one needs come from the real registry (lib/signals/registry.ts) in THIS process: the
 * environment here has none of the optional keys, so those sources are "not set up yet". The live data agrees: none of those eight has
 * a health row or a single run in holler_scan_runs.
 * Output: /home/claude/gates/r15/H-states.md (or the path given as the first argument). Touches no database, network or clock.
 *
 *   JITI_TSCONFIG_PATHS=1 node node_modules/jiti/lib/jiti-cli.mjs scripts/source-states-report.ts [out.md]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_ADAPTERS } from '../lib/signals/registry';
import { missingEnvFor } from '../lib/signals/run';
import { readSourceHealthShape, formatSnapshot } from './source-states-format';

const dir = join(__dirname, 'fixtures', 'source-states-live');
const now = new Date(readFileSync(join(dir, 'now.txt'), 'utf8').trim());
const { health, runs } = readSourceHealthShape(readFileSync(join(dir, 'health.psv'), 'utf8'), readFileSync(join(dir, 'runs.psv'), 'utf8'));
const adapters = ALL_ADAPTERS.map((a) => ({ id: a.id, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: missingEnvFor(a) }));
const out = process.argv[2] ?? '/home/claude/gates/r15/H-states.md';
writeFileSync(out, formatSnapshot({ adapters, health, runs, now }));
console.log(`wrote ${out}`);
