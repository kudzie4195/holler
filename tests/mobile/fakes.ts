// Shared fakes for tests/mobile. A Supabase-like query builder that records every call and answers through a handler, so a test can
// assert exactly which filters a route applied (for example that every read is scoped to the caller's user id).
export type Filter = [op: string, ...args: unknown[]];

export class Q {
  op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select';
  cols = '*';
  payload: unknown = undefined;
  opts: unknown = undefined;
  filters: Filter[] = [];
  returning = false;
  single: 'maybe' | null = null;
  constructor(
    public table: string,
    private handler: (q: Q) => { data?: unknown; error?: unknown },
    private log: Q[],
  ) {
    log.push(this);
  }
  select(cols = '*') {
    if (this.op === 'select') this.cols = cols;
    else this.returning = true;
    return this;
  }
  update(p: unknown) {
    this.op = 'update';
    this.payload = p;
    return this;
  }
  upsert(p: unknown, o?: unknown) {
    this.op = 'upsert';
    this.payload = p;
    this.opts = o;
    return this;
  }
  insert(p: unknown) {
    this.op = 'insert';
    this.payload = p;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push(['eq', c, v]);
    return this;
  }
  in(c: string, v: unknown) {
    this.filters.push(['in', c, v]);
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push(['is', c, v]);
    return this;
  }
  or(f: string) {
    this.filters.push(['or', f]);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push(['gte', c, v]);
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push(['gt', c, v]);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push(['lt', c, v]);
    return this;
  }
  order(c: string, o?: unknown) {
    this.filters.push(['order', c, o]);
    return this;
  }
  limit(n: number) {
    this.filters.push(['limit', n]);
    return this;
  }
  range(a: number, b: number) {
    this.filters.push(['range', a, b]);
    return this;
  }
  maybeSingle() {
    this.single = 'maybe';
    return this.run();
  }
  eqOf(c: string): unknown {
    return this.filters.find((f) => f[0] === 'eq' && f[1] === c)?.[2];
  }
  private run() {
    const r = this.handler(this);
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  }
  then<T>(res: (v: { data: unknown; error: unknown }) => T, rej?: (e: unknown) => T) {
    return this.run().then(res, rej);
  }
}

export interface FakeDb {
  from: (t: string) => Q;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  log: Q[];
  rpcs: { name: string; args: Record<string, unknown> }[];
  auth: unknown;
}

export function fakeDb(
  handler: (q: Q) => { data?: unknown; error?: unknown } = () => ({ data: null }),
  rpc: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown } = () => ({ data: null }),
  auth: unknown = {},
): FakeDb {
  const log: Q[] = [];
  const rpcs: FakeDb['rpcs'] = [];
  return {
    log,
    rpcs,
    auth,
    from: (t: string) => new Q(t, handler, log),
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      const r = rpc(name, args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
}

/** A token that passes the shape check. */
export const tok = (who: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(who).toString('base64url')}payload.signaturesig`;

export const UA = '11111111-1111-4111-8111-111111111111';
export const UB = '22222222-2222-4222-8222-222222222222';

export function profileRow(userId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: userId,
    business_name: 'Ace Roofing',
    categories: ['roofing'],
    zip: '30080',
    city: 'Smyrna',
    state: 'GA',
    lat: 33.88,
    lon: -84.51,
    radius_mi: 25,
    alert_email: true,
    subscription_status: 'trialing',
    trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    plan: 'starter',
    extra_areas: [],
    keywords: [],
    stripe_customer_id: null,
    stripe_subscription_id: null,
    email_verified_at: '2026-11-01T00:00:00Z',
    created_at: '2026-11-10T00:00:00Z',
    plan_source: 'none',
    store_product_id: null,
    store_expires_at: null,
    store_env: null,
    push_alerts: true,
    last_pushed_at: null,
    ...over,
  };
}

export function req(url: string, init: { method?: string; token?: string | null; origin?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.origin) headers.origin = init.origin;
  let body: string | undefined;
  if (init.body !== undefined) {
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    headers['content-type'] ??= 'application/json';
  }
  return new Request(`https://localholler.test${url}`, { method: init.method ?? 'GET', headers, body });
}

/**
 * A stateful holler_rate_hit (the website limiter's counter): counts per key, answers count <= max. No window expiry (tests do not
 * move time across a window). Pass the same Map to share counters across route calls.
 */
export function rateRpc(counters: Map<string, number> = new Map()) {
  return (name: string, args: Record<string, unknown>): { data?: unknown; error?: unknown } => {
    if (name !== 'holler_rate_hit') return { data: null };
    const k = String(args.p_key);
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return { data: n <= Number(args.p_max) };
  };
}
