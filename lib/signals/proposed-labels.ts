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

// ---- Round 20 NEXT ----------------------------------------------------------------------------------------------------------------
// Shares are MEASURED proxies where a live source of the same record type exists: /home/claude/gates/r20/logs/NEXT-shares.log (script
// /home/claude/gates/r20/next-scripts/shares.ts): the live engine's actionable cards a week divided by that type's rows a week within 25 miles,
// in the sourced metros. New business licences (median of NYC, LA, Chicago): commercial cleaning, security and signs 0.246 each; pest control
// 0.218 (Chicago, the only feed whose licence text names food premises). Permits (median of NYC, LA, CHI, ATL, DC): landscaping 0.012,
// lawn care 0.003, cleaning 0.003, painting 0.003, moving 0.005, real estate 0.005, commercial cleaning 0.001, security 0.001, fencing 0.005,
// siding and gutters 0.024, signs 0.001. Each is then multiplied by the share of rows that can print an address:
//   NAME_PASS 0.68: a new business prints its premises only when its name passes the licence name rule. Review fix P1-4: the earlier 0.8 was
//                  not a measurement. 0.68 is 34 of the reviewer's 50 hand-written storefront LLC names with the round 20 second try
//                  (lib/contacts/trade-name.ts; /home/claude/gates/r20/logs/NEXT2-names.log; 32% to 38% without it). Hand-written, not live: [A].
//   HOME_PASS (Chicago) 0.816: 155 of the 190 live Chicago rows can print an address once the home-based and home-prone activities print none
//                  (review fix P0-1; /home/claude/gates/r20/logs/NEXT2-chicago-home.log) [O for the activity text, the names are stand-ins].
//   PREMISES_CLASS (Texas) 0.5: share of kept storefront outlets in a class that may print its address (restaurants, bars, grocery, gas, car
//                  dealers; review fix P2-2) [A].
//   ADDRESS_PASS 0.9: a permit or CO address passes lib/contacts cleanAddress [A]; New York 0.6 [A] (block level since the review, which still
//                  counts for the block tier, not the strict one: kept here only as the block-tier figure).
const NAME_PASS = 0.68;
const HOME_PASS = 0.816;
const PREMISES_CLASS = 0.5;
/** Review fix P2-3: share of LA and DC certificates that are commercial or multi-family (exact address) [A]. */
const NON_RESIDENTIAL = 0.5;
const ADDRESS_PASS = 0.9;
const NYC_ADDRESS_PASS = 0.6;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The reviewed rules' logic for a NEW BUSINESS: heads-up for signs, security and commercial cleaning; pest control only for food premises. */
function newBusinessLabels(pestShare: number, addressShare = 1): ProposedSource['labels'] {
  const s = r3(0.246 * NAME_PASS * addressShare);
  return {
    'signs-printing': { label: 'coming_soon', share: s, why: 'new storefront needs signs (business-licence share 0.246 x name pass)' },
    security: { label: 'coming_soon', share: s, why: 'new storefront needs alarms or guards (business-licence share 0.246 x name pass)' },
    'janitorial-commercial': { label: 'coming_soon', share: s, why: 'new storefront needs a cleaning contract (business-licence share 0.246 x name pass)' },
    ...(pestShare > 0 ? { 'pest-control': { label: 'coming_soon' as const, share: r3(pestShare * NAME_PASS * addressShare), why: 'food premises only (BUSINESS_RULES food words / NAICS 722)' } } : {}),
  };
}

/** A certificate of occupancy: heads-up for cleaning, moving, security and landscaping (the reviewed finished-stage rule, plus moving). */
function occupancyLabels(addressPass: number): ProposedSource['labels'] {
  return {
    cleaning: { label: 'coming_soon', share: r3(addressPass), why: 'a building is ready to occupy: move-in and post-construction cleans' },
    moving: { label: 'coming_soon', share: r3(addressPass), why: 'someone is about to move in' },
    security: { label: 'coming_soon', share: r3(addressPass), why: 'a newly occupied building needs locks, alarms or guards' },
    landscaping: { label: 'coming_soon', share: r3(0.5 * addressPass), why: 'new buildings only, not a change of use [A: half]' },
  };
}

