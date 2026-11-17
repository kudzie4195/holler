/**
 * Test double for the two ways Holler reads holler_signals through PostgREST: the holler_signals_near RPC and plain filtered selects.
 * It honours the SEMANTICS of the SQL function in supabase/migrations/0003_holler_ops.sql (the migration itself is tested against a real
 * Postgres in /home/claude/gates/pg/migtest.mjs):
 *   - only rows with coordinates, category overlap, unexpired (expires_at null or in the future), occurred_at in [since, until],
 *     great-circle distance <= radius (radius clamped to 0.1..150 miles), newest first (or soonest first), limit clamped to 1..500 and
 *     applied AFTER the distance test, adds distance_mi;
 *   - PostgREST's own max-rows cap (1000) on every response.
 * Plain selects apply is/eq/gte/lte/gt/lt/overlaps/or()/order/limit the way PostgREST does, so a missing filter fails a test.
 * Every request is recorded in `log`. Provenance: written for this repo (assumed behaviour of PostgREST, checked against the function).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { haversineMi } from '@/lib/geo';

export type Row = Record<string, any>;
export interface FakeLog {
  kind: 'rpc' | 'select';
  name: string;
  args?: Record<string, any>;
  /** rows that passed the filters before the limit */
  matched: number;
  returned: number;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function evalTerm(term: string, r: Row): boolean {
  if (term.startsWith('and(')) return splitTop(term.slice(4, -1)).every((t) => evalTerm(t, r));
  if (term.startsWith('or(')) return splitTop(term.slice(3, -1)).some((t) => evalTerm(t, r));
  const m = /^([a-z_]+)\.([a-z]+)\.(.*)$/.exec(term);
  if (!m) throw new Error(`fake PostgREST cannot parse "${term}"`);
  const [, col, op, val] = m;
  const v = r[col];
  const cmp = (a: any, b: string) => (typeof a === 'number' ? a - Number(b) : String(a) < b ? -1 : String(a) > b ? 1 : 0);
  switch (op) {
    case 'is': return val === 'null' ? v == null : v != null;
    case 'eq': return String(v) === val;
    case 'gt': return v != null && cmp(v, val) > 0;
    case 'gte': return v != null && cmp(v, val) >= 0;
    case 'lt': return v != null && cmp(v, val) < 0;
    case 'lte': return v != null && cmp(v, val) <= 0;
    default: throw new Error(`fake PostgREST: unsupported operator ${op}`);
  }
}

const withSubtype = (r: Row): Row => ({ ...r, subtype: r.data?.subtype ?? r.subtype ?? null });

export function fakeSignalsDb(signals: Row[], opts: { now?: Date; maxRows?: number; rpcError?: string } = {}) {
  const now = opts.now ?? new Date();
  const maxRows = opts.maxRows ?? 1000;
  const log: FakeLog[] = [];
  const upserts: Row[][] = [];

  const finish = (rows: Row[], limit: number | null, entry: Omit<FakeLog, 'matched' | 'returned'>) => {
    const out = rows.slice(0, Math.min(limit ?? Infinity, maxRows));
    log.push({ ...entry, matched: rows.length, returned: out.length });
    return Promise.resolve({ data: out.map(withSubtype), error: null });
  };

  function nearSemantics(a: Record<string, any>): Row[] {
    const radius = Math.min(Math.max(Number(a.p_radius_mi ?? 25), 0.1), 150);
    const cats: string[] = a.p_categories ?? [];
    const since = Date.parse(a.p_since);
    const until = Date.parse(a.p_until);
    const rows: Row[] = signals
      .filter((r) => r.lat != null && r.lon != null)
      .filter((r) => (r.categories ?? []).some((c: string) => cats.includes(c)))
      .filter((r) => !r.expires_at || Date.parse(r.expires_at) > now.getTime())
      .filter((r) => Date.parse(r.occurred_at) >= since && Date.parse(r.occurred_at) <= until)
      .map((r) => ({ ...r, distance_mi: haversineMi(a.p_lat, a.p_lon, r.lat, r.lon) }))
      .filter((r) => r.distance_mi <= radius);
    const asc = !!a.p_soonest_first;
    rows.sort((x, y) => (asc ? 1 : -1) * (Date.parse(x.occurred_at) - Date.parse(y.occurred_at)) || y.id - x.id);
    return rows;
  }

  const db = {
    log,
    upserts,
    rpc(name: string, args: Record<string, any>) {
      let lim: number | null = null;
      const run = () => {
        if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError, code: 'XX000' } });
        if (name !== 'holler_signals_near') return Promise.resolve({ data: null, error: { message: `unknown function ${name}` } });
        lim = Math.min(Math.max(Number(args.p_limit ?? 100), 1), 500);
        return finish(nearSemantics(args), lim, { kind: 'rpc', name, args });
      };
      const q: any = { select: () => q, abortSignal: () => q, then: (res: any, rej: any) => run().then(res, rej) };
      return q;
    },
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let lim: number | null = null;
      let ord: [string, boolean] | null = null;
      const desc: string[] = [];
      const q: any = {
        select: () => q,
        overlaps: (c: string, v: string[]) => (filters.push((r) => (r[c] ?? []).some((x: string) => v.includes(x))), desc.push(`overlaps:${c}`), q),
        is: (c: string, v: any) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), desc.push(`is:${c}`), q),
        eq: (c: string, v: any) => (filters.push((r) => r[c] === v), desc.push(`eq:${c}=${v}`), q),
        gte: (c: string, v: any) => (filters.push((r) => r[c] != null && r[c] >= v), desc.push(`gte:${c}`), q),
        lte: (c: string, v: any) => (filters.push((r) => r[c] != null && r[c] <= v), desc.push(`lte:${c}`), q),
        gt: (c: string, v: any) => (filters.push((r) => r[c] != null && r[c] > v), desc.push(`gt:${c}`), q),
        lt: (c: string, v: any) => (filters.push((r) => r[c] != null && r[c] < v), desc.push(`lt:${c}`), q),
        or: (s: string) => (filters.push((r) => splitTop(s).some((t) => evalTerm(t, r))), desc.push(`or:${s}`), q),
        order: (c: string, o?: { ascending?: boolean }) => ((ord = [c, o?.ascending !== false]), q),
        limit: (n: number) => ((lim = n), q),
        abortSignal: () => q,
        upsert: (rows: Row[]) => (upserts.push(rows), Promise.resolve({ error: null })),
        then: (res: any, rej: any) => {
          let rows = signals.filter((r) => filters.every((f) => f(r)));
          if (ord) {
            const [c, asc] = ord;
            rows = rows.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
          }
          return finish(rows, lim, { kind: 'select', name: `${table}:${desc.join(',')}` }).then(res, rej);
        },
      };
      return q;
    },
  };
  return db;
}
