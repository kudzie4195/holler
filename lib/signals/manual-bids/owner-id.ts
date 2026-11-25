import { manualBidsEnabled } from './flag';

/**
 * Who the owner is, for the hand-added bid pages (round 33 review P1-1). Pure and dependency-free, so the proxy (lib/supabase/proxy.ts),
 * the pages and the server actions all use the same rule.
 *
 * The owner is ONE Supabase account, named by its user id (a UUID) in HOLLER_OWNER_USER_ID. Not an e-mail address: an address can be
 * registered by a stranger first or reached through a shared inbox, an id cannot. ADMIN_EMAIL is not read here at all (it only routes
 * the operational mails). Empty or not a UUID means nobody is the owner.
 */
export const OWNER_USER_ID_ENV = 'HOLLER_OWNER_USER_ID';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The configured owner id, lower-cased, or null when it is empty or not a UUID. */
export function configuredOwnerId(value: string | undefined = process.env[OWNER_USER_ID_ENV]): string | null {
  const v = (value ?? '').trim().toLowerCase();
  return UUID_RE.test(v) ? v : null;
}

export type OwnerRefusal = 'off' | 'signed_out' | 'not_owner';

/** Pure decision: switch on, signed in, and the signed-in user id is exactly the configured owner id. */
export function ownerDecision(f: { flagOn: boolean; ownerId: string | null | undefined; userId: string | null | undefined }): 'ok' | OwnerRefusal {
  if (!f.flagOn) return 'off';
  const mine = (f.userId ?? '').trim().toLowerCase();
  if (!mine) return 'signed_out';
  const owner = configuredOwnerId(f.ownerId ?? '');
  if (!owner || owner !== mine) return 'not_owner';
  return 'ok';
}

/** For the proxy: may this signed-in subject (JWT `sub`, or null when signed out) open /app/owner? Reads the switch and the id now. */
export function ownerPathAllowed(sub: string | null | undefined): boolean {
  return ownerDecision({ flagOn: manualBidsEnabled(), ownerId: process.env[OWNER_USER_ID_ENV], userId: sub }) === 'ok';
}

/** The owner pages: refused requests get a real 404 from the proxy before any page shell is sent. */
export const OWNER_PATH = '/app/owner';
