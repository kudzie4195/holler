import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLocalBidSource, type PipelineDeps } from '@/lib/firecrawl/pipeline';
import { localSourceById } from '@/lib/firecrawl/local-sources';
import { resetRunSpend } from '@/lib/firecrawl/budget';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { FirecrawlError } from '@/lib/firecrawl/client';
import { FakeDb, fixtureScript, mockClient, okRobots } from './fakes';
import { NOW_LIVE } from './helpers';

const GW = localSourceById('bids-gwinnett')!;
const RK = localSourceById('bids-rockdale')!;
const BOTH = { HOLLER_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'fc-test-key-0000000000' };

beforeEach(() => {
  resetRunSpend();
  resetRobotsCache();
});

function deps(over: Partial<PipelineDeps> & { client: ReturnType<typeof mockClient> }): PipelineDeps {
  const { client, ...rest } = over;
  return { fetch: okRobots(), env: { ...BOTH }, now: NOW_LIVE, log: () => undefined, db: null, makeClient: () => client.client, ...rest };
}

describe('flag gating: either env missing means zero calls of any kind', () => {
  it.each([
    ['no flag', { FIRECRAWL_API_KEY: BOTH.FIRECRAWL_API_KEY }, 'flag_off'],
    ['flag off', { HOLLER_BIDS_ENABLED: '0', FIRECRAWL_API_KEY: BOTH.FIRECRAWL_API_KEY }, 'flag_off'],
    ['no key', { HOLLER_BIDS_ENABLED: '1' }, 'no_key'],
    ['blank key', { HOLLER_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: '  ' }, 'no_key'],
    ['neither', {}, 'flag_off'],
  ])('%s', async (_n, env, reason) => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const f = okRobots();
    const db = new FakeDb();
    const made = vi.fn(() => c.client);
    const r = await runLocalBidSource(GW, { fetch: f, env, now: NOW_LIVE, log: () => undefined, db: db as never, makeClient: made });
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe(reason);
    expect(c.calls).toHaveLength(0);
    expect(c.creditUsageCalls()).toBe(0);
    expect(made).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled(); // not even robots.txt
    expect(db.touched).toBe(0);
  });
});

describe('first run: check, then extract', () => {
  it('new page: 1 + 5 credits, the validated rows, one ledger row; the check carries a per-source change tag and no json, the extraction asks for the schema', async () => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'new'));
    const db = new FakeDb();
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(r.status).toBe('ok');
    expect(r.calls).toBe(2);
    expect(r.creditsEstimated).toBe(6);
    expect(r.kept).toHaveLength(5);
    expect(r.rowsExtracted).toBe(28);
    expect(c.calls[0].formats).toEqual(['markdown', { type: 'changeTracking', tag: 'holler-bids-gwinnett' }]);
    expect(c.calls[0].url).toBe(GW.listUrl);
    expect(c.calls[0].maxAgeMs).toBe(0); // the 2-day default cache must not hide today's page from the daily check
    expect(c.calls[1].maxAgeMs).toBe(600_000);
    const f1 = c.calls[1].formats;
    expect(f1[0]).toBe('markdown');
    expect(f1[1]).toMatchObject({ type: 'json' });
    expect(((f1[1] as unknown as { schema: { required: string[] } }).schema).required).toEqual(['solicitations']);
    expect(db.inserts).toEqual([expect.objectContaining({ source: '_fc:bids-gwinnett', fetched: 6, inserted: 5, matched: 23, error: 'extracted' })]);
  });

  it('unchanged page: 1 credit, no extraction, no rows', async () => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const db = new FakeDb();
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(r.status).toBe('unchanged');
    expect(r.creditsEstimated).toBe(1);
    expect(c.calls).toHaveLength(1);
    expect(r.kept).toEqual([]);
    expect(db.inserts[0]).toMatchObject({ source: '_fc:bids-gwinnett', fetched: 1, error: 'unchanged' });
  });

  it('a missing change status (the lookup timed out on their side) counts as changed, never as same', async () => {
    const s = fixtureScript('bids-rockdale', 'new');
    const c = mockClient({ ...s, scrape: (req, n) => ({ ...(s.scrape(req, n) as object), changeStatus: null }) });
    expect((await runLocalBidSource(RK, deps({ client: c }))).calls).toBe(2);
  });

  it('a removed page is an error, not an extraction', async () => {
    const c = mockClient({ remaining: 900, scrape: () => ({ markdown: '', changeStatus: 'removed' }) });
    const r = await runLocalBidSource(GW, deps({ client: c }));
    expect(r).toMatchObject({ status: 'error', reason: 'page_removed', calls: 1 });
  });
});

