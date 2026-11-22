/**
 * Small in-memory PostgREST double for the round 7 MATCH tests: holler_signals and holler_matches as plain arrays.
 * Supports select (with `alias:data->>key` columns), eq, neq, in, gt, gte, lt, lte, is, or (comma terms with eq/neq/is/in/like),
 * order, limit, range (with offset), update(...).eq('id'), delete() (with .select() returning the deleted rows), upsert with ignoreDuplicates on a conflict key, and records every request.
 * Column names may be JSON paths (`data->>subtype`). Written for these tests (assumed PostgREST semantics, text comparison for ->>).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

function colVal(r: Row, col: string): any {
  const m = /^([a-z_]+)->>([a-zA-Z_]+)$/.exec(col);
  if (m) {
    const v = r[m[1]]?.[m[2]];
    return v == null ? null : String(v);
  }
  return r[col];
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

function term(t: string, r: Row): boolean {
  if (t.startsWith('or(') && t.endsWith(')')) return splitTop(t.slice(3, -1)).some((x) => term(x, r));
  if (t.startsWith('and(') && t.endsWith(')')) return splitTop(t.slice(4, -1)).every((x) => term(x, r));
  const m = /^([a-z_]+(?:->>[a-zA-Z_]+)?)\.([a-z]+)\.(.*)$/.exec(t);
  if (!m) throw new Error(`fake cannot parse ${t}`);
  const [, col, op, val] = m;
  const v = colVal(r, col);
  switch (op) {
    case 'is':
      return val === 'null' ? v == null : v != null;
    case 'eq':
      return v != null && String(v) === val;
    case 'neq':
      return v != null && String(v) !== val;
    case 'in':
      return v != null && val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    case 'ilike': {
      const re = new RegExp(`^${val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
      return v != null && re.test(String(v));
    }
    case 'like': {
      const re = new RegExp(`^${val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return v != null && re.test(String(v));
    }
    default:
      throw new Error(`fake: unsupported ${op}`);
  }
}

export function fakeTables(
  init: Record<string, Row[]>,
  /** maxRows: like PostgREST max_rows, a select returns at most this many rows whatever limit or range asked for. */
  opts: { conflict?: Record<string, string[]>; failSelect?: string; maxRows?: number } = {},
) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(init).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const log: string[] = [];
  let nextId = 10_000;
  const db: any = {
    tables,
    log,
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      const desc: string[] = [];
      let cols = '*';
      let lim = Infinity;
      let off = 0;
      let ord: [string, boolean] | null = null;
      let mode: 'select' | 'update' | 'upsert' | 'delete' = 'select';
      let patch: Row = {};
      let upRows: Row[] = [];
      let upOpts: any = {};
      let returning = false;
      const add = (d: string, f: (r: Row) => boolean) => (desc.push(d), filters.push(f), q);
      const project = (r: Row) => {
        if (cols === '*') return { ...r };
        const out: Row = {};
        for (const c of cols.split(',').map((x) => x.trim()).filter(Boolean)) {
          const [alias, path] = c.includes(':') ? c.split(':') : [c, c];
          out[alias] = colVal(r, path);
          if (!c.includes(':') && path.includes('->>')) out[alias] = colVal(r, path);
        }
        return out;
      };
      const q: any = {
        select: (c = '*') => {
          if (mode === 'upsert' || mode === 'update' || mode === 'delete') returning = true;
          cols = c;
          return q;
        },
        eq: (c: string, v: any) => add(`eq:${c}=${v}`, (r) => colVal(r, c) === v || String(colVal(r, c)) === String(v)),
        neq: (c: string, v: any) => add(`neq:${c}=${v}`, (r) => colVal(r, c) !== v),
        in: (c: string, v: any[]) => add(`in:${c}=${v.join('|')}`, (r) => v.map(String).includes(String(colVal(r, c)))),
        gt: (c: string, v: any) => add(`gt:${c}`, (r) => colVal(r, c) != null && colVal(r, c) > v),
        gte: (c: string, v: any) => add(`gte:${c}`, (r) => colVal(r, c) != null && colVal(r, c) >= v),
        lt: (c: string, v: any) => add(`lt:${c}`, (r) => colVal(r, c) != null && colVal(r, c) < v),
        lte: (c: string, v: any) => add(`lte:${c}`, (r) => colVal(r, c) != null && colVal(r, c) <= v),
        is: (c: string, v: any) => add(`is:${c}`, (r) => (v === null ? colVal(r, c) == null : colVal(r, c) === v)),
        or: (s: string) => add(`or:${s}`, (r) => splitTop(s).some((t) => term(t, r))),
        order: (c: string, o?: { ascending?: boolean }) => ((ord = [c, o?.ascending !== false]), q),
        limit: (n: number) => ((lim = n), q),
        range: (a: number, b: number) => ((off = a), (lim = b - a + 1), q),
        delete: () => ((mode = 'delete'), q),
        update: (p: Row) => ((mode = 'update'), (patch = p), q),
        upsert: (rs: Row[], o: any) => ((mode = 'upsert'), (upRows = rs), (upOpts = o ?? {}), q),
        then: (res: any, rej: any) => {
          const run = () => {
            if (mode === 'delete') {
              log.push(`${table}:delete:${desc.join(',')}`);
              const hit = rows.filter((r) => filters.every((f) => f(r)));
              for (const r of hit) rows.splice(rows.indexOf(r), 1);
              return { data: returning ? hit.map(project) : null, error: null };
            }
            if (mode === 'update') {
              log.push(`${table}:update:${desc.join(',')}`);
              const hit = rows.filter((r) => filters.every((f) => f(r)));
              for (const r of hit) Object.assign(r, patch);
              return { data: returning ? hit.map(project) : null, error: null };
            }
            if (mode === 'upsert') {
              log.push(`${table}:upsert:${upRows.length}`);
              const key = (upOpts.onConflict ?? opts.conflict?.[table]?.join(',') ?? 'id').split(',');
              const inserted: Row[] = [];
              for (const r of upRows) {
                const dup = rows.find((x) => key.every((k: string) => x[k] === r[k]));
                if (dup) {
                  if (!upOpts.ignoreDuplicates) Object.assign(dup, r);
                  continue;
                }
                const row = { id: r.id ?? nextId++, ...r };
                rows.push(row);
                inserted.push(row);
              }
              return { data: returning ? inserted.map(project) : null, error: null };
            }
            log.push(`${table}:select:${desc.join(',')}`);
            if (opts.failSelect === table) return { data: null, error: { message: 'down' } };
            let out = rows.filter((r) => filters.every((f) => f(r)));
            if (ord) {
              const [c, asc] = ord;
              out = out.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
            }
            return { data: out.slice(off, off + Math.min(lim, opts.maxRows ?? Infinity)).map(project), error: null };
          };
          return Promise.resolve(run()).then(res, rej);
        },
      };
      return q;
    },
  };
  return db;
}
