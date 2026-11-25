import 'server-only';
import { getUser } from '@/lib/auth/session';
import { manualBidsEnabled } from './flag';
import { OWNER_USER_ID_ENV, ownerDecision, type OwnerRefusal } from './owner-id';

/**
 * Server-side owner gate for the hand-added bid pages and actions (round 33). The rule is in owner-id.ts: the switch
 * HOLLER_MANUAL_BIDS_ENABLED is on, and the signed-in user's id (asked of the Auth server by getUser, not read from the cookie) equals
 * HOLLER_OWNER_USER_ID. Every page and every action calls this; the proxy applies the same rule first so a refused page request is a real
 * 404 (lib/supabase/proxy.ts).
 */
export { ownerDecision, type OwnerRefusal } from './owner-id';

export type OwnerGate = { ok: true; userId: string } | { ok: false; reason: OwnerRefusal };

export async function ownerGate(): Promise<OwnerGate> {
  if (!manualBidsEnabled()) return { ok: false, reason: 'off' };
  const user = await getUser();
  if (!user) return { ok: false, reason: 'signed_out' };
  const d = ownerDecision({ flagOn: true, ownerId: process.env[OWNER_USER_ID_ENV], userId: user.id });
  return d === 'ok' ? { ok: true, userId: user.id } : { ok: false, reason: d };
}
