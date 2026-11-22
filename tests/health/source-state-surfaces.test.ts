// Source states in the daily health email, the cron JSON, the owner sources JSON and the member snapshot. Inputs hand-written (assumed).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { planHealth, renderHealthEmail } from '@/lib/email/health';
import { computeSourceStates, summarizeSourceStates } from '@/lib/signals/source-state';

const NOW = new Date('2026-11-22T12:00:00Z');
const H = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const counts = { newSignups24h: 0, activeSubscribers: 0, trialing: 0, usersEmailed24h: 0 };
const adapters = [
  { id: 'nws', label: 'NWS', kind: 'alert', cadenceMinutes: 15, missingEnv: [] as string[] },
  { id: 'socrata-la-permits', label: 'LA permits', kind: 'permit', cadenceMinutes: 360, missingEnv: [] as string[] },
  { id: 'sam-gov', label: 'SAM', kind: 'contract', cadenceMinutes: 720, missingEnv: ['SAM_API_KEY'] },
];
// The LA permits source's earlier history: 8 runs with rows every 6 h before the three empty ones, so empty runs are unusual for it.
const earlier = Array.from({ length: 8 }, (_, i) => ({ source: 'socrata-la-permits', started_at: ago(20 * H + i * 6 * H), fetched: 16, inserted: 0, error: null as string | null }));
const runs = Array.from({ length: 12 }, (_, i) => ({ source: 'nws', started_at: ago((i + 1) * 15 * 60_000), fetched: 20, inserted: 0, error: null as string | null }));

function reportWithStates() {
  const report = planHealth({ adapters, runs, counts, now: NOW });
  const states = computeSourceStates({
    adapters,
    health: [
      { source: 'nws', last_success_at: ago(15 * 60_000), last_run_at: ago(15 * 60_000), consecutive_failures: 0 },
      { source: 'socrata-la-permits', last_success_at: ago(2 * H), last_run_at: ago(2 * H), consecutive_failures: 0, last_record_at: ago(8 * 24 * H) },
    ],
    runs: [
      ...runs,
      ...earlier,
      { source: 'socrata-la-permits', started_at: ago(2 * H), fetched: 0, inserted: 0, error: null },
      { source: 'socrata-la-permits', started_at: ago(8 * H), fetched: 0, inserted: 0, error: null },
      { source: 'socrata-la-permits', started_at: ago(14 * H), fetched: 0, inserted: 0, error: null },
    ],
    now: NOW,
  });
  report.sourceStates = summarizeSourceStates(states);
  return report;
}

describe('daily health email', () => {
  it('has a Source states block with counts and the non-healthy sources, in text and html', () => {
    const mail = renderHealthEmail(reportWithStates());
    expect(mail.text).toContain('Source states');
    expect(mail.text).toContain('1 healthy, 0 delayed, 1 degraded, 0 unavailable, 1 not set up yet (of 3)');
    expect(mail.text).toContain('socrata-la-permits: degraded, last successful run 2 hours ago, newest record 8 days ago (the last 3 runs returned no rows)');
    expect(mail.text).not.toContain('sam-gov: not set up');
    expect(mail.html).toContain('Source states');
  });
  it('does not print "all sources OK" over a degraded source', () => {
    const report = reportWithStates();
    // Run-level checks are clean for this input, so the old subject would be "all sources OK".
    const without = planHealth({ adapters: [adapters[0], adapters[2]], runs, counts, now: NOW });
    expect(without.subject).toBe('Holler health: all sources OK');
    const mail = renderHealthEmail({ ...without, sourceStates: report.sourceStates });
    expect(mail.subject).toBe('Holler health: 1 source is behind on data');
  });
  it('keeps the existing subject when there is a run-level problem, and when states are absent', () => {
    const plain = planHealth({ adapters, runs, counts, now: NOW });
    expect(renderHealthEmail(plain).subject).toBe(plain.subject);
    expect(renderHealthEmail(plain).text).not.toContain('Source states');
    const withProblem = { ...reportWithStates(), problemCount: 2, subject: 'Holler health: 2 sources need attention' };
    expect(renderHealthEmail(withProblem).subject).toBe('Holler health: 2 sources need attention');
  });
  it('lists healthy sources that have never returned a row as quiet, without changing the subject', () => {
    const quietAdapter = { id: 'socrata-batonrouge-311', label: 'BR', kind: 'civic', cadenceMinutes: 180, missingEnv: [] as string[] };
    const quietRuns = Array.from({ length: 12 }, (_, i) => ({ source: quietAdapter.id, started_at: ago((i + 1) * 3 * H), fetched: 0, inserted: 0, error: null as string | null }));
    const states = summarizeSourceStates(
      computeSourceStates({
        adapters: [quietAdapter],
        health: [{ source: quietAdapter.id, last_success_at: ago(3 * H), last_run_at: ago(3 * H), consecutive_failures: 0, last_record_at: null }],
        runs: quietRuns,
        now: NOW,
      }),
    );
    expect(states.quiet.map((q) => q.id)).toEqual([quietAdapter.id]);
    const report = { ...planHealth({ adapters: [quietAdapter], runs: [], counts, now: NOW }), sourceStates: states, problemCount: 0, subject: 'Holler health: all sources OK' };
    const mail = renderHealthEmail(report);
    expect(mail.text).toContain('never returned a row');
    expect(mail.text).toContain('socrata-batonrouge-311');
    expect(mail.subject).toBe('Holler health: all sources OK');
  });
  it('an all healthy summary says so and lists nothing', () => {
    const states = summarizeSourceStates(
      computeSourceStates({
        adapters: [adapters[0]],
        health: [{ source: 'nws', last_success_at: ago(60_000), last_run_at: ago(60_000), consecutive_failures: 0 }],
        runs,
        now: NOW,
      }),
    );
    const report = { ...planHealth({ adapters: [adapters[0]], runs, counts, now: NOW }), sourceStates: states };
    const mail = renderHealthEmail(report);
    expect(mail.text).toContain('1 healthy, 0 delayed, 0 degraded, 0 unavailable, 0 not set up yet (of 1)');
    expect(mail.subject).toBe('Holler health: all sources OK');
  });
});

