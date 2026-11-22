/**
 * Source probation. A new data source whose live responses could not be checked before release runs in production with
 * `Adapter.probation = true` (lib/signals/types.ts): its rows are stored with `data.probation = true` and counted in scan_runs and
 * source health, but never matched, pushed, emailed or shown to members or on public pages, until someone flips it live after
 * checking real rows (remove the flag from the adapter and remove the `data.probation` key from the stored rows, e.g. `update holler_signals set data = data - 'probation' where source = '...'`).
 *
 * Every path that turns stored signals into member-visible output skips rows for which isProbation() is true. Client-safe (no imports).
 */

/** Row fields isProbation reads: the whole `data` object, or the `probation` JSON alias (OPPORTUNITY_DATA_COLUMNS: data->>probation). */
export interface ProbationFields {
  data?: { probation?: unknown } | null;
  probation?: unknown;
}

/** True when the stored row came from a source on probation. Accepts a row with `data`, with the `probation` alias, or neither (false). */
export function isProbation(row: object | null | undefined): boolean {
  if (!row) return false;
  const r = row as ProbationFields;
  if (r.data && typeof r.data === 'object' && r.data.probation === true) return true;
  return r.probation === true || r.probation === 'true';
}

/** The rows minus probation rows. */
export function withoutProbation<T extends object>(rows: T[]): T[] {
  return rows.filter((r) => !isProbation(r));
}

/**
 * JSON path of the flag for a direct query: `.is(PROBATION_COLUMN, null)` keeps every row that is not on probation. The flag is only
 * ever written as true (withProbationData) and cleared by removing the key, so "no flag" is the visible state. (PostgREST `not.eq.true`
 * would drop the NULL rows, which are all the normal ones, so the test is is-null.)
 */
export const PROBATION_COLUMN = 'data->>probation';

/** Returns the signal data with `probation: true` merged in (other keys kept) when the adapter is on probation; otherwise the data as given. */
export function withProbationData<T extends Record<string, unknown> | undefined>(data: T, probation: boolean | undefined): T | Record<string, unknown> {
  return probation ? { ...(data ?? {}), probation: true } : data;
}
