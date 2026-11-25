// Round 34: more road words (HOLLER_ROAD_WORDS_ENABLED, default off) in the wind damage rule (lib/signals/carry.ts line 39) and the LSR adapter
// that shares its patterns. Evidence: review r33-hail-2 R4-2 (24 of 63 urgent tree service reports in the January 2025 Los Angeles wind event
// were trees on freeways or in traffic lanes) and the review of PR 25 (the change may only LOWER tree service labels; a street that only
// describes an area is not a tree on a road; the browser must agree with the server; the switch must work at once in both directions).
//
// Real remarks: tests/fixtures/lsr/la-wind-remarks-2025-01.txt (143, NWS, read from the Iowa Environmental Mesonet) and
// tests/fixtures/spc/live-wind-damage-2026-11-25.txt (14 distinct SPC wind damage rows stored on 2026-11-25). Public NWS products.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BriefBlock } from '@/components/feed/brief-block';
import { parseLsr } from '@/lib/signals/adapters/lsr';
import { LSR_PARTS, LSR_ROAD_TREE_PART, lsrFactsOf, lsrSummaryOf } from '@/lib/signals/adapters/lsr-parts';
import { ROAD_TREE_PHRASE, ROAD_WORDS_BASE, ROAD_WORDS_FLAG, roadWordsEnabled, treeOnRoad, treeOnRoadWordsOf, WIND_DAMAGE_PATTERNS, windDamageFactsOf, windDamageLevel, windDamageLevelOf } from '@/lib/signals/carry';
import { labelFor } from '@/lib/signals/lead-rules';
import { allBriefStrings, MAX_WHY, REASON_COPY, reasonCopyFor } from '@/lib/signals/brief';
import { cardBriefLang, MAX_WHY_BY_LANG } from '@/lib/signals/brief-i18n';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { ENV_KEYS } from '@/lib/env';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import type { CategoryId } from '@/lib/signals/categories';

const ROOT = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const lines = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#'));
const REAL = lines(read('tests', 'fixtures', 'lsr', 'la-wind-remarks-2025-01.txt'));
const LIVE = lines(read('tests', 'fixtures', 'spc', 'live-wind-damage-2026-11-25.txt'));

const on = () => vi.stubEnv('HOLLER_ROAD_WORDS_ENABLED', '1');
const off = () => vi.stubEnv('HOLLER_ROAD_WORDS_ENABLED', '');
afterEach(() => vi.unstubAllEnvs());

const EN = 'The report names a road; the road crew usually clears trees there. Good to know.';
const ES = 'El reporte menciona una calle o carretera; el equipo vial suele despejar los árboles. Es bueno saberlo.';

const RANK: Record<string, number> = { act_now: 0, coming_soon: 1, market_insight: 2, context: 3 };
const TRADES: CategoryId[] = ['tree-service', 'roofing', 'restoration', 'siding-gutters', 'insurance', 'public-adjuster'];
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

/** Main's line 39 rule, written out here from main's source (round 33), as the independent oracle for "never higher than main". */
const MAIN = {
  trees: /\btrees?\b|limb|branch|uproot|snapped|felled/,
  road: /interstate|highway|\bhwy\b|on.?ramp|off.?ramp|\bi-\d|\broad(?:way)?\b|blocking (?:the )?(?:street|lane)/,
  roofOrSiding: /(?<!p)roof|siding/,
  shinglesOrGutters: /shingle|gutter/,
  structure: /home|house|residen|(?<!p)roof|siding|garage|carport|porch|structure|building/,
  homeOrYard: /home|house|yard|residen/,
};
function mainLevel(remark: string, trade: 'roofing' | 'restoration' | 'tree-service'): string {
  const c = remark.trim().toLowerCase();
  const roof = MAIN.roofOrSiding.test(c) || MAIN.shinglesOrGutters.test(c);
  const trees = MAIN.trees.test(c) && !(MAIN.road.test(c) && !MAIN.homeOrYard.test(c));
  if (trade === 'tree-service') return trees ? 'act_now' : roof ? 'market_insight' : 'coming_soon';
  if (trade === 'roofing') return roof ? 'act_now' : 'coming_soon';
  return MAIN.structure.test(c) ? 'act_now' : 'coming_soon';
}

