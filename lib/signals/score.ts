import { LABEL_RANK, ruleFor, type LabelInput, type OpportunityLabel } from './lead-rules';
import { tradeForRecord } from './brief';

/**
 * Deterministic score v1 (PLAN-2.0 item 2.7). One number from 0 to 100 for one (record, member trade) pair. It orders cards INSIDE a
 * label (the feed is sorted by label first, then score, then the order the surface already had: severity then newest, or the AI
 * ranking). It is shown in the admin JSON (/api/admin/scores) only: a member never sees a score. No model, no clock of its own (the
 * caller passes `nowMs`), no randomness: same input, same score.
 *
 *   +30  contact         a company is named on the record (a row in holler_signal_contacts that is not a bare job-site address; companies only, never a homeowner)
 *   +20  value           the record publishes a job value ABOVE $10,000 (strictly greater; "$42,791 job value" in the summary, or a numeric
 *                        data.valueUsd / data.jobValueUsd once the extractors write one)
 *   +20  fresh           the record is under 48 hours old (a future date, such as an upcoming event, is not "fresh")
 *   +20  trade fit       EXACT: the record is tagged with the member's trade and the pair is not a downstream route. A permit in another
 *                        trade's work (a re-roof shown to a gutter company, a new home shown to movers) is a downstream fit and scores 0 here.
 *                        A keyword-only match (no trade) scores 0 here.
 *   +10  low competition fewer than 3 members of that trade within reach of the record (see below)
 *
 * Low competition: the count of members who see this record under that trade, THE MEMBER INCLUDED, is below LOW_COMPETITION_BELOW (3).
 * It is counted from the profiles the scan already loaded for matching (lib/signals/match.ts matchSignals tallies it in the same
 * pass; no extra query, no per-signal round trip). Paths that do not hold the member list (the member's own feed, backfill) pass
 * `competitors: null` and the term is simply not awarded, so a feed score has a ceiling of 90 and the admin/scan score of 100.
 */
export const SCORE_POINTS = { contact: 30, value: 20, fresh: 20, tradeFit: 20, lowCompetition: 10 } as const;
export const SCORE_MAX = 100;
/** Job value must be greater than this (US dollars). */
export const VALUE_MIN_USD = 10_000;
/** A record younger than this is fresh. */
export const FRESH_MS = 48 * 3_600_000;
/** "Low competition" means fewer than this many members of the trade (N = 3). */
export const LOW_COMPETITION_BELOW = 3;
/** A record dated a few minutes ahead of this server's clock is still fresh (clock skew), a future event is not. */
const SKEW_MS = 5 * 60_000;

export interface ScoreInput {
  hasContact?: boolean | null;
  valueUsd?: number | null;
  occurredAt?: string | null;
  nowMs: number;
  /** Exact trade fit (see isExactTradeFit). */
  tradeFit: boolean;
  /** Members of the trade near the record, the member included. null or undefined: not known on this path, no points. */
  competitors?: number | null;
}

export interface ScoreParts {
  contact: number;
  value: number;
  fresh: number;
  tradeFit: number;
  lowCompetition: number;
}

export interface Score {
  score: number;
  parts: ScoreParts;
}

export function scoreOf(i: ScoreInput): Score {
  const t = i.occurredAt ? Date.parse(i.occurredAt) : NaN;
  const age = Number.isFinite(t) ? i.nowMs - t : NaN;
  const parts: ScoreParts = {
    contact: i.hasContact ? SCORE_POINTS.contact : 0,
    value: typeof i.valueUsd === 'number' && Number.isFinite(i.valueUsd) && i.valueUsd > VALUE_MIN_USD ? SCORE_POINTS.value : 0,
    fresh: Number.isFinite(age) && age >= -SKEW_MS && age < FRESH_MS ? SCORE_POINTS.fresh : 0,
    tradeFit: i.tradeFit ? SCORE_POINTS.tradeFit : 0,
    lowCompetition: typeof i.competitors === 'number' && Number.isFinite(i.competitors) && i.competitors >= 0 && i.competitors < LOW_COMPETITION_BELOW ? SCORE_POINTS.lowCompetition : 0,
  };
  return { score: parts.contact + parts.value + parts.fresh + parts.tradeFit + parts.lowCompetition, parts };
}

/** A contact counts for the score only when it names an organisation: a bare job-site address (role 'site', no name) does not. */
export function hasNamedContact(contacts: readonly { role: string; name?: string | null }[] | null | undefined): boolean {
  return (contacts ?? []).some((c) => c.role !== 'site' && typeof c.name === 'string' && c.name.trim().length > 0);
}

const JOB_VALUE_RE = /\$\s*([\d]{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s+job value/i;

/** The job value a record publishes, in dollars, or null. Reads a numeric data field first, then the "$N job value" part of the summary. */
export function valueUsdOf(sig: { summary?: string | null; data?: { [k: string]: unknown } | null }): number | null {
  for (const k of ['valueUsd', 'jobValueUsd']) {
    const v = sig.data?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  const m = typeof sig.summary === 'string' ? sig.summary.match(JOB_VALUE_RE) : null;
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Exact trade fit: the record carries the member's trade as one of ITS OWN tags and the label rule for the pair is not a downstream
 * route (lead-rules.ts `downstream`). null trade (keyword watch) is never an exact fit.
 */
export function isExactTradeFit(sig: LabelInput, categories: readonly string[] | null | undefined, trade: string | null | undefined): boolean {
  if (!trade || !(categories ?? []).includes(trade)) return false;
  return !ruleFor(sig, trade as Parameters<typeof ruleFor>[1])?.downstream;
}

/**
 * Stable sort: label first (Act Now first), then score high to low, then the given order. Does not mutate. `scoreOf` may return
 * undefined (no score known): it counts as 0.
 */
export function orderByLabelScore<T>(items: readonly T[], labelOf: (item: T) => OpportunityLabel, scoreFn: (item: T) => number | null | undefined): T[] {
  return items
    .map((item, i) => ({ item, i, r: LABEL_RANK[labelOf(item)], s: scoreFn(item) ?? 0 }))
    .sort((a, b) => a.r - b.r || b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

export interface FeedScoreRecord extends LabelInput {
  summary?: string | null;
  occurred_at?: string | null;
  categories?: readonly string[] | null;
}

/**
 * The score a surface that reads stored matches (web feed, mobile feed, email digest) sorts by: the member's trade for the record is
 * the one the card is shown under (tradeForRecord), `hasContact` comes from the contacts the surface already loaded, and no
 * competition term (the member list is not loaded there), so the ceiling is 90.
 */
export function feedScoreFor(sig: FeedScoreRecord, memberTrades: readonly string[], opts: { hasContact?: boolean; nowMs: number }): number {
  const trade = tradeForRecord(sig, sig.categories, memberTrades);
  return scoreOf({
    hasContact: opts.hasContact,
    valueUsd: valueUsdOf({ summary: sig.summary }),
    occurredAt: sig.occurred_at,
    nowMs: opts.nowMs,
    tradeFit: isExactTradeFit(sig, sig.categories, trade),
    competitors: null,
  }).score;
}
