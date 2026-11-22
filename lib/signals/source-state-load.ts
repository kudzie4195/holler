import { readAllPages, type Db } from './store';
import { readSourceHealth } from './health';
import { missingEnvFor } from './run';
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
  const list = adapters ?? (await defaultAdapters());
  const [health, runs] = await Promise.all([readSourceHealth(db), readStateRuns(db, now, list)]);
  return computeSourceStates({ adapters: list, health, runs, now });
}

/** Every registered adapter with the env keys or flag it is missing. The registry is imported on demand (it pulls in every adapter). */
export async function defaultAdapters(): Promise<StateAdapter[]> {
  const { ALL_ADAPTERS } = await import('./registry');
  return ALL_ADAPTERS.map((a) => ({ id: a.id, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: missingEnvFor(a) }));
}
