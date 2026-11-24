import { z } from 'zod';
import { LIMITS, type Limit } from '@/lib/auth/limits';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';
import { limiterMailbox } from '@/lib/requests/tokens';
import { WAITLIST_EMAIL_MAX, WAITLIST_HONEYPOT, WAITLIST_PAGES } from './copy';
import { waitlistAccepts } from './trades';

/**
 * Saves one "Coming to your area" waitlist signup, double opt-in. Pure logic over injected dependencies so tests run without a database
 * or an email provider.
 *
 * Round 19 (review defect 1): sign-ups go to holler_zip_waitlist (migration 0031, already live), the table the live site collected
 * into, and every new row gets ONE confirmation email. Only confirmed rows are ever mailed again. This base keeps its own card, honeypot,
 * trade check and served-ZIP refusal in front of that. Stored: lower-cased email, ZIP, the ZIP's state and centroid rounded to 3
 * decimals (never an address), trade, consent wording version. Nothing about the visitor (no IP, no user agent, no account id).
 * The answer never says whether the address was already on the list: a repeat for a confirmed or unsubscribed row is "ok" and sends nothing.
 * Logs: only a short status code, never the email, the ZIP or the trade.
 */
export const WAITLIST_TABLE = 'holler_zip_waitlist';
/** The consent wording version the live site stored (same value, so both sets of rows read alike). */
export const WAITLIST_CONSENT_VERSION = 'v1-2026-11';
export const WAITLIST_CONFIRM_TTL_SECONDS = 7 * 24 * 60 * 60;

type DbError = { code?: string; message?: string } | null;

export interface WaitlistRow {
  email: string;
  zip: string;
  state: string | null;
  lat: number | null;
  lon: number | null;
  trade: string | null;
  consent_version: string;
}

export interface WaitlistDb {
  /**
   * INSERT ... ON CONFLICT (<onConflict>) DO NOTHING: a repeat keeps the first row and its confirmed_at. Round 24 FIX2 (review D8): the
   * service asks for 'email,zip,trade' (migration 0039) and falls back to 'email,zip' while 0039 is not applied (42P10: no unique index
   * matches). Defaults to 'email,zip'.
   */
  upsert(row: WaitlistRow, onConflict?: WaitlistConflict): PromiseLike<{ error: DbError }>;
  /** The row for (email, zip, trade), or with `trade` undefined the one row for (email, zip) (before 0039 there is only one). */
  find(email: string, zip: string, trade?: string | null): PromiseLike<{ data: WaitlistFound | null; error: DbError }>;
}

export type WaitlistConflict = 'email,zip' | 'email,zip,trade';
export interface WaitlistFound {
  id: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  trade?: string | null;
}

/** Postgres 42P10 (ON CONFLICT names no unique index): migration 0039 is not applied yet. */
export function noTradeUniqueIndex(e: DbError): boolean {
  if (!e) return false;
  return e.code === '42P10' || /no unique or exclusion constraint/i.test(e.message ?? '');
}

export interface WaitlistDeps {
  db: WaitlistDb;
  hit: (limits: Limit[]) => Promise<'allowed' | 'limited' | 'error'>;
  /** Signs a row id into a confirm token (purpose 'waitlist', 7 days). */
  signToken: (id: string) => string;
  /**
   * True when the email was handed to the provider. `trade` (round 24) is set only when the ZIP is one Holler already serves, so the
   * sign-up is for that one trade there: the email then names the trade instead of "when Holler reaches {place}".
   */
  sendConfirm: (msg: { to: string; confirmUrl: string; place: string; trade?: string | null; lang?: 'es' }) => Promise<boolean>;
  /**
   * Round 24 FIX2 (review D8): before migration 0039 the list keeps one row per (email, ZIP). A sign-up for another trade there is not
   * stored, so instead of a confirmation that names the new trade this email says the person is already on the list for that ZIP (and
   * for which trade), with the confirm link of the stored row when it is not confirmed yet.
   */
  sendAlready?: (msg: { to: string; place: string; storedTrade: string | null; newTrade: string; confirmUrl: string | null; lang?: 'es' }) => Promise<boolean>;
  siteUrl: string;
}

export type WaitlistCode = 'ok' | 'invalid' | 'limited' | 'unavailable';
export type WaitlistField = 'email' | 'zip' | 'trade';

export interface WaitlistResult {
  code: WaitlistCode;
  /** The first field that failed, when code is invalid. */
  field?: WaitlistField;
}