describe('lost work is retried, not forgotten', () => {
  it('an extraction that fails is recorded as pending; the next run goes straight to the extraction (no change check) even though the page now reads "same"', async () => {
    const db = new FakeDb();
    const failing = mockClient({
      remaining: 900,
      scrape: (req) => (req.formats.some((f) => typeof f === 'object' && f.type === 'json') ? new FirecrawlError('server_error', 503, 'down', true, 3) : { markdown: 'x', changeStatus: 'changed' }),
    });
    const r1 = await runLocalBidSource(GW, deps({ client: failing, db: db as never }));
    expect(r1).toMatchObject({ status: 'error', reason: 'extract_failed', error: { code: 'server_error', status: 503 } });
    expect(db.inserts.at(-1)).toMatchObject({ error: 'pending', fetched: 1 });

    resetRunSpend();
    const next = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const r2 = await runLocalBidSource(GW, deps({ client: next, db: db as never, now: new Date(NOW_LIVE.getTime() + 3600_000) }));
    expect(r2.status).toBe('ok');
    expect(next.calls).toHaveLength(1); // only the extraction
    expect(next.calls[0].formats.some((f) => typeof f === 'object' && f.type === 'json')).toBe(true);
    expect(r2.kept).toHaveLength(5);
  });

  it('rows handed to a scan that never stored them (no later scan_runs row) are extracted again', async () => {
    const db = new FakeDb();
    db.rows.push({ id: 1, source: '_fc:bids-gwinnett', started_at: '2026-11-22T10:00:00.000Z', finished_at: '2026-11-22T10:00:00.000Z', fetched: 6, inserted: 5, matched: 23, error: 'extracted' });
    const c = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(r.status).toBe('ok');
    expect(r.notes).toContain('last extraction was not stored; extracting again');
    expect(c.calls).toHaveLength(1);
  });

  it('once the scan has logged the source after the extraction, an unchanged page costs 1 credit and stops', async () => {
    const db = new FakeDb();
    db.rows.push({ id: 1, source: '_fc:bids-gwinnett', started_at: '2026-11-21T10:00:00.000Z', finished_at: '2026-11-21T10:00:00.000Z', fetched: 6, inserted: 5, matched: 23, error: 'extracted' });
    db.rows.push({ id: 2, source: 'bids-gwinnett', started_at: '2026-11-21T09:59:50.000Z', finished_at: '2026-11-21T10:00:20.000Z', fetched: 5, inserted: 5, matched: 0, error: null });
    const c = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(r.status).toBe('unchanged');
    expect(c.calls).toHaveLength(1);
  });

  it('a failed change check is recorded as failed and never as pending', async () => {
    const db = new FakeDb();
    const c = mockClient({ remaining: 900, scrape: () => new FirecrawlError('rate_limited', 429, 'busy', true, 3) });
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(r).toMatchObject({ status: 'error', reason: 'check_failed' });
    expect(db.inserts[0]).toMatchObject({ error: 'failed', fetched: 0 });
  });
});

