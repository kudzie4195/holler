import { describe, expect, it, vi } from 'vitest';
import { importCsv, previewCsv, quickAdd, type ServiceDeps } from '@/lib/signals/manual-bids/service';
import { findExisting, type ExistingCandidate } from '@/lib/signals/manual-bids/store';
import type { Db } from '@/lib/signals/store';
import { fakeTables } from '@/tests/match/fake-table';

const NOW = new Date('2026-11-25T15:00:00Z');
const OWNER = async () => ({ ok: true as const, userId: 'owner' });
const STRANGER = async () => ({ ok: false as const, reason: 'not_owner' as const });

/**
 * A database double that fails the test on any write: every method a write would call (insert, upsert, update, delete, rpc) throws.
 * Reads answer with `rows` for the table.
 */
function readOnlyDb(rows: Record<string, unknown[]> = {}) {
  const calls: string[] = [];
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'like', 'order', 'range']) q[m] = (...a: unknown[]) => { calls.push(`${table}.${m}(${JSON.stringify(a)})`); return q; };
    for (const m of ['insert', 'upsert', 'update', 'delete']) q[m] = () => { throw new Error(`write attempted: ${table}.${m}`); };
    q.then = (res: (v: unknown) => void) => res({ data: rows[table] ?? [], error: null });
    return q;
  };
  const db = { from: (t: string) => chain(t), rpc: () => { throw new Error('write attempted: rpc'); } } as unknown as Db;
  return { db, calls };
}

function deps(over: Partial<ServiceDeps> = {}): ServiceDeps & { publish: ReturnType<typeof vi.fn>; db: ReturnType<typeof vi.fn> } {
  const { db } = readOnlyDb();
  return {
    gate: OWNER,
    db: vi.fn(() => db),
    now: () => NOW,
    bidsOn: () => true,
    findExisting: async () => new Set<string>(),
    publish: vi.fn(async (_db: Db, items: unknown[]) => ({ inserted: items.length, matched: 3 })),
    served: () => true,
    ...over,
  } as ServiceDeps & { publish: ReturnType<typeof vi.fn>; db: ReturnType<typeof vi.fn> };
}

const FORM = { url: 'https://mariettaga.gov/Bids.aspx?bidID=412', title: 'Roof replacement at Fire Station 3', agency: 'City of Marietta', dueDate: '2026-12-15', place: '30060' };

const CSV = [
  'title,agency,due_date,url,city,state,zip,solicitation_id,description',
  'Roof replacement at Fire Station 3,City of Marietta,2026-12-15,https://mariettaga.gov/Bids.aspx?bidID=412,,,30060,RFP 1,',
  'Janitorial services for City Hall,City of Marietta,12/20/2026,https://mariettaga.gov/Bids.aspx?bidID=413,Marietta,GA,,RFP 2,',
  'Old paving job,City of Marietta,2026-11-01,https://mariettaga.gov/Bids.aspx?bidID=400,,,30060,RFP 0,',
  'Roof replacement again,City of Marietta,2026-12-15,https://mariettaga.gov/Bids.aspx?bidID=412,,,30060,RFP 9,',
  'HVAC repair,City of Marietta,2026-12-18,https://mariettaga.gov/Bids.aspx?bidID=414,,,30060,RFP 1,',
  'Tree trimming,Town of Far,2026-12-18,https://far.gov/bids/1,,,59001,T-1,',
  'Office software licence renewal,City of Marietta,2026-12-18,https://mariettaga.gov/Bids.aspx?bidID=415,,,30060,RFP 5,',
  'Plumbing upgrades,City of Marietta,2026-12-18,https://mariettaga.gov/Bids.aspx?bidID=416,,,30060,RFP 6,',
].join('\n');

describe('owner refusal (server side, before anything is read)', () => {
  it('quick add, preview and import all refuse a non-owner without creating a database client or reading anything', async () => {
    const d = deps({ gate: STRANGER, findExisting: vi.fn() });
    expect(await quickAdd(d, FORM)).toEqual({ ok: false, error: 'Not found.' });
    expect(await previewCsv(d, CSV, 'generic')).toEqual({ ok: false, error: 'not_found' });
    expect(await importCsv(d, CSV, 'generic')).toEqual({ ok: false, error: 'not_found' });
    expect(d.db).not.toHaveBeenCalled();
    expect(d.findExisting).not.toHaveBeenCalled();
    expect(d.publish).not.toHaveBeenCalled();
  });
});

