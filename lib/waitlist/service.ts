import { z } from 'zod';
import { LIMITS, type Limit } from '@/lib/auth/limits';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';
import { WAITLIST_EMAIL_MAX, WAITLIST_HONEYPOT, WAITLIST_PAGES } from './copy';

/**
 * Saves one "Coming to your area" waitlist signup. Pure logic over injected dependencies so tests run without a database.
 * Stored: lower-cased email, ZIP, trade, page. Nothing about the visitor (no IP, no user agent, no account id).
 * Logs: only a short status code, never the email, the ZIP or the trade.
 */
export interface WaitlistDb {
  from(table: 'holler_area_waitlist'): {
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: { code?: string; message?: string } | null }>;
  };
}

export interface WaitlistDeps {
  db: WaitlistDb;
  hit: (limits: Limit[]) => Promise<'allowed' | 'limited' | 'error'>;
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
  // The card only shows for a ZIP Holler does not serve. A served ZIP never needs the waitlist, so a direct post for one is refused
  // rather than filling the list with places that already have alerts.
  if (isServedZip(place)) return { code: 'invalid', field: 'zip' };

  const deps = typeof depsOrFactory === 'function' ? depsOrFactory() : depsOrFactory;
  const address = email.data.toLowerCase();
  const h = await deps.hit([LIMITS.waitlistIp(input.ip), LIMITS.waitlistEmail(address)]);
  if (h === 'limited') return { code: 'limited' };
  if (h === 'error') return { code: 'unavailable' };

  // ON CONFLICT (email, zip) DO NOTHING: a repeat is a success with the same answer, so the reply never says whether an address was
  // already on the list.
  const { error } = await deps.db
    .from('holler_area_waitlist')
    .upsert({ email: address, zip, trade, page }, { onConflict: 'email,zip', ignoreDuplicates: true });
  if (error) {
    // A missing table (migration 0021 not applied yet) or any other failure is a soft error, never a throw. Log the code only.
    console.error('[waitlist] save failed', error.code ?? 'unknown');
    return { code: 'unavailable' };
  }
  return { code: 'ok' };
}
