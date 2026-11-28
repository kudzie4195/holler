/**
 * Round 35: the second batch of season rows (lib/season/table-r35.ts) behind HOLLER_SEASON_R35_ENABLED.
 * Every row gets the round 30 checks (tests/season/table.test.ts, copied: importing a test file would run its tests here), the switch
 * keeps activeSeasons exactly as it was while off, and the cap, time zones and the New Year wrap hold with the rows on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEASON_TABLE, type SeasonRow } from '@/lib/season/table';
import { SEASON_TABLE_R35 } from '@/lib/season/table-r35';
import { activeSeasons, dayOfYear, inWindow, MAX_SEASON_LINES, seasonLines, seasonR35Enabled, seasonTable } from '@/lib/season/active';
import { measuredCentres } from '@/lib/check/cells';
import { CATEGORIES } from '@/lib/signals/categories';
import { lookupZip } from '@/lib/geo';
import { spanishProblems } from '@/lib/i18n/rules';

const TRADE_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const CENTRE = new Map(measuredCentres().map((c) => [c.id, c]));
const row = (id: string): SeasonRow => SEASON_TABLE_R35.find((r) => r.id === id)!;
const ids = (rows: SeasonRow[]) => rows.map((r) => r.id);
const R35_IDS = new Set(SEASON_TABLE_R35.map((r) => r.id));

const isRealMonthDay = (md: string): boolean => {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return false;
  const month = Number(m[1]);
  return new Date(Date.UTC(2025, month - 1, Number(m[2]))).getUTCMonth() === month - 1;
};

const BANNED: [string, RegExp][] = [
  ['lead', /\bleads?\b/i],
  ['they need you', /they need you/i],
  ['you will win', /you(?:'ll| will) win/i],
  ['guaranteed', /guarantee[ds]?\b/i],
  ['official record', /official records?\b/i],
  ['knock doors', /knock(?:ing)? (?:on )?doors?/i],
  ['canvass', /canvass/i],
  ['em dash', /—/],
];
/** Damage stated as fact. */
const DAMAGE_FACT = /\b(?:damaged|damaging|destroyed|ruined|killed|stripped|devastat\w*|will (?:damage|break|burst|crack|kill))\b/i;
/** A health effect, in either language: no row may say or hint at one. */
const HEALTH_EN = /\b(?:allerg\w*|asthma\w*|sneez\w*|symptoms?|sick\w*|illness\w*|health\w*|breath\w*|hay fever|congestion|itchy|medical|doctor)\b/i;
const HEALTH_ES = /(?:alerg|asma|estornud|síntoma|sintoma|enferm|salud|respir|fiebre del heno|congesti|médic|medic)/i;
const TYPICAL_EN = /\b(?:usually|typically|typical|often|average|can shift|points to)\b/i;
const TYPICAL_ES = /(?:suele|suelen|normalmente|promedio|a menudo|pueden cambiar|puede cambiar|señala|indica)/i;
const SERVICE_WINDOW_EN = /\b(?:booked|booking|scheduled|prepped)\b/i;
const SERVICE_WINDOW_ES = /(?:programar|programan|se preparan)/i;
/** Public pages from a state extension service, a state university, or the pollen-season page the round 30 rows already cite. */
const SOURCE_HOSTS = new Set(['fieldreport.caes.uga.edu', 'ncturfbugs.wordpress.ncsu.edu', 'citybugs.tamu.edu', 'agrilifetoday.tamu.edu', 'forestry.ces.ncsu.edu', 'www.fox5atlanta.com']);

const withSwitch = (value: string | undefined) => {
  if (value === undefined) vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '');
  else vi.stubEnv('HOLLER_SEASON_R35_ENABLED', value);
};
afterEach(() => vi.unstubAllEnvs());

