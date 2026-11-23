import { sanitizeContacts } from '@/lib/contacts/sanitize';
import type { Db } from './store';
import { contactsAllowedFor } from '@/lib/contacts/extract';
import type { SignalInput } from './types';

/**
 * Source probation storage (ported from the parallel branch's lib/signals/samples.ts, round 19 UNIFY). A source with `Adapter.probation`
 * keeps its rows in holler_source_samples (migration 0032, service role only: RLS on, no policy, nothing granted to anon or authenticated),
 * never in holler_signals. Nothing in that table can reach a member, a feed card, an alert, an email, a push, an SEO page, a public count,
 * matching or the anon API.
 *
 * Differences from the other branch (this base's rules):
 *  - the migration is 0032 here (theirs was numbered 0022 and is renamed in the merge; this base's 0022 is the contact licence column);
 *  - with the table missing a probation source is SKIPPED with no error (theirs logged an error on scan_runs): run.ts asks
 *    samplesTableState() once per scan before fetching, and a SamplesMissingError at write time is treated the same way.
 */

/** Most sample rows one run keeps for a source on probation. */
export const SAMPLE_CAP = 300;
/** Samples older than this are deleted by every scan (pruneSourceSamples), for every source. */
export const SAMPLE_KEEP_DAYS = 14;
/** What a skipped probation source says in the scan report (never an error, never on scan_runs). */
export const SAMPLES_MISSING = 'holler_source_samples missing: apply migration 0032';

export class SamplesMissingError extends Error {
  constructor() {
    super(SAMPLES_MISSING);
    this.name = 'SamplesMissingError';
  }
}

/** The table is not there yet: PostgREST PGRST205, Postgres 42P01, or the message of either. */
export function isSamplesTableMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(e.message ?? '');
}

/**
 * Is the samples table there? One cheap select (no row data is used). 'missing' only on the two missing-table codes or messages;
 * any other failure is 'failed' (the scan then still tries the write, which reports its own error). Never throws.
 */
export async function samplesTableState(db: Db): Promise<'ok' | 'missing' | 'failed'> {
  try {
    const { error } = await db.from('holler_source_samples').select('id').limit(1);
    if (!error) return 'ok';
    return isSamplesTableMissing(error) ? 'missing' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Keeps up to SAMPLE_CAP rows per call (duplicates on source + external_id are ignored, never overwritten) and returns the number of
 * rows written. Throws SamplesMissingError when the table is not there; any other error throws a plain Error.
 */
export async function storeSourceSamples(db: Db, source: string, signals: SignalInput[], now: Date = new Date()): Promise<number> {
  const seen = new Set<string>();
  const rows: { source: string; external_id: string; fetched_at: string; row: SignalInput }[] = [];
  for (const s of signals) {
    if (rows.length >= SAMPLE_CAP) break;
    if (s.stageProbe) continue; // a stage-query probe row is never a record of its own
    if (seen.has(s.externalId)) continue;
    seen.add(s.externalId);
    rows.push({ source, external_id: s.externalId, fetched_at: now.toISOString(), row: sanitizeSample(s) });
  }
  if (!rows.length) return 0;
  const { data, error } = await db
    .from('holler_source_samples')
    .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) {
    if (isSamplesTableMissing(error)) throw new SamplesMissingError();
    throw new Error(`source samples upsert failed: ${error.message}`);
  }
  return (data ?? []).length;
}

/**
 * The contact hygiene the live path applies (insertNewSignals / writeSignalContacts in store.ts), reusing its functions: the record kind
 * decides first (contactsAllowedFor, round 18: a 311 request keeps no contact, a code violation only an owner company and only while
 * HOLLER_VIOLATION_OWNERS_ENABLED is on, no other record an owner row), then every kept contact goes through sanitizeContacts with the
 * signal's own city.
 */
export function sanitizeSample(input: SignalInput): SignalInput {
  // Round 20 (LIC): licence numbers read for the insert-time lookup never reach a sample (the holder may be a person).
  const { licenseRefs: _refs, ...s } = input;
  void _refs;
  if (!s.contacts?.length) return s;
  const allowed = contactsAllowedFor(s.data?.subtype, s.contacts);
  if (!allowed.length) return { ...s, contacts: [] };
  return { ...s, contacts: sanitizeContacts(allowed, { datasetCity: s.city ?? null }) };
}

/**
 * Retention, once per scan and for ALL sources (a quiet, promoted or removed source's samples expire too): deletes every sample older
 * than SAMPLE_KEEP_DAYS. Never throws; 'missing' when the table is not there yet, 'failed' on any other error (the next scan deletes
 * the same rows), else 'ok'.
 */
export async function pruneSourceSamples(db: Db, now: Date = new Date()): Promise<'ok' | 'missing' | 'failed'> {
  const cutoff = new Date(now.getTime() - SAMPLE_KEEP_DAYS * 86_400_000).toISOString();
  try {
    const { error } = await db.from('holler_source_samples').delete().lt('fetched_at', cutoff);
    if (!error) return 'ok';
    return isSamplesTableMissing(error) ? 'missing' : 'failed';
  } catch {
    return 'failed';
  }
}
