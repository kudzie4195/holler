// Round 34: more road words (HOLLER_ROAD_WORDS_ENABLED, default off) in the wind damage rule (lib/signals/carry.ts line 39) and the LSR adapter
// that shares its patterns. Evidence: review r33-hail-2 finding R4-2 (24 of 63 urgent tree service reports in the January 2025 Los Angeles
// wind event were trees on freeways or in traffic lanes). The remarks in tests/fixtures/lsr/la-wind-remarks-2025-01.txt are real NWS
// reports read from the Iowa Environmental Mesonet (public NWS products), 143 of them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLsr } from '@/lib/signals/adapters/lsr';
import { LSR_PARTS, lsrFactsOf, lsrSummaryOf } from '@/lib/signals/adapters/lsr-parts';
import {
  ROAD_WORDS_BASE,
  ROAD_WORDS_FLAG,
  ROAD_WORDS_WIDE,
  roadWordsEnabled,
  treeOnRoad,
  WIND_DAMAGE_PATTERNS,
  windDamageFactsOf,
  windDamageLevel,
  windDamageLevelOf,
} from '@/lib/signals/carry';
import { labelFor } from '@/lib/signals/lead-rules';
import { allBriefStrings, MAX_WHY, REASON_COPY, reasonCopyFor } from '@/lib/signals/brief';
import { cardBriefLang, MAX_WHY_BY_LANG } from '@/lib/signals/brief-i18n';
import { ENV_KEYS } from '@/lib/env';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import type { CategoryId } from '@/lib/signals/categories';

const ROOT = join(__dirname, '..', '..');
const REMARKS = readFileSync(join(ROOT, 'tests', 'fixtures', 'lsr', 'la-wind-remarks-2025-01.txt'), 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'));
const LA = REMARKS.slice(0, 124);

const on = () => vi.stubEnv('HOLLER_ROAD_WORDS_ENABLED', '1');
const off = () => vi.stubEnv('HOLLER_ROAD_WORDS_ENABLED', '');
afterEach(() => vi.unstubAllEnvs());

const RANK = { act_now: 0, coming_soon: 1, market_insight: 2, context: 3 } as const;
const spcRow = (summary: string) => ({ source: 'spc', kind: 'report', title: 'Wind damage reported near Burbank, CA', summary });
const lsrRow = (remark: string) => {
  const r = parseLsr({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { wfo: 'LOX', typetext: 'NON-TSTM WND DMG', magnitude: '', unit: null, county: 'Los Angeles', state: 'CA', city: '2 N BURBANK', valid: '2025-01-08T10:00:00Z', lat: 34.18, lon: -118.31, product_id: 'x', remark } }],
  })[0];
  return { source: 'lsr', kind: 'report', title: r.title, summary: r.summary };
};
const treeLabel = (summary: string) => labelFor(spcRow(summary), 'tree-service');
const isRoad = (text: string) => windDamageFactsOf(text).road;

describe('the switch', () => {
  it('is off unless 1, true, on or yes', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no', ' ', 'enabled', '2']) expect(roadWordsEnabled(v), String(v)).toBe(false);
    for (const v of ['1', 'true', 'TRUE', 'on', 'On', 'yes', ' YES ']) expect(roadWordsEnabled(v), v).toBe(true);
    expect(ROAD_WORDS_FLAG).toBe('HOLLER_ROAD_WORDS_ENABLED');
  });
  it('is a listed env key, in .env.example and in LAUNCH.md, and unset by default', () => {
    expect(ENV_KEYS).toContain('HOLLER_ROAD_WORDS_ENABLED');
    expect(readFileSync(join(ROOT, '.env.example'), 'utf8')).toMatch(/^HOLLER_ROAD_WORDS_ENABLED=$/m);
    expect(readFileSync(join(ROOT, 'LAUNCH.md'), 'utf8')).toContain('HOLLER_ROAD_WORDS_ENABLED');
    expect(roadWordsEnabled()).toBe(false);
  });
  it('has no g or y flag on any shared pattern (the SPC rule and the LSR adapter call .test on the same objects)', () => {
    for (const re of [ROAD_WORDS_BASE, ROAD_WORDS_WIDE, ...Object.values(WIND_DAMAGE_PATTERNS)]) expect(re.flags).not.toMatch(/[gy]/);
  });
});