export interface WaitlistInput {
  email: unknown;
  zip: unknown;
  trade: unknown;
  page: unknown;
  /** The hidden honeypot field. Any text in it means a bot. */
  [WAITLIST_HONEYPOT]?: unknown;
  /**
   * Round 24 INT2: the page language. Only 'es' changes anything: the confirmation email is Spanish and its link opens the Spanish
   * confirm page. Anything else (and no value, which is what the English card sends) is English, exactly as before. Not stored.
   */
  lang?: unknown;
  /** Used only in memory by the rate limiter (stored as a keyed hash in the counter). Never stored with the signup. */
  ip: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const emailSchema = z.string().trim().min(1).max(WAITLIST_EMAIL_MAX).pipe(z.email());
const TRADE_IDS: ReadonlySet<string> = new Set(CATEGORIES.map((c) => c.id));

function cleanPage(v: unknown): (typeof WAITLIST_PAGES)[number] | null {
  const s = str(v).trim();
  return (WAITLIST_PAGES as readonly string[]).includes(s) ? (s as (typeof WAITLIST_PAGES)[number]) : null;
}

/**
 * `depsOrFactory` may be a factory so the database client is built only after the input is valid: a bad email is answered as invalid
 * even when the database is not configured. A factory that throws makes the call throw; the route turns that into a 503.
 */
export async function joinWaitlist(depsOrFactory: WaitlistDeps | (() => WaitlistDeps), input: WaitlistInput): Promise<WaitlistResult> {
  // A bot filled the hidden field: answer as if it worked and store nothing, so it learns nothing.
  if (str(input[WAITLIST_HONEYPOT]).trim() !== '') return { code: 'ok' };

  const email = emailSchema.safeParse(input.email);
  if (!email.success) return { code: 'invalid', field: 'email' };
  const zip = str(input.zip).trim();
  const place = /^\d{5}$/.test(zip) ? lookupZip(zip) : null;
  if (!place) return { code: 'invalid', field: 'zip' };
  const trade = str(input.trade).trim();
  if (!TRADE_IDS.has(trade)) return { code: 'invalid', field: 'trade' };
  const page = cleanPage(input.page);
  if (!page) return { code: 'invalid' };
  // The card only shows where this ZIP and this TRADE have nothing an owner could act on (lib/check/cells.ts coverageFor). A cell that
  // is live or limited never needs the waitlist, so a direct post for one is refused rather than filling the list with places that
  // already have alerts. Round 24 (review P2-3): the test is the same list the card offers (lib/waitlist/trades.ts), and a refusal
  // names the trade field, so the card can say what is wrong. The confirmation email names the trade only where the ZIP is served
  // (round 24 mail): in an unserved town the whole place is waiting, not one trade.
  const served = isServedZip(place);
  if (!waitlistAccepts(place, served, trade)) return { code: 'invalid', field: 'trade' };

  const deps = typeof depsOrFactory === 'function' ? depsOrFactory() : depsOrFactory;
  const address = email.data.toLowerCase();
  const h = await deps.hit([LIMITS.waitlistIp(input.ip), LIMITS.waitlistEmail(limiterMailbox(address))]);
  if (h === 'limited') return { code: 'limited' };
  if (h === 'error') return { code: 'unavailable' };

  const row: WaitlistRow = {
    email: address,
    zip,
    state: /^[A-Z]{2}$/.test(place.state) ? place.state : null,
    lat: round3(place.lat),
    lon: round3(place.lon),
    trade,
    consent_version: WAITLIST_CONSENT_VERSION,
  };
  // One row per (email, ZIP, trade) once migration 0039 is applied; before it the unique index is (email, ZIP) and the first trade stays.
  let legacy = false;
  let up = await deps.db.upsert(row, 'email,zip,trade');
  if (up.error && noTradeUniqueIndex(up.error)) {
    legacy = true;
    up = await deps.db.upsert(row, 'email,zip');
  }
  if (up.error) {
    // A missing table (migration 0031 not applied) or any other failure is a soft error, never a throw. Log the code only.
    console.error('[waitlist] save failed', up.error.code ?? 'unknown');
    return { code: 'unavailable' };
  }
  const found = await deps.db.find(address, zip, legacy ? undefined : trade);
  if (found.error || !found.data) {
    console.error('[waitlist] read back failed', found.error?.code ?? 'no_row');
    return { code: 'unavailable' };
  }
  const es = input.lang === 'es';
  const confirmUrlOf = (id: string) => `${deps.siteUrl.replace(/\/$/, '')}/waitlist/confirm?token=${encodeURIComponent(deps.signToken(id))}${es ? '&lang=es' : ''}`;
  // Before 0039: the row kept is for another trade. Never send a confirmation naming a trade that was not stored; say what is stored.
  const storedTrade = typeof found.data.trade === 'string' ? found.data.trade : null;
  if (legacy && 'trade' in found.data && storedTrade !== trade) {
    if (found.data.unsubscribed_at || !deps.sendAlready) return { code: 'ok' };
    const sentAlready = await deps.sendAlready({
      to: address,
      place: `${place.city}, ${place.state}`,
      storedTrade,
      newTrade: trade,
      confirmUrl: found.data.confirmed_at ? null : confirmUrlOf(found.data.id),
      ...(es ? { lang: 'es' as const } : {}),
    });
    if (!sentAlready) console.error('[waitlist] already email not sent');
    return sentAlready ? { code: 'ok' } : { code: 'unavailable' };
  }
  // Already confirmed, or unsubscribed: the same answer as a new sign-up, and nothing is sent.
  if (found.data.confirmed_at || found.data.unsubscribed_at) return { code: 'ok' };

  const confirmUrl = confirmUrlOf(found.data.id);
  const sent = await deps.sendConfirm({ to: address, confirmUrl, place: `${place.city}, ${place.state}`, trade: served ? trade : null, ...(es ? { lang: 'es' as const } : {}) });
  if (!sent) {
    console.error('[waitlist] confirm email not sent');
    return { code: 'unavailable' };
  }
  return { code: 'ok' };
}

/** Three decimals is about one block: the ZIP centroid, never an address. */
function round3(n: number): number | null {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}
