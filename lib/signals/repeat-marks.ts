import type { SupabaseClient } from '@supabase/supabase-js';
import { ABATEMENT_RE, ALSO_CITED_PREFIX, HEAT_MARK, cleanOrderText, hasHeatMark, orderText, stripNotes, titleBodyOf, violationTrades, withHeatMark } from './carry';
import type { CategoryId } from './categories';
import type { RunOutcome } from './health';
import { labelFor } from './lead-rules';
import { carriedTrades } from './permit-routing';
import { ruleChoice } from './rule-choices';

export { HEAT_MARK, hasHeatMark, withHeatMark };
import type { SignalRowInput } from './store';
import { BUILDING_REF_RE, HEAT_SOURCE, buildingRefOf, isWholeBuildingHeat, onPrivacyGrid } from './building-ref';

/**
 * Two counts across records that a single record cannot see, decided ONCE when a row is stored (lib/signals/run.ts calls markRepeats right
 * before the insert), and written into the row itself so every later reader (the scan's matcher, the feeds, push, the digest, the backfill,
 * the rematch, the admin reports) sees the same answer without reading anything new. No migration: both marks live in columns every reader
 * already selects.
 *
 * 1. NYC whole-building heat (owner call 1, review line 3). NYC 311 rows "HEAT/HOT WATER / ENTIRE BUILDING" carry no building id and no
 *    address, only a point and a borough (live rows Nov 16 to 21 2026: data keys dataset, domain, subtype, cat_v). A building is that point
 *    rounded to 4 decimals (about 11 m), as the review measured (1,063 rows, 691 buildings). The row that brings one building to
 *    HEAT_COMPLAINTS_FOR_CARD complaints inside HEAT_WINDOW_HOURS gets HEAT_MARK appended to its summary; the label rules read the mark
 *    (lead-rules.ts) and make that row, and only that row, urgent for HVAC. Earlier complaints, and later ones at the same building within
 *    HEAT_QUIET_DAYS of a marked row, get no mark and so no HVAC card. If the stored rows cannot be read, nothing is marked: no heat alerts,
 *    which is better than hundreds.
 * 2. Repeated NWS alerts (criterion 4). The live rows carry no alert id (0 of 521 hold data.alertId), so the per-scan de-duplication by
 *    alert id never fired. A row whose event, area (data.event, data.areaDesc: both on every NWS row) and place (county, else rounded
 *    point, else state: nwsRepeatKeyOf) match a row stored or seen less than NWS_REPEAT_HOURS earlier is the same alert issued again: it is stored as a follower of the first row (data.projectOf, the
 *    marker every matching path already skips, lib/signals/match.ts isFollower), so it makes no second card.
 *
 * 3. Code-violation orders of one visit (round 19 RULES, needed for the volume ceiling). A Chicago inspection files up to 15 orders for one
 *    building on one day, one row each (375 rows, 138 visits in the export), so a handyman near Chicago got 226 urgent cards in 8 days. The
 *    orders of one visit (same source, same point rounded to 3 decimals, which is how violation points are stored, same UTC day) become ONE
 *    card: the first order stays the title, the others are listed in its summary ("Also cited: ..."), and their rows are stored as followers
 *    of it. The labels read every order of the card (lib/signals/carry.ts violationOrders), so no trade named by any order is lost. Closed
 *    cases and Austin abatements are left as they are. When a visit's card was stored by an earlier scan, a new order joins it as a
 *    follower only if the card already names its trades; otherwise it stays a card of its own.
 *
 * The pure parts (heatTriggers, nwsRepeats, violationVisits) are what the replay (scripts/rules-replay.ts) runs over the live export, so the replay and the
 * scan cannot drift apart.
 */

type Db = Pick<SupabaseClient, 'from'>;

