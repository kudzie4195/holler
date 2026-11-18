/**
 * Intent of an alert: what the record tells a business, and what it does not.
 *   demand   - something happened (weather, storm, disaster, quake, 311, code violation, failed inspection). Work is not confirmed.
 *   spending - money is moving or about to (permit, business licence, federal bid or award, permitted event).
 *   asking   - someone asked: a resident request on Holler, or a public post that looks like a request.
 * intentLine() gives the line for a signal: open federal bids, new business licences and public posts have their own wording.
 * Pure and client-safe: no server imports. Unknown kinds, subtypes and sources fall back to 'demand', the most cautious reading.
 * Mapping is checked against every registered source by tests/feedback/intent.test.ts.
 */
export type Intent = 'demand' | 'spending' | 'asking';

export const INTENTS: readonly Intent[] = ['demand', 'spending', 'asking'];

export interface IntentInput {
  kind: string;
  subtype?: string | null;
  source: string;
}

/** Sources whose rows are people asking, regardless of kind. 'holler-request' is a resident request made on Holler. */
const ASKING_SOURCES = new Set(['holler-request', 'bluesky', 'websearch-brave', 'websearch-serper']);

/** data.subtype values written by the Socrata and ArcGIS adapters. */
const SPENDING_SUBTYPES = new Set(['permit', 'business', 'event-permit']);
const DEMAND_SUBTYPES = new Set(['311', 'violation', 'inspection']);

const SPENDING_KINDS = new Set(['permit', 'contract']);

/** Heuristic public posts: matched by wording, so who wrote them and where they live is not on the record. */
const PUBLIC_POST_SOURCES = new Set(['bluesky', 'websearch-brave', 'websearch-serper']);
/** Open federal solicitations: out for bid, nothing awarded. */
const OPEN_BID_SOURCES = new Set(['sam-gov']);

const norm = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export function intentOf(signal: IntentInput): Intent {
  const kind = norm(signal.kind);
  const subtype = norm(signal.subtype);
  const source = norm(signal.source);
  if (kind === 'ask' || ASKING_SOURCES.has(source)) return 'asking';
  if (SPENDING_SUBTYPES.has(subtype)) return 'spending';
  if (DEMAND_SUBTYPES.has(subtype)) return 'demand';
  if (SPENDING_KINDS.has(kind)) return 'spending';
  // weather alert, storm report, disaster, earthquake, airport delay, big event, 311 or inspection without a subtype, anything unknown
  return 'demand';
}

/** Which line to show. Most signals use their intent's line; a few sources need their own wording so the line never says more than the record. */
export type IntentLineKey = Intent | 'open-bid' | 'new-business' | 'public-post';

export function intentLineKey(signal: IntentInput): IntentLineKey {
  const kind = norm(signal.kind);
  const subtype = norm(signal.subtype);
  const source = norm(signal.source);
  if (PUBLIC_POST_SOURCES.has(source)) return 'public-post';
  if (OPEN_BID_SOURCES.has(source)) return 'open-bid';
  if (kind === 'ask' || source === 'holler-request') return 'asking';
  if (subtype === 'business') return 'new-business';
  return intentOf(signal);
}

export const INTENT_LABEL: Record<Intent, string> = {
  demand: 'Demand sign',
  spending: 'Spending activity',
  asking: 'Someone asked',
};

/** One plain line under the label: what is confirmed and what is not. */
export const INTENT_NOTE: Record<Intent, string> = {
  demand: 'The event is on record. Whether anyone needs work is not confirmed.',
  spending: 'Money is being spent here. The main contractor may already be chosen.',
  asking: 'A resident asked for this service.',
};

const LINE_BY_KEY: Record<IntentLineKey, string> = {
  demand: INTENT_NOTE.demand,
  spending: INTENT_NOTE.spending,
  asking: INTENT_NOTE.asking,
  'open-bid': 'This work is out for bid. No contract has been awarded yet.',
  'new-business': 'A new business registered here. It may need services as it opens.',
  'public-post': 'A public post asked about this. Holler has not checked who wrote it.',
};

/** The one plain line under the label for this signal. The label still comes from INTENT_LABEL[intentOf(signal)]. */
export function intentLine(signal: IntentInput): string {
  return LINE_BY_KEY[intentLineKey(signal)];
}