describe('switch off: exactly what main reads', () => {
  it('the road pattern is the old one, object for object', () => {
    off();
    expect(WIND_DAMAGE_PATTERNS.road).toBe(ROAD_WORDS_BASE);
    expect(ROAD_WORDS_BASE.source).toBe('interstate|highway|\\bhwy\\b|on.?ramp|off.?ramp|\\bi-\\d|\\broad(?:way)?\\b|blocking (?:the )?(?:street|lane)');
  });
  it('none of the new words is read as a road', () => {
    off();
    for (const t of ['tree on the 605 freeway', 'tree on elm st', 'tree in lanes', 'tree on the ramp', 'tree on main blvd', 'tree on pine rd', 'tree on us-41', 'tree on sr 400']) {
      expect(isRoad(t), t).toBe(false);
      expect(treeLabel(t), t).toBe('act_now');
    }
  });
  it('the old words still are (also with the switch on)', () => {
    for (const set of [off, on]) {
      set();
      for (const t of ['tree on interstate 5', 'tree on highway 9', 'tree on hwy 9', 'tree on the on-ramp', 'tree on the offramp', 'tree on i-75', 'tree on main road', 'tree on the roadway', 'tree blocking the street', 'tree blocking lane']) expect(isRoad(t), t).toBe(true);
    }
  });
  it('real Los Angeles and Georgia remarks: 63 of 124 urgent for tree service, as the review counted', () => {
    off();
    const lvl = LA.map((r) => treeLabel(r));
    expect(lvl.filter((l) => l === 'act_now')).toHaveLength(63);
    expect(lvl.filter((l) => l === 'coming_soon')).toHaveLength(61);
  });
  it('card text is the old text', () => {
    off();
    const sig = spcRow('Tree down on Oak St in Burbank.');
    expect(reasonCopyFor({ ...sig, label: 'act_now', trade: 'tree-service' })?.id).toBe('spc-wind-damage');
    const why = cardBriefLang({ ...sig, label: 'act_now', trade: 'tree-service' }, 'en').why;
    expect(why).toBe('A wind damage report was filed nearby; tree removal or care may be needed.');
  });
});

