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
export const PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = {};

/** The label and share of one trade's entry. */
export function proposedLabelOf(entry: ProposedTradeLabel | undefined): { label: OpportunityLabel; share: number } | null {
  if (entry === undefined) return null;
  if (typeof entry === 'string') return { label: entry, share: 1 };
  const share = typeof entry.share === 'number' && Number.isFinite(entry.share) ? Math.min(1, Math.max(0, entry.share)) : 1;
  return { label: entry.label, share };
}
