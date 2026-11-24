/**
 * Round 30: the hand-kept season table (lib/season/table.ts) and the rows that apply to a place, trades and day (lib/season/active.ts).
 * Every row: valid dates, a source URL and a verifiedOn date, EN and ES twins, the wording rules, real trade ids and a real centre.
 */
import { describe, expect, it } from 'vitest';
import { SEASON_TABLE, type SeasonRow } from '@/lib/season/table';
import { activeSeasons, dayOfYear, inWindow, MAX_SEASON_LINES, monthDayOf, seasonEmailEnabled, seasonLines } from '@/lib/season/active';
import { measuredCentres } from '@/lib/check/cells';
import { CATEGORIES } from '@/lib/signals/categories';
import { haversineMi, lookupZip } from '@/lib/geo';
import { spanishProblems } from '@/lib/i18n/rules';

const TRADE_IDS = new Set(CATEGORIES.map((c) => c.id));
const CENTRE = new Map(measuredCentres().map((c) => [c.id, c]));
const row = (id: string): SeasonRow => SEASON_TABLE.find((r) => r.id === id)!;
const ids = (rows: SeasonRow[]) => rows.map((r) => r.id);

/** The house list (tests/signals/ship-banned-words.test.ts BANNED, copied: importing a test file would run its tests here), plus the two this unit adds. */
const BANNED: [string, RegExp][] = [
  ['lead', /\bleads?\b/i],
  ['they need you', /they need you/i],
  ['you will win', /you(?:'ll| will) win/i],
  ['guaranteed', /guarantee[ds]?\b/i],
  ['official record', /official records?\b/i],
];
const EN_BANNED: [string, RegExp][] = [...BANNED, ['knock doors', /knock(?:ing)? (?:on )?doors?/i], ['em dash', /—/]];
/** Damage stated as fact: a weather or pest line may only say "can" or "may". */
const DAMAGE_FACT = /\b(?:damaged|destroyed|ruined|will (?:damage|break|burst|crack|kill))\b/i;
/** Typical timing words: every line must carry one, so a window is never told as a fact about a property. */
const TYPICAL_EN = /\b(?:usually|typically|typical|often|average|can shift|points to)\b/i;
const TYPICAL_ES = /(?:suele|suelen|normalmente|promedio|a menudo|pueden cambiar|puede cambiar|señala|indica)/i;

describe('season table: every row', () => {
  it('has the seven topics the brief asked for, in the four marketed centres only', () => {
    expect(new Set(SEASON_TABLE.map((r) => r.topic))).toEqual(
      new Set(['gutters', 'leaf-cleanup', 'irrigation-winterize', 'pre-emergent', 'pollen', 'fescue-seeding', 'listing-prep']),
    );
    expect(new Set(SEASON_TABLE.map((r) => r.centre))).toEqual(new Set(['atlanta', 'austin', 'charlotte', 'raleigh']));
  });

  it('has a unique id named <topic>-<centre>', () => {
    expect(new Set(SEASON_TABLE.map((r) => r.id)).size).toBe(SEASON_TABLE.length);
    for (const r of SEASON_TABLE) expect(r.id).toBe(`${r.topic}-${r.centre}`);
  });

  it('sits on a measured centre whose coordinates the coverage gate already has (none typed in the table)', () => {
    for (const r of SEASON_TABLE) expect(CENTRE.has(r.centre), r.id).toBe(true);
  });

  it('has valid month-day dates; the peak sits inside the window', () => {
    for (const r of SEASON_TABLE) {
      for (const d of [r.start, r.end, ...(r.peak ? [r.peak] : [])]) {
        expect(d, r.id).toMatch(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
        expect(Number.isFinite(dayOfYear(d)), r.id).toBe(true);
      }
      if (r.peak) expect(inWindow(r.peak, r.start, r.end), r.id).toBe(true);
    }
  });

  it('carries a public https source and a verifiedOn date, and a confidence', () => {
    for (const r of SEASON_TABLE) {
      expect(r.source, r.id).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i);
      expect(r.verifiedOn, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(Date.parse(r.verifiedOn)), r.id).toBe(true);
      expect(['checked', 'estimate'], r.id).toContain(r.confidence);
    }
  });

  it('names only real Holler trade ids', () => {
    for (const r of SEASON_TABLE) {
      expect(r.trades.length, r.id).toBeGreaterThan(0);
      for (const t of r.trades) expect(TRADE_IDS.has(t), `${r.id} ${t}`).toBe(true);
    }
  });

  it('has English and Spanish twins, both non-empty and different', () => {
    for (const r of SEASON_TABLE) {
      expect(r.en.trim().length, r.id).toBeGreaterThan(40);
      expect(r.es.trim().length, r.id).toBeGreaterThan(40);
      expect(r.es, r.id).not.toBe(r.en);
      // the same numbers in both (dates, temperatures, years)
      const nums = (s: string) => (s.match(/\d+/g) ?? []).sort();
      expect(nums(r.es), r.id).toEqual(nums(r.en));
    }
  });

  it('English: no banned word, no em dash, no damage as fact, typical timing words', () => {
    for (const r of SEASON_TABLE) {
      for (const [name, re] of EN_BANNED) expect(re.test(r.en), `${r.id}: ${name}`).toBe(false);
      expect(DAMAGE_FACT.test(r.en), r.id).toBe(false);
      expect(TYPICAL_EN.test(r.en), r.id).toBe(true);
    }
  });

  it('Spanish: the house Spanish rules (usted, no garantizado, no leads, no em dash, no damage words), typical timing words', () => {
    for (const r of SEASON_TABLE) {
      expect(spanishProblems(r.es), r.id).toEqual([]);
      expect(/—/.test(r.es), r.id).toBe(false);
      expect(/tocar puertas/i.test(r.es), r.id).toBe(false);
      expect(TYPICAL_ES.test(r.es), r.id).toBe(true);
    }
  });

  it('each row reaches exactly the trades the brief gave it', () => {
    const want: Record<string, string[]> = {
      gutters: ['siding-gutters'],
      'leaf-cleanup': ['landscaping', 'lawn-care'],
      'irrigation-winterize': ['landscaping'],
      'pre-emergent': ['lawn-care', 'landscaping'],
      pollen: ['cleaning', 'siding-gutters'],
      'fescue-seeding': ['lawn-care', 'landscaping'],
      'listing-prep': ['landscaping', 'cleaning'],
    };
    for (const r of SEASON_TABLE) {
      if (r.id === 'pollen-austin') expect([...r.trades]).toEqual(['cleaning']);
      else expect([...r.trades].sort(), r.id).toEqual([...want[r.topic]].sort());
    }
  });

  it('the windows the brief gave', () => {
    const w = (id: string) => [row(id).start, row(id).end];
    for (const c of ['atlanta', 'charlotte', 'raleigh']) {
      expect(w(`gutters-${c}`)).toEqual(['11-15', '01-15']);
      expect(w(`leaf-cleanup-${c}`)).toEqual(['11-01', '12-15']);
      expect(w(`pollen-${c}`)).toEqual(['03-15', '04-25']);
      expect(w(`fescue-seeding-${c}`)).toEqual(['09-01', '10-15']);
    }
    expect(w('pollen-austin')).toEqual(['12-15', '03-01']);
    expect(w('listing-prep-atlanta')).toEqual(['04-15', '05-15']);
    expect(w('listing-prep-charlotte')).toEqual(['04-15', '05-15']);
    expect(w('listing-prep-austin')).toEqual(['03-01', '03-31']);
    for (const c of ['atlanta', 'austin', 'charlotte', 'raleigh']) {
      expect(row(`irrigation-winterize-${c}`)).toBeTruthy();
      expect(row(`pre-emergent-${c}`)).toBeTruthy();
    }
    expect(SEASON_TABLE.filter((r) => r.topic === 'gutters').map((r) => r.centre).sort()).toEqual(['atlanta', 'charlotte', 'raleigh']);
    expect(SEASON_TABLE.filter((r) => r.topic === 'listing-prep').map((r) => r.centre).sort()).toEqual(['atlanta', 'austin', 'charlotte']);
  });
});

describe('windows and the year wrap', () => {
  it('a plain window is inclusive at both ends', () => {
    expect(inWindow('11-01', '11-01', '12-15')).toBe(true);
    expect(inWindow('12-15', '11-01', '12-15')).toBe(true);
    expect(inWindow('10-31', '11-01', '12-15')).toBe(false);
    expect(inWindow('12-16', '11-01', '12-15')).toBe(false);
  });
  it('a window that runs over New Year (Nov 15 to Jan 15)', () => {
    for (const d of ['11-15', '12-01', '12-31', '01-01', '01-15']) expect(inWindow(d, '11-15', '01-15'), d).toBe(true);
    for (const d of ['11-14', '01-16', '06-01', '10-01']) expect(inWindow(d, '11-15', '01-15'), d).toBe(false);
  });
  it('Feb 29 counts as Feb 28', () => {
    expect(dayOfYear('02-29')).toBe(dayOfYear('02-28'));
  });
  it('the gutter row in Charlotte on Dec 31 2026 and Jan 10 2027 (both sides of New Year), not on Jan 20', () => {
    const clt = lookupZip('28202')!;
    for (const date of ['2026-12-31', '2027-01-10']) expect(ids(activeSeasons({ lat: clt.lat, lon: clt.lon, trades: ['siding-gutters'], date })), date).toEqual(['gutters-charlotte']);
    expect(activeSeasons({ lat: clt.lat, lon: clt.lon, trades: ['siding-gutters'], date: '2027-01-20' })).toEqual([]);
  });
  it('Austin cedar (Dec 15 to Mar 1) wraps too', () => {
    const aus = lookupZip('78701')!;
    expect(ids(activeSeasons({ lat: aus.lat, lon: aus.lon, trades: ['cleaning'], date: '2027-01-15' }))).toEqual(['pollen-austin']);
    expect(ids(activeSeasons({ lat: aus.lat, lon: aus.lon, trades: ['cleaning'], date: '2026-12-20' }))).toEqual(['pollen-austin']);
    expect(activeSeasons({ lat: aus.lat, lon: aus.lon, trades: ['cleaning'], date: '2026-12-14' })).toEqual([]);
  });
  it('a Date is read in the metro\'s own calendar: 9 pm Nov 30 in Charlotte is still Nov 30 there (UTC already says Dec 1)', () => {
    expect(monthDayOf(new Date('2026-12-01T02:00:00Z'), 'America/New_York')).toBe('11-30');
    expect(monthDayOf(new Date('2026-12-01T02:00:00Z'), 'UTC')).toBe('12-01');
    expect(monthDayOf('2026-12-01')).toBe('12-01');
    // Nov 14 at 11 pm in Charlotte: gutters (from Nov 15) not yet, though UTC is already Nov 15
    const clt = lookupZip('28202')!;
    expect(activeSeasons({ lat: clt.lat, lon: clt.lon, trades: ['siding-gutters'], date: new Date('2026-11-15T04:00:00Z') })).toEqual([]);
    expect(ids(activeSeasons({ lat: clt.lat, lon: clt.lon, trades: ['siding-gutters'], date: new Date('2026-11-15T06:00:00Z') }))).toEqual(['gutters-charlotte']);
  });
});

describe('the 25-mile radius', () => {
  const clt = CENTRE.get('charlotte')!;
  // due north of the centre, by latitude only: 1 degree of latitude is about 69.09 miles
  const north = (mi: number) => ({ lat: clt.lat + mi / 69.09, lon: clt.lon });
  it('in at 24.5 miles, out at 25.5 miles from the Charlotte centre', () => {
    const inside = north(24.5);
    const outside = north(25.5);
    expect(haversineMi(inside.lat, inside.lon, clt.lat, clt.lon)).toBeLessThan(25);
    expect(haversineMi(outside.lat, outside.lon, clt.lat, clt.lon)).toBeGreaterThan(25);
    expect(ids(activeSeasons({ ...inside, trades: ['siding-gutters'], date: '2026-12-01' }))).toEqual(['gutters-charlotte']);
    expect(activeSeasons({ ...outside, trades: ['siding-gutters'], date: '2026-12-01' })).toEqual([]);
  });
  it('a place far from every centre (Denver) gets nothing, in any season', () => {
    const den = lookupZip('80202')!;
    for (const date of ['2026-12-01', '2027-03-20', '2027-09-15']) {
      expect(activeSeasons({ lat: den.lat, lon: den.lon, trades: ['siding-gutters', 'landscaping', 'lawn-care', 'cleaning'], date })).toEqual([]);
    }
  });
  it('no point or no trade: nothing', () => {
    expect(activeSeasons({ lat: null, lon: null, trades: ['landscaping'], date: '2026-12-01' })).toEqual([]);
    expect(activeSeasons({ lat: 35.2, lon: -80.8, trades: [], date: '2026-12-01' })).toEqual([]);
    expect(activeSeasons({ lat: 35.2, lon: -80.8, trades: null, date: '2026-12-01' })).toEqual([]);
  });
});

describe('trades, dedupe, order, cap', () => {
  const clt = lookupZip('28202')!;
  const at = (trades: string[], date: string) => ids(activeSeasons({ lat: clt.lat, lon: clt.lon, trades, date }));

  it('each row is reached by each of its own trades and by no other trade', () => {
    const others = CATEGORIES.map((c) => c.id);
    for (const r of SEASON_TABLE) {
      const c = CENTRE.get(r.centre)!;
      const date = `2027-${r.peak ?? r.start}`;
      for (const t of others) {
        const got = activeSeasons({ lat: c.lat, lon: c.lon, trades: [t], date }).some((x) => x.id === r.id);
        expect(got, `${r.id} via ${t}`).toBe(r.trades.includes(t));
      }
    }
  });
  it('the Pressure washing chip reaches gutters through siding-gutters and pollen through both parts', () => {
    expect(at(['pressure-washing'], '2026-12-01')).toEqual(['gutters-charlotte']);
    expect(at(['pressure-washing'], '2027-03-31')).toEqual(['pollen-charlotte']);
  });
  it('one line per row even when two of the member\'s trades reach it', () => {
    expect(at(['landscaping', 'lawn-care'], '2026-12-01')).toEqual(['leaf-cleanup-charlotte']);
    expect(at(['cleaning', 'siding-gutters'], '2027-04-01')).toEqual(['pollen-charlotte']);
  });
  it('at most two, ordered by closeness to the peak', () => {
    // Nov 15: gutters (peak Dec 1, 16 days), leaf clean-up (peak Nov 20, 5 days), irrigation (peak Nov 7, 8 days): three apply
    const r = at(['siding-gutters', 'landscaping'], '2026-11-15');
    expect(r).toHaveLength(MAX_SEASON_LINES);
    expect(r).toEqual(['leaf-cleanup-charlotte', 'irrigation-winterize-charlotte']);
    // Dec 1: gutters (peak today) before leaf clean-up (11 days)
    expect(at(['landscaping', 'siding-gutters'], '2026-12-01')).toEqual(['gutters-charlotte', 'leaf-cleanup-charlotte']);
  });
  it('seasonLines picks the reader\'s language and keeps the source', () => {
    const rows = activeSeasons({ lat: clt.lat, lon: clt.lon, trades: ['siding-gutters'], date: '2026-12-01' });
    expect(seasonLines(rows, 'en')).toEqual([{ id: 'gutters-charlotte', text: row('gutters-charlotte').en, source: row('gutters-charlotte').source }]);
    expect(seasonLines(rows, 'es')[0].text).toBe(row('gutters-charlotte').es);
  });
});

describe('December 1 2026 (launch week)', () => {
  it('Charlotte 28202: siding-gutters gets the gutter line, landscaping the leaf clean-up line', () => {
    const clt = lookupZip('28202')!;
    expect(ids(activeSeasons({ lat: clt.lat, lon: clt.lon, trades: ['siding-gutters'], date: '2026-12-01' }))).toEqual(['gutters-charlotte']);
    expect(ids(activeSeasons({ lat: clt.lat, lon: clt.lon, trades: ['landscaping'], date: '2026-12-01' }))).toEqual(['leaf-cleanup-charlotte']);
    expect(row('gutters-charlotte').en).toContain('Gutter clean-outs are typically booked from mid-November to mid-January.');
  });
  it('Austin 78701: nothing for gutters (and nothing for pressure washing or cleaning before Dec 15)', () => {
    const aus = lookupZip('78701')!;
    for (const t of ['siding-gutters', 'pressure-washing', 'cleaning']) expect(activeSeasons({ lat: aus.lat, lon: aus.lon, trades: [t], date: '2026-12-01' }), t).toEqual([]);
  });
  it('Atlanta and Raleigh gutters too', () => {
    for (const [zip, id] of [['30303', 'gutters-atlanta'], ['27601', 'gutters-raleigh']]) {
      const p = lookupZip(zip)!;
      expect(ids(activeSeasons({ lat: p.lat, lon: p.lon, trades: ['siding-gutters'], date: '2026-12-01' })), zip).toEqual([id]);
    }
  });
  it('a summer day (Jul 1) has no row anywhere for any trade', () => {
    for (const c of CENTRE.values()) {
      expect(activeSeasons({ lat: c.lat, lon: c.lon, trades: CATEGORIES.map((x) => x.id), date: '2026-07-01' }), c.id).toEqual([]);
    }
  });
});

describe('the email switch', () => {
  it('is on only for exactly "1"', () => {
    expect(seasonEmailEnabled('1')).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) expect(seasonEmailEnabled(v), String(v)).toBe(false);
  });
});
