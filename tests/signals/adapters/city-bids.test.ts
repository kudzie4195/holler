/**
 * Fixture provenance
 * tests/signals/adapters/fixtures/bids-{sf,la,batonrouge,nyc}-live-2026-11-21.json are rows copied from the live portals on 2026-11-21 through
 * WebFetch (no shell network): SF data.sf.gov/eshn-8t3a, LA data.lacity.org/hf3r-utnq, Baton Rouge data.brla.gov/u9zk-8nix, NYC
 * data.cityofnewyork.us/3khw-qi8f. Baton Rouge and NYC copies leave out the buyer contact, room and long description columns, which the
 * adapter never reads. Every test clock is 2026-11-21T22:00:00Z.
 * Rows marked SYNTHETIC below are built from a real row with one field changed, to reach a branch no live row reached that day.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BID_DATASETS,
  adapters as bidAdapters,
  buildBidAdapter,
  buildBidQuery,
  clockTime,
  firstBlock,
  parseBids,
  stripCodePrefix,
  tidyBuyer,
  type BidDataset,
} from '@/lib/signals/adapters/city-bids';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { normalizeSignals } from '@/lib/signals/run';
import { isCategoryId } from '@/lib/signals/categories';

const NOW = new Date('2026-11-21T22:00:00Z');
const fx = (n: string): Record<string, unknown>[] => JSON.parse(readFileSync(join(__dirname, 'fixtures', `bids-${n}-live-2026-11-21.json`), 'utf8'));
const ds = (id: string): BidDataset => {
  const d = BID_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const SF = ds('bids-sf');
const LA = ds('bids-la');
const BR = ds('bids-batonrouge');
const NYC = ds('bids-nyc');

const landscaping = () => fx('sf').find((r) => String(r.title).includes('Landscaping')) as Record<string, unknown>;

describe('parseBids on the live fixtures', () => {
  it('San Francisco: counts every row once and keeps the one open bid that names a trade', () => {
    const r = parseBids(fx('sf'), SF, NOW);
    const { items, ...counts } = r;
    expect(counts).toEqual({ rows: 20, shapeOk: 20, noDue: 4, keptNoDue: 0, closed: 7, notOpen: 1, noTrade: 11, duplicates: 0 });
    expect(items).toHaveLength(1);
    const b = items[0];
    expect(b.externalId).toBe('SFGOV~0000009416');
    expect(b.title).toBe('Open bid in San Francisco: TC78150 Citywide Landscaping Services');
    expect(b.categories).toEqual(['landscaping']);
    // 2026-12-07 13:00 in Pacific time is 21:00 UTC
    expect(b.expiresAt).toBe('2026-12-07T21:00:00.000Z');
    expect((b.data as Record<string, unknown>).dueDate).toBe('2026-12-07');
    // open_date 2026-11-02 17:00 Pacific (PST, daylight time ended 2026-11-01) is 2026-11-03 01:00 UTC
    expect(b.occurredAt).toBe('2026-11-03T01:00:00.000Z');
    expect(b.summary).toBe('Office of Contract Administration | Personal Services | Seeking Bids | due 2026-12-07');
  });

  it('Los Angeles: drops the request for information, keeps the cooling tower bid with a UTC due time', () => {
    const r = parseBids(fx('la'), LA, NOW);
    const { items, ...counts } = r;
    expect(counts).toEqual({ rows: 20, shapeOk: 20, noDue: 0, keptNoDue: 0, closed: 0, notOpen: 1, noTrade: 18, duplicates: 0 });
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe('233195');
    expect(items[0].categories).toEqual(['hvac']);
    expect(items[0].expiresAt).toBe('2027-01-08T22:00:00.000Z');
    // 22:00 UTC is 14:00 in Los Angeles: same calendar day
    expect((items[0].data as Record<string, unknown>).dueDate).toBe('2027-01-08');
    expect(items[0].title).toMatch(/^Open bid in Los Angeles area: BEST VALUE/);
    expect(items[0].url).toBe('https://www.rampla.org/s/opportunity-details?id=006Ql00000ot0gvIAA');
  });

  it('Baton Rouge: reads the bid time in local time, drops closed bids, links the City-Parish portal or the dataset page', () => {
    const r = parseBids(fx('batonrouge'), BR, NOW);
    const { items, ...counts } = r;
    expect(counts).toEqual({ rows: 20, shapeOk: 20, noDue: 0, keptNoDue: 0, closed: 5, notOpen: 0, noTrade: 11, duplicates: 0 });
    expect(items.map((i) => i.externalId).sort()).toEqual(['19338', '19348', '19362', '19370']);
    const window = items.find((i) => i.externalId === '19348')!;
    // 2026-11-24 11:00 AM in Central time (UTC-6 in winter) is 17:00 UTC
    expect(window.expiresAt).toBe('2026-11-24T17:00:00.000Z');
    expect(window.title).toBe('Open bid in Baton Rouge: A26-91082 Window Washing Library Sites');
    expect(window.summary).toBe('Purchasing | due 2026-11-24');
    expect(window.url).toBe('https://www.centralauctionhouse.com/rfpc10656-city-of-baton-rouge.html');
    expect((window.data as Record<string, unknown>).linkKind).toBe('portal');
    const mc = items.find((i) => i.externalId === '19338')!;
    expect(mc.url).toBe('https://data.brla.gov/d/u9zk-8nix');
    expect(mc.title).toBe('Open bid in Baton Rouge: McHOST ROAD IMPRV 2 (LA Hwy 64 - Port Hudson - Pride Rd) 20-EN-HC-0107');
    // no posted column: the row is dated when it was first seen
    expect(mc.occurredAt).toBe(NOW.toISOString());
    expect(items.find((i) => i.externalId === '19362')!.summary).toBe('Downtown Development District | due 2026-12-08');
  });

  it('New York is registered on probation (row page confirmed) and parses', () => {
    expect(NYC.verified).toBe(true);
    expect(NYC.probation).toBe(true);
    const r = parseBids(fx('nyc'), NYC, NOW);
    // Roofs (twice), electrical, security staffing, retaining wall are all open; the RFEI is a request for information.
    expect(r.items.map((i) => i.externalId).sort()).toEqual(['20261106020', '20261106025', '20261112002', '20261112006', '20261116019']);
    expect(r.notOpen).toBe(1);
    expect(r.items[0].url).toMatch(/^https:\/\/a856-cityrecord\.nyc\.gov\/RequestDetail\/\d+$/);
    const nycAdapter = bidAdapters.find((a) => a.id === 'bids-nyc');
    expect(nycAdapter?.probation).toBe(true);
    // The other city bid sources are live, not on probation.
    for (const a of bidAdapters.filter((x) => x.id !== 'bids-nyc')) expect(a.probation).toBeFalsy();
  });

  it('every kept row links to a source page, has a valid trade, a city centre marked approximate, kind contract and subtype bid', () => {
    for (const [d, f] of [[SF, 'sf'], [LA, 'la'], [BR, 'batonrouge'], [NYC, 'nyc']] as const) {
      for (const s of parseBids(fx(f), d, NOW).items) {
        expect(s.url, `${d.id} ${s.externalId}`).toMatch(/^https:\/\/\S+$/);
        expect(s.kind).toBe('contract');
        expect(s.source).toBe(d.id);
        expect(s.categories.length).toBeGreaterThan(0);
        for (const c of s.categories) expect(isCategoryId(c)).toBe(true);
        expect(typeof s.lat).toBe('number');
        expect(typeof s.lon).toBe('number');
        expect(s.state).toBe(d.state);
        const data = s.data as Record<string, unknown>;
        expect(data.subtype).toBe('bid');
        expect(data.loc).toBe('approx');
        expect(data.solicitationId).toBe(s.externalId);
        expect(s.contacts).toBeUndefined();
        expect(`${s.title} ${s.summary}`).not.toMatch(/\blead\b|you can win|you will win|guaranteed|official record|eligible|they need you|@/i);
      }
    }
  });

  it('survives the scan normaliser: due date kept as expiresAt, nothing dropped', () => {
    const items = parseBids(fx('batonrouge'), BR, NOW).items;
    const out = normalizeSignals(bidAdapters.find((a) => a.id === 'bids-batonrouge')!, items, NOW);
    expect(out).toHaveLength(items.length);
    expect(out.map((o) => o.expiresAt)).toEqual(items.map((i) => i.expiresAt));
  });
});

describe('parseBids: due dates, duplicates, no-due-date rows', () => {
  it('SYNTHETIC (review P2-9): an SF bid due 13 months out (365-day placeholder limit) shows no deadline; one due in 6 months keeps it', () => {
    const far = parseBids([{ ...landscaping(), due_date: '2027-12-25T08:00:00.000' }], SF, NOW);
    expect(far.items[0].expiresAt).toBeNull();
    expect(far.noDue).toBe(1);
    const near = parseBids([{ ...landscaping(), due_date: '2027-05-20T08:00:00.000' }], SF, NOW);
    expect(near.items[0].expiresAt).not.toBeNull();
  });

  it('SYNTHETIC: a due date far in the future is a placeholder: the row is kept with no deadline and counted', () => {
    const row = { ...landscaping(), due_date: '2099-12-31T11:48:00.000' };
    const r = parseBids([row], SF, NOW);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].expiresAt).toBeNull();
    expect(r.items[0].data).toMatchObject({ noDueDate: true, dueDate: null });
    expect((r.items[0].data as Record<string, unknown>).dueDateNote).toMatch(/placeholder/);
    expect(r.items[0].summary).toContain('no due date published');
    expect(r.noDue).toBe(1);
    expect(r.keptNoDue).toBe(1);
  });

  it('SYNTHETIC: a row with no due date at all is kept and counted', () => {
    const row = { ...landscaping() } as Record<string, unknown>;
    delete row.due_date;
    const r = parseBids([row], SF, NOW);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].expiresAt).toBeNull();
    expect(r.noDue).toBe(1);
    expect(r.keptNoDue).toBe(1);
  });

  it('a real far-future row with no trade is counted as no-due but not kept', () => {
    const r = parseBids(fx('sf').filter((x) => String(x.title).includes('Airport Concessions')), SF, NOW);
    expect(r.items).toHaveLength(0);
    expect(r.noDue).toBe(1);
    expect(r.keptNoDue).toBe(0);
  });

  it('a due date in the past is closed, not kept', () => {
    const row = { ...landscaping(), due_date: '2026-11-20T13:00:00.000' };
    const r = parseBids([row], SF, NOW);
    expect(r.items).toHaveLength(0);
    expect(r.closed).toBe(1);
  });

  it('SYNTHETIC: dedupes by the source solicitation id', () => {
    const a = landscaping();
    const r = parseBids([a, { ...a, title: 'OCA | TC78150 Citywide Landscaping Services (amended copy)' }, a], SF, NOW);
    expect(r.items).toHaveLength(1);
    expect(r.duplicates).toBe(2);
    expect(r.items[0].title).toContain('TC78150 Citywide Landscaping Services');
    expect(new Set(parseBids(fx('batonrouge'), BR, NOW).items.map((i) => i.externalId)).size).toBe(4);
  });

  it('SYNTHETIC: a cancelled notice, a request for information and a status that is not open are dropped', () => {
    const base = landscaping();
    const rfi = parseBids([{ ...base, type: 'Request for Information' }], SF, NOW);
    expect(rfi.items).toHaveLength(0);
    expect(rfi.notOpen).toBe(1);
    const closedStatus = parseBids([{ ...base, status: 'Closed' }], SF, NOW);
    expect(closedStatus.notOpen).toBe(1);
    const cancelled = parseBids([{ ...fx('batonrouge')[6], note: 'NOTICE OF CANCELLATION. THIS PROJECT HAS BEEN CANCELLED.' }], BR, NOW);
    expect(cancelled.items).toHaveLength(0);
    expect(cancelled.notOpen).toBe(1);
  });

  it('SYNTHETIC: a row with no page of its own is not kept (every card links to its source)', () => {
    const row = { ...landscaping() } as Record<string, unknown>;
    delete row.sfcitypartner_link;
    expect(parseBids([row], SF, NOW).items).toHaveLength(0);
    // a link that is not https is not accepted either
    expect(parseBids([{ ...landscaping(), sfcitypartner_link: { url: 'javascript:alert(1)' } }], SF, NOW).items).toHaveLength(0);
  });

  it('SYNTHETIC: never reads contact columns, and strips emails and links from a title', () => {
    const row = {
      ...fx('batonrouge')[6],
      contact_name: 'Jane Roe',
      phone: '225-555-0199',
      buyer_name: 'John Poe',
      description: 'A26-91082 Window Washing Library Sites jane.roe@brla.gov https://example.org/x\nFor bidding information: https://www.centralauctionhouse.com/x.html',
    };
    const r = parseBids([row], BR, NOW);
    expect(r.items).toHaveLength(1);
    const json = JSON.stringify(r.items);
    for (const bad of ['Jane', 'Roe', '555-0199', 'John Poe', '@brla.gov', 'example.org']) expect(json).not.toContain(bad);
    expect(r.items[0].title).toBe('Open bid in Baton Rouge: A26-91082 Window Washing Library Sites');
  });

  it('never throws on malformed input', () => {
    for (const bad of [null, undefined, 'x', 5, {}, [null, 1, 'a', {}, { event_id: 'x' }], [{ event_id: 'a', title: 'Roofing', department: 'D', due_date: 'not a date' }]]) {
      expect(() => parseBids(bad, SF, NOW)).not.toThrow();
    }
    expect(parseBids({ not: 'an array' }, SF, NOW).rows).toBe(0);
  });
});

describe('small helpers', () => {
  it('stripCodePrefix drops short agency codes only', () => {
    expect(stripCodePrefix('EXT AIR | OCA PUC | TM3 - StarDB Renewal')).toBe('TM3 - StarDB Renewal');
    expect(stripCodePrefix('OCA | TC78150 Citywide Landscaping Services')).toBe('TC78150 Citywide Landscaping Services');
    expect(stripCodePrefix('Roofing')).toBe('Roofing');
    expect(stripCodePrefix('AIR')).toBe('AIR');
  });
  it('tidyBuyer title-cases all-caps names only', () => {
    expect(tidyBuyer('TRANSPORTATION AND DRAINAGE')).toBe('Transportation and Drainage');
    expect(tidyBuyer('Water & Power')).toBe('Water & Power');
  });
  it('clockTime reads 12-hour clock text', () => {
    expect(clockTime('2:00 PM')).toBe('14:00:00');
    expect(clockTime('11:00 AM')).toBe('11:00:00');
    expect(clockTime('12:30 AM')).toBe('00:30:00');
    expect(clockTime('noon')).toBeNull();
  });
  it('firstBlock keeps the project lines and drops addenda and portal text', () => {
    expect(firstBlock('A26-1115 - Janitorial Services\nADDENDUM NO. 2 ISSUED 11.10.26\nFor bidding information: x')).toBe('A26-1115 - Janitorial Services');
    expect(firstBlock('IMAGINATION WAY\n(ARDENWOOD DR.)\nCITY-PARISH PROJECT NO. 1')).toBe('IMAGINATION WAY (ARDENWOOD DR.) CITY-PARISH PROJECT NO. 1');
  });
  it('control characters from the portals are cleaned out of titles', () => {
    const row = { ...landscaping(), title: 'OCA | Citywide\u001a Landscaping\u0000 Services' };
    expect(parseBids([row], SF, NOW).items[0].title).toBe('Open bid in San Francisco: Citywide Landscaping Services');
  });
});

describe('query and adapter', () => {
  it('builds a SoQL that asks for open rows only, newest due date last', () => {
    const q = buildBidQuery(SF, NOW);
    expect(q.get('$where')).toBe("(due_date > '2026-11-21T14:00:00' OR (due_date IS NULL AND open_date > '2026-09-22T15:00:00'))");
    expect(q.get('$order')).toBe('due_date ASC');
    expect(q.get('$limit')).toBe('1000');
    expect(buildBidQuery(BR, NOW).get('$where')).toBe("bid_date >= '2026-11-21T00:00:00'");
    expect(buildBidQuery(NYC, NOW).get('$where')).toContain("(type_of_notice_description = 'Solicitation')");
  });

  it('registers San Francisco, Los Angeles, Baton Rouge and New York (probation), with source metadata equal to the adapter', () => {
    expect(bidAdapters.map((a) => a.id)).toEqual(['bids-sf', 'bids-la', 'bids-batonrouge', 'bids-nyc']);
    for (const a of bidAdapters) {
      expect(ALL_ADAPTERS.filter((x) => x.id === a.id)).toHaveLength(1);
      expect(SOURCE_META[a.id]?.label).toBe(a.label);
      expect(SOURCE_META[a.id]?.sourceUrl).toBe(a.sourceUrl);
      expect(a.kind).toBe('contract');
      expect(typeof a.enabled).toBe('function');
    }
  });

  const run = (a: ReturnType<typeof buildBidAdapter>, fetchImpl: typeof fetch, flag: string | undefined) => {
    const logs: string[] = [];
    return a.fetch({ since: new Date(0), now: NOW, fetch: fetchImpl, env: { HOLLER_BIDS_ENABLED: flag }, log: (m) => logs.push(m) }).then((items) => ({ items, logs }));
  };
  const okFetch = (rows: unknown) => vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  it('flag off: fetch makes no request and returns nothing', async () => {
    const f = okFetch(fx('sf'));
    for (const flag of [undefined, '', '0', 'false', 'off', 'no']) {
      const { items, logs } = await run(buildBidAdapter(SF), f, flag);
      expect(items).toEqual([]);
      expect(logs.join(' ')).toMatch(/skipped/);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('flag on: fetches the portal and returns parsed bids', async () => {
    const f = okFetch(fx('batonrouge'));
    const { items, logs } = await run(buildBidAdapter(BR), f, '1');
    expect(f).toHaveBeenCalledTimes(1);
    const url = String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toMatch(/^https:\/\/data\.brla\.gov\/resource\/u9zk-8nix\.json\?/);
    expect(items).toHaveLength(4);
    expect(logs.join(' ')).toMatch(/20 rows, 4 kept, 11 no trade, 5 closed/);
  });

  it('flag on: an HTTP error or a non-array body is logged, not thrown', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const r1 = await run(buildBidAdapter(SF), bad, 'true');
    expect(r1.items).toEqual([]);
    expect(r1.logs.join(' ')).toMatch(/HTTP 503/);
    const r2 = await run(buildBidAdapter(SF), okFetch({ error: true }), 'on');
    expect(r2.logs.join(' ')).toMatch(/non-array/);
    const thrower = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    expect((await run(buildBidAdapter(SF), thrower, 'yes')).items).toEqual([]);
  });

  it('flag on with a body whose shape changed says so', async () => {
    const r = await run(buildBidAdapter(SF), okFetch([{ unexpected: 1 }, { other: 2 }]), '1');
    expect(r.items).toEqual([]);
    expect(r.logs.join(' ')).toMatch(/shape may have changed/);
  });
});
