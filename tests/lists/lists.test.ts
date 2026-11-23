/**
 * Round 18, unit LISTS (PLAN-2.0 item 3.3): storm-path and neighborhood address lists. Radius maths with real coordinates, no owner or
 * contact names in any output, complaint kinds never listed, the damage line in both languages, the print view, the empty state, and member
 * isolation (one member's area or storm never appears for another).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));

import { haversineMi } from '@/lib/geo';
import { spanishProblems } from '@/lib/i18n/rules';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import {
  AREA_LIST_TRADES,
  areaListTrades,
  buildingAddress,
  buildList,
  createsWorkFor,
  DAMAGE_LINE,
  entryOf,
  groupEntries,
  isListablePermit,
  MAX_LIST_ADDRESSES,
  permitTypeOf,
  STORM_RADIUS_MI,
  stormKindOf,
  stormListLabel,
  type ListEntry,
  type PermitRow,
  type StormRow,
} from '@/lib/lists/core';
import { boxFilter, loadAreaList, loadStormList, loadStormReport, loadStormReports, PERMIT_COLUMNS, STORM_COLUMNS, stormCardLinks, type ListProfile } from '@/lib/lists/load';
import { listLinkFor } from '@/lib/lists/card';
import { ListSheet } from '@/components/lists/list-sheet';
import { DoorHanger, HANGER_TEXT, hangerLines } from '@/components/lists/door-hanger';
import { readFileSync } from 'node:fs';
import { scanSpc } from '@/lib/signals/adapters/spc';
import { loadAreaCounts, ROW_CAP } from '@/lib/lists/load';
import { Feed, type FeedItem } from '@/components/feed';

// The rules of tests/signals/ship-banned-words.test.ts (copied: importing that file would run its suites here too).
const BANNED: [string, RegExp][] = [
  ['lead', /\bleads?\b/i],
  ['they need you', /they need you/i],
  ['you will win', /you(?:'ll| will) win/i],
  ['guaranteed', /guarantee[ds]?\b/i],
  ['official record', /official records?\b/i],
  ['proves damage', /\bproves?\b[^.]*\b(?:damage|hir)/i],
];

const NOW = new Date('2026-11-22T15:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

// Real places. Smyrna, GA city hall and Marietta Square are 5.2 miles apart; Longview, TX is a real SPC report town.
const SMYRNA = { lat: 33.8839, lon: -84.5144 };
const MARIETTA = { lat: 33.9526, lon: -84.5499 };
const NORTH_1_8 = { lat: 33.91, lon: -84.5144 }; // 1.80 mi north of Smyrna city hall
const NORTH_2_3 = { lat: 33.9169, lon: -84.5144 }; // 2.28 mi north
const LONGVIEW = { lat: 32.5007, lon: -94.7405 };

let nid = 1000;
function permit(over: Partial<PermitRow> = {}): PermitRow {
  return {
    id: nid++,
    source: 'arcgis-atlanta-permits',
    kind: 'permit',
    title: 'Roof permit in Smyrna',
    summary: 'Re-roof | $12,000 job value | 2318 CHURCH ST',
    url: 'https://example.gov/permits',
    ...SMYRNA,
    city: 'Smyrna',
    state: 'GA',
    zip: '30080',
    occurred_at: day(3),
    subtype: 'permit',
    approxLocation: null,
    loc: null,
    projectOf: null,
    ...over,
  };
}
function storm(over: Partial<StormRow> = {}): StormRow {
  return {
    id: 501,
    source: 'spc',
    kind: 'report',
    title: '1.75 inch hail reported near 1 N Smyrna, GA',
    ...SMYRNA,
    city: 'Smyrna',
    state: 'GA',
    county: 'Cobb',
    occurred_at: day(2),
    url: 'https://www.spc.noaa.gov/climo/reports/261120_rpts.html',
    categories: ['roofing', 'auto-glass', 'auto-body', 'restoration', 'insurance', 'public-adjuster'],
    stormType: 'hail',
    hailInches: '1.75',
    windMph: null,
    comments: 'Quarter to golf ball hail. Reported by John Doe.',
    ...over,
  };
}

const textOf = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// ---- a small fake PostgREST client: records the calls, honours eq filters (RLS stand-in) and returns the rows of a table ----------
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, object[]>) {
  const calls: { table: string; cols: string; filters: string[] }[] = [];
  const db = {
    from: (table: string) => {
      const q = { table, cols: '', filters: [] as string[] };
      calls.push(q);
      const eqs: [string, unknown][] = [];
      const chain: Record<string, unknown> = {};
      const add = (name: string) => (...args: unknown[]) => (q.filters.push(`${name}:${args.map(String).join(',')}`), chain);
      for (const m of ['neq', 'overlaps', 'gte', 'lte', 'order', 'limit', 'not', 'is', 'or', 'in']) chain[m] = add(m);
      chain.eq = (col: string, v: unknown) => (q.filters.push(`eq:${col},${String(v)}`), eqs.push([col, v]), chain);
      chain.select = (c: string) => ((q.cols = c), chain);
      chain.then = (res: (v: unknown) => unknown) => {
        // "signal.source" reads the embedded row, as PostgREST filters an aliased !inner embed.
        const at = (r: Row, c: string) => c.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Row)[k] : undefined), r);
        const rows = ((tables[table] ?? []) as Row[]).filter((r) => eqs.every(([c, v]) => String(at(r, c)) === String(v)));
        return Promise.resolve(res({ data: rows, error: null }));
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}

const member = (over: Partial<ListProfile> = {}): ListProfile => ({
  user_id: 'user-a',
  categories: ['roofing', 'landscaping', 'painting'],
  ...SMYRNA,
  state: 'GA',
  radius_mi: 3,
  plan: 'starter',
  subscription_status: 'active',
  extra_areas: null,
  keywords: null,
  ...over,
});

describe('radius maths with real coordinates', () => {
  it('the test points are where the test says they are', () => {
    expect(haversineMi(SMYRNA.lat, SMYRNA.lon, MARIETTA.lat, MARIETTA.lon)).toBeCloseTo(5.16, 1);
    expect(haversineMi(SMYRNA.lat, SMYRNA.lon, NORTH_1_8.lat, NORTH_1_8.lon)).toBeCloseTo(1.8, 1);
    expect(haversineMi(SMYRNA.lat, SMYRNA.lon, NORTH_2_3.lat, NORTH_2_3.lon)).toBeCloseTo(2.28, 1);
  });
  it('a storm list keeps permits within 2 miles of the report point and drops the rest', () => {
    expect(STORM_RADIUS_MI).toBe(2);
    const rows = [
      permit({ summary: 'Re-roof | 100 ATLANTA RD', ...SMYRNA }),
      permit({ summary: 'Re-roof | 200 CONCORD RD', ...NORTH_1_8 }),
      permit({ summary: 'Re-roof | 300 SPRING RD', ...NORTH_2_3 }),
      permit({ summary: 'Re-roof | 400 ROSWELL ST', ...MARIETTA }),
    ];
    const list = buildList(rows, { center: { ...SMYRNA, radiusMi: STORM_RADIUS_MI } });
    expect(list.entries.map((e) => e.address).sort()).toEqual(['100 ATLANTA RD', '200 CONCORD RD']);
    expect(list.entries.find((e) => e.address === '200 CONCORD RD')?.distanceMi).toBe(1.8);
  });
  it('the query box always contains the circle (Longview, TX and Smyrna, GA)', () => {
    for (const p of [LONGVIEW, SMYRNA]) {
      const f = boxFilter(p.lat, p.lon, STORM_RADIUS_MI);
      const n = (k: string) => Number(new RegExp(`${k}\\.([-\\d.]+)`).exec(f)?.[1]);
      const [latLo, lonLo] = [Number(/lat\.gte\.([-\d.]+)/.exec(f)?.[1]), Number(/lon\.gte\.([-\d.]+)/.exec(f)?.[1])];
      expect(haversineMi(p.lat, p.lon, latLo, p.lon)).toBeGreaterThanOrEqual(STORM_RADIUS_MI);
      expect(haversineMi(p.lat, p.lon, p.lat, lonLo)).toBeGreaterThanOrEqual(STORM_RADIUS_MI);
      expect(n('lat.lte')).toBeGreaterThan(p.lat);
    }
  });
  it('a permit placed at a stand-in point (Cobb County seat, a city centre) is never in a storm list', () => {
    const rows = [
      permit({ source: 'arcgis-cobb-residential-permits', loc: 'approx', approxLocation: 'true', summary: 'Residential | 12 OAK ST | Cobb County', ...SMYRNA }),
      permit({ source: 'socrata-dallas-permits', approxLocation: 'true', summary: 'Re-roof | 14 ELM ST', ...SMYRNA }),
    ];
    expect(buildList(rows, { center: { ...SMYRNA, radiusMi: 2 } }).entries).toEqual([]);
  });
});

describe('addresses only: no owner or contact names', () => {
  it('a name typed after the street is cut, and so is a unit (multi-unit records show the building address)', () => {
    expect(buildingAddress('Re-roof | 123 MAIN ST JOHN SMITH')).toBe('123 MAIN ST');
    expect(buildingAddress('Remodel | 12 OAK ST APT 4')).toBe('12 OAK ST');
    expect(buildingAddress('Remodel | 12 OAK ST #5B')).toBe('12 OAK ST');
    expect(buildingAddress('Remodel | 2300 block of W 47TH ST')).toBeNull();
    expect(buildingAddress('Remodel | owner JANE DOE 404-555-0100')).toBeNull();
  });
  it('two units of one building make one line', () => {
    const list = buildList(
      [permit({ summary: 'Remodel | 12 OAK ST APT 4', occurred_at: day(5) }), permit({ summary: 'Remodel | 12 OAK ST #5', occurred_at: day(2) })],
      { center: { ...SMYRNA, radiusMi: 2 } },
    );
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ address: '12 OAK ST', date: day(2).slice(0, 10) });
  });
  it('an entry has only the listed fields, and the rendered list carries no name from the record', () => {
    const rows = [permit({ summary: 'Re-roof | $9,000 job value | 77 KING ST MARY JONES', title: 'Roof permit in Smyrna' })];
    const list = buildList(rows, { center: { ...SMYRNA, radiusMi: 2 } });
    expect(Object.keys(list.entries[0]).sort()).toEqual(['address', 'city', 'date', 'distanceMi', 'permitType', 'state', 'url', 'zip']);
    const html = renderToStaticMarkup(createElement(ListSheet, { lang: 'en', heading: 'H', notes: [], damageLines: DAMAGE_LINE, entries: list.entries, total: list.total, capped: list.capped }));
    expect(html).toContain('77 KING ST');
    expect(html).not.toMatch(/MARY|JONES|John Doe|9,000/);
  });
  it('the loader never reads contacts or whole data blobs, and never returns storm remarks', async () => {
    expect(PERMIT_COLUMNS).not.toMatch(/contact|owner|applicant|data,|data\)|\bdata$/);
    expect(STORM_COLUMNS).not.toMatch(/contact|owner/);
    const { db, calls } = fakeDb({ holler_matches: [{ user_id: 'user-a', signal_id: 501, signal: storm() }] });
    const reports = await loadStormReports(db, member(), NOW);
    expect(calls.every((c) => c.table === 'holler_matches' || c.table === 'holler_signals')).toBe(true);
    expect(JSON.stringify(reports)).not.toMatch(/John Doe|comments/);
  });
});

describe('only building permits are listed: complaint kinds never', () => {
  const near = { ...SMYRNA };
  it('311, violation, inspection, business and event rows are dropped, whatever their kind says', () => {
    for (const r of [
      permit({ kind: 'civic', subtype: '311', source: 'socrata-nyc-311', ...near }),
      permit({ kind: 'civic', subtype: 'violation', source: 'socrata-chicago-violations', ...near }),
      permit({ kind: 'permit', subtype: 'violation', ...near }),
      permit({ kind: 'civic', subtype: 'inspection', ...near }),
      permit({ kind: 'civic', subtype: 'business', ...near }),
      permit({ kind: 'event', subtype: 'event-permit', ...near }),
      permit({ kind: 'permit', subtype: null, ...near }),
      permit({ source: 'holler-request', ...near }),
      permit({ projectOf: '77', ...near }),
    ]) {
      expect(isListablePermit(r)).toBe(false);
      expect(buildList([r], { center: { ...SMYRNA, radiusMi: 2 } }).entries).toEqual([]);
    }
    expect(isListablePermit(permit())).toBe(true);
  });
  it('the read asks for kind = permit only', async () => {
    const { db, calls } = fakeDb({ holler_signals: [] });
    await loadStormList(db, SMYRNA, NOW);
    expect(calls[0].filters).toContain('eq:kind,permit');
  });
});

describe('which storm reports make a list', () => {
  it('hail of 1 inch or more and wind damage only; gusts without damage, tornadoes and NWS alerts make none', () => {
    expect(stormKindOf(storm())).toBe('hail');
    expect(stormKindOf(storm({ title: '1.00 inch hail reported near X', hailInches: '1' }))).toBe('hail');
    expect(stormKindOf(storm({ title: '0.75 inch hail reported near X', hailInches: '0.75' }))).toBeNull();
    // Review 2: an UNK-speed report lists only when its OWN remark names damage to a thing; the stored title proves nothing.
    expect(stormKindOf(storm({ stormType: 'wind', title: 'Wind damage reported near X', hailInches: null, comments: 'Trees down.' }))).toBe('wind');
    expect(stormKindOf(storm({ stormType: 'wind', title: 'Wind damage reported near X', hailInches: null, comments: '' }))).toBeNull();
    expect(stormKindOf(storm({ stormType: 'wind', title: '61 mph wind gust reported near X', windMph: '61', comments: 'Trees down on Main St.' }))).toBe('wind');
    expect(stormKindOf(storm({ stormType: 'wind', title: '61 mph wind gust reported near X', windMph: '61', comments: 'Measured by ASOS.' }))).toBeNull();
    expect(stormKindOf(storm({ stormType: 'torn', title: 'Tornado reported near X' }))).toBeNull();
    expect(stormKindOf(storm({ source: 'nws', stormType: null, title: 'Severe Thunderstorm Warning: Cobb, GA' }))).toBeNull();
  });
  it('a report older than 14 days, or without a point, makes no list', () => {
    expect(stormListLabel(storm(), ['roofing'], NOW.getTime())).toBe('act_now');
    expect(stormListLabel(storm({ occurred_at: day(15) }), ['roofing'], NOW.getTime())).toBeNull();
    expect(stormListLabel(storm({ lat: null }), ['roofing'], NOW.getTime())).toBeNull();
    // Round 18 integration (step 2): the storm rule reads the report's own damage flag, not the title, so a measured gust whose remark names
    // damage ("trees down") is act_now like an UNK damage report. It was coming_soon from its "wind gust" title.
    expect(stormListLabel(storm({ stormType: 'wind', title: '61 mph wind gust reported near X', windMph: '61', comments: 'trees down' }), ['tree-service'], NOW.getTime())).toBe('act_now');
    expect(stormListLabel(storm({ stormType: 'wind', title: '61 mph wind gust reported near X', windMph: '61', comments: 'Measured gust.' }), ['tree-service'], NOW.getTime())).toBeNull();
  });
});

describe('neighborhood lists: the existing downstream rules', () => {
  it('new homes for landscaping and cleaning, re-roofs for gutters; never the trade doing the work; never a commercial fit-out', () => {
    const newHome = permit({ title: 'New home permit in Smyrna', summary: 'New | 1 or 2 Family Dwelling | 5 PINE CT' });
    const remodel = permit({ title: 'Remodel permit in Smyrna', summary: 'Alteration | Single Family | 9 ASH LN' });
    const commercial = permit({ title: 'Remodel permit in Smyrna', summary: 'Alteration | Commercial | 1 MARKET ST' });
    expect(createsWorkFor(newHome, 'landscaping')).toBe(true);
    expect(createsWorkFor(newHome, 'cleaning')).toBe(true);
    expect(createsWorkFor(permit(), 'siding-gutters')).toBe(true);
    // Round 19 integration: the round 19 rules made these feed only (owner call 7: new home for fencing; owner call 2: remodel for
    // painters), so they make no list line either: a list holds exactly the downstream heads-up the member's feed would show.
    expect(createsWorkFor(newHome, 'fencing')).toBe(false);
    expect(createsWorkFor(remodel, 'painting')).toBe(false);
    // a finished stage (migration 0025) brings the finished-building trades back, as on the feed (rule stage-finished-downstream)
    expect(createsWorkFor({ ...remodel, permitStage: 'final_inspection' }, 'cleaning')).toBe(true);
    expect(createsWorkFor(permit(), 'roofing')).toBe(false); // a roof permit is the roofer's own (market insight)
    expect(createsWorkFor(commercial, 'cleaning')).toBe(false);
    expect(createsWorkFor(permit({ kind: 'civic', subtype: '311', title: 'New home permit in Smyrna' }), 'landscaping')).toBe(false);
  });
  it('lists exist only for downstream trades of the member plan', () => {
    // Round 19 integration: derived from the rules in force, so a trade whose list could never hold an address has none.
    expect(AREA_LIST_TRADES).toEqual(expect.arrayContaining(['landscaping', 'cleaning', 'moving', 'siding-gutters']));
    for (const t of ['janitorial-commercial', 'fencing', 'flooring', 'roofing', 'general-contractor']) expect(AREA_LIST_TRADES, t).not.toContain(t);
    expect(areaListTrades(['roofing', 'hvac', 'landscaping', 'siding-gutters'])).toEqual(['landscaping', 'siding-gutters']);
  });
  it('grouped by ZIP (street when there is none), newest first', () => {
    const e = (address: string, zip: string | null, date: string): ListEntry => ({ address, zip, city: 'Smyrna', state: 'GA', permitType: 'Remodel', date, url: null, distanceMi: null });
    const groups = groupEntries([
      e('1 A ST', '30080', '2026-11-18'), e('2 B ST', '30082', '2026-11-21'), e('3 A ST', '30080', '2026-11-20'),
      e('9 OAK DR', null, '2026-11-19'), e('4 ELM ST', null, '2026-11-21'), e('2 OAK DR', null, '2026-11-17'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['30082', '30080', '']);
    expect(groups[1].entries.map((x) => x.address)).toEqual(['3 A ST', '1 A ST']);
    // every address with no ZIP is in ONE last group, by street then house number
    expect(groups[2].kind).toBe('street');
    expect(groups[2].entries.map((x) => x.address)).toEqual(['4 ELM ST', '2 OAK DR', '9 OAK DR']);
  });
  it('a list shows at most MAX_LIST_ADDRESSES, newest first, and says how many there were', () => {
    const rows = Array.from({ length: MAX_LIST_ADDRESSES + 20 }, (_, i) => permit({ summary: `Re-roof | ${100 + i} MAIN ST`, occurred_at: new Date(NOW.getTime() - i * 3_600_000).toISOString() }));
    const list = buildList(rows, { center: { ...SMYRNA, radiusMi: 2 } });
    expect(list.entries).toHaveLength(MAX_LIST_ADDRESSES);
    expect(list).toMatchObject({ total: MAX_LIST_ADDRESSES + 20, capped: true });
    expect(list.entries[0].address).toBe('100 MAIN ST');
  });
  it('permit type comes from Holler title vocabulary only', () => {
    expect(permitTypeOf('Roof, HVAC and plumbing permit in Chicago')).toBe('Roof, HVAC and plumbing');
    expect(permitTypeOf('Permit in Chicago')).toBeNull();
    expect(entryOf(permit({ summary: null }))).toBeNull();
  });
});

describe('member isolation', () => {
  const a = member({ user_id: 'user-a', ...SMYRNA, radius_mi: 3, categories: ['landscaping'] });
  const b = member({ user_id: 'user-b', lat: LONGVIEW.lat, lon: LONGVIEW.lon, state: 'TX', radius_mi: 3, categories: ['landscaping'] });
  const smyrnaHome = permit({ title: 'New home permit in Smyrna', summary: 'New | 1 or 2 Family Dwelling | 5 PINE CT', ...SMYRNA, occurred_at: day(2) });
  const longviewHome = permit({ title: 'New home permit in Longview', summary: 'New | 1 or 2 Family Dwelling | 8 CEDAR LN', ...LONGVIEW, city: 'Longview', state: 'TX', zip: '75601', occurred_at: day(2) });
  it("one member's area never appears in another member's neighborhood list, even when the read returns both", async () => {
    const { db } = fakeDb({ holler_signals: [smyrnaHome, longviewHome] });
    const la = await loadAreaList(db, a, 'landscaping', NOW);
    const lb = await loadAreaList(db, b, 'landscaping', NOW);
    expect(la?.entries.map((e) => e.address)).toEqual(['5 PINE CT']);
    expect(lb?.entries.map((e) => e.address)).toEqual(['8 CEDAR LN']);
  });
  it('a trade outside the member plan, or with no downstream rule, gives no list', async () => {
    const { db } = fakeDb({ holler_signals: [smyrnaHome] });
    expect(await loadAreaList(db, a, 'fencing', NOW)).toBeNull();
    expect(await loadAreaList(db, member({ categories: ['hvac'] }), 'hvac', NOW)).toBeNull();
    expect(await loadAreaList(db, member({ categories: ['landscaping'], lat: null, lon: null }), 'landscaping', NOW)).toBeNull();
  });
  it('a Solo plan uses its main area only: a saved extra area adds nothing', async () => {
    const solo = member({ categories: ['landscaping'], plan: 'starter', extra_areas: [{ zip: '75601', city: 'Longview', state: 'TX', lat: LONGVIEW.lat, lon: LONGVIEW.lon }] });
    const { db } = fakeDb({ holler_signals: [smyrnaHome, longviewHome] });
    expect((await loadAreaList(db, solo, 'landscaping', NOW))?.entries.map((e) => e.address)).toEqual(['5 PINE CT']);
    const pro = { ...solo, plan: 'pro' };
    expect((await loadAreaList(db, pro, 'landscaping', NOW))?.entries.map((e) => e.address).sort()).toEqual(['5 PINE CT', '8 CEDAR LN']);
  });
  it("a storm list opens only for the member who has the match: another member's report id is not found", async () => {
    const { db, calls } = fakeDb({ holler_matches: [{ user_id: 'user-a', signal_id: 501, signal: storm() }] });
    expect(await loadStormReport(db, a, 501, NOW)).toMatchObject({ id: 501, kind: 'hail' });
    expect(await loadStormReport(db, b, 501, NOW)).toBeNull();
    expect(calls.every((c) => c.table !== 'holler_matches' || c.filters.some((f) => f.startsWith('eq:user_id,')))).toBe(true);
    expect(await loadStormReports(db, b, NOW)).toEqual([]);
  });
});

describe('the damage line, in English and Spanish', () => {
  it('is the exact sentence, and the Spanish one passes the wording rules', () => {
    expect(DAMAGE_LINE.en).toBe('Damage not confirmed. These are addresses near a public storm report.');
    expect(DAMAGE_LINE.es).toMatch(/^Daño no confirmado\./);
    expect(spanishProblems(DAMAGE_LINE.es)).toEqual([]);
  });
  it('every storm list carries both lines, whatever the member language, and with no address too', () => {
    for (const lang of ['en', 'es'] as const) {
      for (const entries of [[], [entryOf(permit()) as ListEntry]]) {
        const text = textOf(createElement(ListSheet, { lang, heading: 'H', notes: [], damageLines: DAMAGE_LINE, entries, total: entries.length, capped: false }));
        expect(text).toContain(DAMAGE_LINE.en);
        expect(text).toContain(DAMAGE_LINE.es);
      }
    }
  });
});

describe('print view and empty state', () => {
  const entries = buildList([permit({ summary: 'Re-roof | 10 CHURCH ST' }), permit({ summary: 'Re-roof | 11 CHURCH ST', zip: null })], { center: { ...SMYRNA, radiusMi: 2 } }).entries;
  it('renders a table per group, the controls hidden in print, the source link labelled "public source"', () => {
    const html = renderToStaticMarkup(
      createElement(ListSheet, { lang: 'en', heading: 'Permitted addresses near a hail report', notes: ['n1'], damageLines: DAMAGE_LINE, entries, total: 2, capped: false, showDistance: true, actions: createElement('button', null, 'Print this list') }),
    );
    expect(html).toContain('<table');
    expect(html).toMatch(/ZIP 30080/);
    expect(html).toMatch(/>No ZIP</);
    expect(html).toMatch(/class="[^"]*print:hidden[^"]*"><button>Print this list/);
    expect(html).toContain('>public source<');
    expect(html).not.toMatch(/official/i);
  });
  it('Spanish print view', () => {
    const text = textOf(createElement(ListSheet, { lang: 'es', heading: 'H', notes: [], entries, total: 2, capped: false }));
    expect(text).toContain('Código postal 30080');
    expect(text).toContain('fuente pública');
    expect(text).toContain('Techo');
  });
  it('an empty list says so in the member language', () => {
    expect(textOf(createElement(ListSheet, { lang: 'en', heading: 'H', notes: [], entries: [], total: 0, capped: false }))).toContain('No permitted addresses in this list right now.');
    expect(textOf(createElement(ListSheet, { lang: 'es', heading: 'H', notes: [], entries: [], total: 0, capped: false }))).toContain(es['lists.empty']);
  });
  it('the door hanger prints the typed name and phone in either language, with the storm line saying damage is not confirmed', () => {
    expect(hangerLines('en', 'Peach Roofing', '404-555-0199', true)).toEqual([
      'Hello, neighbor',
      'Peach Roofing serves your neighborhood. If you would like a quote, call or text 404-555-0199.',
      'There was a public storm report in this area. Damage not confirmed.',
      'We are an independent business, not a city or government office. We leave this card on streets with a public building permit near a public storm report. Those records list addresses only: no names, no phone numbers.',
    ]);
    // review 2: no "we found this street", no "storm records", no "we do not have your name" promise, in either language
    for (const lang of ['en', 'es'] as const) for (const storm of [true, false]) {
      const all = hangerLines(lang, 'Peach Roofing', '404-555-0199', storm).join(' ');
      expect(all).not.toMatch(/we found|encontramos|storm records|registros públicos de permisos y tormentas|do not have your name|no tenemos su nombre/i);
    }
    expect(hangerLines('es', 'Techos Peach', '404-555-0199', false).join(' ')).not.toMatch(/tormenta/);
    for (const l of Object.values(HANGER_TEXT.es)) expect(spanishProblems(l)).toEqual([]);
    const html = renderToStaticMarkup(createElement(DoorHanger, { lang: 'en', initialBusiness: 'Peach Roofing', storm: true }));
    expect(html).toContain('Peach Roofing serves your neighborhood');
    expect(html).toContain('Damage not confirmed.');
    expect(html).not.toMatch(/<form[^>]*action=/);
  });
});

describe('the storm card line (no new alerts)', () => {
  it('points to the list with the count, in both languages, and never for zero', () => {
    expect(listLinkFor(501, 'hail', 12, 'en')).toEqual({ href: '/app/lists/storm?id=501', text: '12 permitted addresses near this hail report', open: 'Open the list' });
    expect(listLinkFor(501, 'wind', 1, 'es')?.text).toBe('1 dirección con permiso cerca de este reporte de viento');
    expect(listLinkFor(501, 'hail', 0, 'en')).toBeNull();
  });
  it('only storm cards the member already has get a line, and only when the list has an address', async () => {
    const { db } = fakeDb({
      holler_matches: [
        { user_id: 'user-a', signal_id: 501, signal: storm() },
        { user_id: 'user-a', signal_id: 502, signal: storm({ id: 502, ...LONGVIEW, title: '1.00 inch hail reported near Longview, TX', hailInches: '1' }) },
      ],
      holler_signals: [permit({ summary: 'Re-roof | 10 CHURCH ST' })],
    });
    const links = await stormCardLinks(db, member(), [501, 502, 999], NOW);
    expect(links.get(501)).toEqual({ kind: 'hail', count: 1 });
    expect(links.has(502)).toBe(false); // the read returned a Smyrna permit; it is not within 2 miles of Longview
    expect(links.has(999)).toBe(false);
    expect(await stormCardLinks(db, member(), [], NOW)).toEqual(new Map());
  });
  it('the feed card renders the line only when the server set it', () => {
    const base: FeedItem = { id: 1, status: 'new', kind: 'report', source: 'spc', title: '1.75 inch hail reported near 1 N Smyrna, GA', summary: null, url: null, distance: '1 mi', place: 'Smyrna, GA', ago: '2 days ago', occurredAt: day(2), draft: null, label: 'act_now', trade: 'roofing' };
    const withLine = renderToStaticMarkup(createElement(Feed, { items: [{ ...base, listLink: listLinkFor(501, 'hail', 12, 'en') }], cityPage: null }));
    expect(withLine).toContain('data-testid="list-link"');
    expect(textOf(createElement(Feed, { items: [{ ...base, listLink: listLinkFor(501, 'hail', 12, 'en') }], cityPage: null }))).toContain('12 permitted addresses near this hail report. Open the list');
    expect(withLine).toContain('href="/app/lists/storm?id=501"');
    expect(renderToStaticMarkup(createElement(Feed, { items: [base], cityPage: null }))).not.toContain('list-link');
  });
  it('a failing read gives no line', async () => {
    const bad = { from: () => { throw new Error('down'); } } as never;
    expect(await stormCardLinks(bad, member(), [501], NOW)).toEqual(new Map());
  });
});

describe('wording', () => {
  const listStrings = Object.entries(en).filter(([k]) => k.startsWith('lists.') || k.startsWith('hanger.')).map(([, v]) => v);
  it('no banned English word in the list strings and the door hanger', () => {
    for (const s of [...listStrings, ...Object.values(HANGER_TEXT.en), DAMAGE_LINE.en]) for (const [, re] of BANNED) expect(s).not.toMatch(re);
  });
  it('every list string has a Spanish twin that passes the Spanish rules', () => {
    for (const k of Object.keys(en).filter((x) => x.startsWith('lists.') || x.startsWith('hanger.'))) {
      expect(es[k as keyof typeof es]).toBeTruthy();
      expect(spanishProblems(es[k as keyof typeof es])).toEqual([]);
    }
  });
});

describe('review redo 1 regressions', () => {
  const gust = { source: 'spc', title: '61 mph wind gust reported near 2 N Smyrna, GA', stormType: 'wind', hailInches: null, windMph: '61' };
  it('defect 1: wind words need word edges; a "no damage" remark never makes a list, even under a "Wind damage reported" title', () => {
    for (const c of ['Measured by ASOS at the downtown airport.', 'Gust measured at Main Street mesonet site.', 'Rooftop anemometer measured 61 mph.', 'Powerful gust measured by a trained spotter.', 'ASOS at DeKalb-Peachtree Airport measured 61 mph.'])
      expect(stormKindOf({ ...gust, comments: c }), c).toBeNull();
    for (const c of ['Trees down on Paces Ferry.', 'Power lines snapped.', 'Roof blown off a barn.', 'Several large limbs downed.', 'Shingles torn off.'])
      expect(stormKindOf({ ...gust, comments: c }), c).toBe('wind');
    for (const c of ['Measured gust. No damage reported.', 'Trees swaying, no known damage.', 'Damage: none reported.', 'Gust measured, none reported.'])
      expect(stormKindOf({ ...gust, comments: c }), c).toBeNull();
    const unk = { ...gust, title: 'Wind damage reported near 2 N Smyrna, GA', windMph: null };
    expect(stormKindOf({ ...unk, comments: 'Trees down.' })).toBe('wind');
    expect(stormKindOf({ ...unk, comments: 'No damage reported.' })).toBeNull();
    // a gust title with no stored speed is still a measured gust
    expect(stormKindOf({ ...gust, windMph: null, comments: 'Measured at the Main Street mesonet site.' })).toBeNull();
  });
  it('defect 1: the SPC fixtures flag the same wind rows as before (only the damage report)', () => {
    for (const [f, type] of [['tests/fixtures/spc-wind.csv', 'wind'], ['tests/fixtures/spc-filtered-combined.csv', 'torn']] as const) {
      const wind = scanSpc({ csv: readFileSync(f, 'utf8'), type, day: '2026-11-20' }).signals.filter((x) => (x.data as { type?: string }).type === 'wind');
      const flagged = wind.filter((x) => {
        const d = x.data as { windMph?: number; comments?: string };
        return stormKindOf({ source: 'spc', title: x.title, stormType: 'wind', hailInches: null, windMph: d.windMph ?? null, comments: d.comments }) === 'wind';
      });
      expect(flagged.map((x) => x.title), f).toEqual(['Wind damage reported near 1 W Grannis, AR']);
    }
  });
  it('defect 2: without the storm line the hanger mentions permits only, in both languages; no damage claim, no insurance, not the city', () => {
    for (const lang of ['en', 'es'] as const) {
      const off = hangerLines(lang, 'Acme', '404-555-0100', false).join(' ');
      expect(off).not.toMatch(/storm|tormenta|damage|daño/i);
      expect(off).toMatch(/permit|permisos/i);
      for (const storm of [true, false]) {
        const all = hangerLines(lang, 'Acme', '404-555-0100', storm).join(' ');
        expect(all).not.toMatch(/insur|seguro|claim|reclamo|sent by|enviado por|on behalf|en nombre/i);
        expect(all).toMatch(/independent business, not a city or government office|negocio independiente, no una oficina de la ciudad ni del gobierno/);
        if (storm) expect(all).toMatch(lang === 'en' ? /Damage not confirmed\./ : /Daño no confirmado\./);
      }
    }
    for (const l of [...Object.values(HANGER_TEXT.es)]) expect(spanishProblems(l)).toEqual([]);
  });
  it('defect 3: every ZIP table of a storm list repeats the damage line in a print-only header row, and no group avoids page breaks', () => {
    const rows = [permit({ summary: 'Re-roof | 10 CHURCH ST' }), permit({ summary: 'Re-roof | 11 SPRING RD', zip: '30082' }), permit({ summary: 'Re-roof | 12 KING ST', zip: null })];
    const entries = buildList(rows, { center: { ...SMYRNA, radiusMi: 2 } }).entries;
    const html = renderToStaticMarkup(createElement(ListSheet, { lang: 'es', heading: 'H', notes: [], damageLines: DAMAGE_LINE, entries, total: 3, capped: false, showDistance: true }));
    const tables = html.split('<table').length - 1;
    expect(tables).toBe(3);
    expect(html.split('data-testid="print-damage-row"').length - 1).toBe(tables);
    expect(html).toMatch(/<tr class="hidden print:table-row"[^>]*><th colSpan="4"[^>]*><span lang="en">Damage not confirmed\./);
    expect(html).not.toContain('break-inside-avoid-page');
    // area lists carry no damage row
    expect(renderToStaticMarkup(createElement(ListSheet, { lang: 'en', heading: 'H', notes: [], entries, total: 3, capped: false }))).not.toContain('print-damage-row');
  });
  it('defect 4: rows stack below 640 px (no sideways table on a phone)', () => {
    const entries = buildList([permit()], { center: { ...SMYRNA, radiusMi: 2 } }).entries;
    const html = renderToStaticMarkup(createElement(ListSheet, { lang: 'en', heading: 'H', notes: [], entries, total: 1, capped: false, showDistance: true }));
    expect(html).toMatch(/<table class="[^"]*max-sm:block/);
    expect(html).toMatch(/<thead class="[^"]*max-sm:hidden/);
    expect(html).toMatch(/<tr class="[^"]*max-sm:flex max-sm:flex-wrap/);
    expect(html).toMatch(/<td class="[^"]*max-sm:w-full[^"]*">2318 CHURCH ST/);
  });
  it('defect 5: APT, #, UNIT and STE forms collapse to one building line, none dropped, no trailing punctuation', () => {
    const forms = ['12 OAK ST', '12 OAK ST APT 4', '12 OAK ST APT 204', '12 OAK ST #305', '12 OAK ST UNIT 7', '12 OAK ST STE 100', '12 OAK ST UNIT 1504', '12 OAK ST, UNIT 4', '12 OAK ST.', '12 OAK ST APT. 3'];
    for (const f of forms) expect(buildingAddress(`Re-roof | ${f}`), f).toBe('12 OAK ST');
    expect(buildingAddress('Re-roof | 12 OAK STREET, APT 4')).toBe('12 OAK STREET');
    expect(buildingAddress('Re-roof | 4812 AVENUE H UNIT 12')).toBe('4812 AVENUE H');
    const list = buildList(forms.map((f) => permit({ summary: `Re-roof | ${f}` })), { center: { ...SMYRNA, radiusMi: 2 } });
    expect(list.entries.map((e) => e.address)).toEqual(['12 OAK ST']);
    // separate buildings stay separate
    expect(buildList([permit({ summary: 'Re-roof | 12A OAK ST' }), permit({ summary: 'Re-roof | 12B OAK ST' })], { center: { ...SMYRNA, radiusMi: 2 } }).total).toBe(2);
  });
  it('P3-11: the Permit column prints only Holler vocabulary', () => {
    expect(permitTypeOf('Garcia Residence permit in Atlanta')).toBeNull();
    expect(permitTypeOf('Roof and gutter permit in Atlanta')).toBe('Roof and gutter');
  });
  it('P3-9: the index count says when the shared read hit the row cap', async () => {
    const rows = Array.from({ length: ROW_CAP }, (_, i) => permit({ title: 'New home permit in Smyrna', summary: `New | 1 or 2 Family Dwelling | ${i + 1} PINE CT`, occurred_at: day(1) }));
    const { db } = fakeDb({ holler_signals: rows });
    const counts = await loadAreaCounts(db, member({ categories: ['landscaping'] }), NOW);
    expect(counts[0]).toMatchObject({ trade: 'landscaping', partial: true });
  });
  it('P3-8: the storm read filters on the SPC source and, for the feed, on the card ids', async () => {
    const { db, calls } = fakeDb({ holler_matches: [{ user_id: 'user-a', signal_id: 501, signal: storm() }], holler_signals: [] });
    await stormCardLinks(db, member(), [501], NOW);
    const m = calls.find((c) => c.table === 'holler_matches');
    expect(m?.cols).toContain('signal:holler_signals!inner(');
    expect(m?.filters).toEqual(expect.arrayContaining(['eq:signal.source,spc', 'in:signal_id,501']));
  });
});

describe('review 2 regressions (redo 2)', () => {
  it('P3-7: a storm prints the SPC report day, not the next UTC day', async () => {
    // 7:30 pm Eastern on Nov 19 is 00:30 UTC on Nov 20; SPC files it under the Nov 19 report day
    const evening = storm({ occurred_at: '2026-11-20T00:30:00+00:00', spcDay: '2026-11-19', comments: '' });
    const { db } = fakeDb({ holler_matches: [{ user_id: 'user-a', signal_id: 501, signal: evening }] });
    const [r] = await loadStormReports(db, member(), NOW);
    expect(r).toMatchObject({ reportDay: '2026-11-19' });
    const { db: db2 } = fakeDb({ holler_matches: [{ user_id: 'user-a', signal_id: 501, signal: { ...evening, spcDay: null } }] });
    expect((await loadStormReports(db2, member(), NOW))[0]).toMatchObject({ reportDay: '2026-11-20' });
    expect(STORM_COLUMNS).toContain('spcDay:data->>day');
  });
  it('P3-5 / P3-6: a 44 px touch area for the source link on phones, and the footer never alone on a printed page', () => {
    const entries = buildList([permit()], { center: { ...SMYRNA, radiusMi: 2 } }).entries;
    const html = renderToStaticMarkup(createElement(ListSheet, { lang: 'en', heading: 'H', notes: [], entries, total: 1, capped: false }));
    expect(html).toMatch(/<a [^>]*class="[^"]*max-sm:inline-block max-sm:py-3[^"]*"[^>]*>public source</);
    // the closing line prints near the top, under the notes, and the end-of-list copy is screen only: no last page holds only this line
    expect(html).toMatch(/<p class="[^"]*hidden[^"]*print:block[^"]*" data-testid="print-footer">From public records/);
    expect(html).toMatch(/<p class="[^"]*print:hidden[^"]*">From public records/);
  });
});
