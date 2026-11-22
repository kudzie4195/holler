import { describe, expect, it } from 'vitest';
import { normalizeNumber, parseDue, rowsFromJson, validateRows } from '@/lib/firecrawl/extract';
import { localSourceById, LOCAL_BID_SOURCES } from '@/lib/firecrawl/local-sources';
import { deadlineOf, labelFor } from '@/lib/signals/lead-rules';
import { extracted, NOW_DUNWOODY_SNAPSHOT, NOW_LIVE, NOW_TUCKER_SNAPSHOT, pageMd } from './helpers';

const src = (id: string) => localSourceById(id)!;
const run = (id: string, now: Date, rows = rowsFromJson(extracted(id)), md: string | null = pageMd(id)) => validateRows(rows, src(id), { now, markdown: md });
const reasons = (r: ReturnType<typeof run>) => r.dropped.reduce<Record<string, number>>((m, d) => ({ ...m, [d.reason]: (m[d.reason] ?? 0) + 1 }), {});

describe('Gwinnett County, real list read on 2026-11-22 (28 rows)', () => {
  const r = run('bids-gwinnett', NOW_LIVE);
  it('keeps the open trade solicitations with the due instant, the PDF link on gwinnettcounty.com and the trades', () => {
    expect(r.rows).toBe(28);
    expect(r.items.map((i) => (i.data as { solicitationId: string }).solicitationId)).toEqual(['BL137-26 NOT', 'BL099-26 INV', 'BL154-26 NOT', 'BL138-26 INV', 'BL160-26 NOT']);
    const roof = r.items[0];
    expect(roof.title).toBe('Open bid in Gwinnett County: Lime Building Roof Replacement at Yellow River Water Reclamation Facility');
    expect(roof.expiresAt).toBe('2026-12-17T20:00:00.000Z'); // 3:00 PM Eastern
    expect((roof.data as { dueDate: string }).dueDate).toBe('2026-12-17');
    expect(roof.url).toBe('https://www.gwinnettcounty.com/static/upload/bid/802545/BL137-26%20NOT.pdf');
    expect(roof.categories).toEqual(['roofing']);
    expect(r.items[3].categories).toEqual(['tree-service']);
    expect(r.items.every((i) => new URL(i.url!).hostname.endsWith('gwinnettcounty.com'))).toBe(true);
  });

  it('drops past rows (the page still lists the 4 that opened on Nov 20) and rows that name no Holler trade, and says why', () => {
    expect(reasons(r)).toEqual({ due_date_passed: 4, no_trade: 19 });
    expect(r.dropped.filter((d) => d.reason === 'due_date_passed').map((d) => d.number)).toEqual(['BL152-26 NOT', 'IWQ 140950', 'IWQ 141809 INV', 'IWQ 111026 INV']);
  });

  it('is placed at the agency ZIP centroid from the zipcodes dataset, marked approximate, never a typed-in point', () => {
    const i = r.items[0];
    expect([i.lat, i.lon]).toEqual([33.9496, -83.9942]);
    expect(i.zip).toBe('30046');
    expect(i.data).toMatchObject({ loc: 'approx', approxLocation: true, subtype: 'bid', via: 'firecrawl', linkKind: 'solicitation' });
    expect(i.kind).toBe('contract');
  });

  it('never carries a contact e-mail, phone or link into any text field', () => {
    for (const i of r.items) expect(`${i.title} ${i.summary} ${JSON.stringify(i.data)}`).not.toMatch(/@\w|https?:\/\/(?!www\.gwinnettcounty)|\d{3}[.-]\d{3}[.-]\d{4}/);
  });

  it('feeds the lead rules like a city bid: Act Now, with the due date as the deadline', () => {
    const i = r.items[0];
    expect(labelFor({ source: i.source, kind: i.kind, subtype: 'bid', title: i.title }, 'roofing')).toBe('act_now');
    expect(deadlineOf({ source: i.source, expires_at: i.expiresAt, data: i.data })).toBe('2026-12-17T12:00:00.000Z');
  });
});

