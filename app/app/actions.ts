'use server';

import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/auth/session';

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
