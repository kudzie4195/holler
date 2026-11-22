import type { Limit } from '@/lib/auth/limits';
import type { WaitlistDb, WaitlistDeps } from '@/lib/waitlist/service';

type Err = { code?: string; message?: string } | null;

/** In-memory stand-in for holler_area_waitlist: records every write as sent and enforces unique (email, zip) with DO NOTHING. */
export function fakeWaitlist(opts: { missingTable?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const writes: { row: Record<string, unknown>; opts: unknown }[] = [];
  const hits: Limit[][] = [];
  let hitResult: 'allowed' | 'limited' | 'error' = 'allowed';
  const missing: Err = { code: '42P01', message: 'relation "public.holler_area_waitlist" does not exist' };
  const db: WaitlistDb = {
    from: () => ({
      upsert: async (row, o) => {
        writes.push({ row, opts: o });
        if (opts.missingTable) return { error: missing };
        if (!rows.some((r) => r.email === row.email && r.zip === row.zip)) rows.push({ ...row });
        return { error: null };
      },
    }),
  };
  const deps: WaitlistDeps = {
    db,
    hit: async (limits) => {
      hits.push(limits);
      return hitResult;
    },
  };
  return { deps, rows, writes, hits, setHit: (r: 'allowed' | 'limited' | 'error') => (hitResult = r) };
}

/** ZIPs the tests rely on (checked in coverage.test.ts): 59001 Absarokee MT has no local source; 60614 Chicago IL does. */
export const UNSERVED_ZIP = '59001';
export const SERVED_ZIP = '60614';
