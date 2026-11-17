import type { SupabaseClient } from '@supabase/supabase-js';
import { REQUEST_SOURCE } from './constants';

/**
 * The filtered description of a resident request is never public (the holler_signals row has summary null). It lives in
 * holler_requests.public_summary, which only the service role can read, and these two helpers are the only readers:
 *  - requestTextForMember: the signed-in feed. Only for match ids that belong to this member (checked with user_id) and only while
 *    the request is open.
 *  - requestTextByPublicId: the alert email, for the request matches of the member being emailed. Only open requests.
 * Neither ever reads or returns the resident's email address.
 */

type Db = SupabaseClient;

interface RequestText {
  public_id: string;
  status: string;
  expires_at: string | null;
  public_summary: string | null;
}

function live(r: RequestText, nowMs: number): boolean {
  if (r.status !== 'open' || !r.expires_at) return false;
  const exp = Date.parse(r.expires_at);
  return Number.isFinite(exp) && exp > nowMs;
}

/** public id -> filtered text, for open requests only. Unknown, ended or empty ones are left out. Never throws. */
export async function requestTextByPublicId(db: Db, publicIds: string[], now: Date = new Date()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(publicIds.filter((x) => typeof x === 'string' && /^req_[0-9a-f]{20}$/.test(x)))].slice(0, 500);
  if (ids.length === 0) return out;
  try {
    const { data, error } = await db
      .from('holler_requests')
      .select('public_id, status, expires_at, public_summary')
      .in('public_id', ids);
    if (error || !Array.isArray(data)) return out;
    for (const r of data as RequestText[]) {
      if (r && typeof r.public_id === 'string' && r.public_summary && live(r, now.getTime())) out.set(r.public_id, r.public_summary);
    }
  } catch {
    // No text is a safe answer: the card and the email still show the title.
  }
  return out;
}

/** match id -> filtered text, for this member's own request matches that are still open. Never throws. */
export async function requestTextForMember(
  db: Db,
  userId: string,
  matchIds: number[],
  now: Date = new Date(),
): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const ids = [...new Set(matchIds.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 200);
  if (!userId || ids.length === 0) return out;
  try {
    const { data: matches, error: mErr } = await db
      .from('holler_matches')
      .select('id, signal_id')
      .eq('user_id', userId)
      .in('id', ids);
    if (mErr || !Array.isArray(matches) || matches.length === 0) return out;
    const m = matches as { id: number; signal_id: number }[];
    const { data: signals, error: sErr } = await db
      .from('holler_signals')
      .select('id, external_id')
      .eq('source', REQUEST_SOURCE)
      .in('id', [...new Set(m.map((x) => x.signal_id))]);
    if (sErr || !Array.isArray(signals) || signals.length === 0) return out;
    const bySignal = new Map((signals as { id: number; external_id: string }[]).map((s) => [s.id, s.external_id]));
    const text = await requestTextByPublicId(db, [...bySignal.values()], now);
    for (const match of m) {
      const pub = bySignal.get(match.signal_id);
      const t = pub ? text.get(pub) : undefined;
      if (t) out[match.id] = t;
    }
  } catch {
    // As above: no text.
  }
  return out;
}
