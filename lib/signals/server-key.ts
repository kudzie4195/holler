import { createHmac } from 'node:crypto';

/**
 * Round 21 integration: the ONE server-side keyed hash, shared by the NYC heat building reference (lib/signals/building-ref.ts, r20-ship
 * final review P2-1) and the keyed external id of a source whose own id embeds a taxpayer number (lib/signals/id-key.ts, r20 NEXT review fix
 * P2-1). Both had the same secret rule and the same HMAC pattern; they now read it here.
 *
 * The secret is HOLLER_BUILDING_REF_SECRET, else the service role key the scan already holds. It never leaves the server and is never
 * logged. Without either, callers fail closed (no building ref; the Texas sources send no request).
 */
export function serverKeySecret(): string | null {
  const s = process.env.HOLLER_BUILDING_REF_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return s ? s : null;
}

/**
 * HMAC-SHA256 of `value`, keyed with `<purpose>|<secret>` (the purpose keeps two uses of one secret apart), as the first `hexChars` hex
 * characters. Null without a secret.
 */
export function keyedHex(purpose: string, value: string, hexChars: number, secret: string | null = serverKeySecret()): string | null {
  if (!secret) return null;
  return createHmac('sha256', `${purpose}|${secret}`).update(value).digest('hex').slice(0, hexChars);
}
