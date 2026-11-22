// In-memory stand-in for the slice of supabase-js the AI step uses: select/eq/gte/in/is/order/range/limit, insert(+select),
// update, delete, and rpc('holler_ai_apply') implemented with the same rules as the SQL function in 0014 (skip deleted signals and
// signals already classified, change categories only when the set differs, set data.cat_src, keep prev_categories).
// The unique index on holler_ai_spend (month, kind) for alert rows is enforced like Postgres would.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export class AiFakeDb {
  tables: Record<string, Row[]> = { holler_signals: [], holler_signal_ai: [], holler_ai_spend: [], holler_ai_cache: [] };
  calls: string[] = [];
  failOn: Record<string, string> = {};
  rpcCalls: any[] = [];
  private seq = 0;
  /** Called after every insert into holler_ai_spend (lets a test interleave a second run's reservation). */
  onSpendInsert?: (row: Row) => void;
  /** PostgREST max-rows: a select returns at most this many rows whatever range it asks for (the shared project may set it below 1000). */
  maxRows = 1000;
  /** The SQL month-total function from 0014 (holler_ai_month_spend). False: the function is missing, like before the migration. */
  monthSpendFn = true;
  /** Longest .in() list seen per table (the cache lookup must send at most 50 keys per request). */
  maxInList: Record<string, number> = {};

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }));
  }
  from(table: string) {
    this.tables[table] ??= [];
    return new B(this, table);
  }
  nextId() {
    return ++this.seq;
  }
  async rpc(name: string, args: any) {
    this.calls.push(`rpc.${name}`);
    this.rpcCalls.push(args);
    if (this.failOn[`rpc.${name}`]) return { data: null, error: { message: this.failOn[`rpc.${name}`] } };
    if (name === 'holler_ai_month_spend' && this.monthSpendFn) {
      const total = this.tables.holler_ai_spend.filter((r) => r.month === args.p_month).reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
      return { data: Math.round(total * 1_000_000) / 1_000_000, error: null };
    }
    if (name !== 'holler_ai_apply') return { data: null, error: { message: `function ${name} does not exist` } };
    const changed: number[] = [];
    for (const r of args.p_rows as Row[]) {
      const sig = this.tables.holler_signals.find((s) => s.id === r.signal_id);
      if (!sig) continue;
      if (this.tables.holler_signal_ai.some((a) => a.signal_id === r.signal_id)) continue;
      const row: Row = { signal_id: r.signal_id, trades: r.trades ?? {}, notes: r.notes ?? {}, model: r.model, prompt_v: r.prompt_v, origin: r.origin ?? 'model', prev_categories: null, applied: false, rematched_at: null, created_at: new Date().toISOString() };
      if (!['model', 'cache', 'skip'].includes(row.origin)) return { data: null, error: { message: 'violates check constraint "holler_signal_ai_origin_check"' } };
      this.tables.holler_signal_ai.push(row);
      if (r.cache_key) {
        if (row.origin === 'model' && r.cache_put === true) {
          if (!this.tables.holler_ai_cache.some((c) => c.key === r.cache_key)) {
            this.tables.holler_ai_cache.push({ key: r.cache_key, trades: r.trades ?? {}, notes: r.notes ?? {}, model: r.model, prompt_v: r.prompt_v, hits: 0, created_at: new Date().toISOString() });
          }
        } else if (row.origin === 'cache') {
          const c = this.tables.holler_ai_cache.find((x) => x.key === r.cache_key);
          if (c) c.hits += 1;
        }
      }
      if (Array.isArray(r.apply) && r.apply.length > 0) {
        const a = [...sig.categories].sort().join(',');
        const b = [...r.apply].sort().join(',');
        if (a !== b) {
          row.prev_categories = [...sig.categories];
          row.applied = true;
          sig.categories = [...r.apply];
          sig.data = { ...(sig.data ?? {}), cat_src: 'ai' };
          changed.push(r.signal_id);
        }
      }
    }
    return { data: changed, error: null };
  }
}

