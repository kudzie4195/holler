import { createHmac } from 'node:crypto';

/**
 * Round 20 NEXT review fix (P2-1): a keyed external id for a source whose own id embeds a taxpayer number (Texas Comptroller). A plain hash of
 * an 11-digit number from a public dataset can be reversed in hours (or at once, by hashing the public dataset itself), so the stored id is an
 * HMAC-SHA256 with a server secret, the same secret and pattern as the building reference (branch r20-ship, lib/signals/building-ref.ts):
 * HOLLER_BUILDING_REF_SECRET, else the service role key the scan already holds (never logged, never leaves the server). Without either the
 * source sends no request and stores nothing (socrata.ts adapter; fails closed). INTEGRATION NOTE: share one secret helper with building-ref.ts.
 */
export function idKeySecret(): string | null {
  const s = process.env.HOLLER_BUILDING_REF_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return s ? s : null;
}

/** "k" + 24 hex of HMAC-SHA256(secret, raw). '' for an empty raw id or without a secret. */
export function keyedId(raw: string, secret: string | null = idKeySecret()): string {
  if (!raw || !secret) return '';
  return `k${createHmac('sha256', `holler-source-id|${secret}`).update(raw).digest('hex').slice(0, 24)}`;
}
