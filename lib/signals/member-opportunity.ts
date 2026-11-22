import { keywordHit } from '@/lib/plan/keywords';
import {
  OPPORTUNITY_LABEL,
  OPPORTUNITY_RANK,
  PERMIT_DOING,
  PERMIT_DOWNSTREAM,
  assessOpportunity,
  opportunityCopy,
  type Opportunity,
  type OpportunityAssessment,
  type OpportunityInput,
  type OpportunityReason,
} from './opportunity';

/**
 * Glue between stored signal rows and lib/signals/opportunity.ts: what a member sees and receives is labelled by opportunity FOR
 * THEIR TRADES (Act now, Coming soon, Market insight), and a record that is only 'context' for every one of their trades is never an
 * alert. Pure and client-safe (imports only opportunity.ts, categories.ts through it, and lib/plan/keywords.ts).
 *
 * Every read that feeds matching, the feed, push, email or the check page must select the columns in OPPORTUNITY_SIGNAL_COLUMNS
 * (or the whole `data` object where the read cannot take JSON aliases, such as the holler_signals_near RPC): without kind, title and
 * the data fields below, records fall to the 'unknown' rule and read as 'context'. The matcher throws on a record without `kind`
 * instead of silently dropping it (lib/signals/match.ts).
 */

/**
 * The data fields opportunity.ts reads, as PostgREST JSON aliases (usable in plain and embedded selects): data.type (SAM.gov notice
 * type, SPC report type), data.event (NWS event name), data.hailInches, data.comments (SPC remarks) and data.mag (USGS magnitude).
 * No personal fields: these are public weather, quake and federal notice values.
 */
export const OPPORTUNITY_DATA_COLUMNS =
  'opp_type:data->>type,opp_event:data->>event,opp_hail:data->>hailInches,opp_comments:data->>comments,opp_mag:data->>mag';

/** Everything opportunity needs from a holler_signals row (plain or embedded select). */
export const OPPORTUNITY_SIGNAL_COLUMNS = `kind,source,title,summary,categories,severity,subtype:data->>subtype,${OPPORTUNITY_DATA_COLUMNS}`;

/** Row fields read by opportunityInputOf. A row may carry the whole `data` object, the opp_* aliases, or both. */
export interface OpportunityRowFields {
  kind?: string | null;
  source?: string | null;
  title?: string | null;
  summary?: string | null;
  categories?: string[] | null;
  severity?: number | null;
  subtype?: string | null;
  data?: Record<string, unknown> | null;
  opp_type?: string | null;
  opp_event?: string | null;
  opp_hail?: string | number | null;
  opp_comments?: string | null;
  opp_mag?: string | number | null;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The OpportunityInput for a stored row (data object merged with the opp_* aliases; aliases fill only what data lacks). */
export function opportunityInputOf(row: OpportunityRowFields): OpportunityInput {
  const base = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...(row.data as Record<string, unknown>) } : {};
  const fill = (k: string, v: unknown) => {
    if (v !== undefined && base[k] === undefined) base[k] = v;
  };
  fill('subtype', str(row.subtype));
  fill('type', str(row.opp_type));
  fill('event', str(row.opp_event));
  fill('hailInches', num(row.opp_hail));
  fill('comments', str(row.opp_comments));
  fill('mag', num(row.opp_mag));
  const subtype = str(row.subtype) ?? str(base.subtype) ?? null;
  return {
    kind: typeof row.kind === 'string' ? row.kind : '',
    subtype,
    source: typeof row.source === 'string' ? row.source : '',
    title: row.title ?? null,
    summary: row.summary ?? null,
    categories: Array.isArray(row.categories) ? row.categories : [],
    severity: typeof row.severity === 'number' ? row.severity : null,
    data: base,
  };
}

/** The opportunity of one record for one member, as every surface shows it. */
export interface MemberOpportunity {
  label: Opportunity;
  /** OPPORTUNITY_LABEL[label]: "Act now", "Coming soon", "Market insight". */
  labelText: string;
  /** The member's trade the label was read for (null for a keyword-only match or context). */
  trade: string | null;
  reason: OpportunityReason | 'keyword';
  why: string;
  next: string;
  uncertain: string;
}

