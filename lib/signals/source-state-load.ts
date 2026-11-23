import { readAllPages, type Db } from './store';
import { readSourceHealth } from './health';
import { missingEnvFor } from './run';
import { samplesTableState } from './samples';
import {
  computeSourceStates,
  type ScanRunRow,
  type SourceStateResult,
  type StateAdapter,
} from './source-state';

/**
 * Reads what computeSourceStates needs (holler_source_health and each source's recent holler_scan_runs) and returns every adapter's
 * state. Read only: selects, no writes.
 *
 * Run history: every source scanned at least hourly gets 14 days (runs are kept 30 days), so a stall that began days ago still has the
 * steady stretch before it in view (a source whose rows stopped on day 3 is judged from days 1 to 3, not forgotten on day 5). A source
 * scanned more often than hourly (weather and storm feeds, 15 and 30 minutes) gets 96 hours: 14 days of it would be thousands of rows
 * and it is never judged by empty runs. Beyond 14 days the stored last_rows_seen_at takes over (see source-state.ts).
 * Throws when a read fails: callers decide what a failure means (member screens show nothing, the owner JSON says so).
 */
export const STATE_RUN_LOOKBACK_MS = 14 * 86_400_000;
export const STATE_FAST_RUN_LOOKBACK_MS = 96 * 3_600_000;
const FAST_CADENCE_MINUTES = 60;

/** The runs the state rules need, in two selects (slow sources 14 days, fast sources 96 hours). */
export async function readStateRuns(db: Db, now: Date, adapters: readonly StateAdapter[]): Promise<ScanRunRow[]> {
  const slow = adapters.filter((a) => a.cadenceMinutes >= FAST_CADENCE_MINUTES).map((a) => a.id);
  const fast = adapters.filter((a) => a.cadenceMinutes < FAST_CADENCE_MINUTES).map((a) => a.id);
  const read = (ids: string[], lookbackMs: number) =>
    ids.length === 0
      ? Promise.resolve([] as ScanRunRow[])
      : readAllPages<ScanRunRow>(
          (from, to) =>
            db
              .from('holler_scan_runs')
              .select('source, started_at, fetched, error')
              .in('source', ids)
              .gte('started_at', new Date(now.getTime() - lookbackMs).toISOString())
              .order('started_at', { ascending: false })
              .order('id', { ascending: false })
              .range(from, to),
          15,
        );
  const [a, b] = await Promise.all([read(slow, STATE_RUN_LOOKBACK_MS), read(fast, STATE_FAST_RUN_LOOKBACK_MS)]);
  return [...a, ...b];
}

export async function loadSourceStates(db: Db, now: Date, adapters?: StateAdapter[]): Promise<SourceStateResult[]> {
  const list = adapters ?? (await defaultAdapters(db));
  const [health, runs] = await Promise.all([readSourceHealth(db), readStateRuns(db, now, list)]);
  return computeSourceStates({ adapters: list, health, runs, now });
}

/** What a probation source is missing when the samples table (migration 0032) is not there: the scan skips it, so it is "not set up". */
export const SAMPLES_TABLE_MISSING_ENV = 'migration 0032 (holler_source_samples)';

/**
 * Probation sources (Adapter.probation) are skipped by the scan while holler_source_samples is missing (lib/signals/run.ts). Their state
 * must then say "not set up", never "unavailable" or behind (round 19 review, defect 7): this adds SAMPLES_TABLE_MISSING_ENV to their
 * missing list. The table is probed only when a probation source is listed and a db is given; a probe that fails for another reason
 * changes nothing.
 */
export async function withProbationSetup<T extends { probation?: boolean; missingEnv: readonly string[] }>(db: Db | null | undefined, list: T[]): Promise<T[]> {
  if (!db || !list.some((a) => a.probation)) return list;
  if ((await samplesTableState(db)) !== 'missing') return list;
  return list.map((a) => (a.probation && !a.missingEnv.includes(SAMPLES_TABLE_MISSING_ENV) ? { ...a, missingEnv: [...a.missingEnv, SAMPLES_TABLE_MISSING_ENV] } : a));
}

/** Every registered adapter with the env keys or flag it is missing. The registry is imported on demand (it pulls in every adapter). */
export async function defaultAdapters(db?: Db | null): Promise<StateAdapter[]> {
  const { ALL_ADAPTERS } = await import('./registry');
  const list = ALL_ADAPTERS.map((a) => ({ id: a.id, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: missingEnvFor(a), probation: !!a.probation }));
  return (await withProbationSetup(db, list)).map(({ id, kind, cadenceMinutes, missingEnv }) => ({ id, kind, cadenceMinutes, missingEnv }));
}
