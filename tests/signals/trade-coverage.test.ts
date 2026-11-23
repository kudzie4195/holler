/**
 * Round 20 SCORE: the coverage arithmetic of the trade-by-metro scorecard (lib/signals/trade-coverage.ts, scripts/trade-coverage.ts) on small
 * hand-built row sets: span of days, call path, the 1-a-week and 7-of-10 rules, the gap reasons, and projected numbers kept apart from
 * measured ones. The engine itself is the live one (matchOne); these tests do not change or restate any label rule.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, type CategoryId } from '@/lib/signals/categories';
import { METROS } from '@/lib/geo/metros';
import { PROPOSED_LABELS, proposedLabelOf, proposedTierOf, type MetroId, type ProposedSource } from '@/lib/signals/proposed-labels';
import { RECORD_TYPES, recordTypeOf, TRADE_NEEDS } from '@/lib/signals/trade-needs';
import {
  addressTierOf,
  buildList,
  callPathOfRow,
  callPathRate,
  cellOf,
  COVER_MODES,
  isBlockText,
  summaryTierOf,
  covers,
  gapOf,
  headlineOf,
  markRows,
  measure,
  metroBuildList,
  projectedHeadline,
  projectedRate,
  projectGrid,
  sourceSpans,
  specCanGiveCallPath,
  wouldPay,
  type Card,
  type Centre,
  type CoverageRow,
  type Grid,
  type NeedSeen,
} from '@/lib/signals/trade-coverage';

const NOW = Date.parse('2026-12-07T00:00:00Z');
const noSpec = () => false;

const card = (source: string, label: Card['label'] = 'coming_soon', callPath: Card['callPath'] = 'exact', type: Card['type'] = 'permit'): Card => ({ source, type, label, callPath });

describe('span of days', () => {
  const rows = [
    { source: 'a', occurred_at: '2026-11-10T00:00:00Z' },
    { source: 'a', occurred_at: '2026-11-17T00:00:00Z' },
    { source: 'b', occurred_at: '2026-11-10T03:00:00Z' },
    { source: 'b', occurred_at: '2026-11-10T09:00:00Z' },
    { source: 'c', occurred_at: '2026-11-10T00:00:00Z' },
    { source: 'c', occurred_at: '2026-11-12T23:00:00Z' },
    { source: 'd', occurred_at: 'not a date' },
  ];
  it('range: newest minus oldest in days, at least 1 day', () => {
    const s = sourceSpans(rows);
    expect(s.get('a')).toBe(7);
    expect(s.get('b')).toBe(1); // 6 hours, floored to one day
    expect(s.get('c')).toBeCloseTo(2 + 23 / 24, 10);
    expect(s.has('d')).toBe(false);
  });
  it('calendar: distinct UTC dates', () => {
    const s = sourceSpans(rows, 'calendar');
    expect(s.get('a')).toBe(2);
    expect(s.get('b')).toBe(1);
    expect(s.get('c')).toBe(2);
  });
  it('each card counts 7 / its own source span, so sources held for different days meet on a weekly footing', () => {
    const spans = new Map([['long', 14], ['short', 2]]);
    const c = cellOf([card('long'), card('long'), card('short', 'act_now')], spans);
    expect(c.perWeek).toBeCloseTo(2 * (7 / 14) + 7 / 2, 10);
    expect(c.urgent).toBe(1);
    expect(c.headsUp).toBe(2);
    expect(c.urgentPerWeek).toBeCloseTo(3.5, 10);
    expect(c.headsUpPerWeek).toBeCloseTo(1, 10);
    expect(c.bySource.long.cards).toBe(2);
  });
  it('a source missing from the spans falls back to 14 days; a non-alert label is ignored', () => {
    const c = cellOf([card('x'), card('x', 'market_insight'), card('x', 'context')], new Map());
    expect(c.cards).toBe(1);
    expect(c.perWeek).toBeCloseTo(0.5, 10);
  });
});

describe('call path', () => {
  it('an exact address on the row summary (the live gate\'s own test) is the exact tier; a hundred-block is the block tier', () => {
    expect(callPathOfRow({ source: 's', summary: 'Reroofing | $10,225 job value | 3447 W 71ST PL' }, noSpec)).toBe('exact');
    expect(callPathOfRow({ source: 's', summary: 'MAINTAIN WINDOW | OPEN | 3600 block of W GRENSHAW ST' }, noSpec)).toBe('block');
  });
  it('a borough, a ZIP, a count or house number 0 is not a place', () => {
    expect(callPathOfRow({ source: 's', summary: 'HEAT/HOT WATER | ENTIRE BUILDING | BRONX' }, noSpec)).toBeNull();
    expect(callPathOfRow({ source: 's', summary: 'Rodent Baiting/Rat Complaint | Open | 60614' }, noSpec)).toBeNull();
    expect(callPathOfRow({ source: 's', summary: '10 stories' }, noSpec)).toBeNull();
    expect(callPathOfRow({ source: 's', summary: null }, noSpec)).toBeNull();
  });
  it('without an address, a source contact spec gives the upper-mode path only', () => {
    expect(callPathOfRow({ source: 'biz', summary: 'Locksmith' }, (s) => s === 'biz')).toBe('spec');
    expect(callPathOfRow({ source: 'other', summary: 'Locksmith' }, (s) => s === 'biz')).toBeNull();
  });
  it('a spec counts when it can store a site, a business or a typed contractor; an owner-only spec does not (switch off by default)', () => {
    expect(specCanGiveCallPath(undefined)).toBe(false);
    expect(specCanGiveCallPath({ site: { addressFields: ['a'] } })).toBe(true);
    expect(specCanGiveCallPath({ orgs: [{ role: 'contractor' }] })).toBe(true);
    expect(specCanGiveCallPath({ orgs: [{ role: 'business' }] })).toBe(true);
    expect(specCanGiveCallPath({ typedContractors: { pairs: [] } })).toBe(true);
    expect(specCanGiveCallPath({ orgs: [{ role: 'owner' }] })).toBe(false);
  });
  it('strict counts business and exact cards; upper counts those, block and spec cards; actionable counts all', () => {
    const spans = new Map([['s', 7]]);
    const c = cellOf([card('s', 'coming_soon', 'exact'), card('s', 'coming_soon', 'spec'), card('s', 'act_now', null)], spans);
    expect(c.perWeek).toBeCloseTo(3, 10);
    expect(c.addressPerWeek).toBeCloseTo(1, 10);
    expect(c.upperPerWeek).toBeCloseTo(2, 10);
    expect(covers(c, 'strict')).toBe(true);
    expect(covers(cellOf([card('s', 'coming_soon', 'spec')], spans), 'strict')).toBe(false);
    expect(covers(cellOf([card('s', 'coming_soon', 'spec')], spans), 'upper')).toBe(true);
  });
});

describe('the 1-a-week and 7-of-10 rules', () => {
  it('exactly one call-path card a week covers; just under does not', () => {
    expect(covers(cellOf([card('s')], new Map([['s', 7]])), 'strict')).toBe(true);
    expect(covers(cellOf(Array.from({ length: 7 }, () => card('s')), new Map([['s', 49]])), 'strict')).toBe(true); // 7 x 7/49 sums to 1 in floats
    expect(covers(cellOf([card('s')], new Map([['s', 7.5]])), 'strict')).toBe(false);
    expect(covers(cellOf([], new Map()), 'strict')).toBe(false);
  });
  it('a trade would pay at 7 metros covered, not at 6', () => {
    expect(wouldPay(6)).toBe(false);
    expect(wouldPay(7)).toBe(true);
    expect(wouldPay(10)).toBe(true);
  });
  it('the headline counts trades covering 7 of 10 metros', () => {
    const centres: Centre[] = METROS.map((m) => ({ id: m.id, label: m.label, lat: m.center.lat, lon: m.center.lon, state: m.states[0] }));
    const spans = new Map([['s', 7]]);
    const on = cellOf([card('s')], spans);
    const off = cellOf([], spans);
    const grid = {} as Grid;
    for (const tr of CATEGORY_IDS) grid[tr] = Object.fromEntries(centres.map((c) => [c.id, off]));
    centres.slice(0, 7).forEach((c) => (grid.roofing[c.id] = on));
    centres.slice(0, 6).forEach((c) => (grid.hvac[c.id] = on));
    centres.forEach((c) => (grid.plumbing[c.id] = on));
    const h = headlineOf(grid, centres, 'strict');
    expect(h.total).toBe(41);
    expect(h.paying).toBe(2);
    expect(h.trades.filter((t) => t.pays).map((t) => t.trade).sort()).toEqual(['plumbing', 'roofing']);
    expect(h.trades.find((t) => t.trade === 'hvac')!.covered).toHaveLength(6);
    expect(h.pct).toBeCloseTo((100 * 2) / 41, 10);
  });
});

// ---- the live engine on hand-built rows ------------------------------------------------------------------------------------------
const ATL: Centre = { id: 'atlanta', label: 'Atlanta', lat: 33.749, lon: -84.388, state: 'GA' };
const NYC: Centre = { id: 'new-york', label: 'New York', lat: 40.7143, lon: -74.006, state: 'NY' };
let nextId = 1;
const newHome = (over: Partial<CoverageRow> = {}): CoverageRow => ({
  id: nextId++,
  source: 'arcgis-cobb-residential-permits',
  kind: 'permit',
  title: 'New home permit in Cobb County',
  summary: 'New Home | $609,273 job value | 5900 SPARROW WAY | Cobb County',
  categories: ['general-contractor', 'real-estate', 'moving'],
  state: 'GA',
  severity: 1,
  occurred_at: '2026-11-16T12:00:00Z',
  data: { subtype: 'permit' },
  lat: 33.79,
  lon: -84.42,
  ...over,
});

describe('measure: the live engine on hand-built rows', () => {
  it('counts a new-home permit for the trades the engine alerts, at 7 / span cards a week, with its address as the call path', () => {
    const rows = [newHome(), newHome({ occurred_at: '2026-11-23T12:00:00Z', summary: 'New Home | $500,000 job value | 12 OAK ST | Cobb County' })];
    const spans = sourceSpans(rows);
    expect(spans.get('arcgis-cobb-residential-permits')).toBe(7);
    const m = measure(rows, [ATL], spans, noSpec, { nowMs: NOW }, ['real-estate', 'roofing'] as CategoryId[]);
    const re = m.grid['real-estate'].atlanta;
    expect(re.cards).toBe(2);
    expect(re.perWeek).toBeCloseTo(2, 10);
    expect(re.addressPerWeek).toBeCloseTo(2, 10);
    expect(re.byType.permit?.cards).toBe(2);
    expect(m.grid.roofing.atlanta.cards).toBe(0);
    expect(m.presence.atlanta.permit).toBe(2);
  });
  it('leaves out a row beyond 25 miles, a follower and a probation source, as the matcher does', () => {
    const rows = [
      newHome(),
      newHome({ lat: 34.4, lon: -84.42 }), // about 45 miles north
      newHome({ data: { subtype: 'permit', projectOf: 'arcgis-cobb-residential-permits:1' } }),
      newHome({ source: 'arcgis-phoenix-permits' }), // a round 19 probation source
    ];
    const m = measure(rows, [ATL], new Map([['arcgis-cobb-residential-permits', 7], ['arcgis-phoenix-permits', 7]]), noSpec, { nowMs: NOW }, ['real-estate'] as CategoryId[]);
    expect(m.grid['real-estate'].atlanta.cards).toBe(1);
    expect(m.presence.atlanta.permit).toBe(1);
  });
  it('a row without an address gives actionable cards but no call path (the no-call-path gap)', () => {
    const rows = [newHome({ summary: 'New Home | Cobb County' })];
    const m = measure(rows, [ATL], new Map([['arcgis-cobb-residential-permits', 1]]), noSpec, { nowMs: NOW }, ['real-estate'] as CategoryId[]);
    const c = m.grid['real-estate'].atlanta;
    expect(c.perWeek).toBeCloseTo(7, 10);
    expect(c.addressPerWeek).toBe(0);
    expect(gapOf('real-estate', 'atlanta', c, m.seen['real-estate'].atlanta, m.presence.atlanta, 'strict')?.reason).toBe('no-call-path');
  });
  it('NYC heat: the ingest marks make one HVAC card for the building\'s third complaint in 48 hours, with no call path (borough only)', () => {
    const heat = (h: number): CoverageRow => ({
      id: nextId++,
      source: 'socrata-nyc-311',
      kind: 'civic',
      title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING',
      summary: 'HEAT/HOT WATER | ENTIRE BUILDING | BRONX',
      categories: ['hvac', 'plumbing'],
      state: 'NY',
      severity: 1,
      occurred_at: new Date(Date.parse('2026-11-17T02:00:00Z') + h * 3_600_000).toISOString(),
      data: { subtype: '311' },
      lat: 40.8301,
      lon: -73.9202,
    });
    const { rows, counts } = markRows([heat(0), heat(1), heat(2)]);
    expect(counts.heat).toBe(1);
    const m = measure(rows, [NYC], new Map([['socrata-nyc-311', 7]]), noSpec, { nowMs: NOW }, ['hvac'] as CategoryId[]);
    expect(m.grid.hvac['new-york'].urgent).toBe(1);
    expect(m.grid.hvac['new-york'].addressPerWeek).toBe(0);
  });
});

describe('gap reasons', () => {
  const spans = new Map([['s', 7]]);
  const seen = (o: Partial<NeedSeen> = {}): NeedSeen => ({ neededRows: 0, alert: 0, background: 0, context: 0, notCarried: 0, ...o });
  it('covered cells have no gap', () => {
    expect(gapOf('roofing', 'x', cellOf([card('s')], spans), seen(), {}, 'strict')).toBeNull();
  });
  it('orders: no-call-path, too-few, feed-only, not-for-trade, no-source', () => {
    expect(gapOf('roofing', 'x', cellOf([card('s', 'coming_soon', null)], spans), seen(), {}, 'strict')!.reason).toBe('no-call-path');
    expect(gapOf('roofing', 'x', cellOf([card('s', 'coming_soon', null)], new Map([['s', 14]])), seen(), {}, 'strict')!.reason).toBe('too-few');
    expect(gapOf('roofing', 'x', cellOf([], spans), seen({ neededRows: 3, background: 1, notCarried: 2 }), { 'code-violation': 3 }, 'strict')!.reason).toBe('feed-only');
    expect(gapOf('roofing', 'x', cellOf([], spans), seen({ neededRows: 3, context: 3 }), { 'code-violation': 3 }, 'strict')!.reason).toBe('feed-only');
    expect(gapOf('roofing', 'x', cellOf([], spans), seen({ neededRows: 3, notCarried: 3 }), { 'code-violation': 3 }, 'strict')!.reason).toBe('not-for-trade');
    expect(gapOf('roofing', 'x', cellOf([], spans), seen(), { permit: 10 }, 'strict')!.reason).toBe('no-source');
  });
  it('lists the record types the trade acts on that have no row in the area', () => {
    const g = gapOf('roofing', 'x', cellOf([], spans), seen(), { 'storm-report': 2 }, 'strict')!;
    expect(g.missingTypes).toEqual(TRADE_NEEDS.roofing.acts.filter((t) => t !== 'storm-report'));
  });
  it('build lists count only uncovered cells whose missing type is proven for that trade elsewhere', () => {
    const rows = [newHome(), newHome({ summary: 'New Home | $1 job value | 7 ELM ST | Cobb County' })];
    const m = measure(rows, [ATL, NYC], new Map([['arcgis-cobb-residential-permits', 2]]), noSpec, { nowMs: NOW }, ['real-estate', 'roofing'] as CategoryId[]);
    // real-estate: covered in Atlanta by permits, uncovered in New York where there is no permit row: a proven permit cell.
    const b = buildList(m, [ATL, NYC], 'strict', ['real-estate', 'roofing'] as CategoryId[]);
    const permit = b.find((x) => x.type === 'permit');
    expect(permit?.provenCells).toBe(1);
    const mb = metroBuildList(m, [ATL, NYC], 'strict', ['real-estate', 'roofing'] as CategoryId[]);
    expect(mb.find((x) => x.metro === 'new-york' && x.type === 'permit')?.provenTrades).toEqual(['real-estate']);
    // roofing does not act on permits (its own permits are taken jobs): no permit cell for roofing.
    expect(mb.filter((x) => x.type === 'permit').every((x) => !x.provenTrades.includes('roofing'))).toBe(true);
  });
});

describe('projection: proposed sources are added apart from the measured grid', () => {
  const centres: Centre[] = METROS.map((m) => ({ id: m.id, label: m.label, lat: m.center.lat, lon: m.center.lon, state: m.states[0] }));
  const spans = new Map([['s', 7]]);
  const grid = (): Grid => {
    const g = {} as Grid;
    for (const tr of CATEGORY_IDS) g[tr] = Object.fromEntries(centres.map((c) => [c.id, cellOf([], spans)]));
    for (const id of ['new-york', 'los-angeles', 'chicago', 'atlanta', 'washington-dc', 'miami']) g.moving[id] = cellOf([card('s')], spans);
    return g;
  };
  const sale: ProposedSource = {
    metros: ['houston', 'phoenix'],
    recordKind: 'property-sale',
    expectedRowsPerWeekPerMetro: 10,
    volumeEvidence: { tag: 'A', note: 'test' },
    labels: { moving: 'coming_soon', cleaning: { label: 'coming_soon', share: 0.05 }, 'real-estate': 'market_insight' },
    callPath: true,
  };
  it('with no proposed source the projection equals the measured numbers', () => {
    const g = grid();
    const p = projectGrid(g, centres, {});
    for (const tr of CATEGORY_IDS) for (const c of centres) expect(projectedRate(p[tr][c.id], 'strict')).toBe(g[tr][c.id].addressPerWeek);
    expect(projectedHeadline(p, centres, 'strict').paying).toBe(headlineOf(g, centres, 'strict').paying);
  });
  it('adds expected volume x share to the listed metros for alert labels only, and never changes the measured grid', () => {
    const g = grid();
    const before = JSON.stringify(g);
    const p = projectGrid(g, centres, { 'test-sales': sale });
    expect(JSON.stringify(g)).toBe(before);
    expect(p.moving.houston.addedCallPathPerWeek).toBe(10);
    expect(p.moving.houston.measured.addressPerWeek).toBe(0);
    expect(p.moving.houston.from).toEqual(['test-sales']);
    expect(p.cleaning.phoenix.addedCallPathPerWeek).toBeCloseTo(0.5, 10); // share 0.05: below one a week
    expect(p['real-estate'].houston.addedPerWeek).toBe(0); // feed-only label adds nothing
    expect(p.moving.miami.addedPerWeek).toBe(0); // metro not listed
    // moving: 6 measured + 2 projected = 8 -> pays in the projection only
    expect(headlineOf(g, centres, 'strict').trades.find((t) => t.trade === 'moving')!.pays).toBe(false);
    expect(projectedHeadline(p, centres, 'strict').trades.find((t) => t.trade === 'moving')!.pays).toBe(true);
    expect(projectedHeadline(p, centres, 'strict').trades.find((t) => t.trade === 'cleaning')!.covered).toHaveLength(0);
  });
  it('a source with no call path adds actionable cards but no call-path cards', () => {
    const p = projectGrid(grid(), centres, { x: { ...sale, callPath: false } });
    expect(p.moving.houston.addedPerWeek).toBe(10);
    expect(p.moving.houston.addedCallPathPerWeek).toBe(0);
    expect(projectedHeadline(p, centres, 'strict').trades.find((t) => t.trade === 'moving')!.pays).toBe(false);
  });
  it('proposedLabelOf reads a bare label as share 1 and clamps a share to 0..1', () => {
    expect(proposedLabelOf('act_now')).toEqual({ label: 'act_now', share: 1 });
    expect(proposedLabelOf({ label: 'coming_soon', share: 3 })).toEqual({ label: 'coming_soon', share: 1 });
    expect(proposedLabelOf({ label: 'coming_soon', share: -1 })).toEqual({ label: 'coming_soon', share: 0 });
    expect(proposedLabelOf(undefined)).toBeNull();
  });
});

describe('tables the scorecard reads', () => {
  it('MetroId lists exactly the ids of lib/geo/metros.ts', () => {
    const ids: MetroId[] = ['new-york', 'los-angeles', 'chicago', 'dallas-fort-worth', 'houston', 'atlanta', 'washington-dc', 'philadelphia', 'miami', 'phoenix'];
    expect([...ids].sort()).toEqual(METROS.map((m) => m.id).sort());
  });
  it('TRADE_NEEDS has every trade, each with record types that exist and a one-line reason', () => {
    const types = new Set(RECORD_TYPES.map((r) => r.id));
    expect(Object.keys(TRADE_NEEDS).sort()).toEqual([...CATEGORY_IDS].sort());
    for (const tr of CATEGORY_IDS) {
      expect(TRADE_NEEDS[tr].acts.length).toBeGreaterThan(0);
      for (const t of TRADE_NEEDS[tr].acts) expect(types.has(t)).toBe(true);
      expect(TRADE_NEEDS[tr].why).toMatch(/\S/);
      expect(TRADE_NEEDS[tr].why).not.toMatch(/\n/);
    }
  });
  it('recordTypeOf reads the national feeds by source and the city feeds by subtype', () => {
    expect(recordTypeOf({ source: 'nws' })).toBe('weather-alert');
    expect(recordTypeOf({ source: 'spc' })).toBe('storm-report');
    expect(recordTypeOf({ source: 'sam-gov', kind: 'contract' })).toBe('public-bid');
    expect(recordTypeOf({ source: 'socrata-chicago-violations', data: { subtype: 'violation' } })).toBe('code-violation');
    expect(recordTypeOf({ source: 'socrata-nyc-311', data: { subtype: '311' } })).toBe('311-request');
    expect(recordTypeOf({ source: 'socrata-nyc-business', data: { subtype: 'business' } })).toBe('business-licence');
    expect(recordTypeOf({ source: 'x', kind: 'permit' })).toBe('permit');
    expect(recordTypeOf({ source: 'x', kind: 'mystery' })).toBe('other');
  });
  it('every proposed source entry (filled by other units) is well formed', () => {
    const metroIds = new Set(METROS.map((m) => m.id));
    const types = new Set(RECORD_TYPES.map((r) => r.id));
    for (const [id, s] of Object.entries(PROPOSED_LABELS)) {
      expect(id).toMatch(/\S/);
      expect(s.metros.length).toBeGreaterThan(0);
      for (const m of s.metros) expect(metroIds.has(m)).toBe(true);
      expect(types.has(s.recordKind)).toBe(true);
      expect(Number.isFinite(s.expectedRowsPerWeekPerMetro) && s.expectedRowsPerWeekPerMetro >= 0).toBe(true);
      expect(['O', '3P', 'A']).toContain(s.volumeEvidence.tag);
      expect(s.volumeEvidence.note).toMatch(/\S/);
      for (const tr of Object.keys(s.labels)) expect((CATEGORY_IDS as string[]).includes(tr)).toBe(true);
    }
  });
});

// Round 20 integration (owner decision): a BLOCK-level address counts as a place to go. A card's call path has three tiers (business,
// exact address, block address); strict = business or exact, 'block' = all three (the official headline), upper = block or a source spec.
describe('call path tiers (round 20 integration: a block-level address counts as a place to go)', () => {
  const spans = new Map([['s', 7]]);
  it('a stored business contact with a name is the business tier, before any address', () => {
    expect(callPathOfRow({ source: 's', summary: '3600 block of W GRENSHAW ST', contacts: [{ role: 'contractor', name: 'Acme Roofing LLC' }] }, noSpec)).toBe('business');
    expect(callPathOfRow({ source: 's', summary: 'Reroof', contacts: [{ role: 'contractor', name: '  ' }] }, noSpec)).toBeNull();
  });
  it('a stored site contact gives exact or block by its own address; an exact address beats a block', () => {
    expect(callPathOfRow({ source: 's', summary: 'HEAT/HOT WATER | ENTIRE BUILDING | BRONX', contacts: [{ role: 'site', name: '', address: '6800 block of 4 AVENUE' }] }, noSpec)).toBe('block');
    expect(callPathOfRow({ source: 's', summary: 'Reroof', contacts: [{ role: 'site', name: '', address: '3447 W 71ST PL' }] }, noSpec)).toBe('exact');
    expect(callPathOfRow({ source: 's', summary: '3600 block of W GRENSHAW ST | 12 OAK ST', contacts: [] }, noSpec)).toBe('exact');
    expect(callPathOfRow({ source: 's', summary: 'Price band: $250k to $500k | Condo | 0-99 block of WEST STREET' }, noSpec)).toBe('block');
    expect(callPathOfRow({ source: 's', summary: 'Open | 41-00 block of BOWNE STREET' }, noSpec)).toBe('block');
  });
  it('summaryTierOf and addressTierOf agree with the live gate: no place, no tier', () => {
    expect(summaryTierOf('HEAT/HOT WATER | ENTIRE BUILDING | BRONX')).toBeNull();
    expect(summaryTierOf(null)).toBeNull();
    expect(addressTierOf('0 block of MAIN ST')).toBeNull();
    expect(addressTierOf('1200 block of Main St')).toBe('block');
    expect(addressTierOf('1200 Main St')).toBe('exact');
    expect(isBlockText('Block Island Rd')).toBe(false);
  });
  it('a block card covers with block level and upper, never strict; business and exact cover all three', () => {
    const blockCell = cellOf([card('s', 'coming_soon', 'block')], spans);
    expect(blockCell.blockPerWeek).toBeCloseTo(1, 10);
    expect(blockCell.addressPerWeek).toBeCloseTo(1, 10);
    expect(covers(blockCell, 'strict')).toBe(false);
    expect(covers(blockCell, 'block')).toBe(true);
    expect(covers(blockCell, 'upper')).toBe(true);
    for (const t of ['business', 'exact'] as const) for (const m of COVER_MODES) expect(covers(cellOf([card('s', 'coming_soon', t)], spans), m), `${t} ${m}`).toBe(true);
    const spec = cellOf([card('s', 'coming_soon', 'spec')], spans);
    expect([covers(spec, 'strict'), covers(spec, 'block'), covers(spec, 'upper')]).toEqual([false, false, true]);
  });
  it('tiers add up: half a week of exact plus half a week of block covers with block, not strict', () => {
    const c = cellOf([card('s', 'coming_soon', 'exact'), card('s', 'coming_soon', 'block')], new Map([['s', 14]]));
    expect(c.exactPerWeek).toBeCloseTo(0.5, 10);
    expect(c.blockPerWeek).toBeCloseTo(0.5, 10);
    expect(callPathRate(c, 'strict')).toBeCloseTo(0.5, 10);
    expect(callPathRate(c, 'block')).toBeCloseTo(1, 10);
    expect(covers(c, 'strict')).toBe(false);
    expect(covers(c, 'block')).toBe(true);
  });
  it('the headline differs by mode on the same grid', () => {
    const centres: Centre[] = METROS.map((m) => ({ id: m.id, label: m.label, lat: m.center.lat, lon: m.center.lon, state: m.states[0] }));
    const g = {} as Grid;
    for (const tr of CATEGORY_IDS) g[tr] = Object.fromEntries(centres.map((c) => [c.id, cellOf([], spans)]));
    centres.slice(0, 7).forEach((c, i) => (g.fencing[c.id] = cellOf([card('s', 'coming_soon', i < 4 ? 'exact' : 'block')], spans)));
    expect(headlineOf(g, centres, 'strict').paying).toBe(0);
    expect(headlineOf(g, centres, 'block').paying).toBe(1);
    expect(headlineOf(g, centres, 'upper').paying).toBe(1);
  });
  it('measure: a Chicago-style violation row with a block summary is a block card', () => {
    const row: CoverageRow = {
      id: 9001, source: 'socrata-chicago-violations', kind: 'civic', title: 'Code violation in Chicago: MAINTAIN WINDOW', summary: 'MAINTAIN WINDOW | OPEN | 3600 block of W GRENSHAW ST',
      categories: ['windows-doors'], state: 'IL', severity: 2, occurred_at: '2026-11-17T12:00:00Z', data: { subtype: 'violation' }, lat: 41.8781, lon: -87.6298,
    };
    const CHI: Centre = { id: 'chicago', label: 'Chicago', lat: 41.8781, lon: -87.6298, state: 'IL' };
    const m = measure([row], [CHI], new Map([['socrata-chicago-violations', 7]]), noSpec, { nowMs: NOW }, ['windows-doors'] as CategoryId[]);
    const c = m.grid['windows-doors'].chicago;
    expect(c.cards).toBe(1);
    expect(c.blockPerWeek).toBeCloseTo(c.perWeek, 10);
    expect(c.exactPerWeek).toBe(0);
    expect(covers(c, 'strict')).toBe(false);
    expect(covers(c, 'block')).toBe(true);
    // A custom path (the script's projected pass) is honoured and never changes the default measurement.
    const m2 = measure([row], [CHI], new Map([['socrata-chicago-violations', 7]]), noSpec, { nowMs: NOW }, ['windows-doors'] as CategoryId[], () => 'exact');
    expect(m2.grid['windows-doors'].chicago.exactPerWeek).toBeCloseTo(c.perWeek, 10);
  });
  it('projection: a block-only proposed source counts with block and upper, never strict; a strict one counts everywhere', () => {
    const centres: Centre[] = METROS.map((m) => ({ id: m.id, label: m.label, lat: m.center.lat, lon: m.center.lon, state: m.states[0] }));
    const g = {} as Grid;
    for (const tr of CATEGORY_IDS) g[tr] = Object.fromEntries(centres.map((c) => [c.id, cellOf([], spans)]));
    const src: ProposedSource = { metros: ['houston'], recordKind: 'property-sale', expectedRowsPerWeekPerMetro: 10, volumeEvidence: { tag: 'A', note: 't' }, labels: { moving: 'coming_soon' }, callPath: false, blockPath: true };
    const p = projectGrid(g, centres, { b: src });
    expect(p.moving.houston.addedBlockPerWeek).toBe(10);
    expect(p.moving.houston.addedCallPathPerWeek).toBe(0);
    expect(projectedRate(p.moving.houston, 'strict')).toBe(0);
    expect(projectedRate(p.moving.houston, 'block')).toBe(10);
    expect(projectedRate(p.moving.houston, 'upper')).toBe(10);
    const q = projectGrid(g, centres, { e: { ...src, callPath: true } });
    expect(q.moving.houston.addedCallPathPerWeek).toBe(10);
    expect(q.moving.houston.addedBlockPerWeek).toBe(0);
    for (const m of COVER_MODES) expect(projectedRate(q.moving.houston, m)).toBe(10);
    expect(proposedTierOf({ callPath: false })).toBeNull();
    expect(proposedTierOf({ callPath: true, callPathTier: 'business' })).toBe('business');
  });
  it('the proposed entries say their tier honestly: violations and home sales are block-only, a commercial sale is exact', () => {
    for (const [id, s] of Object.entries(PROPOSED_LABELS)) {
      if (s.recordKind === 'code-violation') expect(proposedTierOf(s), id).toBe('block');
      if (s.recordKind === 'property-sale') expect(proposedTierOf(s), id).toBe(id.endsWith(':commercial') ? 'exact' : 'block');
      if (s.blockPath) expect(s.callPath, `${id}: blockPath is for rows with no strict call path`).toBe(false);
    }
  });
});
