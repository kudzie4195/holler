/**
 * Shared by the public-output snapshot: which dataset parses which fixture, and the public projection of a SignalInput
 * (every field except `contacts`, which never reaches holler_signals).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import type { SignalInput } from '@/lib/signals/types';

export const FIXTURE_DIR = join(__dirname, '../fixtures');

export function publicProjection(s: SignalInput): Record<string, unknown> {
  // Field-by-field so a new public field shows up as a diff, and `contacts` is the only thing left out.
  // `permitStage` (round 17) is read by lib/signals/projects.ts and is not part of the plain upsert: it is not a stored public field.
  const { contacts: _contacts, permitStage: _stage, ...pub } = s as SignalInput & { contacts?: unknown };
  void _contacts;
  void _stage;
  return JSON.parse(JSON.stringify(pub)) as Record<string, unknown>;
}

/** fixture file -> parsed public output, for every fixture an adapter in this unit reads. */
export function parseAllFixtures(): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const f of readdirSync(FIXTURE_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    const raw: unknown = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8'));
    let items: SignalInput[] | null = null;
    if (f === 'usaspending-awards.json') items = parseUsaSpending(raw);
    else if (f.startsWith('socrata-')) {
      const id = f.replace(/\.json$/, '').replace(/-people$/, '').replace(/-live-\d{4}-\d{2}-\d{2}$/, '');
      const ds = SOCRATA_DATASETS.find((d) => d.id === id);
      if (ds) items = parseSocrata(raw, ds);
    } else if (f.startsWith('arcgis-')) {
      const id = f.replace(/\.json$/, '');
      const ds = ARCGIS_DATASETS.find((d) => d.id === id);
      if (ds) items = parseArcgis(raw, ds);
    }
    if (items) out[f] = items.map(publicProjection);
  }
  return out;
}
