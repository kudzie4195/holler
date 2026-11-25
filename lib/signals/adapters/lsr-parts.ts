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
 *    nothing. So for a remark whose words are real words, the LSR row gets the label the SPC row with the same remark gets. Where the SPC
 *    rule matches inside a longer word (warehouse, courthouse, climbing, lumberyard) or reads "snapped" on power poles as trees, the LSR row
 *    reads less, never more.
 */
export const LSR_TREE_PART = 'The report names trees or limbs down';
export const LSR_POWER_PART = 'It names power lines or poles';
export const LSR_ROAD_PART = 'It names a road';
export const LSR_ROOF_PART = 'It names a roof or siding';
export const LSR_GUTTER_PART = 'It names shingles or gutters';
export const LSR_HOME_PART = 'It names a home';
export const LSR_YARD_PART = 'It names a yard';
export const LSR_BUILDING_PART = 'It names a building';
export const LSR_DAMAGE_PART = 'The report names wind damage, not confirmed';

export const LSR_PARTS: readonly string[] = [LSR_TREE_PART, LSR_POWER_PART, LSR_ROAD_PART, LSR_ROOF_PART, LSR_GUTTER_PART, LSR_HOME_PART, LSR_YARD_PART, LSR_BUILDING_PART, LSR_DAMAGE_PART];

/** What a remark names, word by word (read in memory; the remark is never stored). */
export interface LsrFacts {
  trees: boolean;
  powerLines: boolean;
  road: boolean;
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

const POWER_RE = /\bpower\b|\b(?:power|utility|electric) ?(?:lines?|poles?)\b|\bpoles?\b|\blines? down\b|\btransformers?\b/;

export function lsrFactsOf(remark: string | null | undefined): LsrFacts {
  const c = (remark ?? '').toLowerCase();
  const powerLines = POWER_RE.test(c);
  const treeWords = /\btrees?\b|\blimbs?\b|\bbranches\b|\bbranch (?:down|fell|broke|broken|snapped|on|onto|across|blocking)\b/.test(c);
  // "snapped", "uprooted" and "felled" are trees only when no power line or pole is named (review 2: "POWER POLES SNAPPED").
  const treeVerbs = /\bsnapped\b|\buproot(?:ed|ing|s)?\b|\bfelled\b/.test(c) && !powerLines;
  return {
    trees: treeWords || treeVerbs,
    powerLines,
    road: /\binterstate\b|\bhighway\b|\bhwy\b|\bon.?ramp\b|\boff.?ramp\b|\bi-\d|\broad(?:way)?s?\b|blocking (?:the )?(?:street|lane)/.test(c),
    roofOrSiding: /\broofs?\b|\broofing\b|\brooftops?\b|\bsiding\b/.test(c),
    shinglesOrGutters: /\bshingles?\b|\bgutters?\b/.test(c),
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
  if (f.roofOrSiding) parts.push(LSR_ROOF_PART);
  if (f.shinglesOrGutters) parts.push(LSR_GUTTER_PART);
  if (f.home) parts.push(LSR_HOME_PART);
  if (f.yard) parts.push(LSR_YARD_PART);
  if (f.building) parts.push(LSR_BUILDING_PART);
  return parts.length ? parts.join(' | ') : LSR_DAMAGE_PART;
}