// ---- built corpora (the reviewer's attack sets, plus mine) -------------------------------------------------------------------------
const HOUSE = ['Tree fell on a house', 'Large tree down on a home', 'Tree fell onto a residence', 'A large oak tree fell onto a mobile home', 'Tree limb through the roof of a house', 'Trees down on two houses', 'TREE FELL ON A HOUSE'];
const OTHER = [
  'Tree fell on an apartment complex', 'Tree fell onto a trailer', 'Large tree fell on a duplex', 'Tree fell on a shed', 'Tree fell on a barn', 'Tree fell on a church', 'Tree fell on a business', 'Tree fell onto a condo',
  'Tree fell on a cabin', 'Tree on a fence and a parked car', 'Tree fell into a dwelling', 'Tree fell on a townhome', 'Tree fell in a backyard', 'Tree fell on the property', 'Tree fell on a school', 'Trees down in a neighborhood',
];
const LOC = [
  '2 mi N of Main St', 'between Western Avenue and Vermont', 'near I-10 and Hwy 99', 'at the intersection of Oak Dr and Elm St', 'on the 400 block of N Parish Pl', 'at 1200 Elm St', 'on Maple Ave', 'near the corner of 5th St and Pine Ave',
  'along Sunset Blvd', 'off Peachtree Pkwy', 'just east of US-41', 'near SR 400 and Old Alabama Rd', 'on Lake Shore Drive', 'near the I-85 interchange', 'south of the Hwy 20 overpass', 'on Old Mill Road', 'at Oak St. and 3rd Ave.',
  'in the 2300 block of Colorado Blvd', 'near the 210 freeway', 'on Ramp Creek Rd',
];
const NAMES = [
  'Trees down in St. Louis.', 'Trees down across St Louis County.', 'Trees down in East St. Louis and Belleville.', 'Tree down, reported by Dr. King.', 'Trees down per Dr King of the EMA.', 'Trees down in St Johns County.',
  'Trees down in Lane County.', 'Trees down near Ramp Creek.', 'Trees down at the boat ramp at Lake Lanier.', 'Tree fell at the wheelchair ramp of the library.', 'Trees down in Port St. Lucie.', 'Trees down in Mount St. Helens area.',
  'Trees down in St. Paul and Minneapolis.', 'Trees down in Ave Maria.', 'Trees down across Hampton Roads.', 'Trees down in Roads End.', 'Trees down at Penny Lane Farm.', 'Trees down at Sunset Lanes bowling alley.', 'Trees down in Street, MD.',
  'Trees down near Wall Street Baptist Church.', 'Trees down in Overpass Park.', 'Trees down at Parkway Village apartments.', 'Trees down at Boulevard Mall parking lot.', 'Trees down in Freeway Estates subdivision.',
  'Trees down 10 miles from us 2 miles west.', 'Trees down, see Dr Martin.', 'Trees down at St. Mary Church in town.', 'Trees and limbs down in the Three Lanes community.', 'Trees down in West St. Paul near the river.',
  'Trees down at Fwy Storage lot.', 'Tree on boat ramp', 'Tree on ramp creek', 'Tree on sunset lanes', 'Tree on hampton roads', 'Tree on port st lucie', 'Tree on ave maria',
];
const BASE_ROADS = ['on Highway 9', 'across Hwy 53', 'on Interstate 85', 'on the roadway', 'blocking the road', 'on I-20', 'blocking the street', 'on the off-ramp'];
const STRUCT = ['Roof blown off a barn', 'Garage damaged', 'A carport was destroyed', 'Porch torn off a store', 'Siding ripped from a building', 'Minor structure damage', 'Shingles blown off'];
const BUILT: string[] = [
  ...HOUSE.flatMap((h) => LOC.map((l) => `${h} ${l}.`)),
  ...OTHER.flatMap((h) => LOC.map((l) => `${h} ${l}.`)),
  ...NAMES,
  ...BASE_ROADS.flatMap((rd) => STRUCT.flatMap((s) => [`Trees down ${rd}. ${s}.`, `${s}. Tree blocking ${rd.replace(/^(on|across|blocking) /, '')}.`])),
];
const VOC = [
  'tree down', 'limbs snapped', 'power poles snapped', 'branch fell', 'on highway 9', 'on i-85', 'in the road', 'on main st', 'at 12 elm st.', 'on oak dr', 'on sunset blvd', 'in lanes', 'on the freeway', 'freeway ramp', 'near us-41', 'sr 400',
  'maple ave', 'old mill rd', 'on a house', 'on a home', 'in a yard', 'backyard', 'residence', 'roof damage', 'siding', 'shingles', 'gutters', 'garage', 'porch', 'building', 'structure', 'warehouse', 'lumberyard', 'flowery branch',
  'st. louis', 'dr. king', 'lane county', 'ramp creek', 'wheelchair ramp', 'power lines down', 'waterproof', 'mobile home', 'apartment', 'interchange', 'overpass', 'parkway', 'street', 'avenue', 'blocking the street', 'traffic lane', 'penny lane farm',
  'blocking', 'on', 'across', 'blocked by trees', 'near', 'between', 'along', 'tree', 'trees',
];
const SWEEP: string[] = [];
for (const a of VOC) {
  SWEEP.push(a);
  for (const b of VOC) {
    SWEEP.push(`${a} ${b}`);
    for (let k = 0; k < VOC.length; k += 3) SWEEP.push(`${a}, ${b} ${VOC[k]}`);
  }
}
const ALL = [...REAL, ...LIVE, ...BUILT, ...SWEEP];

