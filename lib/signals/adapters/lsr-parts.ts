import { treeOnRoadWordsOf, WIND_DAMAGE_PATTERNS } from '../carry';

/**
 * Round 33: the fixed summary parts the LSR adapter (adapters/lsr.ts) writes in place of the report's remark, which is never stored.
 * Kept in their own client-safe module so lib/signals/summary-i18n.ts can translate them without importing the adapter.
 *
 * Two jobs, both tested in tests/signals/weather-hazard.test.ts:
 *  - Copy (review 2, P2-3): every phrase says only what the remark says, read with WORD-BOUNDED patterns (lsrFactsOf). "POWER POLES
 *    SNAPPED" is power lines, not trees; a warehouse or a courthouse is not a home; a lumberyard is not a yard; "Flowery Branch" is a place.
 *  - Labels (review 2, P2-2): the wind damage rule (carry.ts windDamageFactsOf, line 39) reads its five facts back from these phrases, and
 *    each phrase carries exactly the facts its word carries in that rule: "a roof or siding" gives roof and structure, "shingles or gutters"
 *    gives roof only, "a home" structure and home-or-yard, "a yard" home-or-yard only, "a building" structure only, "power lines or poles"
 *    nothing.
 *  - Never more than SPC (review 3 R3-1): the rule is not monotone. Reading FEWER tree, home, yard or building words can only lower a
 *    label, but reading fewer ROAD or ROOF words can raise tree service (a road removes the tree act-now; a roof turns tree service to feed
 *    only). So road, roof-or-siding and shingles-or-gutters come from carry.ts WIND_DAMAGE_PATTERNS itself (shared, not copied), and only
 *    trees, home, yard and building use the stricter word-bounded patterns. A sweep test checks the LSR label is never above the SPC label.
 */
export const LSR_TREE_PART = 'The report names trees or limbs down';
export const LSR_POWER_PART = 'It names power lines or poles';
export const LSR_ROAD_PART = 'It names a road';
// Round 34: a tree tied to a street or freeway by the new road words (carry.ts treeOnRoadWordsOf). A neutral fact, stored whatever the switch says;
// the label code reads it only while HOLLER_ROAD_WORDS_ENABLED is on, so the switch works at once in both directions. No word of main's road pattern.
export const LSR_ROAD_TREE_PART = 'It names a street or freeway';
export const LSR_ROOF_PART = 'It names a roof or siding';
export const LSR_GUTTER_PART = 'It names shingles or gutters';
export const LSR_HOME_PART = 'It names a home';
export const LSR_YARD_PART = 'It names a yard';
export const LSR_BUILDING_PART = 'It names a building';
export const LSR_DAMAGE_PART = 'The report names wind damage, not confirmed';

export const LSR_PARTS: readonly string[] = [LSR_TREE_PART, LSR_POWER_PART, LSR_ROAD_PART, LSR_ROAD_TREE_PART, LSR_ROOF_PART, LSR_GUTTER_PART, LSR_HOME_PART, LSR_YARD_PART, LSR_BUILDING_PART, LSR_DAMAGE_PART];

/** What a remark names, word by word (read in memory; the remark is never stored). */
export interface LsrFacts {
  trees: boolean;
  powerLines: boolean;
  road: boolean;
  /** Round 34: a tree tied to a street or freeway by a road word main does not read (switch independent; used only while the switch is on). */
  roadTree: boolean;
  /** "roof" or "siding" (the rule reads both as a roof and a structure). */
  roofOrSiding: boolean;
  /** "shingles" or "gutters" (the rule reads both as a roof, not a structure). */
  shinglesOrGutters: boolean;
  /** home, house, residence, residential. */
  home: boolean;
  yard: boolean;
  /** garage, carport, porch, structure, building. */
  building: boolean;
}

// Review 3 R3-3: power lines or poles only when the words say so ("POWER OUTAGE", "FLAG POLE", "TREE LINE DOWN" are not).
const POWER_RE = /\bpower (?:lines?|poles?)\b|\butility (?:lines?|poles?)\b|\belectric(?:al)? (?:lines?|poles?)\b/;
const LINES_DOWN_WITH_POWER = (c: string) => /\blines? (?:are |were )?down\b/.test(c) && /\bpower\b|\butility\b|\belectric/.test(c);

export function lsrFactsOf(remark: string | null | undefined): LsrFacts {
  const c = (remark ?? '').toLowerCase();
  const powerLines = POWER_RE.test(c) || LINES_DOWN_WITH_POWER(c);
  const treeWords = /\btrees?\b|\blimbs?\b|\bbranches\b|\bbranch (?:down|fell|broke|broken|snapped|on|onto|across|blocking)\b/.test(c);
  // "snapped", "uprooted" and "felled" are trees only when no power line or pole is named (review 2: "POWER POLES SNAPPED").
  const treeVerbs = /\bsnapped\b|\buproot(?:ed|ing|s)?\b|\bfelled\b/.test(c) && !powerLines;
  return {
    trees: treeWords || treeVerbs,
    powerLines,
    // Shared with the line 39 rule (never fewer road or roof words than SPC reads). Main's road words only; the new ones are `roadTree`.
    road: WIND_DAMAGE_PATTERNS.road.test(c),
    roadTree: treeOnRoadWordsOf(c),
    roofOrSiding: WIND_DAMAGE_PATTERNS.roofOrSiding.test(c),
    shinglesOrGutters: WIND_DAMAGE_PATTERNS.shinglesOrGutters.test(c),
    home: /\bhomes?\b|\bhouses?\b|\bresidences?\b|\bresidential\b/.test(c),
    yard: /\b(?:back|front)?yards?\b/.test(c),
    building: /\bgarages?\b|\bcarports?\b|\bporch(?:es)?\b|\bstructures?\b|\bbuildings?\b/.test(c),
  };
}

/** The summary for a non-thunderstorm wind damage report, from what its remark named. */
export function lsrSummaryOf(f: LsrFacts): string {
  const parts: string[] = [];
  if (f.trees) parts.push(LSR_TREE_PART);
  if (f.powerLines) parts.push(LSR_POWER_PART);
  if (f.road) parts.push(LSR_ROAD_PART);
  else if (f.roadTree) parts.push(LSR_ROAD_TREE_PART);
  if (f.roofOrSiding) parts.push(LSR_ROOF_PART);
  if (f.shinglesOrGutters) parts.push(LSR_GUTTER_PART);
  if (f.home) parts.push(LSR_HOME_PART);
  if (f.yard) parts.push(LSR_YARD_PART);
  if (f.building) parts.push(LSR_BUILDING_PART);
  return parts.length ? parts.join(' | ') : LSR_DAMAGE_PART;
}