/** A building permit, as the live permit feeds measure (median share per trade, see above). */
function permitLabels(addressPass: number): ProposedSource['labels'] {
  const m: Array<[CategoryId, number]> = [
    ['landscaping', 0.012], ['lawn-care', 0.003], ['cleaning', 0.003], ['painting', 0.003], ['moving', 0.005], ['real-estate', 0.005],
    ['janitorial-commercial', 0.001], ['security', 0.001], ['fencing', 0.005], ['siding-gutters', 0.024], ['signs-printing', 0.001],
  ];
  return Object.fromEntries(m.map(([t, sh]) => [t, { label: 'coming_soon' as const, share: r3(sh * addressPass), why: 'measured permit share (median of five metros)' }]));
}

const NEXT_PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = {
  // LIVE source, one change: its summary now prints the premises address when the name passes. The measured grid cannot see it (the rows
  // file holds the old summaries), so the call-path cards it adds are projected here. Its actionable cards are already measured: the
  // projection's "added" count for Chicago repeats them, and only the call-path part changes coverage.
  'socrata-chicago-business': {
    metros: ['chicago'],
    recordKind: 'business-licence',
    expectedRowsPerWeekPerMetro: 113.9,
    volumeEvidence: { tag: 'O', note: 'measured: 113.9 Chicago business-licence rows a week within 25 miles in the 14-day export (NEXT-shares.log)' },
    labels: {
      'signs-printing': { label: 'coming_soon', share: r3(0.268 * NAME_PASS * HOME_PASS), why: 'measured Chicago share 0.268 x name pass x not home-based' },
      security: { label: 'coming_soon', share: r3(0.268 * NAME_PASS * HOME_PASS), why: 'measured Chicago share 0.268 x name pass x not home-based' },
      'janitorial-commercial': { label: 'coming_soon', share: r3(0.268 * NAME_PASS * HOME_PASS), why: 'measured Chicago share 0.268 x name pass x not home-based' },
      'pest-control': { label: 'coming_soon', share: r3(0.218 * NAME_PASS * HOME_PASS), why: 'measured Chicago share 0.218 x name pass x not home-based (food premises)' },
    },
    callPath: true,
  },
  'socrata-txsales-dallas-business': {
    metros: ['dallas-fort-worth'],
    recordKind: 'business-licence',
    expectedRowsPerWeekPerMetro: 100,
    volumeEvidence: { tag: 'A', note: 'scout [A]: 2,000-2,500 new outlets a week statewide, about 25% in Dallas/Tarrant/Collin/Denton, 100-200 a week after the storefront NAICS filter; the low end, before the company-form filter' },
    labels: newBusinessLabels(0.218, PREMISES_CLASS),
    callPath: true,
  },
  'socrata-txsales-houston-business': {
    metros: ['houston'],
    recordKind: 'business-licence',
    expectedRowsPerWeekPerMetro: 70,
    volumeEvidence: { tag: 'A', note: 'scout [A]: about 17% of 2,000-2,500 weekly new outlets in Harris; 70 a week after the storefront NAICS filter (proportional to Dallas)' },
    labels: newBusinessLabels(0.218, PREMISES_CLASS),
    callPath: true,
  },
  // Backups for the sales-tax outlets (same cells): counted so a failed Comptroller probe still shows what TABC alone would give.
  'socrata-tabc-dallas-business': {
    metros: ['dallas-fort-worth'],
    recordKind: 'business-licence',
    expectedRowsPerWeekPerMetro: 15,
    volumeEvidence: { tag: 'A', note: 'no TABC count was read; 15 pending original applications a week in the four counties is a guess' },
    labels: newBusinessLabels(0.6),
    callPath: true,
  },
  'socrata-tabc-houston-business': {
    metros: ['houston'],
    recordKind: 'business-licence',
    expectedRowsPerWeekPerMetro: 12,
    volumeEvidence: { tag: 'A', note: 'no TABC count was read; 12 a week in Harris, Fort Bend and Brazoria is a guess' },
    labels: newBusinessLabels(0.6),
    callPath: true,
  },
  'html-houston-permits': {
    metros: ['houston'],
    recordKind: 'permit',
    expectedRowsPerWeekPerMetro: 470,
    volumeEvidence: { tag: 'O', note: 'the report page read on 2026-11-22 held about 470 rows for one week (SCOUT-research.md, Houston [O])' },
    labels: permitLabels(ADDRESS_PASS),
    callPath: true,
  },
  'arcgis-miamidade-business': {
    metros: ['miami'],
    recordKind: 'business-licence',
    expectedRowsPerWeekPerMetro: 100,
    volumeEvidence: { tag: 'A', note: 'no count was read; about 120 new local business tax accounts a week county-wide, 100 within 25 miles, is a guess' },
    labels: newBusinessLabels(0.218),
    callPath: true,
  },
  'arcgis-phoenix-liquor-business': {
    metros: ['phoenix'],
    recordKind: 'business-licence',
    expectedRowsPerWeekPerMetro: 6,
    volumeEvidence: { tag: 'A', note: 'no count was read; about 6 new restaurant (series 12) licences a week in Phoenix is a guess' },
    // Every row is a restaurant: pest control on every row.
    labels: newBusinessLabels(1),
    callPath: true,
  },
  'socrata-la-occupancy-permits': {
    metros: ['los-angeles'],
    recordKind: 'certificate-of-occupancy',
    expectedRowsPerWeekPerMetro: 100,
    volumeEvidence: { tag: 'A', note: 'LADBS loads certificates weekly [3P]; no count was read; 100 a week is a guess' },
    // Review fix P2-3: residential certificates print their block only; NON_RESIDENTIAL is the share that prints an exact address [A].
    labels: occupancyLabels(ADDRESS_PASS * NON_RESIDENTIAL),
    callPath: true,
  },
  'socrata-nyc-occupancy-permits': {
    metros: ['new-york'],
    recordKind: 'certificate-of-occupancy',
    expectedRowsPerWeekPerMetro: 60,
    volumeEvidence: { tag: 'A', note: 'no count was read; 60 DOB NOW certificates a week is a guess' },
    labels: occupancyLabels(NYC_ADDRESS_PASS),
    // Review fix P2-3: every New York certificate prints its block only (no building-type column): a block-tier call path, not a strict one.
    callPath: false,
  },
  'arcgis-dc-occupancy-permits': {
    metros: ['washington-dc'],
    recordKind: 'certificate-of-occupancy',
    expectedRowsPerWeekPerMetro: 40,
    volumeEvidence: { tag: 'A', note: 'no count was read; 40 certificates a week is a guess' },
    // Review fix P2-3: residential certificates print their block only; NON_RESIDENTIAL is the share that prints an exact address [A].
    labels: occupancyLabels(ADDRESS_PASS * NON_RESIDENTIAL),
    callPath: true,
  },
};

/** Source id -> proposed labels. Round 20 NEXT: the new-business, Houston permit and certificate-of-occupancy sources, and the Chicago address change. */
export const PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = { ...NEXT_PROPOSED_LABELS };

/** The label and share of one trade's entry. */
export function proposedLabelOf(entry: ProposedTradeLabel | undefined): { label: OpportunityLabel; share: number } | null {
  if (entry === undefined) return null;
  if (typeof entry === 'string') return { label: entry, share: 1 };
  const share = typeof entry.share === 'number' && Number.isFinite(entry.share) ? Math.min(1, Math.max(0, entry.share)) : 1;
  return { label: entry.label, share };
}
