/* eslint-disable @typescript-eslint/no-explicit-any */
// Small in-memory stand-in for the Supabase client: enough of the query builder for lib/moat.
type Row = Record<string, any>;

// maxRows: like PostgREST's max_rows, no single answer holds more rows than this (round 7 fix-g2, verify-v3 P2).
export function makeDb(tables: Record<string, Row[]>, opts: { users?: Record<string, string | null>; unique?: Record<string, string[]>; maxRows?: number } = {}) {
  const writes: Array<{ table: string; op: string; payload: any }> = [];
  const unique = { holler_outcome_asks: ['user_id', 'signal_id'], holler_alert_log: ['user_id', 'signal_id'], ...(opts.unique ?? {}) } as Record<string, string[]>;
  const db: any = {
    tables,
    writes,
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: opts.users?.[id] ? { email: opts.users[id] } : null }, error: null }) } },
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Array<(r: Row) => boolean> = [];
      let mode: 'select' | 'update' | 'upsert' = 'select';
      let patch: Row = {};
      const inserted: Row[] = [];
      let lim = Infinity;
      let offset = 0;
      const orders: Array<{ col: string; asc: boolean }> = [];
      const run = () => {
        if (mode === 'update') {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          hit.forEach((r) => Object.assign(r, patch));
          return hit;
        }
        if (mode === 'upsert') return inserted;
        let out = rows.filter((r) => filters.every((f) => f(r)));
        if (orders.length)
          out = [...out].sort((a, b) => {
            for (const o of orders) {
              const d = (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1);
              if (d) return d;
            }
            return 0;
          });
        return out.slice(offset, offset + Math.min(lim, opts.maxRows ?? Infinity));
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), q),
        is: (c: string, v: any) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
        lte: (c: string, v: any) => (filters.push((r) => r[c] <= v), q),
        gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), q),
        order: (c: string, o: { ascending: boolean }) => (orders.push({ col: c, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((lim = n), q),
        range: (from: number, to: number) => ((offset = from), (lim = to - from + 1), q),
        update: (p: Row) => {
          mode = 'update';
          patch = p;
          writes.push({ table, op: 'update', payload: p });
          return q;
        },
        upsert: (p: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
          mode = 'upsert';
          const list = Array.isArray(p) ? p : [p];
          writes.push({ table, op: 'upsert', payload: list });
          const keys = o.onConflict ? o.onConflict.split(',') : (unique[table] ?? []);
          for (const row of list) {
            const dup = keys.length > 0 && rows.some((r) => keys.every((k) => r[k] === row[k]));
            if (dup) continue;
            rows.push({ ...row });
            inserted.push({ ...row });
          }
          return q;
        },
        then: (res: (v: any) => any, rej?: (e: any) => any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return q;
    },
  };
  return db;
}