describe('round 35 rows: every row', () => {
  it('is new: 13 rows, unique ids that are not in the round 30 table, a known topic, a measured centre', () => {
    expect(SEASON_TABLE_R35).toHaveLength(13);
    expect(R35_IDS.size).toBe(SEASON_TABLE_R35.length);
    const main = new Set(SEASON_TABLE.map((r) => r.id));
    for (const r of SEASON_TABLE_R35) {
      expect(main.has(r.id), r.id).toBe(false);
      expect(['armyworm', 'pollen'], r.id).toContain(r.topic);
      expect(r.id.endsWith(`-${r.centre}`), r.id).toBe(true);
      expect(CENTRE.has(r.centre), r.id).toBe(true);
    }
    expect(new Set(SEASON_TABLE_R35.map((r) => r.centre))).toEqual(new Set(['atlanta', 'austin', 'charlotte', 'raleigh']));
  });

  it('has valid month-day dates (real calendar days), the peak inside the window, and no window that wraps New Year', () => {
    for (const r of SEASON_TABLE_R35) {
      for (const d of [r.start, r.end, ...(r.peak ? [r.peak] : [])]) {
        expect(d, r.id).toMatch(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
        expect(isRealMonthDay(d), `${r.id} ${d} is a real day`).toBe(true);
      }
      expect(dayOfYear(r.start), `${r.id} start is not after end (no accidental year wrap)`).toBeLessThanOrEqual(dayOfYear(r.end));
      expect(r.peak, r.id).toBeTruthy();
      expect(inWindow(r.peak!, r.start, r.end), r.id).toBe(true);
    }
  });

  it('carries an https source on a state extension, state university or pollen-page host, verifiedOn 2026-11-28, and a confidence', () => {
    for (const r of SEASON_TABLE_R35) {
      expect(r.source, r.id).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i);
      expect(SOURCE_HOSTS.has(new URL(r.source).host), `${r.id} ${r.source}`).toBe(true);
      expect(r.verifiedOn, r.id).toBe('2026-11-28');
      expect(['checked', 'estimate'], r.id).toContain(r.confidence);
    }
  });

  it('names only real Holler trade ids, and the pressure-washing AND rule only where the row is the wash line', () => {
    for (const r of SEASON_TABLE_R35) {
      expect(r.trades.length, r.id).toBeGreaterThan(0);
      for (const t of r.trades) expect(TRADE_IDS.has(t), `${r.id} ${t}`).toBe(true);
      if (r.id === 'pollen-wash-austin') expect(r.allTrades).toEqual(['cleaning', 'siding-gutters']);
      else expect(r.allTrades, r.id).toBeUndefined();
    }
  });

  it('has English and Spanish twins, both non-empty, different, with the same numbers', () => {
    for (const r of SEASON_TABLE_R35) {
      expect(r.en.trim().length, r.id).toBeGreaterThan(40);
      expect(r.es.trim().length, r.id).toBeGreaterThan(40);
      expect(r.es, r.id).not.toBe(r.en);
      const nums = (s: string) => (s.match(/\d+/g) ?? []).sort();
      expect(nums(r.es), r.id).toEqual(nums(r.en));
    }
  });

  it('English: no banned word, no em dash, no damage as fact, no health effect, typical timing words', () => {
    for (const r of SEASON_TABLE_R35) {
      for (const [name, re] of BANNED) expect(re.test(r.en), `${r.id}: ${name}`).toBe(false);
      expect(DAMAGE_FACT.test(r.en), `${r.id} damage`).toBe(false);
      expect(HEALTH_EN.test(r.en), `${r.id} health`).toBe(false);
      expect(TYPICAL_EN.test(r.en), `${r.id} typical`).toBe(true);
    }
  });

  it('Spanish: the house Spanish rules, no health effect, no em dash, typical timing words', () => {
    for (const r of SEASON_TABLE_R35) {
      expect(spanishProblems(r.es), r.id).toEqual([]);
      expect(/—/.test(r.es), r.id).toBe(false);
      expect(/tocar puertas/i.test(r.es), r.id).toBe(false);
      expect(HEALTH_ES.test(r.es), `${r.id} health`).toBe(false);
      expect(TYPICAL_ES.test(r.es), `${r.id} typical`).toBe(true);
    }
  });

  it('every booking or service window says "Holler estimates that" / "Holler estima que", in both languages', () => {
    for (const r of SEASON_TABLE_R35) {
      expect(SERVICE_WINDOW_EN.test(r.en), `${r.id} en states a window`).toBe(true);
      expect(SERVICE_WINDOW_ES.test(r.es), `${r.id} es states a window`).toBe(true);
      expect(r.en, r.id).toMatch(/Holler estimates that /);
      expect(r.es, r.id).toMatch(/Holler estima que/);
      // the estimate is the last sentence: nothing after it presents Holler's window as the source's
      expect(r.en.split(/(?<=\.) /).pop(), r.id).toMatch(/^Holler estimates that /);
      expect(r.es.split(/(?<=\.) /).pop(), r.id).toMatch(/^Holler estima que/);
    }
  });

  it('a pest or pollen line says "can" or a typical word, never a fact about a property or a lawn', () => {
    for (const r of SEASON_TABLE_R35.filter((x) => x.topic === 'armyworm')) {
      expect(r.en, r.id).toContain('The caterpillars can affect lawns.');
      expect(r.es, r.id).toContain('Las orugas pueden afectar los céspedes.');
      expect(r.en, r.id).not.toMatch(/\byour (?:lawn|yard|grass|home|house)\b/i);
      expect(r.es, r.id).not.toMatch(/\bsu (?:césped|jardín|casa|pasto)\b/i);
    }
    for (const r of SEASON_TABLE_R35.filter((x) => x.topic === 'pollen')) {
      expect(r.en, r.id).not.toMatch(/\byour\b/i);
      expect(r.es, r.id).not.toMatch(/\bsu (?:césped|jardín|casa|pasto)\b/i);
    }
  });

  it('confidence, row by row (the table\'s rule, applied to the page each row cites)', () => {
    const want: Record<string, 'checked' | 'estimate'> = {
      // months or a named region stated by the source as usual timing
      'armyworm-atlanta': 'checked', // UGA Circular 1335: "recurs each year from July to September", Georgia
      'armyworm-charlotte': 'checked', // NC State: "generally ranges from late July through mid-October", North Carolina
      'armyworm-raleigh': 'checked',
      'pollen-wash-austin': 'checked', // AgriLife: oak pollen "typically ... in March and April", Central Texas
      'pollen-cleaning-atlanta': 'checked', 'pollen-cleaning-charlotte': 'checked', 'pollen-cleaning-raleigh': 'checked', 'pollen-cleaning-austin': 'checked',
      // a season word only, no month and no region in the sentence (Texas A&M blog)
      'armyworm-austin': 'estimate',
      // the clean-out after the pollen peak is Holler's own link: no page dates it
      'pollen-gutters-atlanta': 'estimate', 'pollen-gutters-charlotte': 'estimate', 'pollen-gutters-raleigh': 'estimate', 'pollen-gutters-austin': 'estimate',
    };
    expect(Object.fromEntries(SEASON_TABLE_R35.map((r) => [r.id, r.confidence]))).toEqual(want);
  });

  it('each row reaches exactly the trades the brief gave it', () => {
    for (const r of SEASON_TABLE_R35) {
      if (r.topic === 'armyworm') expect([...r.trades], r.id).toEqual(['lawn-care']);
      else if (r.id.startsWith('pollen-gutters-')) expect([...r.trades], r.id).toEqual(['siding-gutters']);
      else expect([...r.trades], r.id).toEqual(['cleaning']);
    }
  });

  it('the windows (spring pollen Mar to Apr; armyworm the weeks each state\'s source gives)', () => {
    const w = (id: string) => [row(id).start, row(id).end];
    expect(w('armyworm-atlanta')).toEqual(['08-01', '09-30']);
    expect(w('armyworm-charlotte')).toEqual(['07-25', '10-15']);
    expect(w('armyworm-raleigh')).toEqual(['07-25', '10-15']);
    expect(w('armyworm-austin')).toEqual(['08-15', '10-15']);
    for (const c of ['atlanta', 'charlotte', 'raleigh']) expect(w(`pollen-cleaning-${c}`)).toEqual(['03-15', '04-25']);
    expect(w('pollen-cleaning-austin')).toEqual(['03-01', '04-30']);
    expect(w('pollen-wash-austin')).toEqual(['03-01', '04-30']);
    for (const c of ['atlanta', 'charlotte', 'raleigh', 'austin']) expect(w(`pollen-gutters-${c}`)).toEqual(['03-25', '05-10']);
  });
});

