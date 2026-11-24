import type { Limit } from '@/lib/auth/limits';
import type { WaitlistDb, WaitlistDeps } from '@/lib/waitlist/service';

type Err = { code?: string; message?: string } | null;

/**
 * In-memory stand-in for holler_zip_waitlist (round 19, double opt-in): records every write, enforces unique (email, zip) with DO NOTHING,
 * reads a row back by (email, zip), and records the confirmation emails it would send. `existing` stamps a row as already confirmed or
 * unsubscribed; `missingTable` answers the upsert with the real Postgres missing-table error; `sendOk: false` makes the provider refuse.
 */
// Round 24 FIX2 (review D8): `uniqueTrade` stands for migration 0039 (unique (email, zip, trade)); without it the fake is the live table
// before 0039: an ON CONFLICT on (email, zip, trade) is refused with 42P10 and the service retries on (email, zip). Only a write that
// succeeds is recorded in `writes`.
export function fakeWaitlist(opts: { missingTable?: boolean; missingCode?: string; sendOk?: boolean; uniqueTrade?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const writes: { row: Record<string, unknown>; opts: unknown }[] = [];
  const hits: Limit[][] = [];
  const sent: { to: string; confirmUrl: string; place: string; trade?: string | null }[] = [];
  const already: { to: string; place: string; storedTrade: string | null; newTrade: string; confirmUrl: string | null }[] = [];
  const stamps = new Map<string, { confirmed_at: string | null; unsubscribed_at: string | null }>();
  let hitResult: 'allowed' | 'limited' | 'error' = 'allowed';
  const missing: Err = { code: opts.missingCode ?? '42P01', message: 'relation "public.holler_zip_waitlist" does not exist' };
  const same = (r: Record<string, unknown>, email: unknown, zip: unknown, trade?: unknown) => r.email === email && r.zip === zip && (trade === undefined || (r.trade ?? null) === trade);
  const idOf = (row: Record<string, unknown>) => `00000000-0000-4000-8000-${String(rows.indexOf(row) + 1).padStart(12, '0')}`;
  const db: WaitlistDb = {
    upsert: async (row, onConflict = 'email,zip') => {
      if (opts.missingTable) return { error: missing };
      if (onConflict === 'email,zip,trade' && !opts.uniqueTrade) {
        return { error: { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } };
      }
      writes.push({ row: { ...row }, opts: { onConflict: opts.uniqueTrade ? onConflict : 'email,zip', ignoreDuplicates: true } });
      if (!rows.some((r) => same(r, row.email, row.zip, opts.uniqueTrade ? row.trade : undefined))) rows.push({ ...row });
      return { error: null };
    },
    find: async (email, zip, trade) => {
      const row = rows.find((r) => same(r, email, zip, trade));
      if (!row) return { data: null, error: null };
      const st = stamps.get(`${email}|${zip}`) ?? { confirmed_at: null, unsubscribed_at: null };
      return { data: { id: idOf(row), ...st, trade: (row.trade as string | null) ?? null }, error: null };
    },
  };
  const deps: WaitlistDeps = {
    db,
    hit: async (limits) => {
      hits.push(limits);
      return hitResult;
    },
    signToken: (id) => `signed.${id}`,
    sendConfirm: async (m) => {
      sent.push(m);
      return opts.sendOk !== false;
    },
    sendAlready: async (m) => {
      already.push(m);
      return opts.sendOk !== false;
    },
    siteUrl: 'https://localholler.com/',
  };
  return {
    deps,
    rows,
    writes,
    hits,
    sent,
    already,
    setHit: (r: 'allowed' | 'limited' | 'error') => (hitResult = r),
    stamp: (email: string, zip: string, st: { confirmed_at?: string | null; unsubscribed_at?: string | null }) =>
      stamps.set(`${email}|${zip}`, { confirmed_at: st.confirmed_at ?? null, unsubscribed_at: st.unsubscribed_at ?? null }),
  };
}

/** ZIPs the tests rely on (checked in coverage.test.ts): 59001 Absarokee MT has no local source; 60614 Chicago IL does. */
export const UNSERVED_ZIP = '59001';
export const SERVED_ZIP = '60614';
