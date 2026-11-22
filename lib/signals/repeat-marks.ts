import type { SupabaseClient } from '@supabase/supabase-js';
import { ABATEMENT_RE, ALSO_CITED_PREFIX, HEAT_MARK, hasHeatMark, orderText, titleBodyOf, violationTrades, withHeatMark } from './carry';

export { HEAT_MARK, hasHeatMark, withHeatMark };
import type { SignalRowInput } from './store';

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
 *    alert id never fired. A row whose event and area (data.event, data.areaDesc: both on every NWS row) match a row stored or seen less
 *    than NWS_REPEAT_HOURS earlier is the same alert issued again: it is stored as a follower of the first row (data.projectOf, the
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

export const HEAT_SOURCE = 'socrata-nyc-311';
export const HEAT_COMPLAINTS_FOR_CARD = 3;
export const HEAT_WINDOW_HOURS = 48;
/** After a building's card, further complaints there make no new card for this long. */
export const HEAT_QUIET_DAYS = 7;
export const NWS_REPEAT_HOURS = 24;

const HOUR = 3_600_000;
const WHOLE_BUILDING_RE = /heat\/hot water \/ entire building/i;

/** A NYC "HEAT/HOT WATER / ENTIRE BUILDING" 311 row. */
export function isWholeBuildingHeat(sig: { source?: string | null; title?: string | null }): boolean {
  return sig.source === HEAT_SOURCE && WHOLE_BUILDING_RE.test(sig.title ?? '');
}

/** The building a heat row is about: its point rounded to 4 decimals. Null without a point. */
export function buildingKeyOf(sig: { lat?: number | null; lon?: number | null }): string | null {
  const { lat, lon } = sig;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
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
 * The arriving rows that make a building's heat card: the row at which the building has HEAT_COMPLAINTS_FOR_CARD or more complaints in
 * the HEAT_WINDOW_HOURS up to and including it, when no card (a marked stored row, or a trigger chosen here) lies within HEAT_QUIET_DAYS
 * of it on either side. "Either side" keeps one card per building when an older complaint arrives late.
 */
export function heatTriggers(rows: readonly TimelineRow[]): Set<string> {
  const out = new Set<string>();
  const quiet = HEAT_QUIET_DAYS * 24 * HOUR;
  const window = HEAT_WINDOW_HOURS * HOUR;
  for (const g of groups(rows).values()) {
    const cards = g.filter((r) => r.stored && r.marked).map((r) => r.t);
    for (let i = 0; i < g.length; i++) {
      const r = g[i];
      if (r.stored) continue;
      let n = 0;
      for (let j = i; j >= 0 && r.t - g[j].t < window; j--) n++;
      if (n < HEAT_COMPLAINTS_FOR_CARD) continue;
      if (cards.some((c) => Math.abs(r.t - c) < quiet)) continue;
      out.add(r.id);
      cards.push(r.t);
    }
  }
  return out;
}

/**
 * Arriving NWS rows that repeat an alert already stored or arriving: same event and area, less than NWS_REPEAT_HOURS from the first row of
 * that alert (either side, so a late re-issue cannot make a second card). Maps the repeat's id to the first row's id.
 */
export function nwsRepeats(rows: readonly TimelineRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const span = NWS_REPEAT_HOURS * HOUR;
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

const s = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// ---- code-violation visits ----------------------------------------------------------------------------------------------------------

/** At most this many orders are listed on one card; further orders of the visit stay cards of their own. */
export const MAX_ORDERS_PER_CARD = 12;
const CLOSED_PART_RE = /(?:^|\|)\s*(?:closed|clos-[a-z]+|clos|complied|resolved|compliance achieved|case closed|no violation|cancell?ed|duplicate)\s*(?:\||$)/i;

/** "socrata-chicago-violations|41.903,-87.700|2026-11-12" for a violation row with a point and a date; null otherwise. */
export function visitKeyOf(sig: { source?: string | null; lat?: number | null; lon?: number | null; occurredAt?: string | null; occurred_at?: string | null; data?: Record<string, unknown> | null; subtype?: string | null }): string | null {
  const subtype = typeof sig.subtype === 'string' ? sig.subtype : typeof sig.data?.subtype === 'string' ? (sig.data.subtype as string) : '';
  if (subtype !== 'violation') return null;
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
  /** Stored rows only: already a follower of another row. */
  follower?: boolean;
}

export interface VisitPlan {
  /** Arriving row id to the id of the card it joins. */
  followerOf: Map<string, string>;
  /** Arriving lead id to the order texts listed on it (the followers' title bodies, in order). */
  alsoCited: Map<string, string[]>;
}

/** Groups arriving violation rows into visits (see the file comment). Order inside a visit: the given order of `rows`. */
export function violationVisits(rows: readonly VisitRow[]): VisitPlan {
  const plan: VisitPlan = { followerOf: new Map(), alsoCited: new Map() };
  const byKey = new Map<string, VisitRow[]>();
  for (const r of rows) {
    if (standsAlone(r)) continue;
    const g = byKey.get(r.key) ?? [];
    g.push(r);
    byKey.set(r.key, g);
  }
  for (const g of byKey.values()) {
    const storedCards = g.filter((r) => r.stored && !r.follower);
    const storedTrades = new Set(storedCards.flatMap((r) => violationTrades(r.title, r.summary)));
    const storedLead = storedCards[0];
    const fresh: VisitRow[] = [];
    for (const r of g) {
      if (r.stored) continue;
      const named = violationTrades(r.title, r.summary);
      if (storedLead && named.every((t) => storedTrades.has(t))) plan.followerOf.set(r.id, storedLead.id);
      else fresh.push(r);
    }
    if (fresh.length < 2) continue;
    const lead = fresh[0];
    const cited: string[] = [];
    for (const r of fresh.slice(1)) {
      const body = titleBodyOf(r.title).trim();
      if (!body) continue;
      if (!cited.includes(body) && body !== titleBodyOf(lead.title).trim()) {
        if (cited.length >= MAX_ORDERS_PER_CARD - 1) continue;
        cited.push(body);
      }
      plan.followerOf.set(r.id, lead.id);
    }
    if (cited.length) plan.alsoCited.set(lead.id, cited);
  }
  return plan;
}

/** The lead's summary with the other orders of its visit listed. */
export function withAlsoCited(summary: string | null | undefined, orders: readonly string[]): string {
  const part = `${ALSO_CITED_PREFIX}${orders.join('; ')}`;
  return summary && summary.trim() ? `${summary} | ${part}` : part;
}

/** "flood advisory|miami-dade, fl" from data.event and data.areaDesc (the title "Event: Area" when they are missing). Null when neither is there. */
export function nwsRepeatKeyOf(sig: { source?: string | null; title?: string | null; data?: Record<string, unknown> | null }): string | null {
  if (sig.source !== 'nws') return null;
  const event = s(sig.data?.event);
  const area = s(sig.data?.areaDesc);
  if (event && area) return `${event}|${area}`;
  const t = s(sig.title);
  return t.includes(': ') ? t.replace(': ', '|') : null;
}

/** The follower marker an NWS repeat gets: the first row's source and external id, as lib/signals/projects.ts writes it. */
export const nwsRootRef = (externalId: string) => `nws:${externalId}`;

export interface MarkResult {
  rows: SignalRowInput[];
  heatMarked: number;
  nwsRepeats: number;
  violationFollowers: number;
  logs: string[];
}

const ms = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : NaN;
};

async function readPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    out.push(...rows);
  }
  return out;
}

