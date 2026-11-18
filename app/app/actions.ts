'use server';

import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/auth/session';
import { replyStates, type ReplyState } from '@/lib/requests/service';
import { saveFeedback } from '@/lib/feedback/service';

const STATUSES = ['new', 'saved', 'done', 'dismissed'] as const;
type Status = (typeof STATUSES)[number];

/** Updates one of the signed-in user's matches. RLS also restricts this to the owner. */
export async function setMatchStatus(matchId: number, status: string): Promise<{ ok: boolean }> {
  if (!Number.isInteger(matchId) || !STATUSES.includes(status as Status)) return { ok: false };
  const user = await getUser();
  if (!user) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from('holler_matches')
    .update({ status })
    .eq('id', matchId)
    .eq('user_id', user.id);
  return { ok: !error };
}

/**
 * Reply state of the signed-in member's resident-request matches ('open', 'replied', 'closed', 'full'), keyed by match id.
 * The reply records are service-role only, so this reads them with the admin client after checking the session; only the
 * caller's own matches are looked at. Never throws: on any failure the feed just shows the Reply button and the server decides.
 */
export async function getRequestReplyStates(matchIds: number[]): Promise<Record<number, ReplyState>> {
  if (!Array.isArray(matchIds) || matchIds.length === 0) return {};
  const ids = matchIds.filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 200);
  const user = await getUser();
  if (!user || ids.length === 0) return {};
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    return await replyStates(createAdminClient(), user.id, ids);
  } catch {
    return {};
  }
}

const FEEDBACK_MESSAGES = {
  signed_out: 'Sign in again to answer.',
  invalid: 'That answer did not look right. Try again.',
  no_match: 'That alert is not in your feed.',
  failed: "That didn't save. Try again.",
} as const;

/**
 * Saves the signed-in member's answer on one alert: 'useful', 'not_relevant' or 'led_to_work' (with an optional whole-dollar job
 * value). One answer per member per signal; a new answer replaces the old one. Refuses a signal the member has no match row for.
 * Uses the member's own client, so RLS (migration 0009) enforces the same rules in the database.
 */
export async function submitFeedback(
  signalId: number,
  verdict: string,
  jobValueUsd?: number | null,
): Promise<{ ok: boolean; error?: string; verdict?: string; jobValueUsd?: number | null }> {
  const user = await getUser();
  if (!user) return { ok: false, error: FEEDBACK_MESSAGES.signed_out };
  const supabase = await createClient();
  const res = await saveFeedback(supabase, user.id, { signalId, verdict, jobValueUsd });
  if (!res.ok) return { ok: false, error: FEEDBACK_MESSAGES[res.error] };
  return { ok: true, verdict: res.state.verdict, jobValueUsd: res.state.jobValueUsd };
}