/** Best label of an assessment across trades (no copy). */
export function bestLabelOf(a: OpportunityAssessment, trades: readonly string[]): { trade: string | null; label: Opportunity } {
  let best: { trade: string | null; label: Opportunity } = { trade: null, label: 'context' };
  for (const t of trades) {
    const g = a.grants[t as keyof typeof a.grants];
    if (g && OPPORTUNITY_RANK[g.label] > OPPORTUNITY_RANK[best.label]) best = { trade: t, label: g.label };
  }
  return best;
}

/** Copy for a record that matched only a keyword watch (no trade label): shown as a Market insight, never pushed. */
export function keywordBrief(keyword: string): Omit<MemberOpportunity, 'trade'> {
  return {
    label: 'intel',
    labelText: OPPORTUNITY_LABEL.intel,
    reason: 'keyword',
    why: `It mentions "${keyword}", a phrase you watch.`,
    next: 'Open the source to see whether it fits your work.',
    uncertain: 'Holler matched your watched phrase only and has not checked that this is work for your trade.',
  };
}

/**
 * The member's opportunity for a stored row: the best label across their (plan-limited) trades, with that trade's copy. When no
 * trade gets more than 'context' and one of the member's keyword watches is in the title or summary, a keyword brief (intel).
 * Otherwise label 'context' (never shown or sent as an alert).
 */
export function memberOpportunity(row: OpportunityRowFields, trades: readonly string[], keywords: readonly string[] = []): MemberOpportunity {
  const input = opportunityInputOf(row);
  const a = assessOpportunity(input);
  const best = bestLabelOf(a, trades);
  if (best.label === 'context' && keywords.length > 0) {
    const hit = keywordHit({ title: input.title, summary: input.summary }, [...keywords]);
    if (hit) return { ...keywordBrief(hit), trade: null };
  }
  const trade = best.trade ?? trades[0] ?? '';
  const g = best.trade ? a.grants[best.trade as keyof typeof a.grants] : undefined;
  const reason: OpportunityReason = g ? g.reason : a.fallback;
  const copy = opportunityCopy(reason, trade, best.label, a.detail);
  return { label: best.label, labelText: OPPORTUNITY_LABEL[best.label], trade: best.trade, reason, ...copy };
}

/** The public shape of a brief (web feed, app feed, check page). */
export interface OpportunityDto {
  label: Opportunity;
  labelText: string;
  why: string;
  next: string;
  uncertain: string;
}

export function opportunityDto(o: MemberOpportunity): OpportunityDto {
  return { label: o.label, labelText: o.labelText, why: o.why, next: o.next, uncertain: o.uncertain };
}

/** Shown groups, in order: Act now first. 'context' is never shown. */
export const SHOWN_OPPORTUNITIES: readonly Exclude<Opportunity, 'context'>[] = ['act', 'soon', 'intel'];

/** Group headings and filter names ("Market insights" in the plural for a list). */
export const OPPORTUNITY_GROUP_LABEL: Record<Exclude<Opportunity, 'context'>, string> = {
  act: 'Act now',
  soon: 'Coming soon',
  intel: 'Market insights',
};

/**
 * Record categories a SQL prefilter must accept so that every record a member's trades can earn is read. A trade's own category,
 * plus the trades that DO a permitted job whose follow-on work is this trade (a re-roof permit is tagged roofing and is 'soon' for
 * siding-gutters). Used where a read narrows rows by categories before the opportunity test (backfill, preview, check page).
 * Records whose label comes from their text alone (a few weather, 311 and violation rows) can still sit outside this set.
 */
export function prefilterCategories(trades: readonly string[]): string[] {
  const out = new Set<string>(trades);
  for (const [kind, after] of Object.entries(PERMIT_DOWNSTREAM)) {
    if (!after.some((t) => trades.includes(t))) continue;
    for (const c of PERMIT_DOING[kind] ?? []) out.add(c);
  }
  return [...out];
}