/**
 * Marks the rows of one source's write (see the file comment). Never throws: a failed read leaves the rows as they came (heat: no mark, so
 * no heat card; NWS: no follower mark, so cards as before) and says why in `logs`.
 */
export async function markRepeats(db: Db, rows: SignalRowInput[]): Promise<MarkResult> {
  const logs: string[] = [];
  let out = rows;
  let heatMarked = 0;
  let repeats = 0;
  let visitFollowers = 0;

  const heatRows = rows.filter((r) => isWholeBuildingHeat(r) && buildingKeyOf(r) && Number.isFinite(ms(r.occurredAt)));
  if (heatRows.length) {
    try {
      const times = heatRows.map((r) => ms(r.occurredAt));
      const from = new Date(Math.min(...times) - (HEAT_QUIET_DAYS * 24 + HEAT_WINDOW_HOURS) * HOUR).toISOString();
      const to = new Date(Math.max(...times) + HEAT_QUIET_DAYS * 24 * HOUR).toISOString();
      const stored = await readPages<{ external_id: string; lat: number | null; lon: number | null; occurred_at: string; summary: string | null }>((a, b) =>
        db
          .from('holler_signals')
          .select('external_id, lat, lon, occurred_at, summary')
          .eq('source', HEAT_SOURCE)
          .ilike('title', '%HEAT/HOT WATER / ENTIRE BUILDING%')
          .gte('occurred_at', from)
          .lte('occurred_at', to)
          .order('id', { ascending: true })
          .range(a, b),
      );
      const timeline: TimelineRow[] = [
        ...stored.flatMap((r) => {
          const key = buildingKeyOf(r);
          return key ? [{ key, t: ms(r.occurred_at), id: r.external_id, stored: true, marked: hasHeatMark(r.summary) }] : [];
        }),
        ...heatRows.map((r) => ({ key: buildingKeyOf(r) as string, t: ms(r.occurredAt), id: r.externalId, stored: false })),
      ];
      const hit = heatTriggers(timeline);
      if (hit.size) {
        out = out.map((r) => (isWholeBuildingHeat(r) && hit.has(r.externalId) ? { ...r, summary: withHeatMark(r.summary) } : r));
        heatMarked = hit.size;
      }
    } catch (e) {
      logs.push(`heat per building: stored rows not read (${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}); no heat row is marked, so none is urgent`);
    }
  }

  const nws = out.filter((r) => nwsRepeatKeyOf(r) && Number.isFinite(ms(r.occurredAt)));
  if (nws.length) {
    try {
      const times = nws.map((r) => ms(r.occurredAt));
      const from = new Date(Math.min(...times) - NWS_REPEAT_HOURS * HOUR).toISOString();
      const to = new Date(Math.max(...times) + NWS_REPEAT_HOURS * HOUR).toISOString();
      const stored = await readPages<{ external_id: string; occurred_at: string; title: string | null; event: string | null; areaDesc: string | null; projectOf: string | null }>((a, b) =>
        db
          .from('holler_signals')
          .select('external_id, occurred_at, title, event:data->>event, areaDesc:data->>areaDesc, projectOf:data->>projectOf')
          .eq('source', 'nws')
          .gte('occurred_at', from)
          .lte('occurred_at', to)
          .order('id', { ascending: true })
          .range(a, b),
      );
      const timeline: TimelineRow[] = [
        ...stored.flatMap((r) => {
          const key = nwsRepeatKeyOf({ source: 'nws', title: r.title, data: { event: r.event, areaDesc: r.areaDesc } });
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
      logs.push(`nws repeats: stored rows not read (${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}); repeats are not marked this scan`);
    }
  }
  const visits = out.filter((r) => visitKeyOf(r));
  if (visits.length) {
    try {
      const keys = [...new Set(visits.map((r) => visitKeyOf(r) as string))];
      const days = [...new Set(visits.map((r) => r.occurredAt.slice(0, 10)))].sort();
      const sources = [...new Set(visits.map((r) => r.source))];
      const stored = await readPages<{ external_id: string; source: string; lat: number | null; lon: number | null; occurred_at: string; title: string | null; summary: string | null; projectOf: string | null }>((a, b) =>
        db
          .from('holler_signals')
          .select('external_id, source, lat, lon, occurred_at, title, summary, projectOf:data->>projectOf')
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
          return key && keys.includes(key) ? [{ key, id: `${r.source}:${r.external_id}`, title: r.title, summary: r.summary, stored: true, follower: !!r.projectOf }] : [];
        }),
        ...visits.map((r) => ({ key: visitKeyOf(r) as string, id: `${r.source}:${r.externalId}`, title: r.title, summary: r.summary ?? null, stored: false })),
      ];
      const plan = violationVisits(timeline);
      if (plan.followerOf.size || plan.alsoCited.size) {
        out = out.map((r) => {
          const id = `${r.source}:${r.externalId}`;
          const lead = plan.followerOf.get(id);
          if (lead) return { ...r, data: { ...(r.data ?? {}), projectOf: lead } };
          const cited = plan.alsoCited.get(id);
          return cited ? { ...r, summary: withAlsoCited(r.summary, cited) } : r;
        });
        visitFollowers = plan.followerOf.size;
      }
    } catch (e) {
      logs.push(`violation visits: stored rows not read (${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}); orders are stored one card each this scan`);
    }
  }
  return { rows: out, heatMarked, nwsRepeats: repeats, violationFollowers: visitFollowers, logs };
}
