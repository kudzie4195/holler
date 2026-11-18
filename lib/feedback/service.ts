import type { SupabaseClient } from '@supabase/supabase-js';
import { isJobValue, isVerdict, type FeedbackState, type Verdict } from './types';

export type SaveFeedbackError = 'signed_out' | 'invalid' | 'no_match' | 'failed';
export type SaveFeedbackResult = { ok: true; state: FeedbackState } | { ok: false; error: SaveFeedbackError };

/**
 * Saves the member's one answer for one alert. `db` must be the member's own (RLS) client: the policies in migration 0009 repeat
 * the ownership and "has a match row" rules, so this check is a second lock, not the only one.
 * One row per member per signal: a second answer replaces the first (upsert on user_id, signal_id).
 */
export async function saveFeedback(
  db: Pick<SupabaseClient, 'from'>,
  userId: string | null | undefined,
  input: { signalId: unknown; verdict: unknown; jobValueUsd?: unknown },
): Promise<SaveFeedbackResult> {
  if (!userId) return { ok: false, error: 'signed_out' };
  const { signalId, verdict } = input;
  if (typeof signalId !== 'number' || !Number.isSafeInteger(signalId) || signalId <= 0) return { ok: false, error: 'invalid' };
  if (!isVerdict(verdict)) return { ok: false, error: 'invalid' };
  const raw = input.jobValueUsd;
  if (raw !== undefined && raw !== null && !isJobValue(raw)) return { ok: false, error: 'invalid' };
  // A dollar amount only belongs to "Led to work". Any other answer clears it.
  const jobValueUsd = verdict === 'led_to_work' && typeof raw === 'number' ? raw : null;

  const { data: found, error: mErr } = await db
    .from('holler_matches')
    .select('id')
    .eq('user_id', userId)
    .eq('signal_id', signalId)
    .limit(1);
  if (mErr) return { ok: false, error: 'failed' };
  if (!Array.isArray(found) || found.length === 0) return { ok: false, error: 'no_match' };

  const { error } = await db
    .from('holler_signal_feedback')
    .upsert({ user_id: userId, signal_id: signalId, verdict, job_value_usd: jobValueUsd }, { onConflict: 'user_id,signal_id' });
  if (error) return { ok: false, error: 'failed' };
  return { ok: true, state: { verdict: verdict as Verdict, jobValueUsd } };
}

/** The member's own answers for these signals, keyed by signal id. Never throws: any failure (including a missing table) is "no answers". */
export async function loadFeedback(
  db: Pick<SupabaseClient, 'from'>,
  userId: string,
  signalIds: number[],
): Promise<Map<number, FeedbackState>> {
  const out = new Map<number, FeedbackState>();
  if (signalIds.length === 0) return out;
  try {
    const res = await db
      .from('holler_signal_feedback')
      .select('signal_id,verdict,job_value_usd')
      .eq('user_id', userId)
      .in('signal_id', signalIds);
    const rows = (res as { data?: unknown })?.data;
    if (!Array.isArray(rows)) return out;
    for (const r of rows as Array<{ signal_id: number; verdict: unknown; job_value_usd: number | null }>) {
      if (typeof r.signal_id === 'number' && isVerdict(r.verdict)) {
        out.set(r.signal_id, { verdict: r.verdict, jobValueUsd: typeof r.job_value_usd === 'number' ? r.job_value_usd : null });
      }
    }
  } catch {
    return new Map();
  }
  return out;
}