describe('Rockdale County, real list read on 2026-11-22 (10 rows)', () => {
  it('has no per-row links, so rows link to the county list page; the typo-dated and no-trade rows are dropped with reasons', () => {
    const r = run('bids-rockdale', NOW_LIVE);
    expect(reasons(r)).toEqual({ no_trade: 9, due_date_passed: 1 }); // RFP #26-21 prints "January 14, 2026" next to a December 2026 conference
    expect(r.dropped.find((d) => d.reason === 'due_date_passed')?.number).toBe('RFP #26-21');
    // The two Rockdale titles the first trade table matched wrongly (lead-based paint review, plan review with an arborist) are not trade work.
    expect(r.dropped.find((d) => d.number === 'RFP #26-26')?.reason).toBe('no_trade');
    expect(r.dropped.find((d) => d.number === 'RFQ #26-07')?.reason).toBe('no_trade');
  });

  it('a trade row with no link falls back to the list page on rockdalecountyga.gov, flagged as a list link', () => {
    const rows = [{ title: 'ROOF REPLACEMENT AT FIRE STATION 5', solicitationNumber: 'ITB #26-30', dueDate: '2026-12-20T14:00', detailUrl: '', status: 'open' }];
    const r = validateRows(rows, src('bids-rockdale'), { now: NOW_LIVE, markdown: 'ITB #26-30 ROOF REPLACEMENT AT FIRE STATION 5' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].url).toBe('https://www.rockdalecountyga.gov/current-bids-rfp-rfq');
    expect(r.items[0].data).toMatchObject({ linkKind: 'list' });
    expect(r.items[0].expiresAt).toBe('2026-12-20T19:00:00.000Z');
  });
});

describe('Dunwoody and Tucker snapshots', () => {
  it('Dunwoody (table read in Feb 2026): keeps the traffic-signal maintenance row, drops the design-services row, drops both once past', () => {
    const r = run('bids-dunwoody', NOW_DUNWOODY_SNAPSHOT);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].categories).toEqual(['electrical']);
    expect(r.items[0].expiresAt).toBe('2026-03-11T18:00:00.000Z');
    expect(reasons(r)).toEqual({ no_trade: 1 });
    expect(reasons(run('bids-dunwoody', NOW_LIVE))).toEqual({ due_date_passed: 2 });
  });

  it('Tucker (12 listings, every one carries a Notice of Award): nothing is open, awarded rows are not_open, past rows are due_date_passed', () => {
    const june = run('bids-tucker', NOW_TUCKER_SNAPSHOT);
    expect(june.items).toEqual([]);
    expect(reasons(june)).toEqual({ not_open: 6, due_date_passed: 6 });
    expect(reasons(run('bids-tucker', NOW_LIVE))).toEqual({ due_date_passed: 12 });
  });
});

describe('validation rules', () => {
  const base = { title: 'Roof Replacement at the Annex', solicitationNumber: 'BL200-27', dueDate: '2026-12-30T15:00', detailUrl: 'https://www.gwinnettcounty.com/static/upload/bid/1/BL200-27.pdf', status: 'open' };
  const md = 'BL200-27 Roof Replacement at the Annex';
  const v = (row: Record<string, unknown>, id = 'bids-gwinnett', m: string | null = md) => validateRows([row], src(id), { now: NOW_LIVE, markdown: m });

  it('accepts the clean row', () => expect(v(base).items).toHaveLength(1));
  it('drops a row without a title', () => expect(v({ ...base, title: '' }).dropped[0].reason).toBe('no_title'));
  it('drops a row without a due date', () => expect(v({ ...base, dueDate: '' }).dropped[0].reason).toBe('no_due_date'));
  it('drops a due date that is not a date', () => expect(v({ ...base, dueDate: 'see addendum' }).dropped[0].reason).toBe('bad_due_date'));
  it('drops a due date in the past', () => expect(v({ ...base, dueDate: '2026-11-01T15:00' }).dropped[0].reason).toBe('due_date_passed'));
  it('keeps a bare date open until the end of that day in the agency zone', () => {
    expect(validateRows([{ ...base, dueDate: '2026-11-22' }], src('bids-gwinnett'), { now: new Date('2026-11-23T03:00:00Z'), markdown: md }).items).toHaveLength(1); // 10 PM Eastern on Nov 22
    expect(validateRows([{ ...base, dueDate: '2026-11-22' }], src('bids-gwinnett'), { now: new Date('2026-11-23T05:30:00Z'), markdown: md }).dropped[0].reason).toBe('due_date_passed');
  });
  it('drops a placeholder date years away', () => expect(v({ ...base, dueDate: '2031-01-01T10:00' }).dropped[0].reason).toBe('due_date_placeholder'));
  it('drops awarded, closed and cancelled rows', () => {
    for (const status of ['awarded', 'closed', 'cancelled']) expect(v({ ...base, status }).dropped[0].reason).toBe('not_open');
    expect(v({ ...base, title: 'CANCELLED - Roof Replacement at the Annex' }, 'bids-gwinnett', 'BL200-27 CANCELLED - Roof Replacement at the Annex').dropped[0].reason).toBe('not_open');
  });
  it('drops a link on another domain (a Teams meeting, a portal), and a missing link where the page has per-row links', () => {
    expect(v({ ...base, detailUrl: 'https://teams.microsoft.com/meet/123' }).dropped[0].reason).toBe('link_off_domain');
    expect(v({ ...base, detailUrl: 'https://www.bidnetdirect.com/georgia/gwinnett/x' }).dropped[0].reason).toBe('link_off_domain');
    expect(v({ ...base, detailUrl: 'https://gwinnettcounty.com.evil.example/x.pdf' }).dropped[0].reason).toBe('link_off_domain');
    expect(v({ ...base, detailUrl: '' }).dropped[0].reason).toBe('no_link');
  });
  it('resolves a relative link against the agency page', () => {
    expect(v({ ...base, detailUrl: '/static/upload/bid/9/BL200-27.pdf' }).items[0].url).toBe('https://www.gwinnettcounty.com/static/upload/bid/9/BL200-27.pdf');
  });
  it('drops a row that is not on the page (an invented solicitation)', () => {
    expect(v({ ...base, title: 'Roof Replacement at the Courthouse', solicitationNumber: 'BL999-27' }).dropped[0].reason).toBe('not_on_page');
    expect(v({ ...base, title: 'Roof Replacement at the Courthouse', solicitationNumber: 'BL999-27' }, 'bids-gwinnett', null).items).toHaveLength(1); // no page text: check skipped
  });
  it('dedupes on the solicitation number, ignoring a notice-type suffix, else on the link', () => {
    const r = validateRows([{ ...base, solicitationNumber: 'BL200-27 NOT' }, { ...base, solicitationNumber: 'BL200-27 INV', detailUrl: 'https://www.gwinnettcounty.com/static/upload/bid/2/x.pdf' }], src('bids-gwinnett'), { now: NOW_LIVE, markdown: md });
    expect(r.items).toHaveLength(1);
    expect(r.dropped.map((d) => d.reason)).toEqual(['duplicate']);
    const noNum = { ...base, solicitationNumber: '' };
    const r2 = validateRows([noNum, noNum], src('bids-gwinnett'), { now: NOW_LIVE, markdown: md });
    expect(r2.items).toHaveLength(1);
    expect(r2.dropped[0].reason).toBe('duplicate');
  });
  it('gives the same externalId on every run, so the store dedupes', () => {
    expect(v(base).items[0].externalId).toBe(v(base).items[0].externalId);
    expect(v(base).items[0].externalId).toBe('bids-gwinnett:bl20027');
  });
  it('survives junk: non-array json, non-object rows, wrong types', () => {
    expect(rowsFromJson(null)).toEqual([]);
    expect(rowsFromJson({ solicitations: 'x' })).toEqual([]);
    const r = validateRows([null, 5, 'x', [], { title: 7, dueDate: 9 }], src('bids-gwinnett'), { now: NOW_LIVE, markdown: md });
    expect(r.items).toEqual([]);
    expect(r.dropped.length).toBe(5);
  });
});