export { HEAT_SOURCE, isWholeBuildingHeat } from './building-ref';
export const HEAT_COMPLAINTS_FOR_CARD = 3;
export const HEAT_WINDOW_HOURS = 48;
/** After a building's card, further complaints there make no new card for this long. */
export const HEAT_QUIET_DAYS = 7;
export const NWS_REPEAT_HOURS = 24;

const HOUR = 3_600_000;
/**
 * The building a heat row is about. Final review P2-1: a row stored since 311 points are rounded carries `data.bref` (building-ref.ts, a
 * keyed hash of its exact point at 4 decimals): that is the key. A row stored before (exact point, no ref) gets the same keyed hash of its
 * point, so old and new complaints of one building still join. Without the secret (tests, offline replays) an exact point keys by itself
 * at 4 decimals, as before. A point on the 3-decimal privacy grid with no ref (a rounded point) is a whole block, not a building: null.
 */
export function buildingKeyOf(sig: { lat?: number | null; lon?: number | null; data?: Record<string, unknown> | null }): string | null {
  const ref = sig.data?.bref;
  if (typeof ref === 'string' && BUILDING_REF_RE.test(ref)) return `ref:${ref}`;
  const { lat, lon } = sig;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (onPrivacyGrid(lat, lon)) return null;
  const keyed = buildingRefOf(lat, lon);
  return keyed ? `ref:${keyed}` : `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export interface TimelineRow {
  /** Building key (heat) or event and area (NWS). */
  key: string;
  /** occurred_at in ms. */
  t: number;
  /** Unique per row: the external id. */
  id: string;
  /** A row already stored (true) or arriving now (false). Only arriving rows are ever marked. */
  stored: boolean;
  /** Heat: the stored row already carries the mark. NWS: the stored row is already a follower. */
  marked?: boolean;
}

const byTime = (a: TimelineRow, b: TimelineRow) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function groups(rows: readonly TimelineRow[]): Map<string, TimelineRow[]> {
  const out = new Map<string, TimelineRow[]>();
  const seen = new Set<string>();
  // A row fetched again (already stored, same external id) counts once: as the stored row.
  for (const r of [...rows].sort((a, b) => Number(b.stored) - Number(a.stored))) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const g = out.get(r.key) ?? [];
    g.push(r);
    out.set(r.key, g);
  }
  for (const g of out.values()) g.sort(byTime);
  return out;
}

/**
 * The arriving rows that make a building's heat card (review P2-5: whatever order the complaints arrive in). An arriving row is a card when
 * some HEAT_WINDOW_HOURS window that contains it holds HEAT_COMPLAINTS_FOR_CARD or more complaints (stored or arriving, counted once each)
 * and no card (a marked stored row, or a trigger chosen here) lies within HEAT_QUIET_DAYS of it on either side. Among the arriving rows of
 * one building the third complaint in time order is chosen first (else the newest qualifying row), so one batch makes at most one card per
 * building per quiet period. Because
 * the window only has to CONTAIN the arriving row, a third complaint that was stored before the first two arrive still yields the card,
 * on the row that completes the count.
 */
export function heatTriggers(rows: readonly TimelineRow[]): Set<string> {
  const out = new Set<string>();
  const quiet = HEAT_QUIET_DAYS * 24 * HOUR;
  const window = HEAT_WINDOW_HOURS * HOUR;
  for (const g of groups(rows).values()) {
    if (!g.some((r) => !r.stored)) continue;
    // inFull[k]: row k lies in a window (start at some row i, rows i..j with t_j - t_i < window) of HEAT_COMPLAINTS_FOR_CARD or more.
    const inFull = new Array<boolean>(g.length).fill(false);
    let j = 0;
    for (let i = 0; i < g.length; i++) {
      if (j < i) j = i;
      while (j + 1 < g.length && g[j + 1].t - g[i].t < window) j++;
      if (j - i + 1 >= HEAT_COMPLAINTS_FOR_CARD) for (let k = i; k <= j; k++) inFull[k] = true;
    }
    // completes[k]: the HEAT_WINDOW_HOURS up to and including row k hold HEAT_COMPLAINTS_FOR_CARD or more (row k is a third complaint).
    const completes = new Array<boolean>(g.length).fill(false);
    let lo = 0;
    for (let k = 0; k < g.length; k++) {
      while (g[k].t - g[lo].t >= window) lo++;
      completes[k] = k - lo + 1 >= HEAT_COMPLAINTS_FOR_CARD;
    }
    // The card goes on the row that completes the count when it is arriving (as when complaints arrive in time order); when that row was
    // stored before the others arrived, on the newest arriving row of the full window, the nearest to the completion.
    const candidates = g
      .map((r, k) => ({ r, k }))
      .filter(({ r, k }) => !r.stored && inFull[k])
      .sort((a, b) => Number(completes[b.k]) - Number(completes[a.k]) || (completes[a.k] ? a.r.t - b.r.t : b.r.t - a.r.t));
    const cards = g.filter((r) => r.stored && r.marked).map((r) => r.t);
    for (const { r } of candidates) {
      if (cards.some((c) => Math.abs(r.t - c) < quiet)) continue;
      out.add(r.id);
      cards.push(r.t);
    }
  }
  return out;
}

/**
 * Arriving rows that repeat a row already stored or arriving under the same key: less than `hours` from the first row of that key (either
 * side, so a late re-issue cannot make a second card). Maps the repeat's id to the first row's id.
 */
export function repeatsWithin(rows: readonly TimelineRow[], hours: number): Map<string, string> {
  const out = new Map<string, string>();
  const span = hours * HOUR;
  for (const g of groups(rows).values()) {
    const firsts: TimelineRow[] = g.filter((r) => r.stored && !r.marked);
    for (const r of g) {
      if (r.stored) continue;
      const near = firsts.filter((f) => Math.abs(r.t - f.t) < span).sort((a, b) => Math.abs(r.t - a.t) - Math.abs(r.t - b.t) || byTime(a, b))[0];
      if (near) out.set(r.id, near.id);
      else firsts.push(r);
    }
  }
  return out;
}

/** Arriving NWS rows that repeat an alert: same event, area and place (nwsRepeatKeyOf) less than NWS_REPEAT_HOURS from the first row. */
export const nwsRepeats = (rows: readonly TimelineRow[]) => repeatsWithin(rows, NWS_REPEAT_HOURS);

/**
 * Storm reports listed twice (review P3 item 18). SPC files a report under its convective day, and the next day's file lists it again:
 * the live export holds 51 rows that are 26 reports, each pair with the same type, value, point and comments, the same clock time and
 * occurred_at exactly 24 hours apart (row 15854 and row 24614, 1.00 inch hail near Hollywood FL). The adapter's id carries the file's day,
 * so the second listing gets a new id. The identity below leaves the day out; a second listing within SPC_REPEAT_HOURS is stored as a
 * follower of the first, so one report makes one card.
 */
export const SPC_REPEAT_HOURS = 25;

export function spcReportKeyOf(sig: { source?: string | null; lat?: number | null; lon?: number | null; occurredAt?: string | null; occurred_at?: string | null; data?: Record<string, unknown> | null }): string | null {
  if (sig.source !== 'spc') return null;
  const { lat, lon } = sig;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const at = String(sig.occurredAt ?? sig.occurred_at ?? '');
  const clock = Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at)).toISOString().slice(11, 16) : '';
  if (!clock) return null;
  return [s(sig.data?.type), s(String(sig.data?.value ?? '')), `${lat.toFixed(2)},${lon.toFixed(2)}`, clock, s(sig.data?.comments)].join('|');
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// ---- code-violation visits ----------------------------------------------------------------------------------------------------------

/** At most this many orders are listed on one card; further orders of the visit stay cards of their own. */
export const MAX_ORDERS_PER_CARD = 12;
const CLOSED_PART_RE = /(?:^|\|)\s*(?:closed|clos-[a-z]+|clos|complied|resolved|compliance achieved|case closed|no violation|cancell?ed|duplicate)\s*(?:\||$)/i;

/** "socrata-chicago-violations|41.903,-87.700|2026-11-12" for a violation row with a point and a date; null otherwise. */
export function visitKeyOf(sig: { source?: string | null; lat?: number | null; lon?: number | null; occurredAt?: string | null; occurred_at?: string | null; data?: Record<string, unknown> | null; subtype?: string | null; visitKey?: string | null }): string | null {
  const subtype = typeof sig.subtype === 'string' ? sig.subtype : typeof sig.data?.subtype === 'string' ? (sig.data.subtype as string) : '';
  if (subtype !== 'violation') return null;
  // Round 20 (review P3-11): a New York violation row arrives with its building's key (socrata.ts visitKeyFor, a salted hash held in memory
  // only). Stored rows never carry one, so a New York row joins only rows of its own building in the same scan, never a stored card by point.
  if (typeof sig.visitKey === 'string' && sig.visitKey) return sig.visitKey;
  const { lat, lon } = sig;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const day = String(sig.occurredAt ?? sig.occurred_at ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `${sig.source ?? ''}|${lat.toFixed(3)},${lon.toFixed(3)}|${day}`;
}

/** A violation row that is never merged: a closed case (its own rule hides it) or an Austin abatement (its own rule). */
export function standsAlone(sig: { title?: string | null; summary?: string | null }): boolean {
  return CLOSED_PART_RE.test(sig.summary ?? '') || ABATEMENT_RE.test(orderText(sig.title));
}

export interface VisitRow {
  key: string;
  id: string;
  title: string | null;
  summary: string | null;
  stored: boolean;
  /** The row's own tags. */
  categories?: readonly string[] | null;
  source?: string | null;
  kind?: string | null;
  /** Stored rows only: already a follower of another row. */
  follower?: boolean;
}

export interface VisitPlan {
  /** Arriving row id to the id of the card it joins. */
  followerOf: Map<string, string>;
  /** Arriving lead id to the order texts listed on it (the followers' title bodies, in order). */
  alsoCited: Map<string, string[]>;
  /** Arriving lead id to its tags joined with its followers' tags (review P3 item 4: a follower's tags carry to its card). */
  categories: Map<string, string[]>;
}

/**
 * What one order, alone, means for every member: each trade it reaches and the label that trade gets. Orders of one visit share a card
 * only when this is the same (review P2-2 and P3 item 4): then the card's first order names the member's trade whenever any of its orders
 * does, so the title line, the sentence, the email and the push all quote it, and no trade gains or loses a label by the grouping.
 */
export function orderMeaning(r: { source?: string | null; kind?: string | null; title: string | null; summary: string | null; categories?: readonly string[] | null }): string {
  const input = { source: r.source ?? '', kind: r.kind ?? 'civic', subtype: 'violation', title: r.title, summary: r.summary };
  const trades = [...carriedTrades(input, (r.categories ?? []) as string[])].sort();
  return trades.map((t) => `${t}:${labelFor(input, t as CategoryId)}`).join(',');
}

/** Groups arriving violation rows into visits (see the file comment). Order inside a visit: the given order of `rows`. */
export function violationVisits(rows: readonly VisitRow[]): VisitPlan {
  const plan: VisitPlan = { followerOf: new Map(), alsoCited: new Map(), categories: new Map() };
  const byKey = new Map<string, VisitRow[]>();
  for (const r of rows) {
    if (standsAlone(r)) continue;
    if (!r.stored && !titleBodyOf(r.title).trim()) continue;
    const k = `${r.key}#${orderMeaning(r)}`;
    const g = byKey.get(k) ?? [];
    g.push(r);
    byKey.set(k, g);
  }
  for (const g of byKey.values()) {
    const storedLead = g.find((r) => r.stored && !r.follower);
    const fresh: VisitRow[] = [];
    for (const r of g) {
      if (r.stored) continue;
      // A stored card is joined only when it names a trade (an order naming nothing is not "named", review P3 item 4) and already
      // carries every tag of the new order (its tags cannot be changed once stored).
      const named = violationTrades(r.title, r.summary).length > 0;
      const tagsKept = storedLead && (r.categories ?? []).every((c) => (storedLead.categories ?? []).includes(c));
      if (storedLead && named && tagsKept) plan.followerOf.set(r.id, storedLead.id);
      else fresh.push(r);
    }
    if (fresh.length < 2) continue;
    const lead = fresh[0];
    const cited: string[] = [];
    const tags = new Set<string>(lead.categories ?? []);
    for (const r of fresh.slice(1)) {
      const body = cleanOrderText(titleBodyOf(r.title));
      if (!cited.includes(body) && body !== cleanOrderText(titleBodyOf(lead.title))) {
        if (cited.length >= MAX_ORDERS_PER_CARD - 1) continue;
        cited.push(body);
      }
      for (const c of r.categories ?? []) tags.add(c);
      plan.followerOf.set(r.id, lead.id);
    }
    if (cited.length) plan.alsoCited.set(lead.id, cited);
    if (tags.size > (lead.categories ?? []).length) plan.categories.set(lead.id, [...tags]);
  }
  return plan;
}