describe('the switch', () => {
  it('is off unless 1, true, on or yes', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no', ' ', 'enabled', '2']) expect(roadWordsEnabled(v), String(v)).toBe(false);
    for (const v of ['1', 'true', 'TRUE', 'on', 'On', 'yes', ' YES ']) expect(roadWordsEnabled(v), v).toBe(true);
    expect(ROAD_WORDS_FLAG).toBe('HOLLER_ROAD_WORDS_ENABLED');
    expect(roadWordsEnabled()).toBe(false);
  });
  it('is a listed env key, in .env.example and in LAUNCH.md', () => {
    expect(ENV_KEYS).toContain('HOLLER_ROAD_WORDS_ENABLED');
    expect(read('.env.example')).toMatch(/^HOLLER_ROAD_WORDS_ENABLED=$/m);
    expect(read('LAUNCH.md')).toContain('HOLLER_ROAD_WORDS_ENABLED');
  });
  it('reaches the browser: next.config.ts inlines it, and the code reads it as a plain member expression Next can replace', () => {
    // A variable without NEXT_PUBLIC_ is undefined in the browser. Listing it under `env` makes Next replace process.env.HOLLER_ROAD_WORDS_ENABLED
    // with the build's value in the server and the browser bundle (verified on a build with the switch on: gates log client-chunk-switch.txt).
    expect(read('next.config.ts')).toMatch(/env:\s*\{\s*HOLLER_ROAD_WORDS_ENABLED:\s*process\.env\.HOLLER_ROAD_WORDS_ENABLED/);
    const src = read('lib', 'signals', 'carry.ts');
    expect(src).toContain('process.env.HOLLER_ROAD_WORDS_ENABLED : undefined');
    expect(src).not.toMatch(/process\.env\?\.HOLLER_ROAD_WORDS_ENABLED/);
    expect(src).not.toMatch(/process\.env\[/);
  });
  it('has no g or y flag on a shared pattern (the SPC rule and the LSR adapter call .test on the same objects)', () => {
    for (const re of [ROAD_WORDS_BASE, ...Object.values(WIND_DAMAGE_PATTERNS)]) expect(re.flags).not.toMatch(/[gy]/);
    expect(WIND_DAMAGE_PATTERNS.road).toBe(ROAD_WORDS_BASE);
  });
  it('is fast on long runs of spaces (no quadratic lookbehind)', () => {
    on();
    const t0 = Date.now();
    for (const tail of ['st', 'tree on st']) treeOnRoadWordsOf(`a${' '.repeat(50000)}${tail}`);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('switch off is main', () => {
  it("road pattern is main's; none of the new words reads as a road; every label equals main on every corpus", () => {
    off();
    expect(ROAD_WORDS_BASE.source).toBe(MAIN.road.source);
    for (const t of ['tree on the 605 freeway', 'tree on elm st', 'tree in lanes', 'tree on the ramp', 'tree on main blvd', 'tree on pine rd']) {
      expect(isRoad(t), t).toBe(false);
      expect(treeLabel(t), t).toBe('act_now');
    }
    for (const r of ALL) for (const t of ['tree-service', 'roofing', 'restoration'] as const) expect(labelFor(spcRow(r), t), `${t}: ${r}`).toBe(mainLevel(r, t));
  });
  it('the card line is not shown: neither for a new-word remark nor for a remark main already reads as a road', () => {
    off();
    for (const remark of ['Tree down in lanes on the 605 freeway.', 'Tree down blocking entire road in association with convective band.', 'A large tree branch was blown down on Interstate 405 near Cherry Avenue.']) {
      const sig = spcRow(remark);
      const label = labelFor(sig, 'tree-service');
      expect(reasonCopyFor({ ...sig, label, trade: 'tree-service' })?.id, remark).toBe('spc-wind-damage');
      for (const lang of ['en', 'es'] as const) {
        const b = cardBriefLang({ ...sig, label, trade: 'tree-service' }, lang);
        expect(b.why, `${lang} ${remark}`).not.toBe(lang === 'en' ? EN : ES);
        expect(b.why).not.toMatch(/road crew|equipo vial/);
      }
    }
  });
  it('an LSR row labels as main does, and the stored road-tree phrase is ignored', () => {
    off();
    for (const r of REAL) {
      for (const t of TRADES) expect(RANK[labelFor(lsrRow(r), t)], `${t}: ${r}`).toBeGreaterThanOrEqual(RANK[labelFor(spcRow(r), t)]);
      expect(labelFor(lsrRow(r), 'tree-service'), r).toBe(mainLevel(r, 'tree-service'));
    }
  });
});

describe('switch on: the change only LOWERS tree service, and nothing else moves', () => {
  it('on label is never above main (the oracle) for tree service, roofing and restoration, SPC and LSR rows, on every corpus', () => {
    on();
    let checked = 0;
    for (const r of ALL) {
      for (const t of ['tree-service', 'roofing', 'restoration'] as const) {
        const m = mainLevel(r, t);
        const s = labelFor(spcRow(r), t);
        expect(RANK[s], `SPC ${t} main ${m} now ${s}: ${r}`).toBeGreaterThanOrEqual(RANK[m]);
        if (checked % 7 === 0) {
          const l = labelFor(lsrRow(r), t);
          expect(RANK[l], `LSR ${t} main ${m} now ${l}: ${r}`).toBeGreaterThanOrEqual(RANK[m]);
        }
        checked++;
      }
    }
    expect(checked).toBe(ALL.length * 3);
  });
  it('roofing, restoration, siding and gutters, insurance and public adjuster never move with the switch', () => {
    const others = TRADES.filter((t) => t !== 'tree-service');
    off();
    const before = ALL.map((r) => others.map((t) => labelFor(spcRow(r), t)));
    on();
    ALL.forEach((r, i) => others.forEach((t, j) => expect(labelFor(spcRow(r), t), `${t}: ${r}`).toBe(before[i][j])));
  });
  it("a roof, garage, porch or building next to a base road word is main's reading, never raised (the PR 25 rule is gone)", () => {
    on();
    expect(treeLabel('Trees down on Highway 9. Roof blown off a barn.')).toBe('market_insight');
    expect(treeLabel('Trees down on Highway 9. Garage damaged.')).toBe('coming_soon');
    const f = { trees: true, road: true, roof: false, structure: true, homeOrYard: false };
    expect(treeOnRoad(f)).toBe(true);
    expect(windDamageLevelOf(f, 'tree-service')).toBe('coming_soon');
  });
});

describe('switch on: a tree tied to a road by the new words is a heads-up', () => {
  const TIED: Array<[string, string]> = [
    ['Tree down in lanes on the 605 freeway near Valley Blvd.', 'freeway, lanes'],
    ['Large tree downed by winds on Sierra Madre Avenue in Azusa.', 'avenue after "downed by winds on"'],
    ['Large tree downed by gusty winds on Thousand Oaks Blvd near Caspian Ct.', 'Blvd'],
    ['Trees down on freeways', 'freeways'],
    ['Tree on the Ventura Fwy', 'fwy'],
    ['Large tree blocking entire freeway ramp on the 210.', 'freeway'],
    ['Tree blocking the ramp to the 10', 'ramp'],
    ['Tree in two lanes', 'in lanes'],
    ['Tree down in lanes of traffic', 'lanes of traffic'],
    ['Tree blocking slow lane of the 210', 'slow lane'],
    ['Tree in the left lane', 'left lane'],
    ['Tree blocking a lane', 'blocking a lane'],
    ['Tree on Sunset Boulevard', 'boulevard'],
    ['Tree down on Fairview St between Empire Ave and Thornton Ave.', 'St, between'],
    ['Tree on Elm St', 'St at the end'],
    ['Tree on Elm St.', 'St. at the end'],
    ['Tree blocking Elm St, Burbank', 'St before a comma'],
    ['Tree on 6th St near Angeleno Ave', 'a numbered St'],
    ['Tree on Main Street', 'street'],
    ['Tree blocking Harvard Rd.', 'Rd'],
    ['One tree blocking Dixon Grove Rd, south of Tennille.', 'Rd'],
    ['Tree on Reinhardt College Parkway', 'parkway'],
    ['Tree on Magic Mountain Pkwy', 'Pkwy'],
    ['Tree blocking the interchange', 'interchange'],
    ['Tree on the overpass', 'overpass'],
    ['Tree on US-41', 'US-n'],
    ['Tree on US 41', 'US n'],
    ['Tree on SR 400', 'SR n'],
    ['Tree on SR-400', 'SR-n'],
    ['Ventura Freeway blocked by downed trees', 'road blocked by trees'],
    ['Elm St closed by a fallen tree', 'road closed by a tree'],
  ];
  for (const [text, why] of TIED) {
    it(`"${text}" (${why}): tree service heads-up`, () => {
      on();
      expect(treeOnRoadWordsOf(text)).toBe(true);
      expect(treeLabel(text)).toBe('coming_soon');
      off();
      expect(treeLabel(text)).toBe('act_now');
    });
  }
  it("main's own road words keep main's reading, tied or not, switch on or off", () => {
    for (const set of [off, on]) {
      set();
      for (const t of ['tree on interstate 5', 'tree on highway 9', 'tree on hwy 9', 'tree on the on-ramp', 'tree on i-75', 'tree on main road', 'trees near the roadway', 'tree blocking the street']) expect(isRoad(t), t).toBe(true);
    }
  });
});

describe('switch on: a street that only describes where is NOT a tree on a road', () => {
  const AREA = [
    'Numerous reports of downed trees and branches across the center portion of the city of Los Angeles. The tree damage was reported in the area between Western Avenue and',
    'Dispatch reports relayed to media of large trees down in the Prattsville area and along US 270 between Poyen and Prattsville.',
    'Storm spotter reports wind damage near the intersection of Clint Moore Rd and Lyons Rd in Boca Raton. Downed tree branches and palm fronds observed. Traffic light at th',
    'Many trees down near the insection of Chandler Blvd and Keystone St in Burbank.',
    'Large tree down near Kenwood St and Oak St.',
    'Large tree downed by winds near Badillo St and Virgina Ave in Baldwin Park.',
    'Large tree down on 800 block of Fairview St in Burbank.',
    'Large tree downed on 4100 block of Kling St in Burbank.',
    'Two downed trees on the 5900 block of Golden West Avenue in Temple City.',
    'Tree fell on vehicle on north michigan ave.',
    'Tree and light pole down on 800 block of Niagara Street in Burbank.',
    'Large tree branch downed on power lines on the 4700 block of Baldwin Park Blvd.',
    'Tree down in 2 mi N of Main St area',
    'Trees down along Sunset Blvd and off Peachtree Pkwy',
    'Tree at 1200 Elm St',
    'Power outages along Roaring Fork Rd from fallen limbs/trees/utility lines.',
  ];
  for (const text of AREA) {
    it(`"${text.slice(0, 70)}": tree service stays act now`, () => {
      on();
      expect(treeOnRoadWordsOf(text)).toBe(false);
      expect(treeLabel(text)).toBe('act_now');
    });
  }
  it('the three live rows the review found (ids 71782, 194268, 139832) do not move', () => {
    on();
    for (const frag of ['center portion of the city of Los Angeles', 'Prattsville area and along US 270', 'Clint Moore Rd and Lyons Rd']) {
      const remark = LIVE.find((r) => r.includes(frag));
      expect(remark, frag).toBeTruthy();
      expect(treeLabel(remark as string), frag).toBe(mainLevel(remark as string, 'tree-service'));
    }
  });
  it('no live or real remark is lowered unless it ties a tree to a road word and names no home or yard', () => {
    on();
    for (const r of [...REAL, ...LIVE]) {
      if (treeLabel(r) !== mainLevel(r, 'tree-service')) {
        expect(treeOnRoadWordsOf(r), r).toBe(true);
        expect(windDamageFactsOf(r).homeOrYard, r).toBe(false);
      }
    }
  });
  it('real Los Angeles remarks: tree service act now 63 and heads-up 61 becomes 37 and 87 (28 of 143 move, all downward)', () => {
    off();
    const before = REAL.map((r) => treeLabel(r));
    expect(before.slice(0, 124).filter((l) => l === 'act_now')).toHaveLength(63);
    on();
    const after = REAL.map((r) => treeLabel(r));
    expect(after.slice(0, 124).filter((l) => l === 'act_now')).toHaveLength(37);
    expect(after.slice(0, 124).filter((l) => l === 'coming_soon')).toHaveLength(87);
    expect(REAL.filter((_, i) => before[i] !== after[i])).toHaveLength(28);
    REAL.forEach((_, i) => {
      if (before[i] !== after[i]) expect([before[i], after[i]]).toEqual(['act_now', 'coming_soon']);
    });
  });
});

describe('switch on: private property, names and places are not roads', () => {
  it('a tree on a home, house, residence or yard stays act now, whatever street it names', () => {
    on();
    for (const h of HOUSE) for (const l of LOC) expect(treeLabel(`${h} ${l}.`), `${h} ${l}`).toBe('act_now');
    expect(treeLabel('tree fallen on house and blocking street. time estimated.')).toBe('act_now');
  });
  it('apartment complex, duplex, trailer, condo, townhome, church, business, school, shed, barn, cabin, the property: stay act now at any address', () => {
    on();
    for (const h of OTHER) for (const l of LOC) expect(treeLabel(`${h} ${l}.`), `${h} ${l}`).toBe(mainLevel(`${h} ${l}.`, 'tree-service')); // main's own base road words (I-10, Hwy, Road) still lower, as before
    expect(treeLabel('Tree fell on an apartment complex at 1200 Elm St.')).toBe('act_now');
    expect(treeLabel('Tree fell on a duplex on Elm St.')).toBe('act_now');
    expect(treeLabel('Tree blocking Elm St and fell on a trailer')).toBe('act_now');
  });
  it('names and places that contain a road word are not roads (Ramp Creek, a boat ramp, Ave Maria, Hampton Roads, Sunset Lanes, Port St Lucie, Dr. King ...)', () => {
    on();
    for (const n of NAMES) {
      expect(treeOnRoadWordsOf(n), n).toBe(false);
      expect(treeLabel(n), n).toBe(mainLevel(n, 'tree-service'));
    }
  });
  it('"Dr", "Drive", "lane" alone and "way" are not on the list', () => {
    on();
    for (const t of ['Large tree downed on 1100 block of Orchard Dr in Burbank.', 'Tree blocking Oak Dr.', 'Tree blocking Riverside Drive', 'Tree on Pine Lane', 'Tree blocking Penny Lane Farm', 'Tree on Mulberry Way']) {
      expect(treeOnRoadWordsOf(t), t).toBe(false);
      expect(treeLabel(t), t).toBe('act_now');
    }
  });
  // Mutant killers for the two guards of "St": each case below is blocked by ONE guard only.
  it('"St" is a street suffix only: the follow guard alone blocks "Port St Lucie", "East St Louis", "Mount St Helens", "West St Paul"', () => {
    on();
    for (const t of ['Tree blocking port st lucie', 'Tree on east st louis', 'Tree on Mount St Helens', 'Tree blocking west st paul']) expect(treeOnRoadWordsOf(t), t).toBe(false);
    for (const t of ['Tree blocking port st, near the tracks', 'Tree on east st and', 'Tree on west st']) expect(treeOnRoadWordsOf(t), t).toBe(true);
  });
  it('"St" is a street suffix only: the name guard alone blocks "St" right after a joining word or at the start', () => {
    on();
    for (const t of ['Tree blocking st, near the tracks', 'Tree on st. near the tracks', 'Tree on 2 miles north of st, and', 'Tree on st and']) expect(treeOnRoadWordsOf(t), t).toBe(false);
  });
});

describe('LSR rows: neutral stored facts, decided at read time', () => {
  it("a tree on a street or freeway by a new word stores one fixed phrase, whatever the switch says; main's road phrase is unchanged", () => {
    for (const set of [off, on]) {
      set();
      expect(lsrRow('Tree down in lanes on the 605 freeway near Valley Blvd.').summary).toBe('The report names trees or limbs down | It names a street or freeway');
      expect(lsrRow('Tree down blocking Harvard Rd.').summary).toBe('The report names trees or limbs down | It names a street or freeway');
      expect(lsrRow('Tree down on Highway 101.').summary).toBe('The report names trees or limbs down | It names a road');
      expect(lsrRow('Tree down on Highway 101 and blocking lanes.').summary).toBe('The report names trees or limbs down | It names a road');
      expect(lsrRow('Large tree down near Kenwood St and Oak St.').summary).toBe('The report names trees or limbs down');
    }
    expect(LSR_PARTS).toContain(LSR_ROAD_TREE_PART);
    expect(ROAD_WORDS_BASE.test(ROAD_TREE_PHRASE)).toBe(false);
    expect(ROAD_WORDS_BASE.test(LSR_ROAD_TREE_PART.toLowerCase())).toBe(false);
    expect(localizeSummary(LSR_ROAD_TREE_PART, 'es', 'lsr')).toBe('Menciona una calle o autopista');
  });
  it('is read at read time: ingest on then read off is main, ingest off then read on equals SPC (no tail either way)', () => {
    for (const r of REAL) {
      on();
      const ingestedOn = lsrRow(r);
      off();
      const ingestedOff = lsrRow(r);
      expect(ingestedOn.summary).toBe(ingestedOff.summary);
      expect(labelFor(ingestedOn, 'tree-service'), `off after on: ${r}`).toBe(mainLevel(r, 'tree-service'));
      on();
      expect(labelFor(ingestedOff, 'tree-service'), `on after off: ${r}`).toBe(labelFor(spcRow(r), 'tree-service'));
    }
  });
  it('an LSR row for a tree on a road is a heads-up with the switch on and the card line says so; off, neither', () => {
    on();
    const row = lsrRow('Tree down in lanes on the 605 freeway near Valley Blvd.');
    expect(labelFor(row, 'tree-service')).toBe('coming_soon');
    expect(cardBriefLang({ ...row, label: 'coming_soon', trade: 'tree-service' }, 'en').why).toBe(EN);
    off();
    expect(labelFor(row, 'tree-service')).toBe('act_now');
    expect(cardBriefLang({ ...row, label: 'act_now', trade: 'tree-service' }, 'en').why).not.toBe(EN);
  });
  for (const set of [off, on]) {
    it(`an LSR row is never above the SPC row with the same remark, every trade, on every corpus (${set === on ? 'on' : 'off'})`, () => {
      set();
      for (const r of [...REAL, ...LIVE, ...BUILT, ...SWEEP.filter((_, i) => i % 5 === 0)]) {
        for (const t of TRADES) {
          const l = labelFor(lsrRow(r), t);
          const s = labelFor(spcRow(r), t);
          if (RANK[l] < RANK[s]) throw new Error(`${t}: lsr ${l} above spc ${s}: ${r}`);
        }
      }
    });
  }
  it('property: over every 1 to 3 token remark of a vocabulary of new and old road words, LSR is never above SPC, both states', () => {
    const TOKENS = [
      'TREE', 'LIMB', 'BRANCH', 'UPROOTED', 'SNAPPED', 'ROAD', 'HIGHWAY', 'I-75', 'ON RAMP', 'ON THE FREEWAY', 'BLOCKING LANES', 'IN LANES', 'ELM ST', 'ST LOUIS', 'ON PINE RD', 'BLOCKING MAIN STREET', 'ON HILL AVE',
      'BLVD', 'ON THE PKWY', 'OVERPASS', 'US-41', 'SR 400', 'NEAR', 'BETWEEN', 'ROOF', 'SIDING', 'SHINGLES', 'HOME', 'HOUSE', 'YARD', 'GARAGE', 'BUILDING', 'APARTMENT', 'POWER POLES', 'WIRES', 'FENCE',
    ];
    for (const set of [off, on]) {
      set();
      let checked = 0;
      const check = (remark: string) => {
        const back = lsrSummaryOf(lsrFactsOf(remark));
        for (const t of ['tree-service', 'roofing', 'restoration'] as const) {
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
          for (const c of TOKENS) check(`${a} ${b} ${c}`);
        }
      }
      expect(checked).toBe(TOKENS.length + TOKENS.length ** 2 + TOKENS.length ** 3);
    }
  });
  it('the road fact read back from the stored phrases equals the SPC road fact, and all 32 fact combinations round-trip (both states)', () => {
    for (const set of [off, on]) {
      set();
      for (const a of VOC) for (const b of VOC) {
        const remark = `${a} ${b}`;
        expect(windDamageFactsOf(lsrSummaryOf(lsrFactsOf(remark))).road, remark).toBe(windDamageFactsOf(remark).road);
      }
      for (let mask = 0; mask < 32; mask++) {
        const want = { trees: !!(mask & 1), road: !!(mask & 2), roof: !!(mask & 4), structure: !!(mask & 8), homeOrYard: !!(mask & 16) };
        const words: string[] = [];
        if (want.trees) words.push('TREE DOWN');
        if (want.road) words.push('ON A ROAD');
        if (want.roof && want.structure) words.push('ROOF OFF');
        else if (want.roof) words.push('SHINGLES OFF');
        if (want.structure && want.homeOrYard) words.push('AT A HOME');
        else if (want.homeOrYard) words.push('IN A YARD');
        else if (want.structure && !want.roof) words.push('GARAGE HIT');
        const remark = words.join(', ') || 'FENCE DOWN';
        expect(windDamageFactsOf(remark), remark).toEqual(want);
        expect(windDamageFactsOf(lsrSummaryOf(lsrFactsOf(remark))), remark).toEqual(want);
      }
    }
  });
  it('no stored phrase except the two road phrases reads as a road, alone or combined', () => {
    on();
    const others = LSR_PARTS.filter((p) => p !== 'It names a road' && p !== LSR_ROAD_TREE_PART);
    for (let mask = 0; mask < 1 << others.length; mask++) expect(isRoad(others.filter((_, i) => mask & (1 << i)).join(' | ')), String(mask)).toBe(false);
  });
});

describe('the card line for a tree on a road (EN and ES)', () => {
  it('says plainly that the report names a road, for an SPC row, an LSR row and a base-word row, switch on', () => {
    on();
    for (const sig of [spcRow('Tree down in lanes on the 605 freeway.'), lsrRow('Tree down in lanes on the 605 freeway.'), spcRow('Tree down blocking entire road in association with convective band.')]) {
      const label = labelFor(sig, 'tree-service');
      expect(label).toBe('coming_soon');
      const en_ = cardBriefLang({ ...sig, label, trade: 'tree-service' }, 'en');
      const es_ = cardBriefLang({ ...sig, label, trade: 'tree-service' }, 'es');
      expect(en_.why).toBe(EN);
      expect(es_.why).toBe(ES);
      expect(en_.next).toBe('Watch for reports of trees on homes or yards nearby.');
      expect(es_.next).toBe('Esté atento a reportes de árboles sobre viviendas o patios cercanos.');
      for (const s of [en_.why, en_.next, es_.why, es_.next]) expect(s).not.toMatch(/—|–|\blead|guarantee|garantiz|knock|canvass|you will win/i);
    }
  });
  it('a tree on a road with a roof named (feed only) says it too; a tree on a home, another trade, no tree, or a street that only describes an area does not', () => {
    on();
    const roof = spcRow('Tree down blocking Oak St, shingles blown off.');
    expect(labelFor(roof, 'tree-service')).toBe('market_insight');
    expect(cardBriefLang({ ...roof, label: 'market_insight', trade: 'tree-service' }, 'en').why).toBe(EN);
    const home = spcRow('Tree fell on a house on Oak St.');
    expect(cardBriefLang({ ...home, label: 'act_now', trade: 'tree-service' }, 'en').why).not.toBe(EN);
    const road = spcRow('Tree down in lanes on the 605 freeway.');
    for (const trade of ['roofing', 'restoration'] as const) expect(reasonCopyFor({ ...road, label: labelFor(road, trade), trade })?.id).not.toBe('spc-wind-damage-road');
    const noTree = spcRow('Sign down on the 605 freeway.');
    expect(reasonCopyFor({ ...noTree, label: labelFor(noTree, 'tree-service'), trade: 'tree-service' })?.id).not.toBe('spc-wind-damage-road');
    const area = spcRow('Large tree down near Kenwood St and Oak St.');
    expect(cardBriefLang({ ...area, label: 'act_now', trade: 'tree-service' }, 'en').why).not.toBe(EN);
  });
  it('the feed card (BriefBlock, a client component) shows the line in EN and ES from the one switch value server and browser share', () => {
    // next.config.ts inlines the switch, so the browser bundle and the server bundle hold the same value; here that one value is the stubbed variable.
    const item = { ...spcRow('Tree down in lanes on the 605 freeway.'), occurredAt: '2025-01-08T10:00:00Z', label: 'coming_soon' as const, trade: 'tree-service' };
    on();
    const html = (lang: 'en' | 'es') => renderToStaticMarkup(createElement(BriefBlock, { item, lang }));
    const serverEn = html('en');
    expect(html('en')).toBe(serverEn);
    expect(serverEn).toContain(EN);
    expect(html('es')).toContain(ES);
    off();
    expect(html('en')).not.toContain(EN);
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
    expect(typeof en['sum.lsr_road_tree']).toBe('string');
    expect(typeof es['sum.lsr_road_tree']).toBe('string');
  });
});
