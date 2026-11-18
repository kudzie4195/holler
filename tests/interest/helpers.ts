import type { Limit } from '@/lib/auth/limits';
import type { InterestDb, InterestDeps } from '@/lib/interest/service';

type Err = { code?: string; message?: string } | null;

/** In-memory stand-in for holler_feature_interest: records every write exactly as sent, enforces the (feature, user_id) unique index. */
export function fakeInterest(opts: { missingTable?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const writes: { op: 'insert' | 'upsert'; row: Record<string, unknown>; opts?: unknown }[] = [];
  const hits: Limit[][] = [];
  let hitResult: 'allowed' | 'limited' | 'error' = 'allowed';
  const missing: Err = { code: '42P01', message: 'relation "public.holler_feature_interest" does not exist' };
  const dup = (row: Record<string, unknown>) =>
    row.user_id != null && rows.some((r) => r.feature === row.feature && r.user_id === row.user_id);
  const db: InterestDb = {
    from: () => ({
      insert: async (row) => {
        writes.push({ op: 'insert', row });
        if (opts.missingTable) return { error: missing };
        if (dup(row)) return { error: { code: '23505', message: 'duplicate key' } };
        rows.push({ ...row });
        return { error: null };
      },
      upsert: async (row, o) => {
        writes.push({ op: 'upsert', row, opts: o });
        if (opts.missingTable) return { error: missing };
        if (!dup(row)) rows.push({ ...row });
        return { error: null };
      },
    }),
  };
  const deps: InterestDeps = {
    db,
    hit: async (limits) => {
      hits.push(limits);
      return hitResult;
    },
  };
  return { deps, rows, writes, hits, setHit: (r: 'allowed' | 'limited' | 'error') => (hitResult = r) };
}