describe('quick add', () => {
  it('publishes one checked bid and reports the members it was matched to', async () => {
    const d = deps();
    const r = await quickAdd(d, FORM);
    expect(r).toMatchObject({ ok: true, inserted: 1, matched: 3, trades: ['roofing'] });
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.publish.mock.calls[0][1][0]).toMatchObject({ source: 'bids-manual', kind: 'contract', categories: ['roofing'] });
  });

  it('rejects a due date in the past before reading the database', async () => {
    const d = deps({ findExisting: vi.fn() });
    const r = await quickAdd(d, { ...FORM, dueDate: '2026-11-24' });
    expect(r).toMatchObject({ ok: false, field: 'closed' });
    expect(d.findExisting).not.toHaveBeenCalled();
    expect(d.publish).not.toHaveBeenCalled();
  });

  it('refuses a duplicate found in Holler, and refuses to publish while HOLLER_BIDS_ENABLED is off', async () => {
    const dup = deps({ findExisting: async (_db, c) => new Set([c[0].externalId]) });
    expect(await quickAdd(dup, FORM)).toMatchObject({ ok: false, field: 'duplicate' });
    expect(dup.publish).not.toHaveBeenCalled();
    const off = deps({ bidsOn: () => false });
    expect(await quickAdd(off, FORM)).toMatchObject({ ok: false, error: expect.stringMatching(/HOLLER_BIDS_ENABLED/) });
    expect(off.publish).not.toHaveBeenCalled();
  });

  it('a trade hint replaces the routing; with none, a title that names no trade is refused', async () => {
    expect(await quickAdd(deps(), { ...FORM, title: 'Annual audit of city accounts' })).toMatchObject({ ok: false, field: 'no_trade' });
    expect(await quickAdd(deps(), { ...FORM, title: 'Annual audit of city accounts', trade: 'business-services' })).toMatchObject({ ok: true, trades: ['business-services'] });
    expect(await quickAdd(deps(), { ...FORM, trade: 'not-a-trade' })).toMatchObject({ ok: false, field: 'bad_trade' });
  });
});

describe('CSV preview and import', () => {
  it('preview: lists what will be added and why the rest is skipped, and writes nothing (read-only database, publish never called)', async () => {
    // A database double that honours every filter and logs every request: the preview may only select.
    const fdb = fakeTables({ holler_signals: [{ id: 1, source: 'bids-pw-x', external_id: 'x1', url: 'https://mariettaga.gov/Bids.aspx?bidID=416', data: { subtype: 'bid' } }] });
    const d = deps({ db: vi.fn(() => fdb as unknown as Db), findExisting, served: (p) => p.state === 'GA' });
    const r = await previewCsv(d, CSV, 'generic');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = Object.fromEntries(r.analysis.rows.map((x) => [x.line, x.action === 'add' ? 'add' : x.reason]));
    expect(by).toEqual({
      2: 'add',
      3: 'add',
      4: 'Closed: the due date has passed',
      5: 'Duplicate of an earlier row in this file', // same link as line 2
      6: 'Duplicate of an earlier row in this file', // same agency and solicitation number as line 2
      7: 'Outside the areas Holler serves',
      8: 'No trade matched the title (pick a trade to add it anyway)',
      9: 'Already in Holler (same link, or same agency and solicitation number)',
    });
    expect(r.analysis).toMatchObject({ add: 2, skip: 6 });
    expect(r.analysis.rows.find((x) => x.line === 3)?.trades).toEqual(['janitorial-commercial', 'cleaning']);
    expect(d.publish).not.toHaveBeenCalled();
    expect(fdb.log.length).toBeGreaterThan(0);
    expect(fdb.log.every((l: string) => l.startsWith('holler_signals:select:'))).toBe(true);
    expect(r.analysis.rows.find((x) => x.line === 2)?.host).toBe('mariettaga.gov');
  });

  it('import re-reads the file from scratch and publishes only the rows marked add', async () => {
    const fdb = fakeTables({ holler_signals: [{ id: 1, source: 'bids-pw-x', external_id: 'x1', url: 'https://mariettaga.gov/Bids.aspx?bidID=416', data: { subtype: 'bid' } }] });
    const d = deps({ db: vi.fn(() => fdb as unknown as Db), findExisting, served: (p) => p.state === 'GA' });
    const r = await importCsv(d, CSV, 'generic');
    expect(r).toMatchObject({ ok: true, inserted: 2, matched: 3 });
    const items = d.publish.mock.calls[0][1] as Array<{ title: string }>;
    expect(items.map((i) => i.title)).toEqual(['Open bid in Marietta: Roof replacement at Fire Station 3', 'Open bid in Marietta: Janitorial services for City Hall']);
  });

  it('import refuses while HOLLER_BIDS_ENABLED is off; preview still works', async () => {
    const d = deps({ bidsOn: () => false });
    expect(await importCsv(d, CSV, 'generic')).toEqual({ ok: false, error: 'bids_off' });
    expect(await previewCsv(d, CSV, 'generic')).toMatchObject({ ok: true, bidsOn: false });
    expect(d.publish).not.toHaveBeenCalled();
  });

  it('refuses an unknown format, missing columns and an oversized file', async () => {
    expect(await previewCsv(deps(), CSV, 'xls')).toEqual({ ok: false, error: 'bad_format' });
    expect(await previewCsv(deps(), 'title,url\nA,https://x.gov', 'generic')).toMatchObject({ ok: false, error: 'missing_columns' });
    expect(await previewCsv(deps(), 'x'.repeat(900_001), 'generic')).toEqual({ ok: false, error: 'too_big' });
  });
});