/** The lead's summary with the other orders of its visit listed. */
export function withAlsoCited(summary: string | null | undefined, orders: readonly string[]): string {
  const part = `${ALSO_CITED_PREFIX}${orders.map(cleanOrderText).join('; ')}`;
  return summary && summary.trim() ? `${summary} | ${part}` : part;
}

/**
 * "flood advisory|miami-dade, fl|<place>" from data.event and data.areaDesc (the title "Event: Area" when they are missing) and the place the
 * row itself carries: its county (data.countyFips, on the adapter's one-row-per-county alerts), otherwise its point rounded to 0.1 degree
 * (a cell at most about 9.8 miles corner to corner, so two merged rows are never more than that apart), otherwise its state. Two rows are
 * repeats only when they are the same event for the same place (review P1-A, P1-B: one warning for five counties is five cards, and two
 * flood polygons 30 miles apart that share an area text are two cards). Null when there is no event or no place at all.
 */
export function nwsRepeatKeyOf(sig: { source?: string | null; title?: string | null; lat?: number | null; lon?: number | null; state?: string | null; data?: Record<string, unknown> | null }): string | null {
  if (sig.source !== 'nws') return null;
  const event = s(sig.data?.event);
  const area = s(sig.data?.areaDesc);
  let head: string | null = event && area ? `${event}|${area}` : null;
  if (!head) {
    const t = s(sig.title);
    head = t.includes(': ') ? t.replace(': ', '|') : null;
  }
  if (!head) return null;
  const fips = sig.data?.countyFips;
  if ((typeof fips === 'string' && fips.trim()) || typeof fips === 'number') return `${head}|c:${String(fips).trim()}`;
  const { lat, lon } = sig;
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) return `${head}|p:${lat.toFixed(1)},${lon.toFixed(1)}`;
  const st = s(sig.state);
  return st ? `${head}|s:${st}` : null;
}

