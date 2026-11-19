// Route harness for tests/mobile: mocks the Supabase clients the mobile API builds (lib/mobile/clients.ts, lib/mobile/admin.ts) with
// fakes that emulate RLS (the member client only ever returns the caller's own rows), and imports a route module fresh.
import { vi } from 'vitest';
import { fakeDb, rateRpc, type FakeDb, type Q } from './fakes';

export interface MatchFixture {
  id: number;
  user_id: string;
  created_at: string;
  status?: string;
  distance_mi?: number | null;
  draft?: string | null;
  signal: Record<string, unknown>;
}

export interface World {
  /** token -> user. A token not listed is "invalid" (401 from the Auth server). */
  users: Record<string, { id: string; email: string; app_metadata?: Record<string, unknown> }>;
  /** Simulates an Auth outage. */
  authDown?: boolean;
  /** HTTP status the Auth server answers with when authDown is set (default 500). 0 means no answer (network). */
  authStatus?: number;
  /** Rate limiter counters (holler_rate_hit on the admin client). */
  rate: Map<string, number>;
  profiles: Record<string, Record<string, unknown>>;
  matches: MatchFixture[];
  feedback: { user_id: string; signal_id: number; verdict: string; job_value_usd: number | null }[];
  adminHandler?: (q: Q) => { data?: unknown; error?: unknown } | undefined;
  memberHandler?: (caller: string, q: Q) => { data?: unknown; error?: unknown } | undefined;
  admin: FakeDb | null;
  members: Record<string, FakeDb>;
  authCalls: string[];
}

export function world(over: Partial<World> = {}): World {
  return { users: {}, profiles: {}, matches: [], feedback: [], admin: null, members: {}, authCalls: [], rate: new Map(), ...over };
}

/** Default member (RLS) behaviour: profiles, matches and feedback, own rows only. */
function memberDefault(w: World, caller: string, q: Q): { data?: unknown; error?: unknown } {
  const own = (uid: unknown) => uid === undefined || uid === caller;
  if (q.table === 'holler_profiles' && q.op === 'select') {
    const uid = q.eqOf('user_id');
    const row = uid === caller ? (w.profiles[caller] ?? null) : null;
    return { data: q.single ? row : row ? [row] : [] };
  }
  if (q.table === 'holler_profiles' && q.op === 'update') {
    if (q.eqOf('user_id') === caller && w.profiles[caller]) Object.assign(w.profiles[caller], q.payload as object);
    return { data: null };
  }
  if (q.table === 'holler_matches' && q.op === 'select') {
    const uid = q.eqOf('user_id');
    const sid = q.eqOf('signal_id');
    // RLS: a member sees only their own matches, whatever filter they send.
    let rows = w.matches.filter((m) => m.user_id === caller && own(uid));
    if (sid !== undefined) rows = rows.filter((m) => m.signal.id === sid);
    rows = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
    const or = q.filters.find((f) => f[0] === 'or')?.[1] as string | undefined;
    if (or) {
      const m = /created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.(\d+)\)/.exec(or);
      if (m) rows = rows.filter((r) => r.created_at < m[1] || (r.created_at === m[2] && r.id < Number(m[3])));
    }
    const lim = q.filters.find((f) => f[0] === 'limit')?.[1] as number | undefined;
    if (lim) rows = rows.slice(0, lim);
    return {
      data: rows.map((r) => ({ id: r.id, status: r.status ?? 'new', distance_mi: r.distance_mi ?? null, draft: r.draft ?? null, created_at: r.created_at, signal: r.signal })),
    };
  }
  if (q.table === 'holler_signal_feedback' && q.op === 'select') {
    return { data: w.feedback.filter((f) => f.user_id === caller) };
  }
  if (q.table === 'holler_signal_feedback' && q.op === 'upsert') {
    const p = q.payload as { user_id: string; signal_id: number; verdict: string; job_value_usd: number | null };
    if (p.user_id !== caller) return { error: { message: 'rls' } };
    w.feedback = w.feedback.filter((f) => !(f.user_id === p.user_id && f.signal_id === p.signal_id)).concat(p);
    return { data: null };
  }
  return { data: null };
}

export function install(w: World) {
  vi.resetModules();
  vi.doMock('server-only', () => ({}));
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://localholler.test');
  vi.doMock('@/lib/mobile/clients', () => ({
    authClient: () => ({
      auth: {
        getUser: async (t: string) => {
          w.authCalls.push(t);
          if (w.authDown) return { data: { user: null }, error: { status: w.authStatus ?? 500, message: 'down' } };
          const u = w.users[t];
          return u ? { data: { user: { app_metadata: {}, ...u } }, error: null } : { data: { user: null }, error: { status: 401, message: 'invalid JWT' } };
        },
      },
    }),
    memberClient: (t: string) => {
      const caller = w.users[t]?.id ?? 'nobody';
      const db = fakeDb((q) => w.memberHandler?.(caller, q) ?? memberDefault(w, caller, q));
      w.members[caller] = db;
      return db;
    },
  }));
  if (!w.admin) w.admin = fakeDb((q) => w.adminHandler?.(q) ?? { data: null }, rateRpc(w.rate));
  vi.doMock('@/lib/mobile/admin', () => ({ adminOrNull: () => w.admin }));
}

