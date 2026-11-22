/**
 * Round 16 review fixes (review-FC.md). Each block is a permanent version of a reproducing attack from the review: it passed on the
 * reviewed head 6d4c8b8 only by confirming the defect, and it passes now because the defect is fixed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLocalBidSource, type PipelineDeps } from '@/lib/firecrawl/pipeline';
import { localSourceById } from '@/lib/firecrawl/local-sources';
import { resetRunSpend } from '@/lib/firecrawl/budget';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { createFirecrawlClient, FirecrawlError, resetFirecrawlGate } from '@/lib/firecrawl/client';
import { dayAppearsOn, rowsFromJson, validateRows } from '@/lib/firecrawl/extract';
import { monthWindowStart, rowsWereStored } from '@/lib/firecrawl/ledger';
import { bidTrades } from '@/lib/signals/bid-trades';
import { bidSourceLinkLabel, BID_LIST_LINK_LABEL, BID_PORTAL_LINK_LABEL, BID_SOURCE_LINK_LABEL } from '@/lib/signals/bid-card';
import { FakeDb, fixtureScript, mockClient, okRobots } from './fakes';
import { extracted, NOW_LIVE, NOW_DUNWOODY_SNAPSHOT, NOW_TUCKER_SNAPSHOT, pageMd } from './helpers';

const GW = localSourceById('bids-gwinnett')!;
const RK = localSourceById('bids-rockdale')!;
const ALL = { HOLLER_BIDS_ENABLED: '1', HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'fc-test-key-0000000000000000' };
const KEY = 'fc-abcdefabcdefabcdef';
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers });
const OKBODY = { success: true, data: { markdown: 'x' } };

beforeEach(() => {
  resetRunSpend();
  resetRobotsCache();
  resetFirecrawlGate();
});

function deps(client: ReturnType<typeof mockClient>, over: Partial<PipelineDeps> = {}): PipelineDeps {
  return { fetch: okRobots(), env: { ...ALL }, now: NOW_LIVE, log: () => undefined, db: null, makeClient: () => client.client, ...over };
}
const isJson = (f: unknown) => typeof f === 'object' && f !== null && (f as { type?: string }).type === 'json';
const isTrack = (f: unknown) => typeof f === 'object' && f !== null && (f as { type?: string }).type === 'changeTracking';

describe('P1-1: a dry scan (?dry=1) never calls Firecrawl', () => {
  it('db null (what runScan passes on a dry scan): no robots fetch, no credit-usage, no check, no extraction, zero credits', async () => {
    const m = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const f = okRobots();
    const r = await runLocalBidSource(GW, deps(m, { fetch: f, db: null, dry: true }));
    expect(r).toMatchObject({ status: 'skipped', reason: 'dry_run', calls: 0, creditsEstimated: 0 });
    expect(m.calls).toHaveLength(0);
    expect(m.creditUsageCalls()).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(m.calls.filter((c) => c.formats.some(isTrack))).toHaveLength(0); // the change baseline is not moved
  });
  it('with a database too: no read, no write', async () => {
    const m = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const db = new FakeDb();
    const r = await runLocalBidSource(GW, deps(m, { db: db as never, dry: true }));
    expect(r.reason).toBe('dry_run');
    expect(db.touched).toBe(0);
    expect(m.calls).toHaveLength(0);
  });
  it('the same run without dry does spend (so the guard is the thing that stops it)', async () => {
    const m = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps(m, { db: new FakeDb() as never }));
    expect(r.calls).toBe(2);
  });
});

describe('P1-2: rows are re-extracted unless the scan really stored them', () => {
  const t = new Date(NOW_LIVE.getTime() - 86_400_000);
  const ledgerRow = { id: 1, source: '_fc:bids-gwinnett', started_at: t.toISOString(), finished_at: t.toISOString(), fetched: 6, inserted: 7, matched: 21, error: 'extracted' };
  const scanRow = (over: Record<string, unknown>) => ({ id: 2, source: 'bids-gwinnett', started_at: t.toISOString(), finished_at: new Date(t.getTime() + 45_000).toISOString(), fetched: 7, inserted: 7, matched: 0, error: null, ...over });
  async function nextRun(rows: Array<Record<string, unknown>>) {
    const db = new FakeDb();
    db.rows.push(ledgerRow, ...rows);
    const m = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const r = await runLocalBidSource(GW, deps(m, { db: db as never }));
    return { r, m };
  }
  it('a scan row with error "timeout" (the adapter was cut at 40 s) means the rows were lost: extract again', async () => {
    const { r, m } = await nextRun([scanRow({ fetched: 0, inserted: 0, error: 'timeout' })]);
    expect(r.status).toBe('ok');
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].formats.some(isJson)).toBe(true);
  });
  it('a scan row with an insert error means the rows were lost: extract again', async () => {
    const { r } = await nextRun([scanRow({ error: 'insert failed: connection reset' })]);
    expect(r.status).toBe('ok');
    expect(r.notes).toContain('last extraction was not stored; extracting again');
  });
  it('a scan row that saw fewer rows than the extraction kept means they were lost: extract again', async () => {
    expect((await nextRun([scanRow({ fetched: 3 })])).r.status).toBe('ok');
    expect((await nextRun([scanRow({ fetched: 0 })])).r.status).toBe('ok');
  });
  it('no scan row after the extraction (the deadline skipped the write): extract again', async () => {
    expect((await nextRun([scanRow({ finished_at: new Date(t.getTime() - 1000).toISOString() })])).r.status).toBe('ok');
    expect((await nextRun([])).r.status).toBe('ok');
  });
  it('a clean scan row after the extraction (no error, enough rows): the rows are stored, so an unchanged page costs 1 credit', async () => {
    const { r, m } = await nextRun([scanRow({})]);
    expect(r.status).toBe('unchanged');
    expect(m.calls).toHaveLength(1);
  });
  it('rowsWereStored: the pure rule', () => {
    const at = '2026-11-21T10:00:00.000Z';
    const ok = { finishedMs: Date.parse(at) + 1000, error: null, fetched: 5 };
    expect(rowsWereStored(ok, at, 5)).toBe(true);
    expect(rowsWereStored(null, at, 5)).toBe(false);
    expect(rowsWereStored({ ...ok, error: 'timeout' }, at, 5)).toBe(false);
    expect(rowsWereStored({ ...ok, fetched: 4 }, at, 5)).toBe(false);
    expect(rowsWereStored({ ...ok, finishedMs: Date.parse(at) - 1 }, at, 5)).toBe(false);
    expect(rowsWereStored({ ...ok, fetched: 0 }, at, 0)).toBe(true); // an extraction that kept nothing has nothing to lose
  });
});

describe('P1-3: slot wait counts against the deadline; nothing runs past the budget', () => {
  const slow = (ms: number) =>
    (async (_u: string, init?: RequestInit) => {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, ms);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        });
      });
      return json(OKBODY);
    }) as unknown as typeof fetch;

  it('three calls queued on one slot: none finishes after its deadline, and the one that cannot fit is refused without a request', async () => {
    const f = vi.fn(slow(600));
    const c = createFirecrawlClient({ apiKey: KEY, fetchImpl: f as unknown as typeof fetch, concurrency: 1, maxAttempts: 1 });
    const t0 = Date.now();
    const deadline = t0 + 1300;
    const settled = await Promise.allSettled([0, 1, 2].map(() => c.scrape({ url: 'https://x.example', formats: ['markdown'], timeoutMs: 1000, deadlineMs: deadline }).finally(() => Date.now() - t0)).map((p) => p.then((v) => ({ v, at: Date.now() - t0 }), (e) => Promise.reject({ e, at: Date.now() - t0 }))));
    const ends = settled.map((s) => (s.status === 'fulfilled' ? s.value.at : (s.reason as { at: number }).at));
    expect(Math.max(...ends)).toBeLessThan(1300 + 150);
    const refused = settled.filter((s) => s.status === 'rejected').map((s) => ((s as PromiseRejectedResult).reason as { e: FirecrawlError }).e);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ code: 'timeout' });
    expect(f).toHaveBeenCalledTimes(2); // the third request was never sent
  });
  it('an in-flight call is aborted at the deadline, and the error says its credits may have been billed', async () => {
    const c = createFirecrawlClient({ apiKey: KEY, fetchImpl: slow(5000), maxAttempts: 1 });
    const t0 = Date.now();
    const err = await c.scrape({ url: 'https://x.example', formats: ['markdown', { type: 'json', schema: {} }], timeoutMs: 20_000, deadlineMs: t0 + 700 }).catch((e) => e as FirecrawlError);
    expect(Date.now() - t0).toBeLessThan(1200);
    expect(err).toBeInstanceOf(FirecrawlError);
    expect(err).toMatchObject({ code: 'timeout', creditsBilled: 5 });
  });
  it('pipeline: a call aborted at the budget is recorded as spend (and the extraction stays pending)', async () => {
    const db = new FakeDb();
    const aborted = new FirecrawlError('timeout', null, 'the Firecrawl request timed out', true, 1);
    aborted.creditsBilled = 5;
    const m = mockClient({ remaining: 900, scrape: (req) => (req.formats.some(isJson) ? aborted : { markdown: 'x', changeStatus: 'changed' }) });
    const r = await runLocalBidSource(GW, deps(m, { db: db as never }));
    expect(r).toMatchObject({ status: 'error', reason: 'extract_failed', creditsEstimated: 6 });
    expect(db.inserts.at(-1)).toMatchObject({ fetched: 6, error: 'pending' });
  });
  it('pipeline: no call starts when too little of the budget is left', async () => {
    const m = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    let t = 1_000_000;
    const r = await runLocalBidSource(GW, deps(m, { budgetMs: 4000, clock: () => (t += 0) }));
    expect(r.reason).toBe('no_time');
    expect(m.calls).toHaveLength(0);
  });
});

describe('P2: Retry-After is honoured up to the remaining budget', () => {
  const run = async (retryAfter: string, deadlineIn: number | undefined) => {
    const waits: number[] = [];
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? json({ success: false, error: 'Rate limit exceeded' }, 429, { 'retry-after': retryAfter }) : json(OKBODY))) as unknown as typeof fetch;
    let now = 1_000_000;
    const c = createFirecrawlClient({ apiKey: KEY, fetchImpl: f, sleep: async (ms) => { waits.push(ms); now += ms; }, random: () => 0.5, now: () => now });
    const p = c.scrape({ url: 'https://x.example', formats: ['markdown'], deadlineMs: deadlineIn === undefined ? undefined : now + deadlineIn }).then(() => null, (e) => e as FirecrawlError);
    return { err: await p, waits, calls: (f as unknown as { mock: { calls: unknown[] } }).mock.calls.length };
  };
  it('a 60 s Retry-After inside a 120 s budget is waited in full, then retried', async () => {
    const r = await run('60', 120_000);
    expect(r.waits).toEqual([60_000]);
    expect(r.err).toBeNull();
  });
  it('a Retry-After longer than the budget left stops at once with rate_limited: no early retry', async () => {
    const r = await run('60', 30_000);
    expect(r.waits).toEqual([]);
    expect(r.calls).toBe(1);
    expect(r.err).toMatchObject({ code: 'rate_limited', status: 429 });
  });
  it('a short Retry-After is still honoured (never shorter than asked)', async () => {
    const r = await run('5', 30_000);
    expect(r.waits).toEqual([5000]);
  });
});

describe('P2: billed-but-failed calls are recorded', () => {
  it('a target 404 page is billed 1 credit by Firecrawl: the ledger records 1, not 0', async () => {
    const db = new FakeDb();
    const e = new FirecrawlError('target_error', 404, 'x', false, 1);
    e.creditsBilled = 1;
    const m = mockClient({ remaining: 900, scrape: () => e });
    const r = await runLocalBidSource(GW, deps(m, { db: db as never }));
    expect(r.reason).toBe('check_failed');
    expect(r.creditsEstimated).toBe(1);
    expect(db.inserts[0]).toMatchObject({ fetched: 1, error: 'failed' });
  });
  it('the client marks a target 404 as billed 1 credit', async () => {
    const f = vi.fn(async () => json({ success: true, data: { markdown: '', metadata: { statusCode: 404 } } })) as unknown as typeof fetch;
    const c = createFirecrawlClient({ apiKey: KEY, fetchImpl: f });
    expect(await c.scrape({ url: 'https://x.example', formats: ['markdown'] }).catch((e) => e)).toMatchObject({ code: 'target_error', creditsBilled: 1 });
  });
  it('a 429 or 5xx (no document) is not billed', async () => {
    const f = vi.fn(async () => json({ success: false, error: 'down' }, 503)) as unknown as typeof fetch;
    const c = createFirecrawlClient({ apiKey: KEY, fetchImpl: f, maxAttempts: 1 });
    expect(await c.scrape({ url: 'https://x.example', formats: ['markdown'] }).catch((e) => e)).toMatchObject({ code: 'server_error', creditsBilled: 0 });
  });
  it('the run cap counts the failed call too: a billed failure leaves less for the next source', async () => {
    const e = new FirecrawlError('target_error', 404, 'x', false, 1);
    e.creditsBilled = 1;
    const env = { ...ALL, FIRECRAWL_RUN_CREDIT_CAP: '1' };
    await runLocalBidSource(GW, deps(mockClient({ remaining: 900, scrape: () => e }), { env }));
    const b = mockClient(fixtureScript('bids-rockdale', 'changed'));
    expect((await runLocalBidSource(RK, deps(b, { env }))).reason).toBe('run_cap');
    expect(b.calls).toHaveLength(0);
  });
});

describe('P2: probe spend is on the books and has its own daily cap', () => {
  const PROBE_ENV = { FIRECRAWL_API_KEY: ALL.FIRECRAWL_API_KEY };
  const probe = (m: ReturnType<typeof mockClient>, db: FakeDb, at: number, env: Record<string, string> = PROBE_ENV) =>
    runLocalBidSource(GW, deps(m, { db: db as never, dry: true, force: true, ignoreBidsFlag: true, env, now: new Date(NOW_LIVE.getTime() + at) }));

  it('five probes (25 credits) pass, the sixth is stopped by the probe cap; no signal is ever written', async () => {
    const db = new FakeDb();
    const m = mockClient(fixtureScript('bids-gwinnett', 'same'));
    for (let i = 0; i < 5; i++) expect((await probe(m, db, i * 1000)).status).toBe('ok');
    const sixth = await probe(m, db, 6000);
    expect(sixth).toMatchObject({ status: 'skipped', reason: 'probe_cap' });
    expect(m.calls).toHaveLength(5);
    expect(db.inserts.every((r) => r.source === '_fc:probe:bids-gwinnett' && r.error === 'probe')).toBe(true);
  });
  it('FIRECRAWL_PROBE_DAILY_CAP tightens it', async () => {
    const db = new FakeDb();
    const m = mockClient(fixtureScript('bids-gwinnett', 'same'));
    expect((await probe(m, db, 0, { ...PROBE_ENV, FIRECRAWL_PROBE_DAILY_CAP: '5' })).status).toBe('ok');
    expect((await probe(m, db, 1000, { ...PROBE_ENV, FIRECRAWL_PROBE_DAILY_CAP: '5' })).reason).toBe('probe_cap');
  });
  it('probe credits count toward the daily cap of the scheduled runs', async () => {
    const db = new FakeDb();
    const m = mockClient(fixtureScript('bids-gwinnett', 'same'));
    for (let i = 0; i < 5; i++) await probe(m, db, i * 1000); // 25 credits today
    const sched = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps(sched, { db: db as never, now: new Date(NOW_LIVE.getTime() + 60_000) }));
    expect(sched.calls).toHaveLength(1); // the 1-credit check fits (26 of 30), the 5-credit extraction does not (31)
    expect(r.reason).toBe('day_cap');
  });
  it('a probe row never reads as the source\'s state: it neither forces an extraction nor hides a pending one', async () => {
    const t = new Date(NOW_LIVE.getTime() - 3600_000).toISOString();
    const db = new FakeDb();
    db.rows.push({ id: 1, source: '_fc:bids-gwinnett', started_at: t, finished_at: t, fetched: 6, inserted: 7, matched: 0, error: 'extracted' });
    db.rows.push({ id: 2, source: 'bids-gwinnett', started_at: t, finished_at: new Date(Date.parse(t) + 30_000).toISOString(), fetched: 7, inserted: 7, matched: 0, error: null });
    await probe(mockClient(fixtureScript('bids-gwinnett', 'same')), db, 0);
    const m = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const r = await runLocalBidSource(GW, deps(m, { db: db as never, now: new Date(NOW_LIVE.getTime() + 120_000) }));
    expect(r.status).toBe('unchanged');
  });
});

describe('P2: the month cap follows the billing cycle', () => {
  const row = (at: string, credits: number) => ({ id: Math.random(), source: '_fc:bids-tucker', started_at: at, finished_at: at, fetched: credits, inserted: 0, matched: 0, error: 'unchanged' });
  it('monthWindowStart: the cycle start when sane, else the UTC calendar month', () => {
    const now = new Date('2026-11-22T17:00:00Z');
    expect(monthWindowStart(now, '2026-11-15T00:00:00Z')).toBe(Date.parse('2026-11-15T00:00:00Z'));
    expect(monthWindowStart(now, null)).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(monthWindowStart(now, 'junk')).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(monthWindowStart(now, '2026-12-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z')); // in the future
    expect(monthWindowStart(now, '2026-08-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z')); // older than 40 days
  });
  it('credits spent before the cycle start are not counted: a cycle that began Nov 15 sees 15 + 6, not 480 + 15 + 6', async () => {
    const db = new FakeDb();
    db.rows.push(row('2026-11-10T08:00:00.000Z', 480), row('2026-11-20T08:00:00.000Z', 15));
    const m = mockClient({ ...fixtureScript('bids-gwinnett', 'changed'), billingStart: '2026-11-15T00:00:00Z' });
    const r = await runLocalBidSource(GW, deps(m, { db: db as never, env: { ...ALL, FIRECRAWL_DAILY_CREDIT_CAP: '100' } }));
    expect(r.status).toBe('ok');
  });
  it('without a cycle start the calendar month is used: the same rows stop the extraction at 495 + 5 > 500', async () => {
    const db = new FakeDb();
    db.rows.push(row('2026-11-10T08:00:00.000Z', 480), row('2026-11-20T08:00:00.000Z', 15));
    const m = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const r = await runLocalBidSource(GW, deps(m, { db: db as never, env: { ...ALL, FIRECRAWL_DAILY_CREDIT_CAP: '100' } }));
    expect(r.reason).toBe('month_cap');
  });
});

describe('P2: the extracted due date must be printed on the page', () => {
  it('a date the page never shows is dropped (the model "corrected" a printed typo)', () => {
    const page = 'Lime Building Roof Replacement at Yellow River Water Reclamation Facility BL137-26 NOT Opening Date 2026-12-17';
    const row = { title: 'Lime Building Roof Replacement at Yellow River Water Reclamation Facility', solicitationNumber: 'BL137-26 NOT', dueDate: '2027-03-01T15:00', detailUrl: 'https://www.gwinnettcounty.com/static/upload/bid/1/a.pdf', status: 'open' };
    const v = validateRows([row], GW, { now: NOW_LIVE, markdown: page });
    expect(v.items).toEqual([]);
    expect(v.dropped[0].reason).toBe('due_not_on_page');
    expect(validateRows([{ ...row, dueDate: '2026-12-17T15:00' }], GW, { now: NOW_LIVE, markdown: page }).items[0].data).toMatchObject({ dueOnPage: true });
  });
  it('without page text nothing is dropped for it, and the row says the date was not checked', () => {
    const row = { title: 'Roof Replacement at the Annex', solicitationNumber: 'BL200-27', dueDate: '2026-12-30T15:00', detailUrl: 'https://www.gwinnettcounty.com/static/upload/bid/1/a.pdf', status: 'open' };
    expect(validateRows([row], GW, { now: NOW_LIVE, markdown: null }).items[0].data).toMatchObject({ dueOnPage: null });
  });
  it.each([
    ['2026-12-17', 'Opening Date 2026-12-17', true],
    ['2026-12-17', 'due 12/17/2026 at 3 PM', true],
    ['2026-12-05', 'due 12/5/2026', true],
    ['2026-12-05', 'due 12-05-26', true],
    ['2026-12-17', 'Thursday, December 17, 2026, at 2:00 PM', true],
    ['2026-12-05', 'December 5th, 2026', true],
    ['2026-12-05', 'Dec. 05, 2026', true],
    ['2026-12-05', '5 December 2026', true],
    ['2026-12-17', 'due 12/17/2025', false],
    ['2026-12-17', 'due 2026-12-170', false],
    ['2026-12-17', 'due January 14, 2026', false],
    ['2026-12-17', 'due 112/17/2026', false],
    ['2026-12-17', '', false],
  ])('dayAppearsOn %s in %j', (ymd, text, want) => expect(dayAppearsOn(text, ymd)).toBe(want));
  it('every kept fixture row has its due day on its fixture page', () => {
    for (const [id, now] of [['bids-gwinnett', NOW_LIVE], ['bids-dunwoody', NOW_DUNWOODY_SNAPSHOT], ['bids-tucker', NOW_TUCKER_SNAPSHOT], ['bids-rockdale', NOW_LIVE]] as const) {
      const v = validateRows(rowsFromJson(extracted(id)), localSourceById(id)!, { now, markdown: pageMd(id) });
      expect(v.dropped.filter((d) => d.reason === 'due_not_on_page'), id).toEqual([]);
    }
  });
});

describe('P2: a list-fallback source never carries an off-domain link', () => {
  it('Rockdale: a portal link the model copied becomes the county\'s own list page, flagged as a list link', () => {
    const row = { title: 'ROOF REPLACEMENT AT FIRE STATION 5', solicitationNumber: 'ITB #26-30', dueDate: '2026-12-20T14:00', detailUrl: 'https://www.bidnetdirect.com/georgia/rockdalecounty', status: 'open' };
    const v = validateRows([row], RK, { now: NOW_LIVE, markdown: 'ITB #26-30 ROOF REPLACEMENT AT FIRE STATION 5 DUE: December 20, 2026' });
    expect(v.items[0].url).toBe('https://www.rockdalecountyga.gov/current-bids-rfp-rfq');
    expect(v.items[0].data).toMatchObject({ linkKind: 'list' });
  });
  it('Gwinnett (a link per row) still drops an off-domain link', () => {
    const row = { title: 'Roof Replacement at the Annex', solicitationNumber: 'BL200-27', dueDate: '2026-12-30T15:00', detailUrl: 'https://www.bidnetdirect.com/x', status: 'open' };
    expect(validateRows([row], GW, { now: NOW_LIVE, markdown: 'BL200-27 Roof Replacement at the Annex 2026-12-30' }).dropped[0].reason).toBe('link_off_domain');
  });
});

describe('P2: link labels, fencing, and the trades of every fixture row', () => {
  it('Rockdale links to the county list page, not a portal; Baton Rouge still says portal; the rest say source', () => {
    expect(bidSourceLinkLabel('bids-rockdale')).toBe(BID_LIST_LINK_LABEL);
    expect(bidSourceLinkLabel('bids-rockdale')).not.toBe(BID_PORTAL_LINK_LABEL);
    expect(bidSourceLinkLabel('bids-batonrouge')).toBe(BID_PORTAL_LINK_LABEL);
    for (const s of ['bids-gwinnett', 'bids-tucker', 'bids-dunwoody', 'bids-sf']) expect(bidSourceLinkLabel(s)).toBe(BID_SOURCE_LINK_LABEL);
  });
  it('fencing: installation of fence is a fencing bid (Gwinnett BL153-26); fence supplies are not', () => {
    expect(bidTrades({ title: 'Purchase and Installation of Fence on an Annual Contract' })).toEqual(['fencing']);
    expect(bidTrades({ title: 'Fence Repair at the Water Plant' })).toEqual(['fencing']);
    expect(bidTrades({ title: 'Purchase of Fence Panels' })).toEqual([]);
    expect(bidTrades({ title: 'Fencing Consultant Services' })).toEqual([]);
  });
  it('every real fixture title gets the trades a person would give it (judged row by row, 2026-11-22)', () => {
    const got: Record<string, string> = {};
    for (const id of ['bids-gwinnett', 'bids-rockdale', 'bids-tucker', 'bids-dunwoody']) {
      for (const r of rowsFromJson(extracted(id)) as Array<{ title: string; category?: string }>) {
        const cat = /^(none|bid|rfp|rfq|itb|ifb|quote)$/i.test(r.category ?? '') ? null : r.category;
        const t = bidTrades({ title: r.title, category: cat }).join(',');
        if (t) got[r.title] = t;
      }
    }
    expect(got).toEqual({
      'Lime Building Roof Replacement at Yellow River Water Reclamation Facility': 'roofing',
      'Purchase and Installation of Fence on an Annual Contract': 'fencing',
      'Resurfacing of Major County Roads on a Term Contract': 'concrete-paving',
      'Gwinnett County Fire Station #18 Roof Replacement Project': 'roofing',
      'Purchase and Installation of Guardrail and Fencing on an Annual Contract': 'fencing',
      'Trimming of Trees in Medians and Along Right of Ways on an Annual Contract': 'tree-service',
      'Gwinnett County Public Library - Dacula Branch Lighting Replacement Project': 'electrical',
      'US 78 @MTN IND BLVD ROADWAY IMPROVEMENT - ITB 2026-013': 'concrete-paving',
      'TRAFFIC SIGNAL, SIGNS, AND MARKINGS MAINTENANCE - RFP 2026-010': 'electrical',
      'ON-CALL TREE SERVICES - RFP 2026-011': 'tree-service',
      '2026 RESURFACING - ITB 2026-006': 'concrete-paving',
      'Traffic Signal, Sign and Streetlight Maintenance': 'electrical',
    });
    // Paper work and goods stay out: the lead-paint review, the arborist plan review, milk, valves, software.
    expect(bidTrades({ title: 'PROFESSIONAL ENVIRONMENTAL REVIEW & LEAD-BASED PAINT SERVICES' })).toEqual([]);
    expect(bidTrades({ title: 'ON-CALL PROFESSIONAL SERVICES FOR LAND DISTURBANCE PERMIT PLAN REVIEW, INSPECTION, AND ARBORIST SERVICES' })).toEqual([]);
  });
});