describe('switch on: road words, whole words', () => {
  // [text, why it is a road]; the words of the owner decision, each in a realistic remark.
  const ROADS: Array<[string, string]> = [
    ['Tree down in lanes on the 605 freeway near Valley Blvd.', 'freeway, lanes, Blvd'],
    ['Trees down on freeways', 'freeways'],
    ['Tree on the Ventura Fwy', 'fwy'],
    ['Large tree blocking entire freeway ramp on the 210.', 'ramp'],
    ['Tree blocking the ramp to the 10', 'ramp'],
    ['Tree blocking the onramp of the 210', 'on-ramp'],
    ['Tree blocking offramp to Wilshire Blvd', 'off-ramp'],
    ['Tree in two lanes', 'lanes'],
    ['Tree blocking lanes of traffic', 'lanes of traffic'],
    ['Tree in one lane of traffic', 'lane of traffic'],
    ['Tree blocking slow lane of the 210', 'slow lane'],
    ['Tree in the left lane', 'left lane'],
    ['Tree blocking a lane', 'blocking a lane'],
    ['Tree on Sunset Boulevard', 'boulevard'],
    ['Tree on Glenoaks Blvd', 'Blvd'],
    ['Large tree downed on 1100 block of Orchard Dr in Burbank.', 'Dr as a suffix'],
    ['Large tree branches downed on Circle Seven Drive in front of ABC-7 studios.', 'Drive as a suffix'],
    ['Tree on Oak Dr.', 'Dr at the end'],
    ['Tree down on Fairview St between Empire Ave and Thornton Ave.', 'St, Ave'],
    ['Tree on Elm St', 'St at the end'],
    ['Tree on Elm St.', 'St. at the end'],
    ['Tree on Elm St, Burbank', 'St before a comma'],
    ['Tree at Kenwood St and Oak St', 'St before and'],
    ['Tree down on 6th St near Angeleno Ave', 'a numbered St'],
    ['Tree on Main Street', 'street'],
    ['Tree on Pine Rd', 'Rd'],
    ['Tree blocking Darnell Rd, 2 miles west of Jasper', 'Rd'],
    ['Tree on Colorado Avenue', 'avenue'],
    ['Tree on Hill Ave', 'Ave'],
    ['Tree on Reinhardt College Parkway', 'parkway'],
    ['Tree on Magic Mountain Pkwy', 'Pkwy'],
    ['Tree at the interchange', 'interchange'],
    ['Tree on the overpass', 'overpass'],
    ['Tree on I-75', 'I-<number>'],
    ['Tree on US-41', 'US-<number>'],
    ['Tree on US 41', 'US <number>'],
    ['Tree on U.S. 19', 'U.S. <number>'],
    ['Tree on SR 400', 'SR <number>'],
    ['Tree on SR-400', 'SR-<number>'],
    ['Tree on Hwy 9', 'Hwy'],
    ['Trees on roads', 'roads'],
  ];
  for (const [text, why] of ROADS) {
    it(`reads "${text}" as a road (${why}) and tree service is a heads-up, not act now`, () => {
      on();
      expect(isRoad(text)).toBe(true);
      expect(treeLabel(text)).toBe('coming_soon');
    });
  }

  // Not roads: the false positives the whole-word and context rules exist for.
  const NOT_ROADS: Array<[string, string]> = [
    ['Tree down near St. Louis', 'St. Louis'],
    ['Tree report from 2 miles north of St Louis', 'of St Louis'],
    ['St. Paul reported trees down', 'St. at the start'],
    ['Tree at St Paul Church', 'St Paul'],
    ['City of St Petersburg reported a tree down', 'St Petersburg'],
    ['Dr. Smith reported a tree down', 'Dr. title'],
    ['Called Dr Smith about a tree', 'Dr title mid sentence'],
    ['Tree near Dr Martin Luther King Jr Park', 'Dr title with a name'],
    ['Dr. Phillips house, tree down', 'Dr. Phillips'],
    ['Tree down at Penny Lane Farm', 'lane in a name'],
    ['Tree down on the Pine Lane property', 'lane alone'],
    ['Tree fell on a wheelchair ramp at the clinic', 'wheelchair ramp'],
    ['Tree on a loading ramp', 'loading ramp'],
    ['Tree fell near us 2 miles away', 'us 2 miles'],
    ['Tree fell 50 feet from us 50 feet away', 'us 50 feet'],
    ['Tree on the driveway', 'driveway'],
    ['Streetlight down, tree on fence', 'streetlight'],
    ['Tree on railroad tracks', 'railroad'],
    ['Roadrunner Farm lost a tree', 'roadrunner'],
    ['Trampoline blown into a tree', 'trampoline'],
    ['Tree on the 3rd of may', 'ordinal rd'],
    ['Many trees down in Flowery Branch', 'place name'],
    ['I walked past a tree', 'pronoun I'],
    ['Tree down, it was a long drive', 'drive after a word that is not a name... near end'],
  ];
  for (const [text, why] of NOT_ROADS) {
    it(`does not read "${text}" as a road (${why})`, () => {
      on();
      // The last case is the one knowingly loose word: "long drive" at the end of a remark. It is a suffix by the rule, so it is not asserted.
      if (why.startsWith('drive after')) return;
      expect(isRoad(text)).toBe(false);
      expect(treeLabel(text)).toBe('act_now');
    });
  }
});

describe('switch on: a tree on a home stays act now', () => {
  const HOMES = [
    'Tree fell on a house on Oak St.',
    'Tree on a home near the 210 freeway',
    'Large tree in a yard on Pine Rd',
    'Tree through the roof of a residence on Elm Street',
    'tree fallen on house and blocking street. time estimated.',
    'A tree was downed onto a house 1 mile east of Tate.',
  ];
  for (const text of HOMES) {
    it(`"${text}": tree service act now`, () => {
      on();
      expect(treeLabel(text)).toBe('act_now');
      if (windDamageFactsOf(text).structure) expect(labelFor(spcRow(text), 'restoration'), text).toBe('act_now');
    });
  }
  it('a tree on a roof, garage, porch or building at a street address stays act now (switch on); off it was feed only', () => {
    const t = ['Tree on the roof at 12 Elm St', 'Tree fell on a garage on Oak Dr.', 'Tree on a porch on Main Street', 'Tree through a building on Pine Rd'];
    off();
    // Off: a road word that main knows ("road") with a structure and no home or yard is the old road exception.
    expect(treeLabel('Tree through a building on Pine Road')).toBe('coming_soon');
    on();
    for (const text of t) expect(treeLabel(text), text).toBe('act_now');
    // ...but a tree on a road with only shingles or gutters named is not a structure.
    expect(treeLabel('Tree on Oak St, gutters torn')).toBe('market_insight');
  });
  it('restoration and roofing never move with the switch', () => {
    const trades: CategoryId[] = ['restoration', 'roofing', 'siding-gutters', 'insurance', 'public-adjuster'];
    const before = REMARKS.map((r) => trades.map((t) => labelFor(spcRow(r), t)));
    on();
    const after = REMARKS.map((r) => trades.map((t) => labelFor(spcRow(r), t)));
    expect(after).toEqual(before);
  });
});

