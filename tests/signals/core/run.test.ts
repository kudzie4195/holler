import { describe, expect, it } from 'vitest';
import { isDue, missingEnvFor, normalizeSignals, placeSlugFor, runScan } from '@/lib/signals/run';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const sig = (over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'fake',
  externalId: 'a',
  kind: 'alert',
  title: 'Hail near Marietta',
  categories: ['roofing'],
  severity: 2,
  occurredAt: '2026-11-16T12:00:00Z',
  lat: 33.953,
  lon: -84.55,
  ...over,
});

const adapter = (over: Partial<Adapter> = {}): Adapter => ({
  id: 'fake',
  label: 'Fake',
  kind: 'alert',
  cadenceMinutes: 15,
  sourceUrl: 'https://example.com',
  fetch: async () => [sig(), sig({ externalId: 'b', title: 'Second' }), sig({ externalId: 'c', title: 'Third' }), sig({ externalId: 'd', title: 'Fourth' })],
  ...over,
});

describe('cadence', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('is due when never run, or when cadence has elapsed (with slack)', () => {
    const a = adapter({ cadenceMinutes: 15 });
    expect(isDue(a, undefined, now)).toBe(true);
    expect(isDue(a, now - 5 * 60_000, now)).toBe(false);
    expect(isDue(a, now - 14.5 * 60_000, now)).toBe(true); // 60 s cron jitter slack
    expect(isDue(a, now - 20 * 60_000, now)).toBe(true);
  });
});

describe('normalizeSignals', () => {
  const a = adapter();
  it('drops malformed rows and duplicate ids, clamps severity, filters unknown categories', () => {
    const out = normalizeSignals(a, [
      sig(),
      sig(), // duplicate
      sig({ externalId: 'x', title: '  ' }),
      sig({ externalId: 'y', occurredAt: 'not a date' }),
      sig({ externalId: 'z', severity: 9 as never, categories: ['roofing', 'bogus' as never], state: 'ga', lat: 200 }),
    ]);
    expect(out.map((s) => s.externalId)).toEqual(['a', 'z']);
    const z = out[1];
    expect(z.severity).toBe(3);
    expect(z.categories).toEqual(['roofing']);
    expect(z.state).toBe('GA');
    expect(z.lat).toBeNull();
    expect(z.lon).toBeNull();
  });
});

describe('placeSlugFor', () => {
  it('uses nearest city for coordinates, null when none within 40 mi', () => {
    expect(placeSlugFor(sig())).toBe('marietta-ga');
    expect(placeSlugFor(sig({ lat: 47.0, lon: -109.0 }))).toBeNull(); // central Montana
  });
  it('resolves city+state when there are no coordinates', () => {
    expect(placeSlugFor(sig({ lat: null, lon: null, city: 'Atlanta', state: 'GA' }))).toBe('atlanta-ga');
    expect(placeSlugFor(sig({ lat: null, lon: null }))).toBeNull();
  });
});

describe('env gating', () => {
  it('reports missing env keys', () => {
    expect(missingEnvFor(adapter({ requiresEnv: ['SAM_API_KEY'] }), {})).toEqual(['SAM_API_KEY']);
    expect(missingEnvFor(adapter({ requiresEnv: ['SAM_API_KEY'] }), { SAM_API_KEY: 'x' })).toEqual([]);
    expect(missingEnvFor(adapter(), {})).toEqual([]);
  });
});

