import { sanitizeContacts } from '@/lib/contacts/sanitize';
import { noContactSubtype, type Db } from './store';
import type { SignalInput } from './types';

/** Most sample rows one run keeps for a source on probation. */
export const SAMPLE_CAP = 300;
/** Samples older than this are deleted by every scan (pruneSourceSamples), for every source. */
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
 * per call (duplicates on source + external_id are ignored), and returns the
 * number of rows written. Throws SamplesMissingError when the table is not there yet.
 */
export async function storeSourceSamples(db: Db, source: string, signals: SignalInput[], now: Date = new Date()): Promise<number> {
  const seen = new Set<string>();
  const rows: { source: string; external_id: string; fetched_at: string; row: SignalInput }[] = [];
  for (const s of signals) {
    if (rows.length >= SAMPLE_CAP) break;
    if (seen.has(s.externalId)) continue;
    seen.add(s.externalId);
    rows.push({ source, external_id: s.externalId, fetched_at: now.toISOString(), row: sanitizeSample(s) });
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
  return written;
}

/**
 * The contact hygiene the live path applies (insertNewSignals / writeSignalContacts in store.ts), reusing its functions: a code violation
 * or 311 request keeps no contact at all (noContactSubtype), every other contact goes through sanitizeContacts with the signal's own city.
 */
export function sanitizeSample(s: SignalInput): SignalInput {
  if (!s.contacts?.length) return s;
  if (noContactSubtype(s.data?.subtype)) return { ...s, contacts: [] };
  return { ...s, contacts: sanitizeContacts(s.contacts, { datasetCity: s.city ?? null }) };
}

/**
 * Retention, once per scan and for ALL sources (a quiet, promoted or removed source's samples expire too): deletes every sample older
 * than SAMPLE_KEEP_DAYS. Never throws; returns 'missing' when the table is not there yet (the caller logs that once), 'failed' on any
 * other error (the next scan deletes the same rows), else 'ok'.
 */
export async function pruneSourceSamples(db: Db, now: Date = new Date()): Promise<'ok' | 'missing' | 'failed'> {
  const cutoff = new Date(now.getTime() - SAMPLE_KEEP_DAYS * 86_400_000).toISOString();
  try {
    const { error } = await db.from('holler_source_samples').delete().lt('fetched_at', cutoff);
    if (!error) return 'ok';
    return isMissingTable(error) ? 'missing' : 'failed';
  } catch {
    return 'failed';
  }
}