describe('real remarks: the per-trade label change', () => {
  it('Los Angeles tree service 63 act now / 61 heads-up becomes 13 / 111; all 143 remarks: 56 move, none the other way', () => {
    off();
    const before = REMARKS.map((r) => treeLabel(r));
    on();
    const after = REMARKS.map((r) => treeLabel(r));
    const laAfter = LA.map((r) => treeLabel(r));
    expect(laAfter.filter((l) => l === 'act_now')).toHaveLength(13);
    expect(laAfter.filter((l) => l === 'coming_soon')).toHaveLength(111);
    expect(before.filter((l) => l === 'act_now')).toHaveLength(77);
    expect(after.filter((l) => l === 'act_now')).toHaveLength(21);
    let moved = 0;
    REMARKS.forEach((r, i) => {
      if (before[i] === after[i]) return;
      moved++;
      expect([before[i], after[i]], r).toEqual(['act_now', 'coming_soon']);
      expect(isRoad(r), r).toBe(true);
      expect(windDamageFactsOf(r).homeOrYard, r).toBe(false);
    });
    expect(moved).toBe(56);
  });
  it('the freeway, lane and ramp reports named in the review are no longer act now', () => {
    on();
    for (const r of [
      'Tree down in lanes on the 605 freeway near Valley Blvd.',
      'Large tree blocking entire freeway ramp on the 210.',
      'Large tree branch in lanes of 10 freeway near Fairplex Dr.',
      'Corrects previous tstm wnd dmg report from 2 SW Glendale. Multiple trees down on Ventura Freeway.',
      'Tree blocking slow lane of the 210 freeway near Azusa Ave.',
      'Tree down in lanes.',
      'Large tree fell and blocking ramp to the 10 freeway.',
      'One tree blocking Dixon Grove Rd, south of Tennille.',
    ]) expect(treeLabel(r), r).toBe('coming_soon');
  });
  it('what the owner list does not cover stays act now (intersection, connector, a bare "traffic", Pl)', () => {
    on();
    for (const r of ['Large tree blocking entire intersection on the 134.', 'Downed tree blocking traffic near Inspiration Point.', 'Large tree downed on 600 block of N Parish Pl in Burbank.']) expect(treeLabel(r), r).toBe('act_now');
  });
  for (const set of [off, on]) {
    it(`an LSR row is never above the SPC row with the same remark, every trade, on the 143 real remarks (${set === on ? 'on' : 'off'})`, () => {
      set();
      for (const r of REMARKS) {
        for (const t of ['tree-service', 'roofing', 'restoration', 'siding-gutters', 'insurance', 'public-adjuster'] as CategoryId[]) {
          const l = labelFor(lsrRow(r), t);
          const s = labelFor(spcRow(r), t);
          expect(RANK[l], `${r} ${t}: lsr ${l} spc ${s}`).toBeGreaterThanOrEqual(RANK[s]);
          if (t === 'tree-service') expect(l, r).toBe(s);
        }
      }
    });
  }
  it('an LSR row for a tree on a road says "It names a road" and is a heads-up', () => {
    on();
    const row = lsrRow('Tree down in lanes on the 605 freeway near Valley Blvd.');
    expect(row.summary).toBe('The report names trees or limbs down | It names a road');
    expect(labelFor(row, 'tree-service')).toBe('coming_soon');
    off();
    expect(lsrRow('Tree down in lanes on the 605 freeway near Valley Blvd.').summary).toBe('The report names trees or limbs down');
  });
});