describe('runScan dry run', () => {
  it('reports ok with counts and 3 samples', async () => {
    const r = await runScan({ dry: true, adapters: [adapter()] });
    expect(r.dry).toBe(true);
    expect(r.sources).toHaveLength(1);
    const s = r.sources[0];
    expect(s.status).toBe('ok');
    expect(s.fetched).toBe(4);
    expect(s.samples).toEqual(['Hail near Marietta', 'Second', 'Third']);
    expect(r.totals.fetched).toBe(4);
  });

  it('dry mode reports latestOccurredAt per source (null when quiet) and passes the run clock to adapters', async () => {
    const stale = adapter({ id: 'stale', fetch: async () => [sig({ occurredAt: '2026-11-01T00:00:00Z' }), sig({ externalId: 'z', occurredAt: '2026-11-03T05:00:00Z' })] });
    const quiet = adapter({ id: 'quiet', fetch: async () => [] });
    let seenNow: Date | undefined;
    const clock = adapter({ id: 'clock', fetch: async (ctx) => { seenNow = ctx.now; return []; } });
    const now = new Date('2026-11-16T15:00:00Z');
    const r = await runScan({ dry: true, now, adapters: [stale, quiet, clock] });
    const by = Object.fromEntries(r.sources.map((x) => [x.id, x]));
    expect(by.stale.latestOccurredAt).toBe('2026-11-03T05:00:00.000Z');
    expect(by.quiet.latestOccurredAt).toBeNull();
    expect(seenNow?.toISOString()).toBe(now.toISOString());
  });

  it('normalizes full state names and drops non-http urls', () => {
    const [a, b] = normalizeSignals(adapter(), [sig({ state: 'Georgia', url: 'javascript:alert(1)' }), sig({ externalId: 'q', state: 'ga', url: 'https://example.gov/x' })]);
    expect(a.state).toBe('GA');
    expect(a.url).toBeNull();
    expect(b.state).toBe('GA');
    expect(b.url).toBe('https://example.gov/x');
  });

  it('reports skipped(env) for adapters whose env is missing, without fetching', async () => {
    let called = false;
    const a = adapter({ id: 'needskey', requiresEnv: ['SAM_API_KEY'], fetch: async () => { called = true; return []; } });
    const r = await runScan({ dry: true, adapters: [a] });
    expect(r.sources[0].status).toBe('skipped(env)');
    expect(r.sources[0].missingEnv).toEqual(['SAM_API_KEY']);
    expect(called).toBe(false);
  });

  it('reports error when an adapter throws, and when it returns [] with an error log (broken vs quiet)', async () => {
    const thrower = adapter({ id: 'thrower', fetch: async () => { throw new Error('boom'); } });
    const swallowed = adapter({ id: 'swallowed', fetch: async (ctx) => { ctx.log('error: swallowed fetch failed: HTTP 503'); return []; } });
    const quiet = adapter({ id: 'quiet', fetch: async (ctx) => { ctx.log('nothing new'); return []; } });
    const r = await runScan({ dry: true, adapters: [thrower, swallowed, quiet] });
    const by = Object.fromEntries(r.sources.map((s) => [s.id, s]));
    expect(by.thrower.status).toBe('error');
    expect(by.thrower.error).toContain('boom');
    expect(by.swallowed.status).toBe('error');
    expect(by.swallowed.error).toContain('503');
    expect(by.quiet.status).toBe('ok');
    expect(by.quiet.fetched).toBe(0);
  });

  it('times out slow adapters without blocking the others', async () => {
    const slow = adapter({ id: 'slow', fetch: () => new Promise(() => {}) });
    const r = await runScan({ dry: true, adapters: [slow, adapter({ id: 'fast' })], adapterTimeoutMs: 50 });
    const by = Object.fromEntries(r.sources.map((s) => [s.id, s]));
    expect(by.slow.status).toBe('error');
    expect(by.slow.error).toMatch(/timeout/);
    expect(by.fast.status).toBe('ok');
  });

  it('?source= filters, and unknown source is an error', async () => {
    const r = await runScan({ dry: true, source: 'b', adapters: [adapter({ id: 'a' }), adapter({ id: 'b' })] });
    expect(r.sources.map((s) => s.id)).toEqual(['b']);
    const u = await runScan({ dry: true, source: 'nope', adapters: [adapter()] });
    expect(u.error).toMatch(/unknown source/);
  });

  it('non-dry run without a db refuses rather than silently doing nothing', async () => {
    const r = await runScan({ adapters: [adapter()] }, null);
    expect(r.error).toBeTruthy();
    expect(r.sources).toEqual([]);
  });
});