const hrow = (source: string, over: Record<string, unknown> = {}) => ({
  source, last_run_at: ago(60_000), last_success_at: ago(60_000), last_error: null, last_record_at: ago(H),
  rows_seen_last_run: 3, rows_new_last_run: 1, consecutive_failures: 0, status: 'healthy', updated_at: ago(60_000), ...over,
});

async function load(db: FakeDb) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('ADMIN_EMAIL', '');
  vi.stubEnv('SUPPORT_EMAIL', '');
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
  vi.doMock('next/cache', () => ({ cacheLife: () => undefined, cacheTag: () => undefined }));
  vi.doMock('@/lib/signals/registry', () => ({
    ALL_ADAPTERS: [
      { id: 'nws', label: 'NWS', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'x', fetch: async () => [] },
      { id: 'socrata-la-permits', label: 'LA', kind: 'permit', cadenceMinutes: 360, sourceUrl: 'x', fetch: async () => [] },
      { id: 'sam-gov', label: 'SAM', kind: 'contract', cadenceMinutes: 720, requiresEnv: ['SAM_API_KEY_NOT_SET_IN_TESTS'], sourceUrl: 'x', fetch: async () => [] },
    ],
  }));
  return {
    health: (await import('../../app/api/cron/health/route')).GET,
    sources: (await import('../../app/api/admin/sources/route')).GET,
    snapshot: (await import('@/lib/signals/source-state-snapshot')).loadSourceStateSnapshot,
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const req = (path: string) => new Request(`http://x.test${path}`, { headers: { authorization: 'Bearer s3cret' } });

describe('routes and snapshot', () => {
  const fresh = () => {
    const t = Date.now();
    const a = (ms: number) => new Date(t - ms).toISOString();
    return new FakeDb({
      holler_source_health: [hrow('nws', { last_success_at: a(60_000) }), hrow('socrata-la-permits', { last_success_at: a(2 * H), last_error: 'secret detail 555-0100' })],
      holler_scan_runs: [
        { id: 1, source: 'nws', started_at: a(60_000), fetched: 20, inserted: 0, error: null },
        { id: 2, source: 'socrata-la-permits', started_at: a(2 * H), fetched: 0, inserted: 0, error: null },
        { id: 3, source: 'socrata-la-permits', started_at: a(8 * H), fetched: 0, inserted: 0, error: null },
        { id: 4, source: 'socrata-la-permits', started_at: a(14 * H), fetched: 0, inserted: 0, error: null },
        ...Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, source: 'socrata-la-permits', started_at: a(20 * H + i * 6 * H), fetched: 16, inserted: 0, error: null })),
      ],
    });
  };

  it('/api/cron/health carries sourceStates and the report is still returned', async () => {
    const { health } = await load(fresh());
    const body = await (await health(req('/api/cron/health?dry=1'))).json();
    expect(body.sourceStates.counts).toEqual({ healthy: 1, delayed: 0, degraded: 1, unavailable: 0, not_set_up: 1 });
    expect(body.sourceStates.behind).toBe(1);
    expect(body.sourceStates.attention[0]).toMatchObject({ id: 'socrata-la-permits', state: 'degraded' });
  });

  it('/api/cron/health: sourceStates is null and the rest survives when the health table cannot be read', async () => {
    const db = fresh();
    db.failOn['holler_source_health.select'] = 'relation missing';
    const { health } = await load(db);
    const res = await health(req('/api/cron/health?dry=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sourceStates).toBeNull();
    expect(body.sourceHealth).toBeNull();
  });

  it('/api/admin/sources adds per-source states without removing the table', async () => {
    const { sources } = await load(fresh());
    const body = await (await sources(req('/api/admin/sources'))).json();
    expect(body.counts).toBeDefined();
    expect(body.states.counts.degraded).toBe(1);
    expect(body.states.sources.map((s: { id: string }) => s.id)).toEqual(['nws', 'socrata-la-permits', 'sam-gov']);
  });

  it('the member snapshot keeps only state and last success: no error text, no counts', async () => {
    const { snapshot } = await load(fresh());
    const snap = await snapshot();
    expect(snap).not.toBeNull();
    expect(Object.keys(snap!.states).sort()).toEqual(['nws', 'sam-gov', 'socrata-la-permits']);
    expect(snap!.states['socrata-la-permits'].state).toBe('degraded');
    expect(Object.keys(snap!.states.nws).sort()).toEqual(['lastRecordAt', 'reason', 'state']);
    expect(JSON.stringify(snap)).not.toMatch(/secret|555/);
  });

  it('the member snapshot is null when the read fails', async () => {
    const db = fresh();
    db.failOn['holler_scan_runs.select'] = 'boom';
    const { snapshot } = await load(db);
    expect(await snapshot()).toBeNull();
  });

  it('the member snapshot is null when the admin client is not configured', async () => {
    vi.resetModules();
    vi.doMock('next/cache', () => ({ cacheLife: () => undefined }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('no key'); } }));
    const { loadSourceStateSnapshot } = await import('@/lib/signals/source-state-snapshot');
    expect(await loadSourceStateSnapshot()).toBeNull();
  });
});
