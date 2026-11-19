import type { Limit } from '@/lib/auth/limits';
import { LIMITS } from '@/lib/auth/limits';
import { limiterMailbox } from '@/lib/requests/tokens';

/**
 * "Coming to your area" waitlist. Pure logic over injected dependencies so tests run without a database or an email provider.
 *
 * join: validates, rate limits, stores one row per (email, ZIP) and sends one confirmation email. The answer never says whether the
 * address was already on the list (no enumeration): a repeat for a confirmed row is "ok" and sends nothing.
 * confirm: a signed, expiring token from that email stamps confirmed_at. Only confirmed rows are ever mailed again.
 */

export const WAITLIST_CONSENT_VERSION = 'v1-2026-11';
export const WAITLIST_CONFIRM_PURPOSE = 'waitlist';
export const WAITLIST_CONFIRM_TTL_SECONDS = 7 * 24 * 60 * 60;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/;
const ZIP_RE = /^[0-9]{5}$/;
const TRADE_RE = /^[a-z0-9-]{1,40}$/;
const STATE_RE = /^[A-Z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type DbError = { code?: string; message?: string } | null;

export interface WaitlistDb {
  upsert(row: WaitlistRow): PromiseLike<{ error: DbError }>;
  find(email: string, zip: string): PromiseLike<{ data: { id: string; confirmed_at: string | null; unsubscribed_at: string | null } | null; error: DbError }>;
  confirm(id: string, at: string): PromiseLike<{ data: { id: string } | null; error: DbError }>;
}

export interface WaitlistRow {
  email: string;
  zip: string;
  state: string | null;
  lat: number | null;
  lon: number | null;
  trade: string | null;
  consent_version: string;
}

export interface WaitlistDeps {
  db: WaitlistDb;
  hit: (limits: Limit[]) => Promise<'allowed' | 'limited' | 'error'>;
  /** Looks up a ZIP: its state and centroid, or null when the ZIP is not a real one. */
  lookupZip: (zip: string) => { state: string; lat: number; lon: number; city: string } | null;
  signToken: (id: string) => string;
  verifyToken: (token: string) => string | null;
  /** True when the email was handed to the provider. */
  sendConfirm: (msg: { to: string; confirmUrl: string; place: string }) => Promise<boolean>;
  siteUrl: string;
  now: () => Date;
}

export type JoinCode = 'ok' | 'invalid_email' | 'invalid_zip' | 'limited' | 'unavailable';

export interface JoinInput {
  email: unknown;
  zip: unknown;
  trade: unknown;
  /** Used only in memory by the rate limiter. Never stored. */
  ip: string;
}

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (e.length < 3 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

export function cleanZip(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const z = v.trim();
  return ZIP_RE.test(z) ? z : null;
}

export function cleanTrade(v: unknown): string | null {
  return typeof v === 'string' && TRADE_RE.test(v) ? v : null;
}

/** Three decimals is about one block: the ZIP centroid, never an address. */
function round3(n: number): number | null {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

export async function joinWaitlist(deps: WaitlistDeps, input: JoinInput): Promise<{ code: JoinCode }> {
  const email = cleanEmail(input.email);
  if (!email) return { code: 'invalid_email' };
  const zip = cleanZip(input.zip);
  if (!zip) return { code: 'invalid_zip' };
  const place = deps.lookupZip(zip);
  if (!place) return { code: 'invalid_zip' };

  const h = await deps.hit([LIMITS.waitlistIp(input.ip), LIMITS.waitlistEmail(limiterMailbox(email))]);
  if (h === 'limited') return { code: 'limited' };
  if (h === 'error') return { code: 'unavailable' };

  const up = await deps.db.upsert({
    email,
    zip,
    state: STATE_RE.test(place.state) ? place.state : null,
    lat: round3(place.lat),
    lon: round3(place.lon),
    trade: cleanTrade(input.trade),
    consent_version: WAITLIST_CONSENT_VERSION,
  });
  // A missing table (migration 0021 not applied yet) or any other failure is a soft error, never a throw.
  if (up.error) return { code: 'unavailable' };

  const found = await deps.db.find(email, zip);
  if (found.error || !found.data) return { code: 'unavailable' };
  // Already confirmed, or unsubscribed: answer the same as a new sign-up and send nothing.
  if (found.data.confirmed_at || found.data.unsubscribed_at) return { code: 'ok' };

  const confirmUrl = `${deps.siteUrl.replace(/\/$/, '')}/waitlist/confirm?token=${encodeURIComponent(deps.signToken(found.data.id))}`;
  const sent = await deps.sendConfirm({ to: email, confirmUrl, place: `${place.city}, ${place.state}` });
  return { code: sent ? 'ok' : 'unavailable' };
}

export type ConfirmCode = 'confirmed' | 'invalid' | 'unavailable';

export async function confirmWaitlist(deps: Pick<WaitlistDeps, 'db' | 'verifyToken' | 'now'>, token: unknown): Promise<{ code: ConfirmCode }> {
  if (typeof token !== 'string' || token.length > 400) return { code: 'invalid' };
  const id = deps.verifyToken(token);
  if (!id || !UUID_RE.test(id)) return { code: 'invalid' };
  const res = await deps.db.confirm(id, deps.now().toISOString());
  if (res.error) return { code: 'unavailable' };
  // No row: deleted since the email was sent. Same answer as a bad link.
  return { code: res.data ? 'confirmed' : 'invalid' };
}
