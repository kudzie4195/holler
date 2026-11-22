import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapters, buildLocalBidAdapter, logLine, LOCAL_BIDS_CADENCE_MINUTES } from '@/lib/signals/adapters/bids-local';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { missingEnvFor } from '@/lib/signals/run';
import { LOCAL_BID_SOURCES, localSourceById } from '@/lib/firecrawl/local-sources';
import { BID_SOURCE_IDS, BIDS_FLAG, LOCAL_BIDS_FLAG } from '@/lib/signals/bid-sources';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { deadlineOf, labelFor } from '@/lib/signals/lead-rules';
import { resetRunSpend } from '@/lib/firecrawl/budget';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { FakeDb, fixtureScript, mockClient } from './fakes';
import { NOW_LIVE } from './helpers';

const IDS = ['bids-gwinnett', 'bids-rockdale', 'bids-tucker', 'bids-dunwoody'];

beforeEach(() => {
  resetRunSpend();
  resetRobotsCache();
});
afterEach(() => vi.unstubAllEnvs());

describe('registration under the bids-* pattern', () => {
  it('one adapter per agency, in the registry, daily, kind contract', () => {
    expect(adapters.map((a) => a.id)).toEqual(IDS);
    expect(LOCAL_BID_SOURCES.map((s) => s.id)).toEqual(IDS);
    for (const id of IDS) {
      const a = ALL_ADAPTERS.find((x) => x.id === id)!;
      expect(a, id).toBeTruthy();
      expect(a.kind).toBe('contract');
      expect(a.cadenceMinutes).toBe(LOCAL_BIDS_CADENCE_MINUTES);
      expect(a.cadenceMinutes).toBe(1440);
      expect(a.requiresEnv).toEqual(['FIRECRAWL_API_KEY']);
      expect(a.flag).toBe(BIDS_FLAG);
      expect(a.extraFlags?.map((f) => f.name)).toEqual([LOCAL_BIDS_FLAG]);
      expect(BID_SOURCE_IDS).toContain(id);
      expect(SOURCE_META[id], id).toMatchObject({ label: expect.any(String), sourceUrl: expect.stringMatching(/^https:\/\//) });
    }
  });
  it('ids are unique across the whole registry', () => {
    const ids = ALL_ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('labelled Act Now, with the due day as the deadline', () => {
    for (const id of IDS) {
      expect(labelFor({ source: id, categories: ['roofing'], data: { subtype: 'bid' } } as never, 'roofing' as never)).toBe('act_now');
      expect(deadlineOf({ source: id, expires_at: null, data: { dueDate: '2026-12-10' } } as never)).toMatch(/^2026-12-10/);
    }
  });
});

describe('all three switches are needed (missingEnvFor and the scan)', () => {
  const a = adapters[0];
  it('names every one that is missing', () => {
    vi.stubEnv(BIDS_FLAG, '');
    vi.stubEnv(LOCAL_BIDS_FLAG, '');
    expect(missingEnvFor(a, {})).toEqual(['FIRECRAWL_API_KEY', BIDS_FLAG, LOCAL_BIDS_FLAG]);
    expect(missingEnvFor(a, { FIRECRAWL_API_KEY: 'k' })).toEqual([BIDS_FLAG, LOCAL_BIDS_FLAG]);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(missingEnvFor(a, { FIRECRAWL_API_KEY: 'k' })).toEqual([LOCAL_BIDS_FLAG]); // city bids on + key set (Production): still off
    vi.stubEnv(LOCAL_BIDS_FLAG, '1');
    expect(missingEnvFor(a, {})).toEqual(['FIRECRAWL_API_KEY']);
    expect(missingEnvFor(a, { FIRECRAWL_API_KEY: 'k' })).toEqual([]);
  });
  it('turning on the city bids alone does not turn the Firecrawl feeds on, and the other bid feeds are unaffected', () => {
    vi.stubEnv(BIDS_FLAG, '1');
    vi.stubEnv(LOCAL_BIDS_FLAG, '');
    const sf = ALL_ADAPTERS.find((x) => x.id === 'bids-sf')!;
    expect(missingEnvFor(sf, {})).toEqual([]);
    for (const id of IDS) expect(missingEnvFor(ALL_ADAPTERS.find((x) => x.id === id)!, { FIRECRAWL_API_KEY: 'k' })).toEqual([LOCAL_BIDS_FLAG]);
  });
  it.each([
    ['bids flag missing', '', '1', 'fc-test-key-0000000000', [BIDS_FLAG]],
    ['local flag missing (the Production case)', '1', '', 'fc-test-key-0000000000', [LOCAL_BIDS_FLAG]],
    ['key missing', '1', '1', '', ['FIRECRAWL_API_KEY']],
  ])('runScan skips all four with no network call at all: %s', async (_n, flag, local, key, missing) => {
    vi.stubEnv(BIDS_FLAG, flag);
    vi.stubEnv(LOCAL_BIDS_FLAG, local);
    vi.stubEnv('FIRECRAWL_API_KEY', key);
    vi.resetModules();
    const run = await import('@/lib/signals/run');
    const f = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const mod = await import('@/lib/signals/adapters/bids-local');
    const report = await run.runScan({ fetchImpl: f, adapters: mod.adapters, dry: true }, null);
    for (const id of IDS) {
      const s = report.sources.find((x) => x.id === id)!;
      expect(s.status).toBe('skipped(env)');
      expect(s.missingEnv).toEqual(missing);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('fetch() called directly (bypassing the scan) with any one missing makes no robots, Firecrawl or database call', async () => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const f = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const db = new FakeDb();
    const ad = buildLocalBidAdapter(localSourceById('bids-gwinnett')!, { makeClient: () => c.client });
    vi.stubEnv(BIDS_FLAG, '');
    vi.stubEnv(LOCAL_BIDS_FLAG, '');
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    const K = 'fc-test-key-0000000000';
    for (const e of [{}, { [BIDS_FLAG]: '1' }, { [LOCAL_BIDS_FLAG]: '1' }, { FIRECRAWL_API_KEY: K }, { [BIDS_FLAG]: '1', [LOCAL_BIDS_FLAG]: '1' }, { [BIDS_FLAG]: '1', FIRECRAWL_API_KEY: K }, { [LOCAL_BIDS_FLAG]: '1', FIRECRAWL_API_KEY: K }]) {
      const out = await ad.fetch({ since: new Date(0), now: NOW_LIVE, fetch: f, env: e, log: () => undefined, db: db as never } as never);
      expect(out).toEqual([]);
    }
    expect(c.calls).toHaveLength(0);
    expect(c.creditUsageCalls()).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(db.touched).toBe(0);
  });
  it('a DRY scan with all three set makes no call either (no baseline move, no spend): fetch() and runScan', async () => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const f = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const db = new FakeDb();
    const ad = buildLocalBidAdapter(localSourceById('bids-gwinnett')!, { makeClient: () => c.client });
    const env = { [BIDS_FLAG]: '1', [LOCAL_BIDS_FLAG]: '1', FIRECRAWL_API_KEY: 'fc-test-key-0000000000' };
    const logs: string[] = [];
    expect(await ad.fetch({ since: new Date(0), now: NOW_LIVE, fetch: f, env, log: (m: string) => logs.push(m), db: null, dry: true } as never)).toEqual([]);
    expect(await ad.fetch({ since: new Date(0), now: NOW_LIVE, fetch: f, env, log: () => undefined, db: db as never, dry: true } as never)).toEqual([]);
    expect(c.calls).toHaveLength(0);
    expect(c.creditUsageCalls()).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(db.touched).toBe(0);
    expect(logs[0]).toContain('dry_run');
    expect(logs[0].startsWith('error:')).toBe(false);
  });
});

describe('fetch() with all three set', () => {
  it('returns the validated signals, all Act Now bids, no invented coordinates, and logs one line without the key', async () => {
    const key = 'fc-test-key-0000000000';
    const c = mockClient(fixtureScript('bids-gwinnett', 'new'));
    const logs: string[] = [];
    const f = vi.fn(async () => new Response('User-agent: *\nDisallow: /admin', { status: 200 })) as unknown as typeof fetch;
    const ad = buildLocalBidAdapter(localSourceById('bids-gwinnett')!, { makeClient: () => c.client });
    const out = await ad.fetch({ since: new Date(0), now: NOW_LIVE, fetch: f, env: { [BIDS_FLAG]: '1', [LOCAL_BIDS_FLAG]: '1', FIRECRAWL_API_KEY: key }, log: (m: string) => logs.push(m), db: new FakeDb() as never } as never);
    expect(out).toHaveLength(7);
    for (const s of out) {
      expect(s.source).toBe('bids-gwinnett');
      expect(s.kind).toBe('contract');
      expect(s.data).toMatchObject({ subtype: 'bid', via: 'firecrawl' });
      expect(s.expiresAt && Date.parse(s.expiresAt)).toBeGreaterThan(NOW_LIVE.getTime());
      expect(s.url).toMatch(/^https:\/\/(www\.)?gwinnettcounty\.com\//);
      expect(s.data?.loc).toBe('approx');
    }
    expect(logs.join('\n')).not.toContain(key);
    expect(logs).toHaveLength(1);
    expect(logs[0].startsWith('error:')).toBe(false);
  });
  it('a client that throws is logged as an error line without its message and yields no rows', async () => {
    const logs: string[] = [];
    const ad = buildLocalBidAdapter(localSourceById('bids-gwinnett')!, { makeClient: () => { throw new Error('secret-ish detail fc-abc'); } });
    const out = await ad.fetch({ since: new Date(0), now: NOW_LIVE, fetch: vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch, env: { [BIDS_FLAG]: '1', [LOCAL_BIDS_FLAG]: '1', FIRECRAWL_API_KEY: 'fc-test-key-0000000000' }, log: (m: string) => logs.push(m), db: null } as never);
    expect(out).toEqual([]);
    expect(logs[0].startsWith('error:')).toBe(true);
    expect(logs.join()).not.toContain('secret-ish');
  });
  it('logLine words each outcome without the banned phrases', () => {
    const src = localSourceById('bids-rockdale')!;
    const base = { source: src.id, reason: null, calls: 2, creditsEstimated: 6, creditsReported: null, changeStatus: null, rowsExtracted: 3, kept: [], dropped: [{ title: 't', reason: 'past_due' }], error: null, notes: [] } as never;
    const lines = [
      logLine(src, { ...(base as object), status: 'ok' } as never),
      logLine(src, { ...(base as object), status: 'unchanged', creditsEstimated: 1 } as never),
      logLine(src, { ...(base as object), status: 'skipped', reason: 'day_cap' } as never),
      logLine(src, { ...(base as object), status: 'error', reason: 'check_failed', error: { code: 'rate_limited', status: 429 } } as never),
    ];
    expect(lines[0]).toContain('1 past_due');
    expect(lines[1]).toContain('1 credit');
    expect(lines[3]).toBe('error: bids-rockdale: check_failed (rate_limited 429)');
    expect(lines.join('\n')).not.toMatch(/\blead|guarantee|official record/i);
  });
});