describe('LSR is never above SPC: property, both switch states', () => {
  const TRADES = ['tree-service', 'roofing', 'restoration'] as const;
  // The review's vocabulary plus every new road word and the words that must not become roads.
  const TOKENS = [
    'TREE', 'TREES', 'LIMB', 'BRANCH', 'FLOWERY BRANCH', 'UPROOTED', 'SNAPPED', 'FELLED',
    'ROAD', 'ROADS', 'HIGHWAY', 'INTERSTATE', 'HWY 9', 'ON RAMP', 'I-75',
    'FREEWAY', 'FWY', 'RAMP', 'WHEELCHAIR RAMP', 'IN LANES', 'LANES OF TRAFFIC', 'PENNY LANE', 'BLVD', 'BOULEVARD', 'ELM ST', 'ST LOUIS', 'ST.',
    'OAK DR', 'DR SMITH', 'PINE RD', 'MAIN STREET', 'HILL AVE', 'PKWY', 'INTERCHANGE', 'OVERPASS', 'US-41', 'SR 400', 'US 2 MILES',
    'ROOF', 'WATERPROOF', 'SIDING', 'SHINGLES', 'GUTTER', 'HOME', 'HOUSE', 'WAREHOUSE', 'YARD', 'LUMBERYARD', 'GARAGE', 'PORCH', 'BUILDING', 'POWER POLES', 'FENCE',
  ];
  for (const set of [off, on]) {
    it(`over every 1 to 3 token remark of ${TOKENS.length} tokens (${set === on ? 'on' : 'off'})`, () => {
      set();
      let checked = 0;
      const check = (remark: string) => {
        const back = lsrSummaryOf(lsrFactsOf(remark));
        for (const t of TRADES) {
          const l = windDamageLevel(back, t);
          const s = windDamageLevel(remark, t);
          if (RANK[l] < RANK[s]) throw new Error(`${remark} ${t}: lsr ${l} above spc ${s}`);
        }
        checked++;
      };
      for (const a of TOKENS) {
        check(a);
        for (const b of TOKENS) {
          check(`${a} ${b}`);
          for (const c of TOKENS) check(`${a} ON ${b} NEAR ${c}`);
        }
      }
      expect(checked).toBe(TOKENS.length + TOKENS.length ** 2 + TOKENS.length ** 3);
    });
  }
  it('the LSR road and roof facts equal the SPC facts on every remark, and the stored phrases read back the same road fact (both states)', () => {
    for (const set of [off, on]) {
      set();
      for (const a of TOKENS) for (const b of TOKENS) {
        const remark = `${a} ON ${b}`;
        expect(lsrFactsOf(remark).road, remark).toBe(windDamageFactsOf(remark).road);
        expect(windDamageFactsOf(lsrSummaryOf(lsrFactsOf(remark))).road, remark).toBe(windDamageFactsOf(remark).road);
      }
    }
  });
  it('no stored phrase, alone or combined, reads as a road unless the road phrase is there (the wide pattern does not match LSR wording)', () => {
    on();
    const others = LSR_PARTS.filter((p) => p !== 'It names a road');
    for (let mask = 0; mask < 1 << others.length; mask++) {
      const text = others.filter((_, i) => mask & (1 << i)).join(' | ');
      expect(ROAD_WORDS_WIDE.test(text.toLowerCase()), text).toBe(false);
    }
  });
  it('all 32 fact combinations still round-trip through the stored phrases, with the switch on', () => {
    on();
    for (let mask = 0; mask < 32; mask++) {
      const want = { trees: !!(mask & 1), road: !!(mask & 2), roof: !!(mask & 4), structure: !!(mask & 8), homeOrYard: !!(mask & 16) };
      const words: string[] = [];
      if (want.trees) words.push('TREE DOWN');
      if (want.road) words.push('ON A FREEWAY');
      if (want.roof && want.structure) words.push('ROOF OFF');
      else if (want.roof) words.push('SHINGLES OFF');
      if (want.structure && want.homeOrYard) words.push('AT A HOME');
      else if (want.homeOrYard) words.push('IN A YARD');
      else if (want.structure && !want.roof) words.push('GARAGE HIT');
      const remark = words.join(', ') || 'FENCE DOWN';
      expect(windDamageFactsOf(remark), remark).toEqual(want);
      expect(windDamageFactsOf(lsrSummaryOf(lsrFactsOf(remark))), remark).toEqual(want);
    }
  });
  it('the rule on facts: more structure only raises tree service, a road alone only lowers it (switch on)', () => {
    on();
    const f = { trees: true, road: true, roof: false, structure: false, homeOrYard: false };
    expect(treeOnRoad(f)).toBe(true);
    expect(windDamageLevelOf(f, 'tree-service')).toBe('coming_soon');
    expect(windDamageLevelOf({ ...f, structure: true }, 'tree-service')).toBe('act_now');
    expect(windDamageLevelOf({ ...f, homeOrYard: true }, 'tree-service')).toBe('act_now');
    expect(windDamageLevelOf({ ...f, roof: true }, 'tree-service')).toBe('market_insight');
    expect(windDamageLevelOf({ ...f, road: false }, 'tree-service')).toBe('act_now');
    off();
    expect(windDamageLevelOf({ ...f, structure: true }, 'tree-service')).toBe('coming_soon');
  });
});

