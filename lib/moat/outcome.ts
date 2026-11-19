import type { SupabaseClient } from '@supabase/supabase-js';

type Db = Pick<SupabaseClient, 'from'>;
type RpcDb = Pick<SupabaseClient, 'rpc'>;

export const ASK_AFTER_DAYS = 7;
/** An alert marked Useful longer ago than this is not asked about (stops a backlog from becoming a flood). */
export const ASK_WINDOW_DAYS = 37;
export const EMAIL_MAX_ALERTS = 5;
export const EMAIL_GAP_DAYS = 7;

export const OUTCOME_ANSWERS = ['yes', 'no', 'not_yet'] as const;
export type FeedAnswer = (typeof OUTCOME_ANSWERS)[number];
export function isFeedAnswer(v: unknown): v is FeedAnswer {
  return typeof v === 'string' && (OUTCOME_ANSWERS as readonly string[]).includes(v);
}

export type RecordResult = 'recorded' | 'already' | 'none' | 'invalid' | 'failed';

/** Records the answer once (and sets led_to_work for "yes") in one database transaction. Never throws. */
export async function recordOutcome(db: RpcDb, userId: string, signalId: number, answer: string): Promise<RecordResult> {
  if (!userId || !Number.isSafeInteger(signalId) || signalId <= 0 || !isFeedAnswer(answer)) return 'invalid';
  try {
    const { data, error } = await db.rpc('holler_record_outcome', { p_user: userId, p_signal: signalId, p_answer: answer });
    if (error) return 'failed';
    return data === 'recorded' || data === 'already' || data === 'none' || data === 'invalid' ? data : 'failed';
  } catch {
    return 'failed';
  }
}

/** Is there an unanswered ask for this member and alert? Pass the member's own client (RLS: own rows). Never throws. */
export async function hasPendingAsk(db: Db, userId: string, signalId: number): Promise<boolean> {
  try {
    const { data, error } = await db
      .from('holler_outcome_asks')
      .select('id')
      .eq('user_id', userId)
      .eq('signal_id', signalId)
      .is('answer', null)
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