describe('findExisting (read only)', () => {
  const cand = (over: Partial<ExistingCandidate>): ExistingCandidate => ({
    externalId: 'manual:x:1',
    url: 'https://www.city.gov/bids/1',
    keys: { urlKey: 'city.gov/bids/1', solKey: null },
    solicitationId: null,
    agency: 'City of X',
    ...over,
  });

  it('matches the same page under another spelling of its link, from any source', async () => {
    const db = fakeTables({ holler_signals: [{ id: 1, source: 'socrata-x', external_id: 'a', url: 'https://city.gov/bids/1/', data: {} }] }) as unknown as Db;
    expect(await findExisting(db, [cand({})])).toEqual(new Set(['manual:x:1']));
    expect(await findExisting(db, [cand({ url: 'https://www.city.gov/bids/2', keys: { urlKey: 'city.gov/bids/2', solKey: null } })])).toEqual(new Set());
  });

  it('matches the same agency and solicitation number from another bid source, whatever the case, spaces or dashes (review P2-3a)', async () => {
    const db = fakeTables({
      holler_signals: [
        { id: 1, source: 'bids-gwinnett', external_id: 'g1', url: 'https://gwinnett.example/doc/1.pdf', data: { subtype: 'bid', solicitationId: 'RP-026-26', buyer: 'Gwinnett County' } },
        // Same number, but not a bid source: never compared.
        { id: 2, source: 'socrata-x', external_id: 's1', url: null, data: { solicitationId: 'RP-026-26', buyer: 'City of Tucker' } },
      ],
    }) as unknown as Db;
    for (const sol of ['RP-026-26', 'RP 026-26', 'rp-026-26', 'RP026-26', ' rp 026 26 ']) {
      const hit = cand({ externalId: `manual:g:${sol}`, keys: { urlKey: null, solKey: 'x' }, solicitationId: sol, agency: 'Gwinnett County Purchasing' });
      expect(await findExisting(db, [hit]), sol).toEqual(new Set([hit.externalId]));
    }
    const otherAgency = cand({ externalId: 'manual:t:1', keys: { urlKey: null, solKey: 'y' }, solicitationId: 'RP-026-26', agency: 'City of Tucker' });
    const otherNumber = cand({ externalId: 'manual:g:2', keys: { urlKey: null, solKey: 'z' }, solicitationId: 'RP-026-27', agency: 'Gwinnett County' });
    const extraChars = cand({ externalId: 'manual:g:3', keys: { urlKey: null, solKey: 'w' }, solicitationId: 'XRP-026-26', agency: 'Gwinnett County' });
    expect(await findExisting(db, [otherAgency, otherNumber, extraChars])).toEqual(new Set());
  });

  it('throws on a read error, so the caller says so instead of guessing', async () => {
    const db = { from: () => { const q: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'in', 'like']) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: null, error: { message: 'boom' } }); return q; } } as unknown as Db;
    await expect(findExisting(db, [cand({})])).rejects.toThrow('existing-record read failed');
  });
});