/** The follower marker an NWS repeat gets: the first row's source and external id, as lib/signals/projects.ts writes it. */
export const nwsRootRef = (externalId: string) => `nws:${externalId}`;

export interface MarkResult {
  rows: SignalRowInput[];
  heatMarked: number;
  nwsRepeats: number;
  spcRepeats: number;
  violationFollowers: number;
  logs: string[];
  /**
   * The heat check's own line in source health (review P2-5): ok when the stored complaints were read, failed when not, so a run of
   * failed reads shows as consecutive failures under HEAT_CHECK_SOURCE (lib/signals/health.ts) and not only in a scan log.
   */
  checks: RunOutcome[];
}

/** The source-health name of the per-building heat check. */
export const HEAT_CHECK_SOURCE = 'socrata-nyc-311-heat-check';
/** Pages of 1,000 stored rows read at most per check. */
export const MAX_READ_PAGES = 10;

const ms = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : NaN;
};

async function readPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, maxPages = MAX_READ_PAGES): Promise<{ rows: T[]; capped: boolean }> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return { rows: out, capped: false };
  }
  return { rows: out, capped: true };
}

const why = (e: unknown) => (e instanceof Error ? e.message.slice(0, 120) : 'unknown');

/**
 * Marks the rows of one source's write (see the file comment). Never throws: a failed read leaves the rows as they came (heat: no mark, so
 * no heat card; NWS and SPC: no follower mark, so cards as before; violations: one card per order) and says why in `logs`.
 * First, the two notes this file writes are removed from every incoming summary (review P3 item 10): a source cannot forge a heat card
 * or a list of orders.
 */