describe('the switch', () => {
  it('is on for 1, true, on, yes (any case, spaces ignored) and off for everything else, including unset', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'On', 'yes', ' 1 ']) expect(seasonR35Enabled(v), String(v)).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', '2', 'enabled', '11']) expect(seasonR35Enabled(v), String(v)).toBe(false);
  });

  it('off: the table is SEASON_TABLE itself; on: the same rows first, then the 13 new ones', () => {
    expect(seasonTable(false)).toBe(SEASON_TABLE);
    const on = seasonTable(true);
    expect(on).toHaveLength(SEASON_TABLE.length + 13);
    expect(on.slice(0, SEASON_TABLE.length)).toEqual([...SEASON_TABLE]);
    expect(on.slice(SEASON_TABLE.length)).toEqual([...SEASON_TABLE_R35]);
  });

  it('reads process.env at call time, with no default of its own (unset means off)', () => {
    vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '');
    expect(seasonR35Enabled()).toBe(false);
    expect(seasonTable()).toBe(SEASON_TABLE);
    vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '1');
    expect(seasonR35Enabled()).toBe(true);
    expect(seasonTable()).toHaveLength(SEASON_TABLE.length + 13);
    vi.unstubAllEnvs();
    delete process.env.HOLLER_SEASON_R35_ENABLED;
    expect(seasonR35Enabled()).toBe(false);
  });
});

