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

/** Source id -> proposed labels. Empty until this round's source units fill it. */
export const PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = {
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
  },
};

/** The label and share of one trade's entry. */
export function proposedLabelOf(entry: ProposedTradeLabel | undefined): { label: OpportunityLabel; share: number } | null {
  if (entry === undefined) return null;
  if (typeof entry === 'string') return { label: entry, share: 1 };
  const share = typeof entry.share === 'number' && Number.isFinite(entry.share) ? Math.min(1, Math.max(0, entry.share)) : 1;
  return { label: entry.label, share };
}
