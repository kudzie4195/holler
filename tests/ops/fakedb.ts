// In-memory stand-in for the slice of the Supabase query builder that lib/signals/store.ts and the health route use.
// It deliberately caps every select at 1000 rows, like PostgREST's default max_rows, so tests prove paging works.
// Shape of the real API this imitates: @supabase/postgrest-js (select/eq/neq/gt/gte/lt/in/order/range/limit/upsert/insert/update/delete).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export const MAX_ROWS = 1000;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  calls: string[] = [];
  private seq: Record<string, number> = {};
  failOn: Record<string, string> = {}; // "table.op" -> error message
  failCode: Record<string, string> = {}; // "table.op" -> PostgREST / Postgres error code sent with the failOn message (PGRST205, 42P01, ...)

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }));
  }

  from(table: string) {
    this.tables[table] ??= [];
    return new Builder(this, table);
  }

  nextId(table: string): number {
    this.seq[table] = (this.seq[table] ?? this.tables[table].reduce((m, r) => Math.max(m, r.id ?? 0), 0)) + 1;
    return this.seq[table];
  }
}

class Builder implements PromiseLike<{ data: any; error: { message: string } | null; count?: number | null }> {
  private op: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private rangeFrom = 0;
  private rangeTo = MAX_ROWS - 1;
  private limitN: number | null = null;
  private payload: any = null;
  private opts: any = {};
  private returning = false;
  private wantCount = false;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, o?: { count?: string; head?: boolean }) {
    if (this.op === 'select') this.db.calls.push(`${this.table}.select`);
    else this.returning = true;
    if (o?.count) this.wantCount = true;
    return this;
  }
  upsert(rows: Row[], o: any = {}) { this.op = 'upsert'; this.payload = rows; this.opts = o; this.db.calls.push(`${this.table}.upsert`); return this; }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.db.calls.push(`${this.table}.insert`); return this; }
  update(patch: Row) { this.op = 'update'; this.payload = patch; this.db.calls.push(`${this.table}.update`); return this; }
  delete(o?: { count?: string }) { this.op = 'delete'; if (o?.count) this.wantCount = true; this.db.calls.push(`${this.table}.delete`); return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  range(a: number, b: number) { this.rangeFrom = a; this.rangeTo = b; return this; }
  limit(n: number) { this.limitN = n; return this; }
  abortSignal() { return this; }

  then<T1 = any, T2 = never>(onF?: ((v: any) => T1 | PromiseLike<T1>) | null, onR?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.run()).then(onF, onR);
  }

  private run() {
    const t = this.db.tables[this.table];
    const failKey = `${this.table}.${this.op}`;
    if (this.db.failOn[failKey]) {
      const code = this.db.failCode[failKey];
      return { data: null, error: code ? { message: this.db.failOn[failKey], code } : { message: this.db.failOn[failKey] } };
    }
    const matching = () => t.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'select') {
      let rows = matching();
      for (const { col, asc } of [...this.orders].reverse()) {
        rows = [...rows].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)));
      }
      const total = rows.length;
      rows = rows.slice(this.rangeFrom, Math.min(this.rangeTo + 1, this.rangeFrom + MAX_ROWS));
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return { data: rows.map((r) => ({ ...r })), error: null, count: this.wantCount ? total : null };
    }
    if (this.op === 'insert') {
      const out = this.payload.map((r: Row) => ({ id: this.db.nextId(this.table), ...r }));
      t.push(...out);
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === 'upsert') {
      const keys: string[] = String(this.opts.onConflict ?? 'id').split(',');
      const out: Row[] = [];
      for (const r of this.payload as Row[]) {
        const dup = t.find((x) => keys.every((k) => x[k] === r[k]));
        if (dup) continue; // ignoreDuplicates
        const row = { id: this.db.nextId(this.table), ...r };
        t.push(row);
        out.push({ ...row });
      }
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === 'update') {
      const m = matching();
      for (const r of m) Object.assign(r, this.payload);
      return { data: null, error: null };
    }
    const m = new Set(matching());
    this.db.tables[this.table] = t.filter((r) => !m.has(r));
    return { data: null, error: null, count: this.wantCount ? m.size : null };
  }
}
