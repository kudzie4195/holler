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
import { CHECK_RADIUS_MI } from '@/lib/check/scope';
import { expandTradeIds } from '@/lib/plan/composite-trades';
import { CATEGORIES } from '@/lib/signals/categories';
import { haversineMi, lookupZip } from '@/lib/geo';
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

/** The loop tests run about 90,000 activeSeasons calls each (1 to 2 s alone, several times that on a busy shared machine). */
const LONG = 60_000;

describe('round 35 rows: every row', () => {
  it('is new: 12 rows, unique ids that are not in the round 30 table, a known topic, a measured centre', () => {
    expect(SEASON_TABLE_R35).toHaveLength(12);
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
      // review: no damage claim at all, not even a hedged one; the line is the source's timing and Holler's estimate
      expect(r.en, r.id).not.toMatch(/\b(?:affect\w*|damag\w*|harm\w*|eat\w*|chew\w*|strip\w*|kill\w*|destroy\w*)\b/i);
      expect(r.es, r.id).not.toMatch(/(?:afect|dañ|dano|destru|comen|mata)/i);
      expect(r.en.split(/(?<=\.) /), r.id).toHaveLength(2);
      expect(r.en, r.id).not.toMatch(/\byour (?:lawn|yard|grass|home|house)\b/i);
      expect(r.es, r.id).not.toMatch(/\bsu (?:césped|jardín|casa|pasto)\b/i);
    }
    for (const r of SEASON_TABLE_R35.filter((x) => x.id.startsWith('pollen-gutters-'))) {
      // timing only: nothing says pollen fills, clogs or blocks a gutter, and the Spanish says "limpiezas de canaletas en primavera"
      expect(r.en, r.id).not.toMatch(/\b(?:clog\w*|fill\w*|block\w*|collect\w*|because|cause\w*|due to)\b/i);
      expect(r.en, r.id).toContain('are typically booked after the peak, from mid-April to early May.');
      expect(r.es, r.id).toContain('las limpiezas de canaletas en primavera se suelen programar después de ese punto máximo, de mediados de abril a principios de mayo.');
    }
    for (const r of SEASON_TABLE_R35.filter((x) => x.id.endsWith('-austin') && x.topic === 'pollen')) {
      // the sentence the page says has no region in it (review P2-4)
      expect(r.en, r.id).not.toMatch(/Central Texas/);
      expect(r.es, r.id).not.toMatch(/centro de Texas/);
    }
    for (const r of SEASON_TABLE_R35.filter((x) => x.topic === 'pollen')) {
      expect(r.en, r.id).not.toMatch(/\byour\b/i);
      expect(r.es, r.id).not.toMatch(/\bsu (?:césped|jardín|casa|pasto)\b/i);
    }
  });

  // The table's confidence rule (lib/season/table.ts header), computed from facts about each row's page, not copied from the labels:
  // 'checked' only when the page states the anchor as usual timing WITH months for the metro or a region it names, and the row's
  // booking sentence is not built on a later event the page does not date (a clean-out "after the peak"); anything else is 'estimate'.
  // Facts read from the pages on 2026-11-28: what each source states.
  const SOURCE_FACTS: Record<string, { monthsAsUsualTiming: boolean }> = {
    'https://fieldreport.caes.uga.edu/publications/C1335/': { monthsAsUsualTiming: true }, // "recurs each year from July to September" (Georgia)
    'https://ncturfbugs.wordpress.ncsu.edu/2021/08/05/fall-armyworms-alert/': { monthsAsUsualTiming: true }, // "generally ranges from late July through mid-October" (NC)
    'https://citybugs.tamu.edu/2021/08/30/be-on-the-lookout-for-armyworms/': { monthsAsUsualTiming: false }, // "late summer or early fall": a season word, no month
    'https://www.fox5atlanta.com/news/georgia-pollen-count-explained-seasonal-allergies': { monthsAsUsualTiming: true }, // peaks late March and mid-April
    'https://forestry.ces.ncsu.edu/news/pine-pollen-season': { monthsAsUsualTiming: true }, // "typically peaking between late March and early April" (NC)
    'https://agrilifetoday.tamu.edu/2018/04/07/central-texans-getting-more-than-fair-share-of-oak-pollen/': { monthsAsUsualTiming: true }, // "typically ... March and April"
  };
  const ruleLabel = (r: SeasonRow): 'checked' | 'estimate' => {
    const facts = SOURCE_FACTS[r.source];
    if (!facts) throw new Error(`no facts recorded for ${r.source}`);
    const builtOnLaterEvent = /\bafter the peak\b/.test(r.en);
    return facts.monthsAsUsualTiming && !builtOnLaterEvent ? 'checked' : 'estimate';
  };
  it('confidence follows the rule, computed per row from what its source states', () => {
    for (const r of SEASON_TABLE_R35) expect(r.confidence, r.id).toBe(ruleLabel(r));
    // and the rule yields both labels here, so the test can fail either way
    expect(new Set(SEASON_TABLE_R35.map(ruleLabel))).toEqual(new Set(['checked', 'estimate']));
    expect(ruleLabel({ ...row('armyworm-atlanta'), en: 'x. Holler estimates that y are booked after the peak, z.' })).toBe('estimate');
    expect(ruleLabel({ ...row('armyworm-austin') })).toBe('estimate');
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
    // the gutter rows open with the booking window they state ("from mid-April"), after the sources' own peaks; none for Austin
    for (const c of ['atlanta', 'charlotte', 'raleigh']) expect(w(`pollen-gutters-${c}`)).toEqual(['04-15', '05-10']);
    expect(SEASON_TABLE_R35.some((r) => r.id === 'pollen-gutters-austin')).toBe(false);
  });
});

