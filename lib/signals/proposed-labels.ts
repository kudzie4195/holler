import type { CategoryId } from './categories';
import type { OpportunityLabel } from './lead-rules';
import type { RecordType } from './trade-needs';
import { SALES_PROPOSED_LABELS } from './proposed-labels-sales';

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
 * a call path when callPath is true (strict: an exact address or a business), or a block-level address only when blockPath is true (counted
 * under the owner's block rule, never in strict). Every expected row is assumed to fall within 25 miles of the metro centre, which overstates a
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
  /**
   * Each row carries an EXACT street address (house number) or a business a member can call: the strict call path. A row that carries
   * only a hundred-block address is NOT a strict call path: say so with `blockPath` (round 20 integration).
   */
  callPath: boolean;
  /** With callPath true: which strict tier the rows carry. Default 'exact'. */
  callPathTier?: 'business' | 'exact';
  /**
   * Round 20 integration (owner decision: a block-level address counts as a place to go): the rows carry a hundred-block address only
   * ("2300 block of W 52 STREET"; violations, home sales). Counts in the scorecard's 'block' and 'upper' modes, never in 'strict'.
   * Ignored when callPath is true.
   */
  blockPath?: boolean;
}

/** The best call-path tier a proposed source's rows carry: business, exact, block, or null (none). */
export function proposedTierOf(src: Pick<ProposedSource, 'callPath' | 'callPathTier' | 'blockPath'>): 'business' | 'exact' | 'block' | null {
  if (src.callPath) return src.callPathTier === 'business' ? 'business' : 'exact';
  return src.blockPath ? 'block' : null;
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

export const NEXT_PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = {
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
    // Round 21 integration: say the block tier with the r20-ship field (counted under the owner's block rule, never strict).
    blockPath: true,
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

// Round 20 WATCH (page watch, lib/signals/adapters/page-watch-datasets.ts): open public bids, REGISTERED sources only (the four Bonfire
// and two Firecrawl-only pages wait for their vendors' terms and have no entry). Round 20 review P1-7:
//  - a trade gets a label only when lib/signals/trade-needs.ts lists 'public-bid' among the record types it acts on (general contractor,
//    commercial cleaning, concrete and paving here); roofing, HVAC, plumbing and the rest get nothing from these sources;
//  - the shares of one source sum to at most 0.4 (not every row is trade work: parts purchases, consulting and goods are dropped);
//  - transit and school capital lists, and lists with no due date, are heads-up (coming_soon) for every trade: their work is mostly
//    bonded or prequalified, and a heads-up is the most a small business can act on;
//  - every volume is ASSUMED (research estimate, tag A) until two weeks of samples give real counts.
// Per row, page-watch.ts proposedPageWatchLabel decides: urgent only with an explicitly open status (or no status at all) and a due date
// 3+ days out; feed-only when anything says closed or awarded. The call path is the agency and the bid number on a public page.
const PW_DUE = 'urgent (act_now) when the status is open (or absent) and it is due 3+ days out, else heads-up; share ASSUMED, sum <= 0.4';
const PW_NODUE = 'the list prints no due date: heads-up only; share ASSUMED, sum <= 0.4';
const PW_TRANSIT = 'transit agency bid list: mostly large or prequalified work, heads-up only; share ASSUMED, sum <= 0.4';
const PW_CAPITAL = 'school district capital list: mostly bonded construction, heads-up only; share ASSUMED, sum <= 0.4';

/** Round 20 WATCH: the registered page-watch bid pages (agency and bid number on a public page: a business-tier call path). */
export const WATCH_PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = {
  'bids-pw-dallas-isd': {
    metros: ['dallas-fort-worth'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 2.8,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 12 new rows a month from Dallas ISD; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'janitorial-commercial': { label: 'coming_soon', share: 0.13, why: PW_CAPITAL },
      'concrete-paving': { label: 'coming_soon', share: 0.13, why: PW_CAPITAL },
      'general-contractor': { label: 'coming_soon', share: 0.13, why: PW_CAPITAL },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-houston-metro': {
    metros: ['houston'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 1.2,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 5 new rows a month from Houston METRO; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'janitorial-commercial': { label: 'coming_soon', share: 0.2, why: PW_TRANSIT },
      'concrete-paving': { label: 'coming_soon', share: 0.2, why: PW_TRANSIT },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-hha': {
    metros: ['houston'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 0.7,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 3 new rows a month from Houston Housing Authority; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'act_now', share: 0.4, why: PW_DUE },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-houston-isd': {
    metros: ['houston'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 1.8,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 8 new rows a month from Houston ISD; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'coming_soon', share: 0.2, why: PW_CAPITAL },
      'janitorial-commercial': { label: 'coming_soon', share: 0.2, why: PW_CAPITAL },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-atlanta-housing': {
    metros: ['atlanta'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 0.7,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 3 new rows a month from Atlanta Housing; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'coming_soon', share: 0.4, why: PW_NODUE },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-decatur-housing': {
    metros: ['atlanta'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 0.2,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 1 new rows a month from Decatur Housing Authority; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'act_now', share: 0.4, why: PW_DUE },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-aps': {
    metros: ['atlanta'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 1.4,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 6 new rows a month from Atlanta Public Schools; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'coming_soon', share: 0.2, why: PW_CAPITAL },
      'janitorial-commercial': { label: 'coming_soon', share: 0.2, why: PW_CAPITAL },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-septa': {
    metros: ['philadelphia'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 4.6,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 20 new rows a month from SEPTA; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'janitorial-commercial': { label: 'coming_soon', share: 0.2, why: PW_TRANSIT },
      'general-contractor': { label: 'coming_soon', share: 0.2, why: PW_TRANSIT },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-philasd-capital': {
    metros: ['philadelphia'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 1.4,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 6 new rows a month from School District of Philadelphia; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'coming_soon', share: 0.4, why: PW_CAPITAL },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-miamidade-construction': {
    metros: ['miami'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 0.9,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 4 new rows a month from Miami-Dade County; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'act_now', share: 0.2, why: PW_DUE },
      'concrete-paving': { label: 'act_now', share: 0.2, why: PW_DUE },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-chicago': {
    metros: ['chicago'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 6.9,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 30 new rows a month from City of Chicago; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'general-contractor': { label: 'act_now', share: 0.13, why: PW_DUE },
      'concrete-paving': { label: 'act_now', share: 0.13, why: PW_DUE },
      'janitorial-commercial': { label: 'act_now', share: 0.13, why: PW_DUE },
    },
    callPath: true,
    callPathTier: 'business',
  },
  'bids-pw-lacounty-dpw': {
    metros: ['los-angeles'],
    recordKind: 'public-bid',
    expectedRowsPerWeekPerMetro: 1.8,
    volumeEvidence: { tag: 'A', note: 'ASSUMED: round 20 WATCH research estimate of about 8 new rows a month from LA County Public Works; not counted on the live page. Replace with counts from two weeks of samples before the scorecard uses it.' },
    labels: {
      'concrete-paving': { label: 'act_now', share: 0.2, why: PW_DUE },
      'general-contractor': { label: 'act_now', share: 0.2, why: PW_DUE },
    },
    callPath: true,
    callPathTier: 'business',
  },
};

/** Source id -> proposed labels. Round 20: SALES entries (lib/signals/proposed-labels-sales.ts), NEXT and WATCH entries (above), VIOL entries below. */
export const PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = {
  ...SALES_PROPOSED_LABELS,
  ...NEXT_PROPOSED_LABELS,
  ...WATCH_PROPOSED_LABELS,
  // ==== Round 20 VIOL (lib/signals/adapters/viol-datasets.ts; research /home/claude/gates/r20/VIOL-research.md) ======================
  // Labels follow the reviewed rules (lead-rules.ts RULES), except where a per-building cap is proposed (NYC HPD and rodent, below): a
  // violation order that names a repair is act_now for the trade it names
  // (act-violation-named); a handyman named next to a specialist is coming_soon (owner call 12); an order that names no repair is
  // coming_soon for its tagged trades and market_insight for the general contractor (violation-unnamed); 311 city work is context.
  // tests/signals/viol-r20.test.ts parses a hand-written row per trade through the real parser and checks labelFor() gives these labels.
  // Every `share` is the ASSUMED part of the source's rows that names that trade (no live row was read); the volume tags say how sure the
  // row count is. Violations carry a block-level street address ("2300 block of W 52 STREET"), which the live gate counts as a
  // place; HPD streets numbered 100 and up lose their address under the block-address rule (see the why on each HPD trade).
  // ---- NYC HPD and rodent (review P2-3): NOT to be promoted on an act_now default. Rule proposed for review with two weeks of samples:
  //   - heat (§ 27-2029 and the like): ONE card per building (HPD building id or BBL) per heating season (Oct 1 to May 31), HEADS-UP; a
  //     building that got a 311 heat card in the last 7 days gets a follow-up line on that card instead; "PROVIDE READY ACCESS TO BUILDINGS
  //     HEATING SYSTEM" (§ 27-2033) is paperwork (feed only);
  //   - APARTMENT-LEVEL orders (an apartment is named): FEED ONLY (market_insight), as 311 "apartment only" heat (line 1);
  //   - BUILDING-WIDE orders (public hall, entire building, cellar, roof, boiler room): class C keeps the reviewed violation logic (a named
  //     repair is urgent, a handyman next to a specialist and an unnamed order a heads-up, the general contractor feed only), with at most one
  //     card per building per trade per day; class B building-wide is feed only; painting is capped at a heads-up (the commonest order);
  //   - promote only if `npm run replay:rules` on the samples keeps every NYC trade at or under 10 urgent and 25 heads-up a day.
  //   - review P3-2 wording (HPD_EXTRA_RULES): hot water (§ 27-2031) is treated like heat for plumbing (one heads-up per building per
  //     season); a radiator is HVAC and a toilet stoppage plumbing (building-wide class C only); a carbon-monoxide detector is electrical,
  //     like a smoke detector; elevator orders name no Holler trade and are dropped.
  // Shares below = (assumed share of B/C rows naming the trade) x 0.25 building-wide [A] x 0.3 class C among those [A]; heat and hot water
  // x 0.4 (60% repeat a building within the season [A]). Projected a day on 7,000 rows a week: plumbing 9.75 urgent (9.0 + 0.75 stoppage)
  // and 6.0 heads-up (hot water), windows-doors 9.0 urgent, electrical 7.5 urgent (6.0 + 1.5 carbon monoxide), pest-control 6.0 urgent,
  // hvac 0.75 urgent (radiator) and 8.0 heads-up (heat), painting 15.0 heads-up, handyman 9.0 heads-up, restoration 3.0 heads-up,
  // flooring 2.2 heads-up. The SCORE shape holds one label per trade, so the smaller second path of plumbing and hvac is in `why`
  // (tests/signals/viol-r20.test.ts adds both paths and checks the 10 / 25 ceilings).
  'socrata-nyc-hpd-violations': {
    metros: ['new-york'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 7000,
    volumeEvidence: { tag: 'A', note: 'HPD class B and C violations, open, by NOV issue date: about 10,000 a week issued citywide, about 70% B or C (estimate; dataset wvxf-dwi5 holds 11.4M rows [3P], updated daily [O]). Not measured.' },
    labels: {
      plumbing: { label: 'act_now', share: 0.00975, why: 'building-wide class C plumbing orders (0.12 x 0.25 x 0.3) and toilet stoppages (0.01 x 0.25 x 0.3); apartment-level orders are feed only. Second path: hot water, one heads-up per building per season, 6.0 a day' },
      'windows-doors': { label: 'act_now', share: 0.009, why: 'building-wide class C door and window orders (self-closing public-hall doors): 0.12 x 0.25 x 0.3' },
      electrical: { label: 'act_now', share: 0.0075, why: 'building-wide class C electrical orders (0.08 x 0.25 x 0.3) and carbon-monoxide detectors (0.02 x 0.25 x 0.3)' },
      'pest-control': { label: 'act_now', share: 0.006, why: 'building-wide class C pest orders: 0.08 x 0.25 x 0.3' },
      painting: { label: 'coming_soon', share: 0.015, why: 'building-wide class C paint orders, capped at a heads-up: 0.2 x 0.25 x 0.3' },
      handyman: { label: 'coming_soon', share: 0.009, why: 'named next to a specialist, or unnamed building-wide class C orders: 0.12 x 0.25 x 0.3' },
      hvac: { label: 'coming_soon', share: 0.008, why: 'heat: one card per building per heating season, heads-up: 0.02 x 0.4 first-in-season. Second path: building-wide class C radiator orders, urgent, 0.75 a day' },
      restoration: { label: 'coming_soon', share: 0.003, why: 'mold, building-wide class C (unnamed in the title words): 0.04 x 0.25 x 0.3' },
      flooring: { label: 'coming_soon', share: 0.00225, why: 'floor orders, building-wide class C: 0.03 x 0.25 x 0.3' },
      'general-contractor': { label: 'market_insight', share: 0.0225, why: 'unnamed structure orders: feed only' },
    },
    // Block-level address under the New York block rule (nyc-address.ts): 100+ streets, Queens numbers and named streets now place.
    // Block-level address only (publicAddress / nycBlockAddress): a place to go under the owner's block rule, not a strict call path.
    callPath: false,
    blockPath: true,
  },
  // Rodent (review P2-3): a first finding of rats is FEED ONLY; a failed compliance re-inspection (rats still there) is a HEADS-UP, at most
  // one card per property per 30 days. Share: 0.25 of rat findings are compliance failures [A]: 600 x 0.25 = 150 a week = 21.4 a day,
  // under the 25 heads-up ceiling (HPD pest-control urgent cards count against the separate urgent ceiling).
  'socrata-nyc-rodent-violations': {
    metros: ['new-york'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 600,
    volumeEvidence: { tag: 'A', note: 'DOHMH rodent inspections whose result names rats (dataset p937-wjvj, last modified 2026-11-17 [O]); count not measured.' },
    labels: { 'pest-control': { label: 'coming_soon', share: 0.25, why: 'failed compliance re-inspection only, one card per property per 30 days; a first finding is feed only' } },
    // Block-level address only (publicAddress / nycBlockAddress): a place to go under the owner's block rule, not a strict call path.
    callPath: false,
    blockPath: true,
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
    // Block-level address only (publicAddress / nycBlockAddress): a place to go under the owner's block rule, not a strict call path.
    callPath: false,
    blockPath: true,
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
    // Block-level address only (publicAddress / nycBlockAddress): a place to go under the owner's block rule, not a strict call path.
    callPath: false,
    blockPath: true,
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
      handyman: { label: 'coming_soon', share: 0.15, why: 'exterior walls next to the general contractor, vacant structure titles (assumed share)' },
      'general-contractor': { label: 'act_now', share: 0.05, why: 'exterior wall and porch titles only; vacant and unsafe titles are feed only (assumed share)' },
    },
    // Block-level address only (publicAddress / nycBlockAddress): a place to go under the owner's block rule, not a strict call path.
    callPath: false,
    blockPath: true,
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
    // Block-level address only (publicAddress / nycBlockAddress): a place to go under the owner's block rule, not a strict call path.
    callPath: false,
    blockPath: true,
  },
  'arcgis-miamidade-building-violations': {
    metros: ['miami'],
    recordKind: 'code-violation',
    expectedRowsPerWeekPerMetro: 100,
    volumeEvidence: { tag: 'A', note: 'Miami-Dade building violation cases (case type only); count not measured.' },
    labels: {
      roofing: { label: 'act_now', share: 0.1, why: 'roof case types (assumed share)' },
      'general-contractor': { label: 'coming_soon', share: 0.15, why: 'work-without-permit case types only (paperwork rule, line 15); unsafe structure is feed only (assumed share)' },
    },
    // Block-level address only (publicAddress / nycBlockAddress): a place to go under the owner's block rule, not a strict call path.
    callPath: false,
    blockPath: true,
  },
};

/** The label and share of one trade's entry. */
export function proposedLabelOf(entry: ProposedTradeLabel | undefined): { label: OpportunityLabel; share: number } | null {
  if (entry === undefined) return null;
  if (typeof entry === 'string') return { label: entry, share: 1 };
  const share = typeof entry.share === 'number' && Number.isFinite(entry.share) ? Math.min(1, Math.max(0, entry.share)) : 1;
  return { label: entry.label, share };
}

/**
 * Round 20 VIOL (review P3-6): label RULES a source needs before it can be promoted, because a SOURCE_DEFAULTS value alone cannot give the
 * proposed label (a rule in lib/signals/lead-rules.ts RULES beats a source default). Nothing reads this in the product; LAUNCH.md lists each
 * as a promotion prerequisite, and tests/signals/viol-r20.test.ts proves the default alone would not cap the source.
 */
export interface ProposedRule {
  id: string;
  sources: readonly string[];
  /** The rule in plain words, as it would be written in RULES. */
  rule: string;
  /** Why a source default is not enough. */
  why: string;
}

export const PROPOSED_RULES: readonly ProposedRule[] = [
  {
    id: 'phoenix-complaint-heads-up',
    sources: ['arcgis-phoenix-violations'],
    rule: 'A Phoenix Neighborhood Services property-maintenance case is complaint level: every trade its case type names gets coming_soon (a heads-up), never act_now; a trade it does not name gets context. Placed before act-violation-named, like property-violation-311 (Kansas City, line 9).',
    why: 'Today act-violation-named makes a case type that names a repair ("Grass/Weeds") act_now for that trade, whatever SOURCE_DEFAULTS says.',
  },
  {
    id: 'nyc-hpd-per-building',
    sources: ['socrata-nyc-hpd-violations'],
    rule: 'Heat and hot water: one heads-up per building per heating season; apartment-level orders and building-wide class B orders: feed only; building-wide class C orders: the violation rule with one card per building per trade per day; painting at most a heads-up.',
    why: 'act-violation-named makes every named HPD order act_now (painting alone about 200 a day).',
  },
  {
    id: 'nyc-rodent-reinspection',
    sources: ['socrata-nyc-rodent-violations'],
    rule: 'A first finding of rats: feed only; a failed compliance re-inspection: heads-up, one per property per 30 days.',
    why: 'act-violation-named makes every "Rat Activity" row act_now for pest control.',
  },
];