describe('parseDue', () => {
  const tz = 'America/New_York';
  it.each([
    ['2026-12-10T14:00', '2026-12-10T19:00:00.000Z', true],
    ['2026-12-10 14:00:00.0', '2026-12-10T19:00:00.000Z', true],
    ['2026-07-10T14:00', '2026-07-10T18:00:00.000Z', true], // daylight time
    ['2026-12-10', '2026-12-11T04:59:00.000Z', false],
    ['Thursday, December 10, 2026, at 2:00 PM., Local Time', '2026-12-10T19:00:00.000Z', true],
    ['12/09/2026 2:00 p.m.', '2026-12-09T19:00:00.000Z', true],
    ['2026-12-10T14:00:00-05:00', '2026-12-10T19:00:00.000Z', true],
  ])('%s', (raw, iso, hasTime) => expect(parseDue(raw, tz)).toEqual({ iso, hasTime }));
  it('rejects text with no date', () => {
    expect(parseDue('TBD', tz)).toBeNull();
    expect(parseDue('', tz)).toBeNull();
    expect(parseDue('2026-13-45', tz)).toBeNull();
  });
  it('normalizeNumber drops the source suffix', () => {
    expect(normalizeNumber('BL137-26 NOT', /\s+(?:NOT|INV)$/i)).toBe('bl13726');
    expect(normalizeNumber('RFP #26-28')).toBe('rfp2628');
  });
});

describe('source configuration', () => {
  it('lists 4 sources, each with an https list page on its own domain and a ZIP the dataset knows', () => {
    expect(LOCAL_BID_SOURCES.map((s) => s.id)).toEqual(['bids-gwinnett', 'bids-rockdale', 'bids-tucker', 'bids-dunwoody']);
    for (const s of LOCAL_BID_SOURCES) {
      const u = new URL(s.listUrl);
      expect(u.protocol).toBe('https:');
      expect(s.domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))).toBe(true);
      expect(s.id.startsWith('bids-')).toBe(true);
      expect(validateRows([], s, { now: NOW_LIVE, markdown: '' }).items).toEqual([]);
    }
  });
  it('no source is a third-party portal', () => {
    for (const s of LOCAL_BID_SOURCES) expect(s.listUrl).not.toMatch(/bidnet|opengov|bonfire|periscope|demandstar|govspend|bidexpress/i);
  });
});