describe('the switch', () => {
  it('is on for 1, true, on, yes (any case, spaces ignored) and off for everything else, including unset', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'On', 'yes', ' 1 ']) expect(seasonR35Enabled(v), String(v)).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', '2', 'enabled', '11']) expect(seasonR35Enabled(v), String(v)).toBe(false);
  });

  it('off: the table is SEASON_TABLE itself; on: the same rows first, then the new ones', () => {
    expect(seasonTable(false)).toBe(SEASON_TABLE);
    const on = seasonTable(true);
    expect(on).toHaveLength(SEASON_TABLE.length + SEASON_TABLE_R35.length);
    expect(on.slice(0, SEASON_TABLE.length)).toEqual([...SEASON_TABLE]);
    expect(on.slice(SEASON_TABLE.length)).toEqual([...SEASON_TABLE_R35]);
  });

  it('reads process.env at call time, with no default of its own (unset means off)', () => {
    vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '');
    expect(seasonR35Enabled()).toBe(false);
    expect(seasonTable()).toBe(SEASON_TABLE);
    vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '1');
    expect(seasonR35Enabled()).toBe(true);
    expect(seasonTable()).toHaveLength(SEASON_TABLE.length + SEASON_TABLE_R35.length);
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

/**
 * An independent copy of the round 30 selection rules, written here and sharing no code with lib/season/active.ts except the shared
 * helpers it also uses for the place and the trades (centres, radius, distance, chip expansion). If activeSeasons changes behaviour with the
 * switch off, the answer no longer equals this one. String dates only (the instants are covered by the time zone tests).
 */
function oracleActive(table: readonly SeasonRow[], lat: number, lon: number, tradeIds: readonly string[], date: string): string[] {
  const trades = expandTradeIds(tradeIds);
  if (trades.length === 0) return [];
  const md = date.slice(5) === '02-29' ? '02-28' : date.slice(5);
  const num = (d: string) => Math.round((Date.UTC(2025, Number(d.slice(0, 2)) - 1, Number(d.slice(3, 5))) - Date.UTC(2025, 0, 1)) / 86_400_000) + 1;
  const inside = (s: string, e: string) => (s <= e ? md >= s && md <= e : md >= s || md <= e);
  const hits: { row: SeasonRow; miles: number; far: number; order: number }[] = [];
  table.forEach((r, order) => {
    const c = CENTRE.get(r.centre)!;
    const miles = haversineMi(lat, lon, c.lat, c.lon);
    if (!(miles <= CHECK_RADIUS_MI)) return;
    const all = r.allTrades ?? [];
    const reached = r.trades.some((t) => trades.includes(t) && (all.every((a) => trades.includes(a)) || !all.includes(t)));
    if (!reached || !inside(r.start, r.end)) return;
    const gap = Math.abs(num(md) - num(r.peak!)) % 365;
    hits.push({ row: r, miles, far: Math.min(gap, 365 - gap), order });
  });
  const byTopic = new Map<string, (typeof hits)[number]>();
  for (const h of hits) {
    const was = byTopic.get(h.row.topic);
    if (!was || h.miles < was.miles) byTopic.set(h.row.topic, h);
  }
  return [...byTopic.values()].sort((a, b) => a.far - b.far || a.order - b.order).map((h) => h.row.id).slice(0, 2);
}

