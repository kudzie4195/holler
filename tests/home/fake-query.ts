// In-memory stand-in for the anonymous Supabase client used by the home page loaders: records each filter call and applies it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { evalTerm, splitTop } from '../fixtures/fake-signals-db';
import { colOf } from '../fixtures/json-col';

export type Row = Record<string, unknown>;

const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

export function fakeClient(rows: Row[], opts: { fail?: 'error' | 'throw' } = {}) {
  const calls: string[][] = [];
  const client = {
    from(table: string) {
      if (opts.fail === 'throw') throw new Error('network down');
      const log: string[] = [`from:${table}`];
      calls.push(log);
      const filters: ((r: Row) => boolean)[] = [];
      let limit = Infinity;
      let order: { col: string; asc: boolean } | null = null;
      const q: Record<string, unknown> = {
        select(c: string) { log.push(`select:${c}`); return q; },
        in(c: string, v: unknown[]) { log.push(`in:${c}=${v.join(',')}`); filters.push((r) => v.includes(r[c])); return q; },
        is(c: string, v: null) { log.push(`is:${c}`); filters.push((r) => (colOf(r, c) == null) === (v === null)); return q; },
        neq(c: string, v: unknown) { log.push(`neq:${c}=${v}`); filters.push((r) => r[c] != null && r[c] !== v); return q; },
        gte(c: string, v: unknown) { log.push(`gte:${c}`); filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return q; },
        lte(c: string, v: unknown) { log.push(`lte:${c}`); filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return q; },
        or(s: string) { log.push(`or:${s}`); filters.push((r) => splitTop(s).some((t) => evalTerm(t, r))); return q; },
        order(c: string, o: { ascending: boolean }) { order = { col: c, asc: o.ascending }; return q; },
        limit(n: number) { log.push(`limit:${n}`); limit = n; return q; },
        abortSignal() { return q; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          if (opts.fail === 'error') return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
          let m = rows.filter((r) => filters.every((f) => f(r)));
          if (order) m = [...m].sort((a, b) => (order!.asc ? 1 : -1) * cmp(a[order!.col], b[order!.col]));
          return Promise.resolve({ data: m.slice(0, limit), error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