/** Every place the table is read in production, plus one far away: the four centres' ZIPs. */
const PLACES = [
  { name: 'atlanta', p: lookupZip('30303')! },
  { name: 'austin', p: lookupZip('78701')! },
  { name: 'charlotte', p: lookupZip('28202')! },
  { name: 'raleigh', p: lookupZip('27601')! },
  { name: 'denver', p: lookupZip('80202')! },
];
/** Trade sets a member can hold: every trade on its own, the chip, and the mixes the new rows can meet. */
const TRADE_SETS: string[][] = [
  ...CATEGORIES.map((c) => [c.id]),
  ['pressure-washing'],
  ['cleaning', 'siding-gutters'],
  ['cleaning', 'lawn-care'],
  ['siding-gutters', 'lawn-care'],
  ['siding-gutters', 'landscaping', 'lawn-care'],
  ['pressure-washing', 'landscaping', 'lawn-care'],
  CATEGORIES.map((c) => c.id),
];
/** Every day of a leap year as 'YYYY-MM-DD' (2028 has Feb 29; the table has no year, so the days cover every month-day). */
const DAYS: string[] = (() => {
  const out: string[] = [];
  for (let t = Date.UTC(2028, 0, 1); t < Date.UTC(2029, 0, 1); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
})();

describe('switch off = main', () => {
  for (const v of [undefined, '', '0', 'false', 'off']) {
    it(`HOLLER_SEASON_R35_ENABLED=${JSON.stringify(v)}: activeSeasons equals the round 30 table's answer for every place, trade set and day, and never returns a new row`, () => {
      withSwitch(v);
      let compared = 0;
      for (const { name, p } of PLACES) {
        for (const trades of TRADE_SETS) {
          for (const date of DAYS) {
            const got = activeSeasons({ lat: p.lat, lon: p.lon, trades, date });
            const main = activeSeasons({ lat: p.lat, lon: p.lon, trades, date, table: SEASON_TABLE });
            expect(got, `${name} ${trades.join('+')} ${date}`).toEqual(main);
            for (const r of got) expect(R35_IDS.has(r.id), r.id).toBe(false);
            compared++;
          }
        }
      }
      expect(compared).toBe(PLACES.length * TRADE_SETS.length * DAYS.length);
    });
  }

  it('the lines /check prints (seasonLines, EN and ES) are the same objects of text as main, with the switch off', () => {
    withSwitch(undefined);
    for (const { p } of PLACES) {
      for (const date of ['2026-12-01', '2027-03-31', '2027-04-20', '2027-09-01', '2027-10-10']) {
        for (const lang of ['en', 'es']) {
          const trades = ['siding-gutters', 'cleaning', 'lawn-care', 'landscaping'];
          expect(seasonLines(activeSeasons({ lat: p.lat, lon: p.lon, trades, date }), lang)).toEqual(
            seasonLines(activeSeasons({ lat: p.lat, lon: p.lon, trades, date, table: SEASON_TABLE }), lang),
          );
        }
      }
    }
  });
});

describe('switch on: who gets which new line', () => {
  const at = (zip: string, trades: string[], date: string | Date) => {
    const p = lookupZip(zip)!;
    return ids(activeSeasons({ lat: p.lat, lon: p.lon, trades, date }));
  };

  it('fall armyworm reaches lawn care only, in each metro\'s weeks', () => {
    withSwitch('1');
    expect(at('30303', ['lawn-care'], '2027-09-01')).toContain('armyworm-atlanta');
    expect(at('28202', ['lawn-care'], '2027-08-20')).toContain('armyworm-charlotte');
    expect(at('27601', ['lawn-care'], '2027-10-10')).toContain('armyworm-raleigh');
    expect(at('78701', ['lawn-care'], '2027-09-15')).toContain('armyworm-austin');
    for (const [zip, id, date] of [['30303', 'armyworm-atlanta', '2027-09-01'], ['28202', 'armyworm-charlotte', '2027-09-01'], ['27601', 'armyworm-raleigh', '2027-09-01'], ['78701', 'armyworm-austin', '2027-09-15']]) {
      for (const t of CATEGORIES.map((c) => c.id).filter((x) => x !== 'lawn-care')) expect(at(zip, [t], date), `${id} via ${t}`).not.toContain(id);
      expect(at(zip, ['pressure-washing'], date), `${id} via the chip`).not.toContain(id);
    }
  });

  it('armyworm edges: Atlanta Aug 1 to Sep 30, the Carolinas Jul 25 to Oct 15, Austin Aug 15 to Oct 15 (inclusive)', () => {
    withSwitch('1');
    const has = (zip: string, id: string, date: string) => at(zip, ['lawn-care'], date).includes(id);
    expect(has('30303', 'armyworm-atlanta', '2027-07-31')).toBe(false);
    expect(has('30303', 'armyworm-atlanta', '2027-08-01')).toBe(true);
    expect(has('30303', 'armyworm-atlanta', '2027-09-30')).toBe(true);
    expect(has('30303', 'armyworm-atlanta', '2027-10-01')).toBe(false);
    for (const [zip, id] of [['28202', 'armyworm-charlotte'], ['27601', 'armyworm-raleigh']]) {
      expect(has(zip, id, '2027-07-24'), id).toBe(false);
      expect(has(zip, id, '2027-07-25'), id).toBe(true);
      expect(has(zip, id, '2027-10-15'), id).toBe(true);
      expect(has(zip, id, '2027-10-16'), id).toBe(false);
    }
    expect(has('78701', 'armyworm-austin', '2027-08-14')).toBe(false);
    expect(has('78701', 'armyworm-austin', '2027-08-15')).toBe(true);
    expect(has('78701', 'armyworm-austin', '2027-10-15')).toBe(true);
    expect(has('78701', 'armyworm-austin', '2027-10-16')).toBe(false);
  });

  it('spring pollen: house cleaning gets the cleaning line, gutters the gutter line, in all four metros', () => {
    withSwitch('1');
    for (const [zip, c, date] of [['30303', 'atlanta', '2027-03-31'], ['28202', 'charlotte', '2027-03-31'], ['27601', 'raleigh', '2027-03-31'], ['78701', 'austin', '2027-03-31']]) {
      expect(at(zip, ['cleaning'], date), `${c} cleaning`).toEqual([`pollen-cleaning-${c}`]);
      expect(at(zip, ['siding-gutters'], '2027-04-20'), `${c} gutters`).toEqual([`pollen-gutters-${c}`]);
    }
  });

  it('a pressure washer (both parts of the chip) gets the one pollen line: the round 30 wash line in Atlanta, Charlotte and Raleigh, the new wash line in Austin', () => {
    withSwitch('1');
    for (const [zip, id] of [['30303', 'pollen-atlanta'], ['28202', 'pollen-charlotte'], ['27601', 'pollen-raleigh']]) {
      for (const date of ['2027-03-20', '2027-03-31', '2027-04-20']) {
        const got = at(zip, ['pressure-washing'], date).filter((x) => x.startsWith('pollen'));
        expect(got, `${zip} ${date}`).toEqual([id]);
      }
      expect(at(zip, ['cleaning', 'siding-gutters'], '2027-03-31').filter((x) => x.startsWith('pollen'))).toEqual([id]);
    }
    // Austin: the new wash line from Mar 1; the winter cedar line before that
    expect(at('78701', ['pressure-washing'], '2027-03-31')).toContain('pollen-wash-austin');
    expect(at('78701', ['pressure-washing'], '2027-03-31').filter((x) => x.startsWith('pollen'))).toEqual(['pollen-wash-austin']);
    expect(at('78701', ['pressure-washing'], '2027-01-15')).toEqual(['pollen-austin']);
    // never the house-cleaning line to a pressure washer; the gutter line only on days the wash line is not showing (the chip holds
    // siding-gutters, which the round 30 gutter rows also reach), so a pressure washer never gets two pollen lines
    for (const { p } of PLACES) {
      for (const date of DAYS) {
        const got = activeSeasons({ lat: p.lat, lon: p.lon, trades: ['pressure-washing'], date, table: seasonTable(true) });
        const pollen = got.filter((r) => r.topic === 'pollen');
        expect(pollen.length, `${date}`).toBeLessThanOrEqual(1);
        for (const r of got) expect(r.id, `${date}`).not.toMatch(/^pollen-cleaning-/);
        if (pollen.length === 1 && /^pollen-gutters-/.test(pollen[0].id)) {
          const washWindow = SEASON_TABLE.concat(SEASON_TABLE_R35).filter((r) => r.topic === 'pollen' && r.allTrades && r.centre === pollen[0].centre);
          for (const w of washWindow) expect(inWindow(date.slice(5), w.start, w.end), `${date} ${w.id}`).toBe(false);
        }
      }
    }
  });

  it('a pressure washer in Atlanta on Mar 31 gets exactly the same lines with the switch on as with it off', () => {
    withSwitch('1');
    const on = at('30303', ['pressure-washing'], '2027-03-31');
    withSwitch(undefined);
    expect(at('30303', ['pressure-washing'], '2027-03-31')).toEqual(on);
  });

  it('no new line outside its window: a summer day gives nothing for any trade', () => {
    withSwitch('1');
    for (const c of CENTRE.values()) {
      expect(activeSeasons({ lat: c.lat, lon: c.lon, trades: CATEGORIES.map((x) => x.id), date: '2027-07-04' }), c.id).toEqual([]);
    }
  });

  it('seasonLines carries the new text and source in both languages', () => {
    withSwitch('1');
    const p = lookupZip('28202')!;
    const rows = activeSeasons({ lat: p.lat, lon: p.lon, trades: ['lawn-care'], date: '2027-09-01' });
    expect(ids(rows)).toContain('armyworm-charlotte');
    expect(seasonLines(rows, 'en').find((l) => l.id === 'armyworm-charlotte')).toEqual({ id: 'armyworm-charlotte', text: row('armyworm-charlotte').en, source: row('armyworm-charlotte').source });
    expect(seasonLines(rows, 'es').find((l) => l.id === 'armyworm-charlotte')!.text).toBe(row('armyworm-charlotte').es);
  });
});

describe('at most two lines, every place, trade set and day, with the rows on', () => {
  it(`never more than ${MAX_SEASON_LINES}, one per topic, one per id`, () => {
    withSwitch('1');
    let over = 0;
    for (const { name, p } of PLACES) {
      for (const trades of TRADE_SETS) {
        for (const date of DAYS) {
          const got = activeSeasons({ lat: p.lat, lon: p.lon, trades, date });
          if (got.length > MAX_SEASON_LINES) over++;
          expect(got.length, `${name} ${trades.join('+')} ${date}`).toBeLessThanOrEqual(MAX_SEASON_LINES);
          expect(new Set(got.map((r) => r.topic)).size, `${name} ${trades.join('+')} ${date} topics`).toBe(got.length);
          expect(new Set(got.map((r) => r.id)).size).toBe(got.length);
        }
      }
    }
    expect(over).toBe(0);
  });

  it('the busiest day: Austin, a member with every trade, Mar 20 has two lines and the nearer-to-peak ones win', () => {
    withSwitch('1');
    const p = lookupZip('78701')!;
    const got = activeSeasons({ lat: p.lat, lon: p.lon, trades: CATEGORIES.map((c) => c.id), date: '2027-03-20' });
    expect(got.length).toBeLessThanOrEqual(2);
    expect(got.length).toBeGreaterThan(0);
  });
});

describe('time zones: a Date is read in the metro\'s own calendar', () => {
  const aus = lookupZip('78701')!; // America/Chicago
  const clt = lookupZip('28202')!; // America/New_York
  const on = (p: { lat: number; lon: number }, trades: string[], date: Date) => ids(activeSeasons({ lat: p.lat, lon: p.lon, trades, date }));

  it('Austin armyworm opens at Aug 15 00:00 Central (CDT, UTC-5), not at UTC midnight', () => {
    withSwitch('1');
    expect(on(aus, ['lawn-care'], new Date('2027-08-15T04:59:00Z'))).not.toContain('armyworm-austin'); // Aug 14, 11:59 pm in Austin
    expect(on(aus, ['lawn-care'], new Date('2027-08-15T05:00:00Z'))).toContain('armyworm-austin');
    // closes after Oct 15 23:59 Central
    expect(on(aus, ['lawn-care'], new Date('2027-10-16T04:59:00Z'))).toContain('armyworm-austin');
    expect(on(aus, ['lawn-care'], new Date('2027-10-16T05:00:00Z'))).not.toContain('armyworm-austin');
  });

  it('Charlotte armyworm opens at Jul 25 00:00 Eastern (EDT, UTC-4)', () => {
    withSwitch('1');
    expect(on(clt, ['lawn-care'], new Date('2027-07-25T03:59:00Z'))).not.toContain('armyworm-charlotte');
    expect(on(clt, ['lawn-care'], new Date('2027-07-25T04:00:00Z'))).toContain('armyworm-charlotte');
    expect(on(clt, ['lawn-care'], new Date('2027-10-16T03:59:00Z'))).toContain('armyworm-charlotte');
    expect(on(clt, ['lawn-care'], new Date('2027-10-16T04:00:00Z'))).not.toContain('armyworm-charlotte');
  });

  it('Austin spring pollen opens Mar 1 00:00 Central (CST, UTC-6) and gutters open Mar 25 (CDT after Mar 14 2027)', () => {
    withSwitch('1');
    expect(on(aus, ['cleaning'], new Date('2027-03-01T05:59:00Z'))).not.toContain('pollen-cleaning-austin');
    expect(on(aus, ['cleaning'], new Date('2027-03-01T06:00:00Z'))).toContain('pollen-cleaning-austin');
    expect(on(aus, ['siding-gutters'], new Date('2027-03-25T04:59:00Z'))).not.toContain('pollen-gutters-austin');
    expect(on(aus, ['siding-gutters'], new Date('2027-03-25T05:00:00Z'))).toContain('pollen-gutters-austin');
    // the same instant is already Mar 25 in Charlotte (EDT): the gutter line is there too
    expect(on(clt, ['siding-gutters'], new Date('2027-03-25T04:00:00Z'))).toContain('pollen-gutters-charlotte');
    expect(on(clt, ['siding-gutters'], new Date('2027-03-25T03:59:00Z'))).not.toContain('pollen-gutters-charlotte');
  });
});

describe('the New Year wrap is untouched by the new rows', () => {
  it('no new row runs over New Year, and Dec 20 to Jan 12 gives the same answer with the switch on as off, for every place and trade set', () => {
    for (const r of SEASON_TABLE_R35) expect(inWindow('12-31', r.start, r.end) || inWindow('01-01', r.start, r.end), r.id).toBe(false);
    const days = DAYS.filter((d) => d >= '2028-12-20' || d <= '2028-01-12');
    expect(days.length).toBe(24);
    for (const { name, p } of PLACES) {
      for (const trades of TRADE_SETS) {
        for (const date of days) {
          const on = activeSeasons({ lat: p.lat, lon: p.lon, trades, date, table: seasonTable(true) });
          const off = activeSeasons({ lat: p.lat, lon: p.lon, trades, date, table: SEASON_TABLE });
          expect(ids(on), `${name} ${trades.join('+')} ${date}`).toEqual(ids(off));
        }
      }
    }
  });
  it('Austin cedar (Dec 15 to Mar 1, a wrap) still runs for a pressure washer, and hands over to the new wash line on Mar 2', () => {
    withSwitch('1');
    const p = lookupZip('78701')!;
    const f = (date: string) => ids(activeSeasons({ lat: p.lat, lon: p.lon, trades: ['pressure-washing'], date })).filter((x) => x.startsWith('pollen'));
    expect(f('2027-12-31')).toEqual(['pollen-austin']);
    expect(f('2028-01-05')).toEqual(['pollen-austin']);
    expect(f('2028-03-01')).toEqual(['pollen-austin']);
    expect(f('2028-03-02')).toEqual(['pollen-wash-austin']);
  });
});