export async function markRepeats(db: Db, rowsIn: SignalRowInput[]): Promise<MarkResult> {
  const logs: string[] = [];
  const checks: RunOutcome[] = [];
  const rows = rowsIn.map((r) => {
    if (!r.summary) return r;
    const clean = stripNotes(r.summary);
    return clean === r.summary ? r : { ...r, summary: clean };
  });
  let out = rows;
  let heatMarked = 0;
  let repeats = 0;
  let spcRepeats = 0;
  let visitFollowers = 0;

  // Owner choice 1 "no": no heat note is written at all (review P3 item 17).
  const heatRows = ruleChoice('heatPerBuilding') ? rows.filter((r) => isWholeBuildingHeat(r) && buildingKeyOf(r) && Number.isFinite(ms(r.occurredAt))) : [];
  if (heatRows.length) {
    const times = heatRows.map((r) => ms(r.occurredAt));
    const newest = new Date(Math.max(...times)).toISOString();
    try {
      const from = new Date(Math.min(...times) - (HEAT_QUIET_DAYS * 24 + HEAT_WINDOW_HOURS) * HOUR).toISOString();
      const to = new Date(Math.max(...times) + HEAT_QUIET_DAYS * 24 * HOUR).toISOString();
      // Newest first (review P2-5): if the cap is reached, what is left unread is the oldest complaints, which matter least.
      const read = await readPages<{ external_id: string; lat: number | null; lon: number | null; occurred_at: string; summary: string | null; bref: string | null }>((a, b) =>
        db
          .from('holler_signals')
          .select('external_id, lat, lon, occurred_at, summary, bref:data->>bref')
          .eq('source', HEAT_SOURCE)
          .ilike('title', '%HEAT/HOT WATER / ENTIRE BUILDING%')
          .gte('occurred_at', from)
          .lte('occurred_at', to)
          .order('occurred_at', { ascending: false })
          .order('id', { ascending: false })
          .range(a, b),
      );
      const stored = read.rows;
      if (read.capped) {
        const oldest = stored.length ? stored[stored.length - 1].occurred_at : from;
        logs.push(`heat per building: read cap reached (${stored.length} stored complaints); complaints before ${oldest} were not read`);
      }
      const timeline: TimelineRow[] = [
        ...stored.flatMap((r) => {
          const key = buildingKeyOf({ lat: r.lat, lon: r.lon, data: { bref: r.bref } });
          return key ? [{ key, t: ms(r.occurred_at), id: r.external_id, stored: true, marked: hasHeatMark(r.summary) }] : [];
        }),
        ...heatRows.map((r) => ({ key: buildingKeyOf(r) as string, t: ms(r.occurredAt), id: r.externalId, stored: false })),
      ];
      const hit = heatTriggers(timeline);
      if (hit.size) {
        out = out.map((r) => (isWholeBuildingHeat(r) && hit.has(r.externalId) ? { ...r, summary: withHeatMark(r.summary) } : r));
        heatMarked = hit.size;
      }
      checks.push({ source: HEAT_CHECK_SOURCE, ok: true, error: read.capped ? 'read cap reached' : null, rowsSeen: stored.length, rowsNew: heatMarked, latestRecordAt: newest });
    } catch (e) {
      logs.push(`heat per building: stored rows not read (${why(e)}); no heat row is marked, so none is urgent`);
      checks.push({ source: HEAT_CHECK_SOURCE, ok: false, error: `stored complaints not read: ${why(e)}`, rowsSeen: 0, rowsNew: 0, latestRecordAt: null });
    }
  }

  const nws = out.filter((r) => nwsRepeatKeyOf(r) && Number.isFinite(ms(r.occurredAt)));
  if (nws.length) {
    try {
      const times = nws.map((r) => ms(r.occurredAt));
      const from = new Date(Math.min(...times) - NWS_REPEAT_HOURS * HOUR).toISOString();
      const to = new Date(Math.max(...times) + NWS_REPEAT_HOURS * HOUR).toISOString();
      const { rows: stored, capped } = await readPages<{ external_id: string; occurred_at: string; title: string | null; lat: number | null; lon: number | null; state: string | null; event: string | null; areaDesc: string | null; countyFips: string | null; projectOf: string | null }>((a, b) =>
        db
          .from('holler_signals')
          .select('external_id, occurred_at, title, lat, lon, state, event:data->>event, areaDesc:data->>areaDesc, countyFips:data->>countyFips, projectOf:data->>projectOf')
          .eq('source', 'nws')
          .gte('occurred_at', from)
          .lte('occurred_at', to)
          .order('occurred_at', { ascending: false })
          .order('id', { ascending: false })
          .range(a, b),
      );
      if (capped) logs.push(`nws repeats: read cap reached (${stored.length} stored alerts); older alerts were not read`);
      const timeline: TimelineRow[] = [
        ...stored.flatMap((r) => {
          const key = nwsRepeatKeyOf({ source: 'nws', title: r.title, lat: r.lat, lon: r.lon, state: r.state, data: { event: r.event, areaDesc: r.areaDesc, countyFips: r.countyFips } });
          return key ? [{ key, t: ms(r.occurred_at), id: r.external_id, stored: true, marked: !!r.projectOf }] : [];
        }),
        ...nws.map((r) => ({ key: nwsRepeatKeyOf(r) as string, t: ms(r.occurredAt), id: r.externalId, stored: false })),
      ];
      const rep = nwsRepeats(timeline);
      if (rep.size) {
        out = out.map((r) => {
          const root = r.source === 'nws' ? rep.get(r.externalId) : undefined;
          return root ? { ...r, data: { ...(r.data ?? {}), projectOf: nwsRootRef(root) } } : r;
        });
        repeats = rep.size;
      }
    } catch (e) {
      logs.push(`nws repeats: stored rows not read (${why(e)}); repeats are not marked this scan`);
    }
  }

  const spc = out.filter((r) => spcReportKeyOf(r));
  if (spc.length) {
    try {
      const times = spc.map((r) => ms(r.occurredAt));
      const from = new Date(Math.min(...times) - SPC_REPEAT_HOURS * HOUR).toISOString();
      const to = new Date(Math.max(...times) + SPC_REPEAT_HOURS * HOUR).toISOString();
      const { rows: stored } = await readPages<{ external_id: string; occurred_at: string; lat: number | null; lon: number | null; type: string | null; value: string | null; comments: string | null; projectOf: string | null }>((a, b) =>
        db
          .from('holler_signals')
          .select('external_id, occurred_at, lat, lon, type:data->>type, value:data->>value, comments:data->>comments, projectOf:data->>projectOf')
          .eq('source', 'spc')
          .gte('occurred_at', from)
          .lte('occurred_at', to)
          .order('occurred_at', { ascending: false })
          .order('id', { ascending: false })
          .range(a, b),
      );
      const timeline: TimelineRow[] = [
        ...stored.flatMap((r) => {
          const key = spcReportKeyOf({ source: 'spc', lat: r.lat, lon: r.lon, occurred_at: r.occurred_at, data: { type: r.type, value: r.value, comments: r.comments } });
          return key ? [{ key, t: ms(r.occurred_at), id: r.external_id, stored: true, marked: !!r.projectOf }] : [];
        }),
        ...spc.map((r) => ({ key: spcReportKeyOf(r) as string, t: ms(r.occurredAt), id: r.externalId, stored: false })),
      ];
      const rep = repeatsWithin(timeline, SPC_REPEAT_HOURS);
      if (rep.size) {
        out = out.map((r) => {
          const root = r.source === 'spc' ? rep.get(r.externalId) : undefined;
          return root ? { ...r, data: { ...(r.data ?? {}), projectOf: `spc:${root}` } } : r;
        });
        spcRepeats = rep.size;
      }
    } catch (e) {
      logs.push(`storm report repeats: stored rows not read (${why(e)}); repeats are not marked this scan`);
    }
  }

  const visits = out.filter((r) => visitKeyOf(r));
  if (visits.length) {
    try {
      const keys = [...new Set(visits.map((r) => visitKeyOf(r) as string))];
      const days = [...new Set(visits.map((r) => r.occurredAt.slice(0, 10)))].sort();
      const sources = [...new Set(visits.map((r) => r.source))];
      const { rows: stored } = await readPages<{ external_id: string; source: string; kind: string | null; lat: number | null; lon: number | null; occurred_at: string; title: string | null; summary: string | null; categories: string[] | null; projectOf: string | null }>((a, b) =>
        db
          .from('holler_signals')
          .select('external_id, source, kind, lat, lon, occurred_at, title, summary, categories, projectOf:data->>projectOf')
          .in('source', sources)
          .eq('data->>subtype', 'violation')
          .gte('occurred_at', `${days[0]}T00:00:00Z`)
          .lte('occurred_at', `${days[days.length - 1]}T23:59:59.999Z`)
          .order('id', { ascending: true })
          .range(a, b),
      );
      const timeline: VisitRow[] = [
        ...stored.flatMap((r) => {
          const key = visitKeyOf({ source: r.source, lat: r.lat, lon: r.lon, occurred_at: r.occurred_at, subtype: 'violation' });
          return key && keys.includes(key)
            ? [{ key, id: `${r.source}:${r.external_id}`, source: r.source, kind: r.kind, title: r.title, summary: r.summary, categories: r.categories ?? [], stored: true, follower: !!r.projectOf }]
            : [];
        }),
        ...visits.map((r) => ({ key: visitKeyOf(r) as string, id: `${r.source}:${r.externalId}`, source: r.source, kind: r.kind, title: r.title, summary: r.summary ?? null, categories: r.categories ?? [], stored: false })),
      ];
      const plan = violationVisits(timeline);
      if (plan.followerOf.size || plan.alsoCited.size || plan.categories.size) {
        out = out.map((r) => {
          const id = `${r.source}:${r.externalId}`;
          const lead = plan.followerOf.get(id);
          if (lead) return { ...r, data: { ...(r.data ?? {}), projectOf: lead } };
          const cited = plan.alsoCited.get(id);
          const tags = plan.categories.get(id);
          if (!cited && !tags) return r;
          return { ...r, ...(cited ? { summary: withAlsoCited(r.summary, cited) } : {}), ...(tags ? { categories: tags as SignalRowInput['categories'] } : {}) };
        });
        visitFollowers = plan.followerOf.size;
      }
    } catch (e) {
      logs.push(`violation visits: stored rows not read (${why(e)}); orders are stored one card each this scan`);
    }
  }
  return { rows: out, heatMarked, nwsRepeats: repeats, spcRepeats, violationFollowers: visitFollowers, logs, checks };
}