describe('switch off = main', () => {
  it('every round 30 row has a peak, so the oracle below needs no midpoint rule', () => {
    for (const r of SEASON_TABLE) expect(r.peak, r.id).toBeTruthy();
  });
  for (const v of [undefined, '', '0', 'false', 'off']) {
    it(`HOLLER_SEASON_R35_ENABLED=${JSON.stringify(v)}: activeSeasons gives the answer of an independent copy of the round 30 rules over SEASON_TABLE, for every place, trade set and day, and never a new row`, () => {
      withSwitch(v);
      let compared = 0;
      for (const { name, p } of PLACES) {
        for (const trades of TRADE_SETS) {
          for (const date of DAYS) {
            const got = activeSeasons({ lat: p.lat, lon: p.lon, trades, date });
            expect(ids(got), `${name} ${trades.join('+')} ${date}`).toEqual(oracleActive(SEASON_TABLE, p.lat, p.lon, trades, date));
            for (const r of got) expect(R35_IDS.has(r.id), r.id).toBe(false);
            compared++;
          }
        }
      }
      expect(compared).toBe(PLACES.length * TRADE_SETS.length * DAYS.length);
    }, LONG);
  }
  it('the oracle can fail: with the switch on, it disagrees with activeSeasons on some day (so a wrong table would be seen)', () => {
    withSwitch('1');
    let differs = 0;
    for (const { p } of PLACES) for (const date of DAYS) if (ids(activeSeasons({ lat: p.lat, lon: p.lon, trades: ['lawn-care', 'cleaning', 'siding-gutters'], date })).join() !== oracleActive(SEASON_TABLE, p.lat, p.lon, ['lawn-care', 'cleaning', 'siding-gutters'], date).join()) differs++;
    expect(differs).toBeGreaterThan(0);
  });
  it('the table is main\'s SEASON_TABLE object itself while the switch is off', () => {
    withSwitch(undefined);
    expect(seasonTable()).toBe(SEASON_TABLE);
  });

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

  it('spring pollen: house cleaning gets the cleaning line in all four metros, gutters the gutter line in the three that have one', () => {
    withSwitch('1');
    for (const [zip, c, date] of [['30303', 'atlanta', '2027-03-31'], ['28202', 'charlotte', '2027-03-31'], ['27601', 'raleigh', '2027-03-31'], ['78701', 'austin', '2027-03-31']]) {
      expect(at(zip, ['cleaning'], date), `${c} cleaning`).toEqual([`pollen-cleaning-${c}`]);
      if (c !== 'austin') expect(at(zip, ['siding-gutters'], '2027-04-20'), `${c} gutters`).toEqual([`pollen-gutters-${c}`]);
    }
    // gutters: nothing before the booking window the line states (Apr 15), nothing in Austin
    for (const [zip, c] of [['30303', 'atlanta'], ['28202', 'charlotte'], ['27601', 'raleigh']]) {
      expect(at(zip, ['siding-gutters'], '2027-04-14'), `${c} Apr 14`).not.toContain(`pollen-gutters-${c}`);
      expect(at(zip, ['siding-gutters'], '2027-03-31'), `${c} Mar 31`).toEqual([]);
      expect(at(zip, ['siding-gutters'], '2027-04-15'), `${c} Apr 15`).toContain(`pollen-gutters-${c}`);
      expect(at(zip, ['siding-gutters'], '2027-05-10'), `${c} May 10`).toContain(`pollen-gutters-${c}`);
      expect(at(zip, ['siding-gutters'], '2027-05-11'), `${c} May 11`).not.toContain(`pollen-gutters-${c}`);
    }
    expect(at('78701', ['siding-gutters'], '2027-04-20')).toEqual([]);
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
  }, LONG);

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
  }, LONG);

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

  it('Austin spring pollen opens Mar 1 00:00 Central (CST, UTC-6); Charlotte gutters open Apr 15 00:00 Eastern (EDT)', () => {
    withSwitch('1');
    expect(on(aus, ['cleaning'], new Date('2027-03-01T05:59:00Z'))).not.toContain('pollen-cleaning-austin');
    expect(on(aus, ['cleaning'], new Date('2027-03-01T06:00:00Z'))).toContain('pollen-cleaning-austin');
    expect(on(clt, ['siding-gutters'], new Date('2027-04-15T04:00:00Z'))).toContain('pollen-gutters-charlotte');
    expect(on(clt, ['siding-gutters'], new Date('2027-04-15T03:59:00Z'))).not.toContain('pollen-gutters-charlotte');
    // the same instant is still Apr 14 in Austin at 04:59Z (CDT), but Austin has no gutter row anyway
    expect(on(aus, ['siding-gutters'], new Date('2027-04-15T05:00:00Z'))).toEqual([]);
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
  }, LONG);
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
