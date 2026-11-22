import type { Db } from './store';
import type { SignalInput } from './types';

/** Most sample rows one run keeps for a source on probation. */
export const SAMPLE_CAP = 300;
/** Samples older than this are deleted on every run of the source. */
export const SAMPLE_KEEP_DAYS = 14;

export const SAMPLES_MISSING = 'holler_source_samples missing: apply 0022';

export class SamplesMissingError extends Error {
  constructor() {
    super(SAMPLES_MISSING);
  }
}

function isMissingTable(e: { code?: string; message?: string }): boolean {
  return e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(e.message ?? '');
}

/**
 * Probation storage (migration 0022). A source with `Adapter.probation` keeps its rows here, never in holler_signals: the table is
 * service role only, so nothing in it can reach a member, a public page, the anon API, matching or a push. Keeps up to SAMPLE_CAP rows
 * per call (duplicates on source + external_id are ignored), deletes this source's samples older than SAMPLE_KEEP_DAYS, and returns the
 * number of rows written. Throws SamplesMissingError when the table is not there yet.
 */
export async function storeSourceSamples(db: Db, source: string, signals: SignalInput[], now: Date = new Date()): Promise<number> {
  const seen = new Set<string>();
  const rows: { source: string; external_id: string; fetched_at: string; row: SignalInput }[] = [];
  for (const s of signals) {
    if (rows.length >= SAMPLE_CAP) break;
    if (seen.has(s.externalId)) continue;
    seen.add(s.externalId);
    rows.push({ source, external_id: s.externalId, fetched_at: now.toISOString(), row: s });
  }
  let written = 0;
  if (rows.length) {
    const { data, error } = await db
      .from('holler_source_samples')
      .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true })
      .select('id');
    if (error) {
      if (isMissingTable(error)) throw new SamplesMissingError();
      throw new Error(`source samples upsert failed: ${error.message}`);
    }
    written = (data ?? []).length;
  }
  const cutoff = new Date(now.getTime() - SAMPLE_KEEP_DAYS * 86_400_000).toISOString();
  const { error: delError } = await db.from('holler_source_samples').delete().eq('source', source).lt('fetched_at', cutoff);
  if (delError && isMissingTable(delError)) throw new SamplesMissingError();
  // A failed cleanup never fails the run: the next run deletes the same rows.
  return written;
}
