import { describe, expect, it } from 'vitest';
import { firecrawlLines, loadFirecrawlHealth } from '@/lib/firecrawl/health';
import { renderHealthEmail, planHealth } from '@/lib/email/health';
import { FakeDb, mockClient, fixtureScript } from './fakes';

const NOW = new Date('2026-11-22T17:00:00Z');
const ledger = (db: FakeDb, source: string, at: string, fetched: number, error: string, inserted = 0) => db.rows.push({ id: db.rows.length + 1, source: `_fc:${source}`, started_at: at, finished_at: at, fetched, inserted, matched: 0, error });

describe('Firecrawl block of the health email', () => {
  it('credits today and month to date, live balance, one line per source with its state', async () => {
    const db = new FakeDb();
    ledger(db, 'bids-gwinnett', '2026-11-22T08:00:00Z', 6, 'extracted', 5);
    ledger(db, 'bids-rockdale', '2026-11-22T08:01:00Z', 1, 'unchanged');
    ledger(db, 'bids-gwinnett', '2026-11-10T08:00:00Z', 6, 'extracted', 4);
    const c = mockClient({ ...fixtureScript('bids-gwinnett', 'same'), remaining: 880 });
    const h = await loadFirecrawlHealth({ db: db as never, now: NOW, env: { HOLLER_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'fc-test-key-0000000000' }, makeClient: () => c.client });
    expect(h).toMatchObject({ running: true, creditsToday: 7, creditsMonth: 13, remainingLive: 880, planCredits: 1000 });
    const text = firecrawlLines(h!).join('\n');
    expect(text).toContain('Credits used today: 7 of 30');
    expect(text).toContain('Month to date: 13 of 500');
    expect(text).toContain('880 remaining');
    expect(text).toContain('bids-gwinnett: extracted');
    expect(text).toContain('bids-rockdale: unchanged');
    expect(text).toContain('bids-tucker: no run yet');
    expect(text).not.toContain('fc-test-key');
  });
  it('says Off and names the missing switch when either is unset; no balance call without a key', async () => {
    const db = new FakeDb();
    const c = mockClient(fixtureScript('bids-gwinnett', 'same'));
    const h = await loadFirecrawlHealth({ db: db as never, now: NOW, env: { HOLLER_BIDS_ENABLED: '1' }, makeClient: () => c.client });
    // nothing spent and no key: block is left out only when the flag is off too
    expect(h?.running).toBe(false);
    expect(firecrawlLines(h!)[0]).toBe('Off: FIRECRAWL_API_KEY is not set; no Firecrawl call is made.');
    expect(c.creditUsageCalls()).toBe(0);
    const h2 = await loadFirecrawlHealth({ db: db as never, now: NOW, env: { FIRECRAWL_API_KEY: 'k' }, makeClient: () => c.client });
    expect(firecrawlLines(h2!)[0]).toBe('Off: HOLLER_BIDS_ENABLED is not set; no Firecrawl call is made.');
  });
  it('is left out entirely when nothing is configured and nothing was ever spent', async () => {
    expect(await loadFirecrawlHealth({ db: new FakeDb() as never, now: NOW, env: {} })).toBeNull();
  });
  it('an unreadable balance shows as unknown, not zero', async () => {
    const c = mockClient({ ...fixtureScript('bids-gwinnett', 'same'), remaining: undefined });
    const h = await loadFirecrawlHealth({ db: new FakeDb() as never, now: NOW, env: { HOLLER_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'k' }, makeClient: () => c.client });
    expect(h?.remainingLive).toBeNull();
    expect(firecrawlLines(h!).join('\n')).toContain('Account balance now: unknown remaining');
  });
  it('renders inside the health email before the 24-hour block, with no em dash or banned wording', async () => {
    const db = new FakeDb();
    ledger(db, 'bids-tucker', '2026-11-22T08:00:00Z', 1, 'unchanged');
    const h = await loadFirecrawlHealth({ db: db as never, now: NOW, env: { HOLLER_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'k' }, makeClient: () => mockClient({ ...fixtureScript('bids-gwinnett', 'same'), remaining: 900 }).client });
    const base = planHealth({ adapters: [], runs: [], counts: { newSignups24h: 0, activeSubscribers: 0, trialing: 0, usersEmailed24h: 0 }, now: NOW });
    const m = renderHealthEmail({ ...base, firecrawl: h });
    expect(m.text.indexOf('Firecrawl (agency bid pages)')).toBeGreaterThan(-1);
    expect(m.text.indexOf('Firecrawl (agency bid pages)')).toBeLessThan(m.text.indexOf('Last 24 hours'));
    expect(m.text).toContain('Credits used today: 1');
    expect(m.html).toContain('Firecrawl (agency bid pages)');
    expect(m.text + m.html).not.toContain('—');
    expect(m.text).not.toMatch(/\blead|guarantee|official record|free month/i);
    const without = renderHealthEmail({ ...base, firecrawl: null });
    expect(without.text).not.toContain('Firecrawl');
  });
});
