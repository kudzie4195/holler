/**
 * Round 18 unit LISTS, review redo 1: the independent reviewer's probes (logs/REV-LISTS-probe-tests/rev-lists-core.probe.test.ts), kept as
 * permanent regression tests. The seven that failed at 421131e (zero-point storm, 7-day instant compare, multi-unit collapse, wind damage
 * words, "$" in typed text, storm-free door hanger, the 1,000-match read) pass after the fixes. Test names are the reviewer's.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { haversineMi } from '@/lib/geo';
import {
  buildingAddress,
  buildList,
  entryOf,
  isListablePermit,
  MAX_LIST_ADDRESSES,
  permitTypeOf,
  stormKindOf,
  stormListLabel,
  STORM_LIST_DAYS,
  type PermitRow,
  type StormRow,
} from '@/lib/lists/core';
import { boxFilter, loadAreaList, loadStormReport, loadStormReports, type ListProfile } from '@/lib/lists/load';
import { hangerLines, HANGER_TEXT } from '@/components/lists/door-hanger';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';

const NOW = new Date('2026-11-22T15:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const SMYRNA = { lat: 33.8839, lon: -84.5144 };

let nid = 1;
const permit = (over: Partial<PermitRow> = {}): PermitRow => ({
  id: nid++, source: 'arcgis-atlanta-permits', kind: 'permit', title: 'Roof permit in Smyrna', summary: 'Re-roof | 2318 CHURCH ST',
  url: 'https://example.gov/p', ...SMYRNA, city: 'Smyrna', state: 'GA', zip: '30080', occurred_at: day(3), subtype: 'permit',
  approxLocation: null, loc: null, projectOf: null, ...over,
});
const storm = (over: Partial<StormRow> = {}): StormRow => ({
  id: 501, source: 'spc', kind: 'report', title: '1.75 inch hail reported near 1 N Smyrna, GA', ...SMYRNA, city: 'Smyrna', state: 'GA',
  county: 'Cobb', occurred_at: day(2), url: null, categories: ['roofing', 'auto-glass', 'auto-body', 'restoration', 'insurance', 'public-adjuster'],
  stormType: 'hail', hailInches: '1.75', windMph: null, comments: '', ...over,
});

describe('distance maths against published great-circle distances', () => {
  it('JFK to LAX is about 2,469 statute miles; one degree of latitude is about 69.1 miles', () => {
    const d = haversineMi(40.6413, -73.7781, 33.9416, -118.4085);
    console.log('JFK-LAX', d.toFixed(1));
    expect(Math.abs(d - 2469)).toBeLessThan(8);
    expect(haversineMi(33, -84, 34, -84)).toBeCloseTo(69.09, 1);
    // one degree of longitude at 33.88 N
    expect(haversineMi(33.88, -84, 33.88, -85)).toBeCloseTo(69.09 * Math.cos((33.88 * Math.PI) / 180), 0);
  });
  it('the SQL box always contains the circle, from Key West to Fairbanks, for 2 to 115 miles', () => {
    for (const lat of [24.55, 33.88, 40.7, 47.6, 64.84]) {
      for (const r of [2, 25, 50, 100, 115]) {
        const m = /lat\.gte\.(-?[\d.]+),lat\.lte\.(-?[\d.]+),lon\.gte\.(-?[\d.]+),lon\.lte\.(-?[\d.]+)/.exec(boxFilter(lat, -100, r))!;
        const [la0, la1, lo0, lo1] = m.slice(1).map(Number);
        for (let b = 0; b < 360; b += 5) {
          // a point exactly r miles away on bearing b
          const R = 3958.76, d = r / R, p1 = (lat * Math.PI) / 180, l1 = (-100 * Math.PI) / 180, br = (b * Math.PI) / 180;
          const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
          const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
          const la = (p2 * 180) / Math.PI, lo = (l2 * 180) / Math.PI;
          expect(la >= la0 && la <= la1 && lo >= lo0 && lo <= lo1, `lat ${lat} r ${r} bearing ${b}`).toBe(true);
        }
      }
    }
  });
});

describe('null and zero coordinates', () => {
  it('a permit at 0,0 or with a null point is never in a storm list or an area list', () => {
    const rows = [permit({ lat: 0, lon: 0 }), permit({ lat: null, lon: null, summary: 'x | 9 OAK ST' }), permit({ lat: 0, lon: -84.5144, summary: 'x | 7 ELM ST' })];
    expect(buildList(rows, { center: { ...SMYRNA, radiusMi: 2 } }).total).toBe(0);
    expect(buildList(rows, { areas: [SMYRNA], areaRadiusMi: 50 }).total).toBe(0);
  });
  it('PROBE: a storm report stored at 0,0 still makes a list centred on 0,0 (stormListLabel accepts a zero point)', () => {
    const label = stormListLabel(storm({ lat: 0, lon: 0 }), ['roofing'], NOW.getTime());
    const l = buildList([permit({ lat: 0, lon: 0 })], { center: { lat: 0, lon: 0, radiusMi: 2 } });
    console.log('zero-point storm label:', label, 'entries at 0,0:', l.total);
    // Criterion 4: "records with null or zero coordinates are excluded, not placed at 0,0".
    expect(label).toBeNull();
  });
});

describe('windows', () => {
  it('14 days is exact to the millisecond', () => {
    const t = NOW.getTime();
    expect(stormListLabel(storm({ occurred_at: new Date(t - STORM_LIST_DAYS * 86_400_000).toISOString() }), ['roofing'], t)).not.toBeNull();
    expect(stormListLabel(storm({ occurred_at: new Date(t - STORM_LIST_DAYS * 86_400_000 - 1).toISOString() }), ['roofing'], t)).toBeNull();
  });
  it('PROBE: the 7-day cut compares ISO strings; a PostgREST "+00:00" stamp and a non-UTC offset', () => {
    const since = '2026-11-15T15:00:00.000Z';
    // same instant, PostgREST formatting
    const same = buildList([permit({ occurred_at: '2026-11-15T15:00:00+00:00' })], { areas: [SMYRNA], areaRadiusMi: 5, sinceIso: since });
    // one hour INSIDE the window, but printed with a -05:00 offset (a database whose session time zone is not UTC)
    const inside = buildList([permit({ occurred_at: '2026-11-15T11:00:00-05:00' })], { areas: [SMYRNA], areaRadiusMi: 5, sinceIso: since });
    console.log('same instant kept:', same.total, '| 1h inside window, -05:00 offset kept:', inside.total);
    expect(inside.total).toBe(1);
  });
  it('PROBE: the printed permit date is the UTC calendar day', () => {
    // A permit stamped 7:30 pm Pacific on Nov 19 is stored as 03:30Z on Nov 20.
    const e = entryOf(permit({ occurred_at: '2026-11-20T03:30:00+00:00' }));
    console.log('date shown for 2026-11-19 19:30 PST:', e?.date);
  });
});

describe('complaint kinds, kind and subtype disagreeing', () => {
  it('only kind=permit AND subtype=permit passes', () => {
    const cases: [Partial<PermitRow>, boolean][] = [
      [{ kind: 'permit', subtype: 'permit' }, true],
      [{ kind: 'permit', subtype: '311' }, false],
      [{ kind: 'permit', subtype: 'violation' }, false],
      [{ kind: 'permit', subtype: 'inspection' }, false],
      [{ kind: 'permit', subtype: 'business' }, false],
      [{ kind: 'permit', subtype: 'event-permit' }, false],
      [{ kind: 'permit', subtype: null }, false],
      [{ kind: 'permit', subtype: 'bid' }, false],
      [{ kind: 'civic', subtype: 'permit' }, false],
      [{ kind: 'report', subtype: 'permit' }, false],
      [{ kind: 'permit', subtype: 'permit', source: 'socrata-nyc-311' }, false],
      [{ kind: 'permit', subtype: 'permit', source: 'holler-request' }, false],
      [{ kind: 'permit', subtype: 'permit', projectOf: '123' }, false],
    ];
    for (const [over, want] of cases) expect(isListablePermit(permit(over)), JSON.stringify(over)).toBe(want);
  });
  it('INFO: datasets whose kind is permit but whose subtype is not (these rows eat the 1000-row read cap before the JS filter)', () => {
    const odd = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.kind === 'permit' && d.subtype !== 'permit').map((d) => `${d.id}:${d.subtype}`);
    const oddSrc = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.subtype !== 'permit' && !/-(?:311|violations|inspections|business|events)$/.test(d.id)).map((d) => `${d.id}:${d.kind}/${d.subtype}`);
    console.log('kind=permit, subtype!=permit:', odd.length, odd.join(', '));
    console.log('non-permit datasets whose id does not end in a complaint suffix:', oddSrc.join(', '));
  });
});

describe('addresses: names, units', () => {
  it('names after or before the street never survive', () => {
    const cases: [string, string | null][] = [
      ['Re-roof | 123 MAIN ST JOHN SMITH', '123 MAIN ST'],
      ['Re-roof | 123 MAIN ST - SMITH RESIDENCE', '123 MAIN ST'],
      ['JOHN SMITH 123 MAIN ST', null],
      ['Re-roof | 45 SMITH JOHN', null],
      ['Re-roof | 123 MAIN ST APT 4 JOHN SMITH', '123 MAIN ST'],
      ['Re-roof | 123 MAIN ST, ATLANTA, GA 30303', '123 MAIN ST'],
      ['Re-roof | 2300 block of W 47TH ST', null],
    ];
    for (const [s, want] of cases) {
      const got = buildingAddress(s);
      console.log(JSON.stringify(s), '=>', JSON.stringify(got));
      if (want === null) expect(got).toBeNull();
      else expect(got).toBe(want);
    }
  });
  it('PROBE: unit forms collapse to one building line', () => {
    const forms = [
      '12 OAK ST', '12 OAK ST APT 4', '12 OAK ST #5B', '12 OAK ST UNIT 7', '12 OAK ST, UNIT 4', '12 OAK ST STE 100', '12 OAK ST APT. 3',
      '12 OAK ST FL 2', '12 OAK ST N UNIT 2', '12 OAK ST 4B', '12 OAK ST APT 4-B', '12 OAK ST BLDG 2 APT 4', '12 OAK ST UNIT B',
      '12 OAK ST REAR', '12 OAK ST 2ND FLOOR', '12 OAK ST PH', '12A OAK ST', '12B OAK ST', '12 1/2 OAK ST', '12 OAK ST LOT 34',
    ];
    const out = forms.map((f) => [f, buildingAddress(`Re-roof | ${f}`)] as const);
    for (const [f, a] of out) console.log(f.padEnd(26), '=>', JSON.stringify(a));
    const list = buildList(forms.map((f) => permit({ summary: `Re-roof | ${f}` })), { center: { ...SMYRNA, radiusMi: 2 } });
    console.log('distinct lines for one building:', list.entries.map((e) => e.address));
    // No listed address may end in punctuation or still carry a unit word.
    for (const e of list.entries) expect(e.address, e.address).not.toMatch(/[,;]$|\b(?:APT|UNIT|STE|SUITE|FL|FLOOR|BLDG|RM|ROOM)\b|#/i);
  });
  it('PROBE: what a title can put in the Permit column', () => {
    for (const t of ['Roof permit in Atlanta', 'Garcia Residence permit in Atlanta', 'John Smith permit in Atlanta', 'Permit in Atlanta', 'ROOF PERMIT IN ATLANTA for John Smith permit in X'])
      console.log(JSON.stringify(t), '=>', JSON.stringify(permitTypeOf(t)));
  });
});


describe('multi-unit buildings', () => {
  it('PROBE: every unit of 12 OAK ST collapses to the building line (none is dropped)', () => {
    const forms = ['12 OAK ST APT 4', '12 OAK ST APT 204', '12 OAK ST #305', '12 OAK ST UNIT 7', '12 OAK ST STE 100', '12 OAK ST UNIT 1504', '12 OAK STREET, APT 4', '12 OAK ST.'];
    const got = forms.map((f) => [f, buildingAddress(`Re-roof | ${f}`)] as const);
    for (const [f, a] of got) console.log(f.padEnd(24), '=>', JSON.stringify(a));
    const dropped = got.filter(([, a]) => a === null).map(([f]) => f);
    const punct = got.filter(([, a]) => a !== null && /[.,]$/.test(a)).map(([, a]) => a);
    console.log('dropped entirely:', dropped, '| shown with trailing punctuation:', punct);
    expect(dropped).toEqual([]);
    expect(punct).toEqual([]);
  });
});

describe('wind damage test', () => {
  it('PROBE: a measured gust whose remarks hold no damage word is not a wind-damage report', () => {
    const base = { source: 'spc', title: '61 mph wind gust reported near 2 N Smyrna, GA', stormType: 'wind', hailInches: null, windMph: '61' };
    const remarks = [
      'Measured by ASOS at the downtown airport.',
      'Gust measured at Main Street mesonet site.',
      'Rooftop anemometer measured 61 mph.',
      'Powerful gust measured by a trained spotter.',
      'Measured gust. No damage reported.',
      'ASOS at DeKalb-Peachtree Airport measured 61 mph.',
    ];
    const got = remarks.map((c) => [c, stormKindOf({ ...base, comments: c })] as const);
    for (const [c, k] of got) console.log(JSON.stringify(c), '=>', k);
    for (const [c, k] of got) expect(k, c).toBeNull();
  });
});

describe('door hanger text', () => {
  it('PROBE: typed text with $ patterns is printed as typed', () => {
    for (const b of ['Cash $$ Roofing', "A $' B", 'Smith $& Sons', '{phone}']) {
      const line = hangerLines('en', b, '404-555-0100', false)[1];
      console.log(JSON.stringify(b), '=>', JSON.stringify(line));
      expect(line, b).toContain(b);
    }
  });
  it('PROBE: with the storm line off, the card does not mention a storm', () => {
    for (const lang of ['en', 'es'] as const) {
      const lines = hangerLines(lang, 'Acme Roofing', '404-555-0100', false);
      console.log(lang, lines);
      expect(lines.join(' '), lang).not.toMatch(/storm|tormenta/i);
    }
    console.log(HANGER_TEXT.en.body);
  });
});

// ---- loaders with a fake PostgREST client ------------------------------------------------------------------------------------------
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
        const rows = ((tables[table] ?? []) as Row[]).filter((r) => eqs.every(([c, v]) => String(r[c]) === String(v)));
        return Promise.resolve(res({ data: rows, error: null }));
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}
const member = (over: Partial<ListProfile> = {}): ListProfile => ({
  user_id: 'user-a', categories: ['roofing', 'landscaping', 'painting'], ...SMYRNA, state: 'GA', radius_mi: 3, plan: 'starter',
  subscription_status: 'active', extra_areas: null, keywords: null, ...over,
});

describe('plan gating and isolation, server side', () => {
  it('a Solo member cannot open the list of a 6th saved trade; a lapsed Pro member loses trade 6 and the extra areas', async () => {
    const six = ['roofing', 'hvac', 'plumbing', 'electrical', 'painting', 'landscaping'];
    const { db, calls } = fakeDb({ holler_signals: [permit({ title: 'New home permit in Smyrna' })] });
    expect(await loadAreaList(db, member({ categories: six }), 'landscaping', NOW)).toBeNull();
    expect(await loadAreaList(db, member({ categories: six, plan: 'pro', subscription_status: 'canceled' }), 'landscaping', NOW)).toBeNull();
    expect(calls.length).toBe(0); // nothing was read at all
    expect(await loadAreaList(db, member({ categories: six, plan: 'pro', subscription_status: 'active' }), 'landscaping', NOW)).not.toBeNull();
  });
  it('trade strings that are not plain trade ids give no list and no read', async () => {
    const { db, calls } = fakeDb({ holler_signals: [] });
    for (const t of ['', 'landscaping,roofing', 'landscaping}', '*', '__proto__', 'constructor', 'LANDSCAPING', ' landscaping'])
      expect(await loadAreaList(db, member(), t, NOW), JSON.stringify(t)).toBeNull();
    expect(calls.length).toBe(0);
  });
  it('storm ids: non-integers, another member, a non-SPC signal and a permit id give null', async () => {
    const sig = storm();
    const { db } = fakeDb({
      holler_matches: [
        { user_id: 'user-b', signal_id: 501, signal: sig },
        { user_id: 'user-a', signal_id: 777, signal: { ...storm({ id: 777 }), source: 'nws' } },
        { user_id: 'user-a', signal_id: 778, signal: { ...permit({ id: 778 }), categories: ['roofing'] } },
      ],
    });
    for (const id of [501, 777, 778, NaN, 0, -1, 1.5, Infinity, 2 ** 60]) expect(await loadStormReport(db, member(), id, NOW), String(id)).toBeNull();
    expect(await loadStormReport(db, member({ user_id: 'user-b' }), 501, NOW)).not.toBeNull();
  });
  it('PROBE: a member with more than 1,000 matches in 15 days: is a storm report inside the window still listed?', async () => {
    // The fake returns what the query would after order(created_at desc).limit(1000): the storm match is row 1,001.
    const newer = Array.from({ length: 1000 }, (_, i) => ({ user_id: 'user-a', signal_id: 9000 + i, signal: { ...permit({ id: 9000 + i }), categories: ['roofing'] } }));
    const { db, calls } = fakeDb({ holler_matches: newer });
    const out = await loadStormReports(db, member(), NOW);
    console.log('filters on the matches read:', calls[0].filters.join(' | '));
    console.log('select:', calls[0].cols.slice(0, 60));
    // The read has no source filter, so 1,000 newer non-storm matches push every storm match out of the page.
    expect(calls[0].filters.join(' ')).toMatch(/spc/);
    expect(out.length).toBe(0);
  });
});

describe('cap', () => {
  it('never more than 100 lines, even with 5,000 rows', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => permit({ summary: `Re-roof | ${i + 1} CHURCH ST` }));
    const l = buildList(rows, { center: { ...SMYRNA, radiusMi: 2 } });
    expect(l.entries.length).toBe(MAX_LIST_ADDRESSES);
    expect(l.capped).toBe(true);
  });
});