describe('the budget stops the calls', () => {
  const ledgerRows = (credits: number, when = '2026-11-22T08:00:00.000Z') => [{ id: 1, source: '_fc:bids-tucker', started_at: when, finished_at: when, fetched: credits, inserted: 0, matched: 0, error: 'unchanged' }];

  it('daily cap: with 28 of 30 credits used today, a 1-credit check runs but a 5-credit extraction does not (state pending)', async () => {
    const db = new FakeDb();
    db.rows.push(...ledgerRows(28));
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(c.calls).toHaveLength(1);
    expect(r).toMatchObject({ status: 'skipped', reason: 'day_cap', creditsEstimated: 1 });
    expect(db.inserts.at(-1)).toMatchObject({ error: 'pending' });
  });

  it('daily cap reached: no call at all', async () => {
    const db = new FakeDb();
    db.rows.push(...ledgerRows(30));
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(c.calls).toHaveLength(0);
    expect(r.reason).toBe('day_cap');
  });

  it('monthly cap: 500 used this month stops the next call even on a new day', async () => {
    const db = new FakeDb();
    db.rows.push(...ledgerRows(500, '2026-11-03T08:00:00.000Z'));
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never }));
    expect(c.calls).toHaveLength(0);
    expect(r.reason).toBe('month_cap');
  });

  it('env caps tighten the budget: FIRECRAWL_DAILY_CREDIT_CAP=5 allows a check (1) but not check + extraction (6)', async () => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps({ client: c, db: new FakeDb() as never, env: { ...BOTH, FIRECRAWL_DAILY_CREDIT_CAP: '5' } }));
    expect(c.calls).toHaveLength(1);
    expect(r.reason).toBe('day_cap');
  });

  it('run cap is shared by every source in one run: with a cap of 6, the first source takes 6 and the second makes no call', async () => {
    const env = { ...BOTH, FIRECRAWL_RUN_CREDIT_CAP: '6' };
    const a = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const b = mockClient(fixtureScript('bids-rockdale', 'changed'));
    const r1 = await runLocalBidSource(GW, deps({ client: a, env }));
    const r2 = await runLocalBidSource(RK, deps({ client: b, env }));
    expect(r1.status).toBe('ok');
    expect(r1.creditsEstimated).toBe(6);
    expect(b.calls).toHaveLength(0);
    expect(r2.reason).toBe('run_cap');
  });

  it('a later run (a different clock) starts with a fresh run counter', async () => {
    const env = { ...BOTH, FIRECRAWL_RUN_CREDIT_CAP: '6' };
    await runLocalBidSource(GW, deps({ client: mockClient(fixtureScript('bids-gwinnett', 'changed')), env }));
    const b = mockClient(fixtureScript('bids-rockdale', 'changed'));
    const r = await runLocalBidSource(RK, deps({ client: b, env, now: new Date(NOW_LIVE.getTime() + 60_000) }));
    expect(r.status).toBe('ok');
  });

  it('balance floor: the account is never drawn below 100 remaining credits', async () => {
    const s = fixtureScript('bids-gwinnett', 'changed');
    const c = mockClient({ ...s, remaining: 104 });
    const r = await runLocalBidSource(GW, deps({ client: c }));
    expect(r).toMatchObject({ status: 'skipped', reason: 'low_balance' });
    expect(c.calls).toHaveLength(1); // the 1-credit check may run (104 -> 103); the 5-credit extraction may not (would leave 99)
    expect(c.calls.every((x) => !x.formats.some((f) => typeof f === 'object' && f.type === 'json'))).toBe(true);
  });

  it('an unreadable balance does not block (the caps still apply)', async () => {
    const s = fixtureScript('bids-gwinnett', 'changed');
    const c = mockClient({ ...s, remaining: undefined });
    expect((await runLocalBidSource(GW, deps({ client: c }))).status).toBe('ok');
  });

  it('a ledger that cannot be read fails closed: no call', async () => {
    const bad = { from: () => ({ select: () => ({ like: () => ({ gte: () => ({ order: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'down' } }) }) }) }) }) }) }) };
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps({ client: c, db: bad as never }));
    expect(r.reason).toBe('ledger_unreadable');
    expect(c.calls).toHaveLength(0);
  });
});

describe('robots.txt', () => {
  it('a disallowed page path means no Firecrawl call', async () => {
    const f = vi.fn(async () => new Response('User-agent: *\nDisallow: /departments/\n', { status: 200 })) as unknown as typeof fetch;
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps({ client: c, fetch: f }));
    expect(r.reason).toBe('robots_disallowed');
    expect(c.calls).toHaveLength(0);
    expect(c.creditUsageCalls()).toBe(0);
  });
  it('an unreachable robots.txt (5xx) means skip this run', async () => {
    const f = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    expect((await runLocalBidSource(GW, deps({ client: c, fetch: f }))).reason).toBe('robots_unreachable');
    expect(c.calls).toHaveLength(0);
  });
  it('no robots.txt (404) means allowed', async () => {
    const f = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    expect((await runLocalBidSource(GW, deps({ client: c, fetch: f }))).status).toBe('ok');
  });
});

describe('probe mode (dry + force)', () => {
  it('runs the extraction only, without the bids flag, writes nothing, and does not touch change tracking', async () => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const db = new FakeDb();
    const r = await runLocalBidSource(GW, deps({ client: c, db: db as never, dry: true, force: true, ignoreBidsFlag: true, env: { FIRECRAWL_API_KEY: BOTH.FIRECRAWL_API_KEY } }));
    expect(r.status).toBe('ok');
    expect(r.calls).toBe(1);
    expect(r.creditsEstimated).toBe(5);
    expect(c.calls[0].formats.some((f) => typeof f === 'object' && f.type === 'changeTracking')).toBe(false);
    expect(db.inserts).toEqual([]);
    expect(r.kept).toHaveLength(5);
    expect(r.dropped).toHaveLength(23);
  });
  it('still needs the key', async () => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const r = await runLocalBidSource(GW, deps({ client: c, dry: true, force: true, ignoreBidsFlag: true, env: {} }));
    expect(r.reason).toBe('no_key');
    expect(c.calls).toHaveLength(0);
  });
});