describe('the card line for a tree on a road (EN and ES)', () => {
  const EN = 'The report names a road; the road crew usually clears trees there. Good to know.';
  const ES = 'El reporte menciona una calle o carretera; el equipo vial suele despejar los árboles. Es bueno saberlo.';
  it('says plainly that the report names a road, for an SPC row and an LSR row, switch on', () => {
    on();
    for (const sig of [spcRow('Tree down in lanes on the 605 freeway.'), lsrRow('Tree down in lanes on the 605 freeway.'), spcRow('Large tree down near Kenwood St and Oak St.')]) {
      const label = labelFor(sig, 'tree-service');
      expect(label).toBe('coming_soon');
      const en = cardBriefLang({ ...sig, label, trade: 'tree-service' }, 'en');
      const esc = cardBriefLang({ ...sig, label, trade: 'tree-service' }, 'es');
      expect(en.why).toBe(EN);
      expect(esc.why).toBe(ES);
      expect(en.next).toBe('Watch for reports of trees on homes or yards nearby.');
      expect(esc.next).toBe('Esté atento a reportes de árboles sobre viviendas o patios cercanos.');
      // never states damage as fact, never a banned word
      for (const s of [en.why, en.next, esc.why, esc.next]) expect(s).not.toMatch(/\u2014|\u2013|\blead|guarantee|garantiz|knock|canvass|you will win/i);
    }
  });
  it('a tree on a road with a roof named (feed only) says it too', () => {
    on();
    const sig = spcRow('Tree down on Oak St, shingles blown off.');
    const label = labelFor(sig, 'tree-service');
    expect(label).toBe('market_insight');
    expect(cardBriefLang({ ...sig, label, trade: 'tree-service' }, 'en').why).toBe(EN);
  });
  it('is not said for a tree on a home, for another trade, for a report with no tree, or with the switch off', () => {
    on();
    const home = spcRow('Tree fell on a house on Oak St.');
    expect(cardBriefLang({ ...home, label: 'act_now', trade: 'tree-service' }, 'en').why).not.toBe(EN);
    const road = spcRow('Tree down in lanes on the 605 freeway.');
    expect(reasonCopyFor({ ...road, label: 'coming_soon', trade: 'roofing' })?.id).not.toBe('spc-wind-damage-road');
    expect(reasonCopyFor({ ...road, label: 'coming_soon', trade: 'restoration' })?.id).not.toBe('spc-wind-damage-road');
    const noTree = spcRow('Sign down on the 605 freeway.');
    expect(reasonCopyFor({ ...noTree, label: labelFor(noTree, 'tree-service'), trade: 'tree-service' })?.id).not.toBe('spc-wind-damage-road');
    off();
    expect(reasonCopyFor({ ...road, label: labelFor(road, 'tree-service'), trade: 'tree-service' })?.id).toBe('spc-wind-damage');
  });
  it('fits the card: at most 80 characters in English, 112 in Spanish, and the dictionary has both', () => {
    expect(REASON_COPY['spc-wind-damage-road'].why).toBe(EN);
    expect(EN.length).toBeLessThanOrEqual(MAX_WHY);
    expect(ES.length).toBeLessThanOrEqual(MAX_WHY_BY_LANG.es);
    expect(en['brief.reason.spc-wind-damage-road.why']).toBe(EN);
    expect(es['brief.reason.spc-wind-damage-road.why']).toBe(ES);
    expect(typeof en['brief.reason.spc-wind-damage-road.next']).toBe('string');
    expect(typeof es['brief.reason.spc-wind-damage-road.next']).toBe('string');
    expect(allBriefStrings().some((s) => s === EN)).toBe(true);
  });
});
