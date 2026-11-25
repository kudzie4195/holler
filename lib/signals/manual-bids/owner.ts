import 'server-only';
import { env } from '@/lib/env';
import { getProfile, getUser } from '@/lib/auth/session';
import { manualBidsEnabled } from './flag';

/**
 * Who may use the hand-added bid pages and actions (round 33): the owner, and only while HOLLER_MANUAL_BIDS_ENABLED is on.
 *
 * The owner is the signed-in account whose e-mail is ADMIN_EMAIL (the inbox the health and AI-spend mails already go to) AND whose e-mail
 * Holler has verified through its own signed link (holler_profiles.email_verified_at, or the service-role-only app_metadata key the
 * verify route parks before onboarding). The verification matters: Supabase does not confirm e-mails here, so a stranger who signed up
 * with that address first would otherwise pass. ADMIN_EMAIL empty means nobody is the owner. Checked on the server for every page and
 * every action; the pages answer 404 to anyone else so they do not reveal that they exist.
 */
export type OwnerRefusal = 'off' | 'signed_out' | 'not_owner';

export interface OwnerFacts {
  flagOn: boolean;
  adminEmail: string | null | undefined;
  userEmail: string | null | undefined;
  /** Holler's own verification time for this account, or null. */
  verifiedAt: string | null | undefined;
  signedIn: boolean;
}

/** Pure decision, so the rule is tested without a session. */
export function ownerDecision(f: OwnerFacts): 'ok' | OwnerRefusal {
  if (!f.flagOn) return 'off';
  if (!f.signedIn) return 'signed_out';
  const admin = (f.adminEmail ?? '').trim().toLowerCase();
  const mine = (f.userEmail ?? '').trim().toLowerCase();
  if (!admin || !mine || admin !== mine) return 'not_owner';
  if (typeof f.verifiedAt !== 'string' || !f.verifiedAt) return 'not_owner';
  return 'ok';
}

export type OwnerGate = { ok: true; userId: string } | { ok: false; reason: OwnerRefusal };

export async function ownerGate(): Promise<OwnerGate> {
  if (!manualBidsEnabled()) return { ok: false, reason: 'off' };
  const user = await getUser();
  if (!user) return { ok: false, reason: 'signed_out' };
  let verifiedAt: string | null = null;
  try {
    const profile = await getProfile(user.id);
    verifiedAt = profile?.email_verified_at ?? null;
  } catch {
    verifiedAt = null;
  }
  if (!verifiedAt) {
    const parked = (user.app_metadata as { holler_email_verified_at?: unknown } | undefined)?.holler_email_verified_at;
    verifiedAt = typeof parked === 'string' ? parked : null;
  }
  const d = ownerDecision({ flagOn: true, adminEmail: process.env.ADMIN_EMAIL ?? env.ADMIN_EMAIL, userEmail: user.email, verifiedAt, signedIn: true });
  return d === 'ok' ? { ok: true, userId: user.id } : { ok: false, reason: d };
}
