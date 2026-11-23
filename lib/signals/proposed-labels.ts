import type { CategoryId } from './categories';
import type { OpportunityLabel } from './lead-rules';
import type { RecordType } from './trade-needs';

/**
 * Round 20: the labels NEW probation sources are meant to get, written by the units that add them, so the scorecard can PROJECT coverage
 * before the sources are probed (npm run score:trades -- --with-proposed). Nothing here reaches a member: the engine
 * (lib/signals/lead-rules.ts SOURCE_DEFAULTS and RULES) never reads this file, and a probation source never makes a card
 * (lib/signals/probation.ts). When a source leaves probation its label goes into lead-rules.ts by review, and its entry here is removed.
 *
 * How to add a source (one entry per source id):
 *   'socrata-xyz-sales': {
 *     metros: ['houston'],
 *     recordKind: 'property-sale',
 *     expectedRowsPerWeekPerMetro: 120,
 *     volumeEvidence: { tag: 'O', note: 'portal row count: 6,240 rows in 2025, read 2026-11-22 from <portal page>' },
 *     labels: { moving: 'coming_soon', cleaning: { label: 'coming_soon', share: 0.4, why: 'residential sales only' } },
 *     callPath: true,
 *   },
 *
 * Projection arithmetic (lib/signals/trade-coverage.ts projectGrid): for each metro listed and each trade whose label is act_now or
 * coming_soon, the cell gains expectedRowsPerWeekPerMetro x share actionable cards a week (share defaults to 1), and the same amount with
 * a call path when callPath is true. Every expected row is assumed to fall within 25 miles of the metro centre, which overstates a
 * county-wide feed: set share below 1 to say otherwise. The projected grid is printed apart from the measured one and marked PROJECTED.
 */

/** The 10 metro ids of lib/geo/metros.ts METROS (tests/signals/trade-coverage.test.ts keeps them equal). */
export type MetroId =
  | 'new-york'
  | 'los-angeles'
  | 'chicago'
  | 'dallas-fort-worth'
  | 'houston'
  | 'atlanta'
  | 'washington-dc'
  | 'philadelphia'
  | 'miami'
  | 'phoenix';

/** Research tag of the stated volume: O opened (the portal's own count was read), 3P third party, A assumed. */
export type VolumeEvidenceTag = 'O' | '3P' | 'A';

export interface ProposedTradeLabelDetail {
  label: OpportunityLabel;
  /** Share of the source's rows that reach this trade at this label, 0 to 1. Default 1. */
  share?: number;
  why?: string;
}

/** A label alone means every row of the source gets it for the trade (share 1). */
export type ProposedTradeLabel = OpportunityLabel | ProposedTradeLabelDetail;

export interface ProposedSource {
  /** The metros (lib/geo/metros.ts ids) the source covers. */
  metros: readonly MetroId[];
  /** The kind of record (lib/signals/trade-needs.ts). */
  recordKind: RecordType;
  /** Rows a week the source is expected to add per listed metro, from the portal's own stated volume. */
  expectedRowsPerWeekPerMetro: number;
  /** Where that volume comes from. */
  volumeEvidence: { tag: VolumeEvidenceTag; note: string };
  /** The proposed label per trade. A trade not listed gets nothing (context). */
  labels: Partial<Record<CategoryId, ProposedTradeLabel>>;
  /** Each row carries a street address or a business a member can call. */
  callPath: boolean;
}

