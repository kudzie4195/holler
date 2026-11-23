import { describe, expect, it } from 'vitest';
import { parseRobots, robotsAllows, checkRobots, resetRobotsCache } from '@/lib/firecrawl/robots';
import { checkBudget, readBudgetConfig, DEFAULTS } from '@/lib/firecrawl/budget';
import { summarizeLedger, writeLedger, readLedger } from '@/lib/firecrawl/ledger';
import { FakeDb } from './fakes';

describe('robots.txt rules (RFC 9309)', () => {
  it('no rules allows; a blanket Disallow blocks; an empty Disallow allows', () => {
    expect(robotsAllows('', '/a')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /', '/a')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow:', '/a')).toBe(true);
  });
  it('longest match wins, and Allow beats Disallow on a tie', () => {
    const t = 'User-agent: *\nDisallow: /dept/\nAllow: /dept/purchasing/';
    expect(robotsAllows(t, '/dept/purchasing/bids')).toBe(true);
    expect(robotsAllows(t, '/dept/other')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /x\nAllow: /x', '/x')).toBe(true);
  });
  it('a firecrawl-specific group beats the * group', () => {
    const t = 'User-agent: *\nDisallow: /\n\nUser-agent: Firecrawl\nAllow: /';
    expect(robotsAllows(t, '/bids')).toBe(true);
    expect(robotsAllows('User-agent: FirecrawlAgent\nDisallow: /bids', '/bids')).toBe(false);
  });
  it('wildcards, $ anchors and comments', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf?x=1')).toBe(true);
    expect(robotsAllows('User-agent: * # all\nDisallow: /p # private', '/p')).toBe(false);
  });
  it('consecutive User-agent lines share one group', () => {
    expect(parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x')).toHaveLength(1);
  });
  it('checkRobots: 200 judged, 404 allowed, 5xx and network errors unreachable, result cached', async () => {
    resetRobotsCache();
    const f = (async () => new Response('User-agent: *\nDisallow: /no', { status: 200 })) as unknown as typeof fetch;
    expect(await checkRobots('https://a.example/yes', f)).toEqual({ allowed: true, checked: true, crawlDelaySec: null });
    expect(await checkRobots('https://a.example/no?q=1', f)).toEqual({ allowed: false, reason: 'disallowed' });
    expect(await checkRobots('https://b.example/x', (async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toEqual({ allowed: true, checked: false, crawlDelaySec: null });
    expect(await checkRobots('https://c.example/x', (async () => new Response('', { status: 500 })) as unknown as typeof fetch)).toMatchObject({ allowed: false, reason: 'unreachable' });
    expect(await checkRobots('https://d.example/x', (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toMatchObject({ allowed: false, reason: 'unreachable' });
    let n = 0;
    const counting = (async () => (n++, new Response('', { status: 200 }))) as unknown as typeof fetch;
    await checkRobots('https://e.example/1', counting);
    await checkRobots('https://e.example/2', counting);
    expect(n).toBe(1);
  });
});

describe('budget rules', () => {
  const cfg = readBudgetConfig({});
  it('defaults are half the free plan: run 24, day 30, month 500, floor 100', () => {
    expect(cfg).toEqual({ runCap: 24, dayCap: 30, monthCap: 500, minRemaining: 100, probeCap: 25 });
    expect(DEFAULTS.monthCap * 2).toBeLessThanOrEqual(1000);
  });
  it('env overrides; junk falls back to the default', () => {
    expect(readBudgetConfig({ FIRECRAWL_RUN_CREDIT_CAP: '6', FIRECRAWL_DAILY_CREDIT_CAP: '12', FIRECRAWL_MONTHLY_CREDIT_CAP: '100', FIRECRAWL_MIN_REMAINING: '0', FIRECRAWL_PROBE_DAILY_CAP: '10' })).toEqual({ runCap: 6, dayCap: 12, monthCap: 100, minRemaining: 0, probeCap: 10 });
    expect(readBudgetConfig({ FIRECRAWL_RUN_CREDIT_CAP: '-1', FIRECRAWL_DAILY_CREDIT_CAP: 'lots', FIRECRAWL_MONTHLY_CREDIT_CAP: '1.5' }).runCap).toBe(24);
  });
  const snap = { ledgerToday: 0, ledgerMonth: 0, remainingLive: 1000 };
  it('each cap stops a call on its own, with its own reason', () => {
    expect(checkBudget(cfg, snap, 20, 5)).toMatchObject({ ok: false, reason: 'run_cap' });
    expect(checkBudget(cfg, { ...snap, ledgerToday: 26 }, 0, 5)).toMatchObject({ ok: false, reason: 'day_cap' });
    expect(checkBudget(cfg, { ...snap, ledgerMonth: 497 }, 0, 5)).toMatchObject({ ok: false, reason: 'month_cap' });
    expect(checkBudget(cfg, { ...snap, remainingLive: 103 }, 0, 5)).toMatchObject({ ok: false, reason: 'low_balance' });
  });
  it('spending exactly up to a cap is allowed, one credit more is not', () => {
    expect(checkBudget(cfg, { ...snap, ledgerToday: 25 }, 0, 5).ok).toBe(true);
    expect(checkBudget(cfg, { ...snap, ledgerToday: 26 }, 0, 5).ok).toBe(false);
  });
  it('unknown numbers are not treated as zero spend for the caps that have a number, and a null is skipped', () => {
    expect(checkBudget(cfg, { ledgerToday: null, ledgerMonth: null, remainingLive: null }, 0, 5).ok).toBe(true);
  });
  it('run spend counts against day, month and balance too', () => {
    expect(checkBudget(cfg, { ...snap, ledgerToday: 20 }, 6, 5)).toMatchObject({ reason: 'day_cap' });
    expect(checkBudget(cfg, { ...snap, remainingLive: 110 }, 6, 5)).toMatchObject({ reason: 'low_balance' });
  });
});

describe('ledger', () => {
  const now = new Date('2026-11-22T17:00:00Z');
  const r = (source: string, started_at: string, fetched: number, error: string | null, inserted = 0, matched = 0) => ({ source, started_at, fetched, inserted, matched, error });
  it('totals today and the month, per source, newest row gives the last state, ignores non-ledger rows', () => {
    const s = summarizeLedger(
      [
        r('_fc:bids-gwinnett', '2026-11-22T08:00:00Z', 6, 'extracted', 5, 23),
        r('_fc:bids-gwinnett', '2026-11-21T08:00:00Z', 1, 'unchanged'),
        r('_fc:bids-tucker', '2026-11-22T08:05:00Z', 1, 'unchanged'),
        r('_fc:bids-tucker', '2026-10-31T08:00:00Z', 6, 'extracted'),
        r('bids-gwinnett', '2026-11-22T08:00:00Z', 99, null),
        r('_prune', '2026-11-22T08:00:00Z', 99, null),
      ],
      now,
    );
    expect(s.today).toBe(7);
    expect(s.month).toBe(8);
    expect(s.bySource['bids-gwinnett']).toMatchObject({ lastState: 'extracted', lastCredits: 6, lastKept: 5, lastDropped: 23, creditsMonth: 7 });
    expect(s.bySource['bids-tucker']).toMatchObject({ lastState: 'unchanged', creditsMonth: 1 });
    expect(s.bySource['_prune']).toBeUndefined();
  });
  it('an unknown state word reads as null, a bad date is skipped', () => {
    const s = summarizeLedger([r('_fc:x', '2026-11-22T08:00:00Z', 1, 'weird'), r('_fc:x', 'nope', 50, 'extracted')], now);
    expect(s.bySource.x.lastState).toBeNull();
    expect(s.month).toBe(1);
  });
  it('write then read round-trips through holler_scan_runs and never writes a null error', async () => {
    const db = new FakeDb();
    await writeLedger(db as never, { source: 'bids-rockdale', at: now, credits: 6, kept: 3, dropped: 4, state: 'extracted' });
    expect(db.inserts[0]).toMatchObject({ source: '_fc:bids-rockdale', fetched: 6, inserted: 3, matched: 4, error: 'extracted' });
    const s = await readLedger(db as never, now);
    expect(s.today).toBe(6);
  });
  it('a failed insert throws (the caller reports it), without leaking row data', async () => {
    const db = { from: () => ({ insert: async () => ({ error: { message: 'boom' } }) }) };
    await expect(writeLedger(db as never, { source: 'x', at: now, credits: 1, kept: 0, dropped: 0, state: 'unchanged' })).rejects.toThrow('firecrawl ledger insert failed: boom');
  });
});
