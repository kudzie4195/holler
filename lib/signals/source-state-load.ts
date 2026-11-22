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
 * Reads what computeSourceStates needs (holler_source_health and the last 48 hours of holler_scan_runs) and returns every adapter's
 * state. Read only: two selects, no writes. 48 hours holds at least 3 runs of any source scanned every 12 hours or faster; a slower
 * source falls back on the stored failure count.
 * Throws when a read fails: callers decide what a failure means (member screens show nothing, the owner JSON says so).
 */
export const STATE_RUN_LOOKBACK_MS = 48 * 3_600_000;

export async function loadSourceStates(db: Db, now: Date, adapters?: StateAdapter[]): Promise<SourceStateResult[]> {
  const list = adapters ?? (await defaultAdapters());
  const since = new Date(now.getTime() - STATE_RUN_LOOKBACK_MS).toISOString();
  const [health, runs] = await Promise.all([
    readSourceHealth(db),
    readAllPages<ScanRunRow>(
      (from, to) =>
        db
          .from('holler_scan_runs')
          .select('source, started_at, fetched, error')
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      10,
    ),
  ]);
  return computeSourceStates({ adapters: list, health, runs, now });
}

/** Every registered adapter with the env keys or flag it is missing. The registry is imported on demand (it pulls in every adapter). */
export async function defaultAdapters(): Promise<StateAdapter[]> {
  const { ALL_ADAPTERS } = await import('./registry');
  return ALL_ADAPTERS.map((a) => ({ id: a.id, kind: a.kind, cadenceMinutes: a.cadenceMinutes, missingEnv: missingEnvFor(a) }));
}
