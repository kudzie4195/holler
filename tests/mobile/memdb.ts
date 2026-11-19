// A small in-memory Supabase-like database for tests/mobile: tables of plain rows, evaluated against the filters a query recorded
// (fakes.ts Q). Supports what the push and notify code sends: select (holler_matches rows carry `signal` from holler_signals),
// update, upsert, insert, delete, eq / in / is / gte / gt / lt, or() made of `col.is.null` and `col.lt."value"` parts, order, limit,
// range, maybeSingle, and update ... select() returning the changed rows.
import { fakeDb, rateRpc, type FakeDb, type Filter, type Q } from './fakes';

export type Row = Record<string, unknown>;
export interface MemDb {
  tables: Record<string, Row[]>;
  db: FakeDb;
  /** Answers with this error for a table (to simulate a missing table or column). */
  failOn: Record<string, { code?: string; message: string } | undefined>;
}

const cmp = (a: unknown, b: unknown): number => {
  const da = typeof a === 'string' ? Date.parse(a) : NaN;
  const db = typeof b === 'string' ? Date.parse(b) : NaN;
  if (Number.isFinite(da) && Number.isFinite(db) && /\d{4}-\d\d-\d\d/.test(String(a)) && /\d{4}-\d\d-\d\d/.test(String(b))) return da - db;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

function orPart(row: Row, part: string): boolean {
  const m = /^([a-z_]+)\.(is|lt|gt|eq)\.(.*)$/.exec(part.trim());
  if (!m) throw new Error(`memdb: unsupported or() part ${part}`);
  const [, col, op, raw] = m;
  const v = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  if (op === 'is') return v === 'null' ? row[col] == null : String(row[col]) === v;
  if (row[col] == null) return false;
  if (op === 'lt') return cmp(row[col], v) < 0;
  if (op === 'gt') return cmp(row[col], v) > 0;
  return String(row[col]) === v;
}

/** Splits an or() filter on the commas that are not inside double quotes. */
function splitOr(expr: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of expr) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function passes(row: Row, f: Filter): boolean {
  const [op, c, v] = f as [string, string, unknown];
  switch (op) {
    case 'eq':
      return row[c] === v;
    case 'in':
      return (v as unknown[]).includes(row[c]);
    case 'is':
      return v === null ? row[c] == null : row[c] === v;
    case 'gte':
      return row[c] != null && cmp(row[c], v) >= 0;
    case 'gt':
      return row[c] != null && cmp(row[c], v) > 0;
    case 'lt':
      return row[c] != null && cmp(row[c], v) < 0;
    case 'or':
      return splitOr(String(c)).some((p) => orPart(row, p));
    default:
      return true;
  }
}

function shape(table: string, row: Row, tables: Record<string, Row[]>): Row {
  if (table !== 'holler_matches') return { ...row };
  const signal = (tables.holler_signals ?? []).find((s) => s.id === row.signal_id) ?? null;
  return { ...row, signal };
}

export function memDb(tables: Record<string, Row[]>, rate: Map<string, number> = new Map()): MemDb {
  const failOn: MemDb['failOn'] = {};
  let nextId = 1000;
  const handler = (q: Q): { data?: unknown; error?: unknown } => {
    const fail = failOn[q.table];
    if (fail) return { error: fail };
    const rows = (tables[q.table] ??= []);
    const where = q.filters.filter((f) => !['order', 'limit', 'range'].includes(f[0]));
    const hit = rows.filter((r) => where.every((f) => passes(r, f)));
    if (q.op === 'select') {
      let out = [...hit];
      const orders = q.filters.filter((f) => f[0] === 'order').reverse();
      for (const [, c, o] of orders as [string, string, { ascending?: boolean } | undefined][]) {
        const asc = o?.ascending !== false;
        out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c]));
      }
      const range = q.filters.find((f) => f[0] === 'range') as [string, number, number] | undefined;
      if (range) out = out.slice(range[1], range[2] + 1);
      const lim = q.filters.find((f) => f[0] === 'limit')?.[1] as number | undefined;
      if (lim !== undefined) out = out.slice(0, lim);
      const shaped = out.map((r) => shape(q.table, r, tables));
      return { data: q.single ? (shaped[0] ?? null) : shaped };
    }
    if (q.op === 'update') {
      for (const r of hit) Object.assign(r, q.payload as Row);
      return { data: q.returning ? hit.map((r) => ({ ...r })) : null };
    }
    if (q.op === 'delete') {
      tables[q.table] = rows.filter((r) => !hit.includes(r));
      return { data: null };
    }
    if (q.op === 'insert' || q.op === 'upsert') {
      const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[];
      const key = (q.opts as { onConflict?: string } | undefined)?.onConflict;
      for (const p of list) {
        const existing = key ? rows.find((r) => r[key] === p[key]) : undefined;
        if (existing) Object.assign(existing, p);
        else rows.push({ id: p.id ?? `r${nextId++}`, ...p });
      }
      return { data: null };
    }
    return { data: null };
  };
  return { tables, failOn, db: fakeDb(handler, rateRpc(rate)) };
}
