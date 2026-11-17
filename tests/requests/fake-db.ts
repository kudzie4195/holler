// In-memory stand-in for the slice of the supabase-js query builder that lib/requests and lib/signals/store.ts use:
// select (with count/head), insert, update, delete, upsert (ignoreDuplicates), eq/neq/in/is/lt/gte, order, range, limit,
// maybeSingle, single, and `.select()` after a write to return rows. Shapes follow @supabase/postgrest-js.
// Unique keys and the reply guard of migration 0005 are imitated so the service sees the same errors it would get from Postgres.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Err = { message: string; code?: string } | null;

const UNIQUE: Record<string, string[][]> = {
  holler_signals: [['source', 'external_id']],
  holler_matches: [['user_id', 'signal_id']],
  holler_requests: [['public_id'], ['confirm_token_hash'], ['close_token_hash'], ['remove_token_hash']],
  holler_request_replies: [['request_id', 'user_id']],
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  failOn: Record<string, string> = {};
  writes: { table: string; op: string; payload: unknown }[] = [];
  private seq: Record<string, number> = {};
  now: () => Date = () => new Date();

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }));
  }
  from(table: string) {
    this.tables[table] ??= [];
    return new Builder(this, table);
  }
  nextId(table: string): number {
    this.seq[table] = (this.seq[table] ?? this.tables[table].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0)) + 1;
    return this.seq[table];
  }
  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }
}

class Builder implements PromiseLike<{ data: any; error: Err; count?: number | null }> {
  private op: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private rangeFrom = 0;
  private rangeTo = 999;
  private limitN: number | null = null;
  private payload: any = null;
  private opts: any = {};
  private returning = false;
  private countMode = false;
  private head = false;
  private one: 'maybe' | 'single' | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, o?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true;
    if (o?.count) this.countMode = true;
    if (o?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row[], o: any = {}) { this.op = 'upsert'; this.payload = rows; this.opts = o; return this; }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
  /** Only the form the service uses: not(col, 'is', null). */
  not(c: string, op: string, v: any) {
    if (op !== 'is' || v !== null) throw new Error(`fake: unsupported not(${c}, ${op}, ${v})`);
    this.filters.push((r) => (r[c] ?? null) !== null);
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  range(a: number, b: number) { this.rangeFrom = a; this.rangeTo = b; return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'single'; return this; }

  then<T1 = any, T2 = never>(onF?: ((v: any) => T1 | PromiseLike<T1>) | null, onR?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.run()).then(onF, onR);
  }

  private shape(rows: Row[] | null, error: Err = null, count: number | null = null) {
    if (error) return { data: null, error, count: null };
    if (this.one) {
      const list = rows ?? [];
      if (list.length > 1) return { data: null, error: { message: 'multiple rows' }, count: null };
      if (list.length === 0 && this.one === 'single') return { data: null, error: { message: 'no rows', code: 'PGRST116' }, count: null };
      return { data: list[0] ? { ...list[0] } : null, error: null, count: null };
    }
    return { data: rows ? rows.map((r) => ({ ...r })) : null, error: null, count };
  }

  private violates(row: Row, except?: Row): boolean {
    const t = this.db.tables[this.table];
    return (UNIQUE[this.table] ?? []).some((keys) =>
      t.some((x) => x !== except && keys.every((k) => x[k] !== undefined && x[k] !== null && x[k] === row[k])),
    );
  }

  /** Migration 0005 trigger holler_request_replies_guard (open, 5 per request, 10 per business per day). */
  private replyGuard(row: Row): Err {
    if (this.table !== 'holler_request_replies') return null;
    const req = this.db.rows('holler_requests').find((r) => r.id === row.request_id);
    const now = this.db.now().toISOString();
    if (!req || req.status !== 'open' || !req.expires_at || req.expires_at <= now) return { message: 'holler_request_not_open', code: 'P0001' };
    const n = this.db.rows('holler_request_replies').filter((r) => r.request_id === row.request_id).length;
    if (n >= 5) return { message: 'holler_request_reply_cap', code: 'P0001' };
    // Round 3 (P1-4): 10 replies per business in any 24 hours, counted inside the guard.
    const since = new Date(this.db.now().getTime() - 86_400_000).toISOString();
    const day = this.db.rows('holler_request_replies').filter((r) => r.user_id === row.user_id && r.created_at > since).length;
    if (day >= 10) return { message: 'holler_request_daily_cap', code: 'P0001' };
    return null;
  }

  private run() {
    const t = this.db.tables[this.table];
    const fail = this.db.failOn[`${this.table}.${this.op}`];
    if (fail) return this.shape(null, { message: fail });
    const matching = () => t.filter((r) => this.filters.every((f) => f(r)));
    if (this.op !== 'select') this.db.writes.push({ table: this.table, op: this.op, payload: this.payload });

    if (this.op === 'select') {
      let rows = matching();
      for (const { col, asc } of [...this.orders].reverse()) {
        rows = [...rows].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)));
      }
      const total = rows.length;
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      if (this.head) return { data: null, error: null, count: this.countMode ? total : null };
      return this.shape(rows, null, this.countMode ? total : null);
    }
    if (this.op === 'insert') {
      const out: Row[] = [];
      for (const r of this.payload as Row[]) {
        const guard = this.replyGuard(r);
        if (guard) return this.shape(null, guard);
        const row = { id: r.id ?? this.db.nextId(this.table), created_at: r.created_at ?? this.db.now().toISOString(), ...r };
        if (this.violates(row)) return this.shape(null, { message: 'duplicate key value violates unique constraint', code: '23505' });
        t.push(row);
        out.push(row);
      }
      return this.shape(this.returning ? out : null);
    }
    if (this.op === 'upsert') {
      const out: Row[] = [];
      const keys: string[] = String(this.opts.onConflict ?? 'id').split(',');
      for (const r of this.payload as Row[]) {
        if (t.some((x) => keys.every((k) => x[k] === r[k]))) continue;
        const row = { id: this.db.nextId(this.table), ...r };
        t.push(row);
        out.push(row);
      }
      return this.shape(this.returning ? out : null);
    }
    if (this.op === 'update') {
      const m = matching();
      for (const r of m) Object.assign(r, this.payload);
      return this.shape(this.returning ? m : null);
    }
    const m = matching();
    const set = new Set(m);
    this.db.tables[this.table] = t.filter((r) => !set.has(r));
    // Migration 0001: holler_matches.signal_id ON DELETE CASCADE. Migration 0005: holler_requests.signal_id and
    // holler_request_replies.match_id ON DELETE SET NULL.
    if (this.table === 'holler_signals') {
      const ids = new Set(m.map((r) => r.id));
      const gone = new Set(this.db.rows('holler_matches').filter((r) => ids.has(r.signal_id)).map((r) => r.id));
      this.db.tables.holler_matches = this.db.rows('holler_matches').filter((r) => !gone.has(r.id));
      for (const r of this.db.rows('holler_requests')) if (ids.has(r.signal_id)) r.signal_id = null;
      for (const r of this.db.rows('holler_request_replies')) if (gone.has(r.match_id)) r.match_id = null;
    }
    // ON DELETE CASCADE for the reply rows of a deleted request.
    if (this.table === 'holler_requests') {
      const ids = new Set(m.map((r) => r.id));
      this.db.tables.holler_request_replies = this.db.rows('holler_request_replies').filter((r) => !ids.has(r.request_id));
    }
    return this.shape(this.returning ? m : null);
  }
}
