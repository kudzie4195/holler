import { createHash } from 'node:crypto';
import type { Db } from './budget';

/**
 * Bounded retries for a record the model cannot answer ("poison": a record whose text makes the structured output come back bad or
 * unparseable). Without a bound, a fixed oldest-first order sends the same failing batch again every run, billed each time, and its
 * good neighbours are never classified.
 *
 * Rules:
 *  - An attempt is a model call that ANSWERED with bad output (CallResult bad_output: billed). A gateway outage, an error status, a
 *    timeout, a cap or a database failure is not an attempt: nothing was learned about the record.
 *  - A failed call with several records gives each of them one attempt, and no record is retried in the same run. In a later run every
 *    record that has an attempt is sent ALONE, so a good neighbour succeeds and only the bad record fails again.
 *  - A record with MAX_ATTEMPTS attempts (the batch failure plus one failure alone) is marked skipped: a holler_signal_ai row with
 *    origin 'skip' and model 'poison' (the same shape the structured-source skips use), so the queue moves past it, it is never sent
 *    again, the app reads it as "no note" and the rule-based text stays. Records with the same normalized text are skipped with it.
 *  - The attempt count lives in an existing table, no migration: holler_ai_cache, one row per record under a key that is a SHA-256 of
 *    "poison-attempts" and the signal id (never equal to a real cache key), with the count in the existing `hits` column and empty
 *    trades and notes. The 120 day cache clean-up removes old ones.
 * When the count cannot be read or written the record is simply not retried in the rest of that run (nothing is re-sent within a run).
 */

export const MAX_ATTEMPTS = 2;
/** Keys per lookup request (same as the result cache: 50 SHA-256 keys keep the request URL short). */
const KEY_CHUNK = 50;
export const POISON_MODEL = 'poison';
const ATTEMPT_MODEL = 'poison-attempts';

export function attemptKey(signalId: number): string {
  return createHash('sha256').update(`poison-attempts:v1:${signalId}`).digest('hex');
}

/** Attempts so far per signal id (ids with none are absent). A read error gives an empty map: nothing is known, nothing blocks. */
export async function readAttempts(db: Db, ids: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const byKey = new Map(ids.map((id) => [attemptKey(id), id]));
  const keys = [...byKey.keys()];
  try {
    for (let i = 0; i < keys.length; i += KEY_CHUNK) {
      const { data, error } = await db.from('holler_ai_cache').select('key,hits').in('key', keys.slice(i, i + KEY_CHUNK));
      if (error) return new Map();
      for (const r of (data ?? []) as { key: string; hits: number | string | null }[]) {
        const id = byKey.get(r.key);
        const n = Number(r.hits);
        if (id !== undefined && Number.isFinite(n) && n > 0) out.set(id, n);
      }
    }
  } catch {
    return new Map();
  }
  return out;
}

/** Store the new attempt count. True when written. */
export async function writeAttempt(db: Db, signalId: number, attempts: number, promptV: number): Promise<boolean> {
  const key = attemptKey(signalId);
  try {
    if (attempts > 1) {
      const { error } = await db.from('holler_ai_cache').update({ hits: attempts }).eq('key', key);
      if (!error) return true;
    }
    const ins = await db.from('holler_ai_cache').insert({ key, trades: {}, notes: {}, model: ATTEMPT_MODEL, prompt_v: promptV, hits: attempts });
    if (!ins.error) return true;
    // another run inserted it first: set the count on the existing row
    const upd = await db.from('holler_ai_cache').update({ hits: attempts }).eq('key', key);
    return !upd.error;
  } catch {
    return false;
  }
}

/**
 * Mark these signals skipped: an empty holler_signal_ai row, origin 'skip', model 'poison' (holler_ai_apply skips a signal that
 * already has a row, so a repeat is harmless). True when the write went through.
 */
export async function writeSkipMarkers(db: Db, signalIds: readonly number[], promptV: number): Promise<boolean> {
  if (signalIds.length === 0) return true;
  try {
    const rows = signalIds.map((id) => ({ signal_id: id, trades: {}, notes: {}, model: POISON_MODEL, prompt_v: promptV, origin: 'skip' }));
    const { error } = await db.rpc('holler_ai_apply', { p_rows: rows });
    return !error;
  } catch {
    return false;
  }
}