/** Source id -> proposed labels. Empty until this round's source units fill it. */
export const PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = {
  // ==== Round 20 VIOL (lib/signals/adapters/viol-datasets.ts; research /home/claude/gates/r20/VIOL-research.md) ======================
  // Labels follow the reviewed rules (lead-rules.ts RULES): a violation order that names a repair is act_now for the trade it names
  // (act-violation-named); a handyman named next to a specialist is coming_soon (owner call 12); an order that names no repair is
  // coming_soon for its tagged trades and market_insight for the general contractor (violation-unnamed); 311 city work is context.
  // tests/signals/viol-r20.test.ts parses a hand-written row per trade through the real parser and checks labelFor() gives these labels.
  // Every `share` is the ASSUMED part of the source's rows that names that trade (no live row was read); the volume tags say how sure the
  // row count is. callPath: violations carry a block-level street address ("2300 block of W 52 STREET"), which the live gate counts as a
  // place; HPD streets numbered 100 and up lose their address under the block-address rule (see the why on each HPD trade).
  'socrata-nyc-hpd-violations': {
    metros: ['new-york'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 7000,
    volumeEvidence: { tag: 'A', note: 'HPD class B and C violations, open, by NOV issue date: about 10,000 a week issued citywide, about 70% B or C (estimate; dataset wvxf-dwi5 holds 11.4M rows [3P], updated daily [O]). Not measured.' },
    labels: {
      painting: { label: 'act_now', share: 0.2, why: 'paint and plaster orders, the most common HPD order (assumed share); about a third of rows lose the address on 100+ streets' },
      plumbing: { label: 'act_now', share: 0.12, why: 'leaks, water supply, fixtures (assumed share)' },
      'windows-doors': { label: 'act_now', share: 0.12, why: 'self-closing doors, window guards, broken windows (assumed share)' },
      electrical: { label: 'act_now', share: 0.08, why: 'outlets, fixtures, wiring (assumed share)' },
      'pest-control': { label: 'act_now', share: 0.08, why: 'mice, roaches, bed bugs (assumed share)' },
      hvac: { label: 'act_now', share: 0.02, why: 'heat orders (assumed share)' },
      handyman: { label: 'coming_soon', share: 0.12, why: 'named next to windows and doors (owner call 12), or unnamed structure orders' },
      restoration: { label: 'coming_soon', share: 0.04, why: 'mold: the title words do not name a repair, so violation-unnamed applies' },
      flooring: { label: 'coming_soon', share: 0.03, why: 'floor orders: unnamed in the title words, so a heads-up' },
      'general-contractor': { label: 'market_insight', share: 0.05, why: 'unnamed structure orders: feed only' },
    },
    callPath: true,
  },
  'socrata-nyc-rodent-violations': {
    metros: ['new-york'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 600,
    volumeEvidence: { tag: 'A', note: 'DOHMH rodent inspections whose result names rats (dataset p937-wjvj, last modified 2026-11-17 [O]); count not measured.' },
    labels: { 'pest-control': { label: 'act_now', share: 1, why: 'active rat signs found at a named property: the owner is ordered to abate' } },
    callPath: true,
  },
  'socrata-montgomery-violations': {
    metros: ['washington-dc'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 300,
    volumeEvidence: { tag: 'A', note: 'Montgomery County MD housing code violations (k9nj-z35d, weekly, last modified 2026-11-15 [O]); count not measured; about half the county lies within 25 miles of the DC centre.' },
    labels: {
      'windows-doors': { label: 'act_now', share: 0.1, why: 'item Windows / condition Windows/doors (assumed share)' },
      plumbing: { label: 'act_now', share: 0.08, why: 'item Water Heater (assumed share)' },
      handyman: { label: 'coming_soon', share: 0.15, why: 'named next to windows and doors, or unnamed structure items' },
      restoration: { label: 'coming_soon', share: 0.04, why: 'condition Water/Mold-Light under an item that names no repair' },
      'general-contractor': { label: 'market_insight', share: 0.05, why: 'Accessory Structure and other unnamed structure items: feed only' },
    },
    callPath: true,
  },
  'arcgis-phoenix-violations': {
    metros: ['phoenix'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 500,
    volumeEvidence: { tag: 'A', note: 'Phoenix NSD property-maintenance complaints; neither the field list nor a count could be read. Estimate only.' },
    // Complaint-level records (a case opened on a complaint, not yet a confirmed order): proposed as a HEADS-UP for the trades the case type
    // names, like the Kansas City property-violation 311 rule (lead-rules.ts property-violation-311, line 9). At promotion it needs that cap.
    labels: {
      'lawn-care': { label: 'coming_soon', share: 0.3, why: 'grass and weeds cases (assumed share)' },
      landscaping: { label: 'coming_soon', share: 0.3, why: 'grass and weeds cases (assumed share)' },
      'junk-removal': { label: 'coming_soon', share: 0.3, why: 'trash, debris, junk cases (assumed share)' },
      handyman: { label: 'coming_soon', share: 0.1, why: 'structure, boarded or open-to-entry cases (assumed share)' },
      'general-contractor': { label: 'market_insight', share: 0.1, why: 'unnamed structure cases: feed only' },
      fencing: { label: 'coming_soon', share: 0.03, why: 'fence cases (assumed share)' },
      'pool-spa': { label: 'coming_soon', share: 0.03, why: 'green or stagnant pools (assumed share)' },
    },
    callPath: true,
  },
  'arcgis-dc-311': {
    metros: ['washington-dc'],
    recordKind: '311-request',
    expectedRowsPerWeekPerMetro: 1500,
    volumeEvidence: { tag: 'A', note: 'DC 311 requests whose type names rodents, trees, graffiti, dumping, bulk items, heat, sewer or mold; request types not read.' },
    // Rodent baiting, bulk pickup, dumping and graffiti requests are city work: context (311 default, line 10). No trade is projected.
    labels: {},
    callPath: false,
  },
  // ==== Round 19 code-violation feeds already on probation (NOT added by VIOL; listed so the scorecard can project them) ===============
  // Their SOURCE_DEFAULTS label is already act_now (carto-phl-violations) or proposed act_now in lib/signals/probation.ts (Miami-Dade).
  'carto-phl-violations': {
    metros: ['philadelphia'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 1000,
    volumeEvidence: { tag: 'A', note: 'Philadelphia L&I open violations by case date (Carto table violations); count not measured.' },
    labels: {
      'lawn-care': { label: 'act_now', share: 0.1, why: 'EXTERIOR AREA WEEDS and similar code titles (assumed share)' },
      landscaping: { label: 'act_now', share: 0.1, why: 'weeds titles (assumed share)' },
      'junk-removal': { label: 'act_now', share: 0.1, why: 'rubbish and debris titles (assumed share)' },
      plumbing: { label: 'act_now', share: 0.05, why: 'ALTER EXISTING PLUMBING and similar (assumed share)' },
      handyman: { label: 'coming_soon', share: 0.15, why: 'vacant structure, exterior walls (assumed share)' },
      'general-contractor': { label: 'act_now', share: 0.1, why: 'exterior wall, porch, structure titles (assumed share)' },
      security: { label: 'act_now', share: 0.05, why: 'VACANT STRUCTURE & LAND: secure the building (assumed share)' },
    },
    callPath: true,
  },
  'arcgis-miamidade-violations': {
    metros: ['miami'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 300,
    volumeEvidence: { tag: 'A', note: 'Miami-Dade open code compliance cases, unincorporated county only; count not measured.' },
    labels: {
      'lawn-care': { label: 'act_now', share: 0.3, why: 'overgrown lot problem descriptions (assumed share)' },
      landscaping: { label: 'act_now', share: 0.3, why: 'overgrown lot (assumed share)' },
      'junk-removal': { label: 'act_now', share: 0.25, why: 'trash and debris, junk (assumed share)' },
    },
    callPath: true,
  },
  'arcgis-miamidade-building-violations': {
    metros: ['miami'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 100,
    volumeEvidence: { tag: 'A', note: 'Miami-Dade building violation cases (case type only); count not measured.' },
    labels: {
      roofing: { label: 'act_now', share: 0.1, why: 'roof case types (assumed share)' },
      'general-contractor': { label: 'coming_soon', share: 0.3, why: 'unsafe structure or work without permit case types (assumed share)' },
    },
    callPath: true,
  },
};

/** The label and share of one trade's entry. */
export function proposedLabelOf(entry: ProposedTradeLabel | undefined): { label: OpportunityLabel; share: number } | null {
  if (entry === undefined) return null;
  if (typeof entry === 'string') return { label: entry, share: 1 };
  const share = typeof entry.share === 'number' && Number.isFinite(entry.share) ? Math.min(1, Math.max(0, entry.share)) : 1;
  return { label: entry.label, share };
}