class B implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private from_ = 0;
  private to_ = 999;
  private lim: number | null = null;
  private payload: any;
  private returning = false;
  private antiJoin = false;
  constructor(private db: AiFakeDb, private table: string) {}
  select() {
    if (this.op === 'select') this.db.calls.push(`${this.table}.select`);
    else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.db.calls.push(`${this.table}.insert`); return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; this.db.calls.push(`${this.table}.update`); return this; }
  delete() { this.op = 'delete'; this.db.calls.push(`${this.table}.delete`); return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
  in(c: string, vs: any[]) {
    this.db.maxInList[this.table] = Math.max(this.db.maxInList[this.table] ?? 0, vs.length);
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: any) {
    // PostgREST anti-join: .is('holler_signal_ai', null) on holler_signals keeps the rows that have no holler_signal_ai row.
    if (c === 'holler_signal_ai' && v === null && this.table === 'holler_signals') {
      this.filters.push((r) => !this.db.tables.holler_signal_ai.some((a) => a.signal_id === r.id));
      this.antiJoin = true;
      return this;
    }
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this; }
  limit(n: number) { this.lim = n; return this; }
  then<T1 = any, T2 = never>(f?: ((v: any) => T1 | PromiseLike<T1>) | null, r?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve().then(() => this.run()).then(f, r);
  }
  private run() {
    // A test can make just the anti-join read fail (an old PostgREST, a stale schema cache) with failOn['holler_signals.antijoin'] = code.
    if (this.antiJoin && this.db.failOn['holler_signals.antijoin']) return { data: null, error: { message: 'Could not find a relationship', code: this.db.failOn['holler_signals.antijoin'] } };
    const fk = `${this.table}.${this.op}`;
    if (this.db.failOn[fk]) return { data: null, error: { message: this.db.failOn[fk] } };
    const t = this.db.tables[this.table];
    const match = () => t.filter((x) => this.filters.every((f) => f(x)));
    if (this.op === 'select') {
      let rows = match();
      for (const { col, asc } of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)));
      rows = rows.slice(this.from_, Math.min(this.to_ + 1, this.from_ + this.db.maxRows));
      if (this.lim !== null) rows = rows.slice(0, this.lim);
      return { data: rows.map((x) => ({ ...x })), error: null };
    }
    if (this.op === 'insert') {
      const out: Row[] = [];
      for (const p of this.payload as Row[]) {
        // 0014: alert_80 / alert_100 once per (month, kind); alert_price once per (day, kind).
        const dup =
          this.table === 'holler_ai_spend' &&
          /^alert_/.test(p.kind) &&
          t.some((x) => x.kind === p.kind && (p.kind === 'alert_price' ? x.day === p.day : x.month === p.month));
        if (dup) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint "holler_ai_spend_alert_once_idx"', code: '23505' } };
        }
        const row = { id: this.db.nextId(), input_tokens: 0, output_tokens: 0, ...p };
        t.push(row);
        out.push({ ...row });
        if (this.table === 'holler_ai_spend') this.db.onSpendInsert?.(row);
      }
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === 'update') {
      for (const x of match()) Object.assign(x, this.payload);
      return { data: null, error: null };
    }
    const m = new Set(match());
    this.db.tables[this.table] = t.filter((x) => !m.has(x));
    return { data: null, error: null };
  }
}

export const NOW = new Date('2026-11-19T15:00:00Z');
export const MONTH = '2026-11-01';

/** Letters for an id, so each test signal has its own text after the cache normalization removes digits (12 -> "bc"). */
export const tag = (id: number) => String(id).split('').map((d) => 'abcdefghij'[Number(d)]).join('');

/** A building permit (a source that goes to the model). Every id gets distinct text, so distinct cache keys. */
export function sig(id: number, over: Row = {}): Row {
  return {
    id,
    source: 'socrata-chicago-permits',
    kind: 'permit',
    subtype: 'permit',
    title: `Roof permit ${tag(id)} for a single family home, 1.75 inch hail`,
    summary: `Permit issued to replace roof shingles, job ${tag(id)}.`,
    city: 'Smyrna',
    state: 'GA',
    categories: ['roofing', 'auto-body'],
    severity: 2,
    occurred_at: new Date(NOW.getTime() - id * 60_000).toISOString(),
    created_at: new Date(NOW.getTime() - id * 60_000).toISOString(),
    data: { subtype: 'permit' },
    ...over,
  };
}
