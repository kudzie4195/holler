import { CATEGORY_IDS, type CategoryId } from './categories';
import { contactPathOf } from './alert-gate';
import { isAlertLabel, type OpportunityLabel } from './lead-rules';
import { matchArea, matchOne, type MatchProfile, type MatchSignal } from './match';
import { carriedTrades } from './permit-routing';
import { proposedLabelOf, type ProposedSource } from './proposed-labels';
import {
  buildingKeyOf,
  heatTriggers,
  isWholeBuildingHeat,
  nwsRepeatKeyOf,
  nwsRepeats,
  nwsRootRef,
  repeatsWithin,
  spcReportKeyOf,
  SPC_REPEAT_HOURS,
  violationVisits,
  visitKeyOf,
  withAlsoCited,
  withHeatMark,
  type TimelineRow,
} from './repeat-marks';
import { recordTypeOf, TRADE_NEEDS, type RecordType } from './trade-needs';

/**
 * Round 20 SCORE: the trade-by-metro "would pay" scorecard (scripts/trade-coverage.ts, npm run score:trades). Measures only: it runs the
 * live engine (lib/signals/match.ts matchOne, which applies lib/signals/lead-rules.ts) over stored rows exactly as scripts/rules-replay.ts
 * does (ingest marks of lib/signals/repeat-marks.ts first, deliverable rows only, NWS repeats once, the heat rule on) and does arithmetic
 * on the cards it returns. Nothing here changes a label, a match or a card. Pure: rows in, numbers out; no database, network or clock.
 *
 * Definitions (the round 20 goal, owned by this unit):
 *   actionable card    an urgent (act_now) or heads-up (coming_soon) card the matcher gives a member of the trade at the metro centre,
 *                      25 miles, one trade, no keywords, no work profile, plan id 'starter' (Solo limits), city bids off (as the reviewed replay).
 *   cards a week       each card counts 7 / (its source's span of days in the rows file), so a source held for 4 days and one held for
 *                      14 are put on the same weekly footing.
 *   call path          the card shows an address (the live gate's own test on the row's public summary, alert-gate.ts contactPathOf)
 *                      or a business to call. The rows file holds no contacts table, so the business side is known only per source: the
 *                      "upper" mode also counts a card whose source has a contact spec that can store a business or a site address.
 *   covers             at least 1 actionable card a week with a call path (strict mode: an address on the row itself).
 *   would pay          the trade covers at least 7 of the 10 metros.
 */

export const DAY_MS = 86_400_000;
export const RADIUS_MI = 25;
export const COVER_MIN_PER_WEEK = 1;
export const PAY_MIN_METROS = 7;
/** Float tolerance for the 1-a-week test (7 cards over a 7.0000001-day span is still one a week). */
const EPS = 1e-9;

export interface CoverageRow {
  id: number;
  source: string;
  kind: string;
  title: string | null;
  summary: string | null;
  categories: string[] | null;
  state: string | null;
  city?: string | null;
  severity: number;
  occurred_at: string;
  url?: string | null;
  data: Record<string, unknown> | null;
  lat: number | null;
  lon: number | null;
}

export const subtypeOfRow = (r: CoverageRow): string | null => (typeof r.data?.subtype === 'string' && r.data.subtype ? (r.data.subtype as string) : null);

// ---- span of days ---------------------------------------------------------------------------------------------------------------

/**
 * Days each source's rows cover. 'range' (the reviewed replay's rule, the default): newest minus oldest occurred_at in days, at least 1.
 * 'calendar': the number of distinct UTC dates the source's rows fall on, at least 1 (a sensitivity check: 'range' runs short by up to a
 * day, which inflates the weekly rate of a source held for only a few days).
 */
export function sourceSpans(rows: readonly Pick<CoverageRow, 'source' | 'occurred_at'>[], mode: 'range' | 'calendar' = 'range'): Map<string, number> {
  const out = new Map<string, number>();
  if (mode === 'calendar') {
    const days = new Map<string, Set<string>>();
    for (const r of rows) {
      const t = Date.parse(r.occurred_at);
      if (!Number.isFinite(t)) continue;
      const s = days.get(r.source) ?? new Set<string>();
      s.add(new Date(t).toISOString().slice(0, 10));
      days.set(r.source, s);
    }
    for (const [src, s] of days) out.set(src, Math.max(1, s.size));
    return out;
  }
  const mm = new Map<string, [number, number]>();
  for (const r of rows) {
    const t = Date.parse(r.occurred_at);
    if (!Number.isFinite(t)) continue;
    const cur = mm.get(r.source);
    mm.set(r.source, cur ? [Math.min(cur[0], t), Math.max(cur[1], t)] : [t, t]);
  }
  for (const [src, [a, b]] of mm) out.set(src, Math.max(1, (b - a) / DAY_MS));
  return out;
}

// ---- call path --------------------------------------------------------------------------------------------------------------------

/** 'address': the row's public summary names a place (measured on the row). 'spec': only the source's contact spec could add one. */
export type CallPath = 'address' | 'spec' | null;

export function callPathOfRow(r: Pick<CoverageRow, 'source' | 'summary'>, specCapable: (source: string) => boolean): CallPath {
  if (contactPathOf(null, r.summary) === 'site') return 'address';
  return specCapable(r.source) ? 'spec' : null;
}

/** A contact spec (lib/contacts/extract.ts ContactSpec, read structurally) that can store a business or a site address for a card. */
export function specCanGiveCallPath(spec: { site?: unknown; orgs?: readonly { role: string }[]; typedContractors?: unknown } | undefined | null): boolean {
  if (!spec) return false;
  if (spec.site) return true;
  if (spec.typedContractors) return true;
  // 'owner' (code violations) is read only behind HOLLER_VIOLATION_OWNERS_ENABLED, off by default: not counted.
  return (spec.orgs ?? []).some((o) => o.role === 'business' || o.role === 'contractor');
}

// ---- cells ------------------------------------------------------------------------------------------------------------------------

export interface Card {
  source: string;
  type: RecordType;
  label: OpportunityLabel;
  callPath: CallPath;
}

export interface Rate {
  cards: number;
  /** Actionable cards a week (any call path). */
  perWeek: number;
  /** ... with an address on the row (strict). */
  addressPerWeek: number;
  /** ... with an address on the row or a source contact spec that can add one (upper). */
  upperPerWeek: number;
}

export interface Cell extends Rate {
  urgent: number;
  headsUp: number;
  /** Urgent and heads-up cards a week (the replay prints these a day). */
  urgentPerWeek: number;
  headsUpPerWeek: number;
  byType: Partial<Record<RecordType, Rate>>;
  bySource: Record<string, Rate>;
}

export type CoverMode = 'strict' | 'upper';

const emptyRate = (): Rate => ({ cards: 0, perWeek: 0, addressPerWeek: 0, upperPerWeek: 0 });
function addTo(r: Rate, w: number, path: CallPath): void {
  r.cards++;
  r.perWeek += w;
  if (path === 'address') r.addressPerWeek += w;
  if (path !== null) r.upperPerWeek += w;
}

/** One (trade, metro) cell from its actionable cards. A card that is not an alert label is ignored (the caller passes alerts only). */
export function cellOf(cards: readonly Card[], spans: ReadonlyMap<string, number>, fallbackDays = 14): Cell {
  const c: Cell = { ...emptyRate(), urgent: 0, headsUp: 0, urgentPerWeek: 0, headsUpPerWeek: 0, byType: {}, bySource: {} };
  for (const k of cards) {
    if (!isAlertLabel(k.label)) continue;
    const w = 7 / (spans.get(k.source) ?? fallbackDays);
    if (k.label === 'act_now') {
      c.urgent++;
      c.urgentPerWeek += w;
    } else {
      c.headsUp++;
      c.headsUpPerWeek += w;
    }
    addTo(c, w, k.callPath);
    addTo((c.byType[k.type] ??= emptyRate()), w, k.callPath);
    addTo((c.bySource[k.source] ??= emptyRate()), w, k.callPath);
  }
  return c;
}

export const callPathRate = (r: Pick<Rate, 'addressPerWeek' | 'upperPerWeek'>, mode: CoverMode): number => (mode === 'strict' ? r.addressPerWeek : r.upperPerWeek);
export const covers = (r: Pick<Rate, 'addressPerWeek' | 'upperPerWeek'>, mode: CoverMode): boolean => callPathRate(r, mode) + EPS >= COVER_MIN_PER_WEEK;
export const wouldPay = (metrosCovered: number): boolean => metrosCovered >= PAY_MIN_METROS;

// ---- grid -------------------------------------------------------------------------------------------------------------------------

export interface Centre {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** The member's own state (the metro's first state). */
  state: string;
}

export type Grid = Record<CategoryId, Record<string, Cell>>;

export interface TradeSummary {
  trade: CategoryId;
  covered: string[];
  pays: boolean;
}

export interface Headline {
  mode: CoverMode;
  trades: TradeSummary[];
  paying: number;
  total: number;
  pct: number;
}

export function headlineOf(grid: Grid, centres: readonly Centre[], mode: CoverMode, trades: readonly CategoryId[] = CATEGORY_IDS): Headline {
  const out: TradeSummary[] = trades.map((trade) => {
    const covered = centres.filter((m) => covers(grid[trade][m.id], mode)).map((m) => m.id);
    return { trade, covered, pays: wouldPay(covered.length) };
  });
  const paying = out.filter((t) => t.pays).length;
  return { mode, trades: out, paying, total: trades.length, pct: trades.length ? (100 * paying) / trades.length : 0 };
}

// ---- ingest marks (the same as scripts/rules-replay.ts, applied as if every row arrived in time order) ----------------------------

export interface MarkCounts {
  heat: number;
  nws: number;
  spc: number;
  visitFollowers: number;
}

export function markRows<R extends CoverageRow>(rows: readonly R[]): { rows: R[]; counts: MarkCounts } {
  const t = (iso: string) => Date.parse(iso);
  const heatTimeline: TimelineRow[] = rows.filter((r) => isWholeBuildingHeat(r) && buildingKeyOf(r)).map((r) => ({ key: buildingKeyOf(r) as string, t: t(r.occurred_at), id: String(r.id), stored: false }));
  const heatHit = heatTriggers(heatTimeline);
  const nwsTimeline: TimelineRow[] = rows.filter((r) => nwsRepeatKeyOf(r)).map((r) => ({ key: nwsRepeatKeyOf(r) as string, t: t(r.occurred_at), id: String(r.id), stored: false }));
  const nwsRep = nwsRepeats(nwsTimeline);
  const spcTimeline: TimelineRow[] = rows.filter((r) => spcReportKeyOf(r)).map((r) => ({ key: spcReportKeyOf(r) as string, t: t(r.occurred_at), id: String(r.id), stored: false }));
  const spcRep = repeatsWithin(spcTimeline, SPC_REPEAT_HOURS);
  const visits = violationVisits(
    rows
      .filter((r) => visitKeyOf(r))
      .map((r) => ({ key: visitKeyOf(r) as string, id: String(r.id), source: r.source, kind: r.kind, title: r.title, summary: r.summary, categories: r.categories ?? [], stored: false })),
  );
  const marked = rows.map((r) => {
    const id = String(r.id);
    if (heatHit.has(id)) return { ...r, summary: withHeatMark(r.summary) };
    const root = nwsRep.get(id);
    if (root) return { ...r, data: { ...(r.data ?? {}), projectOf: nwsRootRef(root) } };
    const spcRoot = spcRep.get(id);
    if (spcRoot) return { ...r, data: { ...(r.data ?? {}), projectOf: `spc:${spcRoot}` } };
    const lead = visits.followerOf.get(id);
    if (lead) return { ...r, data: { ...(r.data ?? {}), projectOf: `${r.source}:${lead}` } };
    const cited = visits.alsoCited.get(id);
    const tags = visits.categories.get(id);
    if (cited || tags) return { ...r, ...(cited ? { summary: withAlsoCited(r.summary, cited) } : {}), ...(tags ? { categories: tags } : {}) };
    return r;
  });
  return { rows: marked, counts: { heat: heatHit.size, nws: nwsRep.size, spc: spcRep.size, visitFollowers: visits.followerOf.size } };
}

// ---- running the engine -----------------------------------------------------------------------------------------------------------

export const signalOf = (r: CoverageRow): MatchSignal => ({
  id: r.id,
  categories: r.categories ?? [],
  lat: r.lat,
  lon: r.lon,
  state: r.state,
  severity: r.severity,
  occurred_at: r.occurred_at,
  subtype: subtypeOfRow(r),
  data: r.data as MatchSignal['data'],
  source: r.source,
  title: r.title,
  summary: r.summary,
  kind: r.kind,
});

export const profileAt = (c: Pick<Centre, 'lat' | 'lon' | 'state'>, trade: CategoryId | null, radiusMi = RADIUS_MI): MatchProfile => ({
  user_id: 'score',
  categories: trade ? [trade] : [],
  lat: c.lat,
  lon: c.lon,
  state: c.state,
  radius_mi: radiusMi,
  plan: 'starter',
});

export interface EngineOpts {
  /** Passed to matchOne: the replay's fixed clock (score and deadline only; labels do not read it). */
  nowMs: number;
  /** City bids on or off (the replay: off). */
  bidsOn?: boolean;
  radiusMi?: number;
  /**
   * The replay's quick box (degrees of latitude and longitude around the centre) applied before matchOne. Undefined: a box wide enough
   * for the 25-mile radius plus the 15-mile stand-in reach (1.0 by 1.3 degrees), so the matcher alone decides.
   */
  box?: { lat: number; lon: number };
}

/** The actionable cards one member of `trade` at `centre` gets from `rows` (rows already marked). */
export function cardsAt(rows: readonly CoverageRow[], centre: Centre, trade: CategoryId, specCapable: (source: string) => boolean, opts: EngineOpts): Card[] {
  const profile = profileAt(centre, trade, opts.radiusMi);
  const box = opts.box ?? { lat: 1.0, lon: 1.3 };
  const out: Card[] = [];
  for (const r of rows) {
    if (r.lat !== null && r.lon !== null && (Math.abs(r.lat - centre.lat) > box.lat || Math.abs(r.lon - centre.lon) > box.lon)) continue;
    const m = matchOne(signalOf(r), profile, opts.bidsOn ?? false, opts.nowMs);
    if (!m || !isAlertLabel(m.label) || m.hold) continue;
    out.push({ source: r.source, type: recordTypeOf({ source: r.source, kind: r.kind, data: r.data }), label: m.label, callPath: callPathOfRow(r, specCapable) });
  }
  return out;
}

/** What a (trade, metro) cell saw of the record types the trade acts on: rows of those types in the area, and what the trade got from them. */
export interface NeedSeen {
  /** Rows in the area (25 miles) whose type the trade acts on (TRADE_NEEDS). */
  neededRows: number;
  /** ... of which reach the trade as urgent or heads-up. */
  alert: number;
  /** ... of which reach the trade as feed-only background (market insight or held). */
  background: number;
  /** ... of which carry the trade but its label is context, so the card is never shown (public work, closed cases, own-trade rules). */
  context: number;
  /** ... of which do not carry the trade at all (the record is about other work: tags and permit routing leave this trade out). */
  notCarried: number;
}

export interface Measured {
  grid: Grid;
  /** metro id -> record type -> deliverable rows in the 25-mile area (followers left out). */
  presence: Record<string, Partial<Record<RecordType, number>>>;
  seen: Record<CategoryId, Record<string, NeedSeen>>;
}

export function measure(
  rows: readonly CoverageRow[],
  centres: readonly Centre[],
  spans: ReadonlyMap<string, number>,
  specCapable: (source: string) => boolean,
  opts: EngineOpts,
  trades: readonly CategoryId[] = CATEGORY_IDS,
): Measured {
  const grid = {} as Grid;
  const seen = {} as Measured['seen'];
  const presence: Measured['presence'] = {};
  for (const tr of trades) {
    grid[tr] = {};
    seen[tr] = {};
  }
  const box = opts.box ?? { lat: 1.0, lon: 1.3 };
  for (const c of centres) {
    const near = rows.filter((r) => r.lat === null || r.lon === null || (Math.abs(r.lat - c.lat) <= box.lat && Math.abs(r.lon - c.lon) <= box.lon));
    // The area alone (no trade): deliverable, not a follower, not on probation, within the radius by the matcher's own rule.
    const area: CoverageRow[] = [];
    const types: RecordType[] = [];
    const pres: Partial<Record<RecordType, number>> = {};
    for (const r of near) {
      const s = signalOf(r);
      if (typeof s.data?.projectOf === 'string' && s.data.projectOf) continue;
      if (!matchArea(s, profileAt(c, null, opts.radiusMi), opts.bidsOn ?? false)) continue;
      const ty = recordTypeOf({ source: r.source, kind: r.kind, data: r.data });
      area.push(r);
      types.push(ty);
      pres[ty] = (pres[ty] ?? 0) + 1;
    }
    presence[c.id] = pres;
    for (const tr of trades) {
      const profile = profileAt(c, tr, opts.radiusMi);
      const needs = new Set<RecordType>(TRADE_NEEDS[tr].acts);
      const cards: Card[] = [];
      const ns: NeedSeen = { neededRows: 0, alert: 0, background: 0, context: 0, notCarried: 0 };
      for (let i = 0; i < area.length; i++) {
        const r = area[i];
        const m = matchOne(signalOf(r), profile, opts.bidsOn ?? false, opts.nowMs);
        const alert = !!m && isAlertLabel(m.label) && !m.hold;
        if (alert) cards.push({ source: r.source, type: types[i], label: m!.label, callPath: callPathOfRow(r, specCapable) });
        if (needs.has(types[i])) {
          ns.neededRows++;
          if (alert) ns.alert++;
          else if (m) ns.background++;
          else if (carriedTrades({ source: r.source, kind: r.kind, subtype: subtypeOfRow(r), title: r.title, summary: r.summary }, r.categories).includes(tr)) ns.context++;
          else ns.notCarried++;
        }
      }
      grid[tr][c.id] = cellOf(cards, spans);
      seen[tr][c.id] = ns;
    }
  }
  return { grid, presence, seen };
}

// ---- projection (proposed sources, unverified) ------------------------------------------------------------------------------------

/** A projected cell: the measured rates plus what proposed sources are expected to add. Never written back into the measured grid. */
export interface ProjectedCell {
  measured: Rate;
  addedPerWeek: number;
  addedCallPathPerWeek: number;
  /** Proposed source ids that add to this cell. */
  from: string[];
}

export type ProjectedGrid = Record<CategoryId, Record<string, ProjectedCell>>;

export function projectGrid(
  grid: Grid,
  centres: readonly Centre[],
  proposed: Readonly<Record<string, ProposedSource>>,
  trades: readonly CategoryId[] = CATEGORY_IDS,
): ProjectedGrid {
  const out = {} as ProjectedGrid;
  for (const tr of trades) {
    out[tr] = {};
    for (const c of centres) {
      const m = grid[tr][c.id];
      out[tr][c.id] = { measured: { cards: m.cards, perWeek: m.perWeek, addressPerWeek: m.addressPerWeek, upperPerWeek: m.upperPerWeek }, addedPerWeek: 0, addedCallPathPerWeek: 0, from: [] };
    }
  }
  for (const [id, src] of Object.entries(proposed)) {
    const vol = Number.isFinite(src.expectedRowsPerWeekPerMetro) ? Math.max(0, src.expectedRowsPerWeekPerMetro) : 0;
    for (const tr of trades) {
      const l = proposedLabelOf(src.labels[tr]);
      if (!l || !isAlertLabel(l.label) || l.share <= 0) continue;
      for (const metro of src.metros) {
        const cell = out[tr][metro];
        if (!cell) continue;
        cell.addedPerWeek += vol * l.share;
        if (src.callPath) cell.addedCallPathPerWeek += vol * l.share;
        cell.from.push(id);
      }
    }
  }
  return out;
}

/** The projected rate with a call path for the mode: measured + added. */
export const projectedRate = (p: ProjectedCell, mode: CoverMode): number => callPathRate(p.measured, mode) + p.addedCallPathPerWeek;

export function projectedHeadline(pg: ProjectedGrid, centres: readonly Centre[], mode: CoverMode, trades: readonly CategoryId[] = CATEGORY_IDS): Headline {
  const out: TradeSummary[] = trades.map((trade) => {
    const covered = centres.filter((m) => projectedRate(pg[trade][m.id], mode) + EPS >= COVER_MIN_PER_WEEK).map((m) => m.id);
    return { trade, covered, pays: wouldPay(covered.length) };
  });
  const paying = out.filter((t) => t.pays).length;
  return { mode, trades: out, paying, total: trades.length, pct: trades.length ? (100 * paying) / trades.length : 0 };
}

// ---- gap report and build list ----------------------------------------------------------------------------------------------------

export type GapReason = 'no-source' | 'not-for-trade' | 'feed-only' | 'no-call-path' | 'too-few';

export interface Gap {
  trade: CategoryId;
  metro: string;
  reason: GapReason;
  /** Record types the trade acts on that have no row in the metro's area. */
  missingTypes: RecordType[];
  cell: Cell;
  seen: NeedSeen;
}

/**
 * Why a cell does not cover, in this order:
 *   no-call-path  at least 1 actionable card a week, but fewer than 1 a week with a call path;
 *   too-few       some actionable cards, but fewer than 1 a week;
 *   feed-only     no actionable card, though rows of a type the trade acts on that carry the trade are in the area: the label keeps them
 *                 in the feed as background, or hides them (context);
 *   not-for-trade no actionable card; rows of a type the trade acts on are in the area, but none is about this trade's work (the rows'
 *                 tags and permit routing never carry the trade): the source is there, the records the trade needs are not;
 *   no-source     no actionable card and no row of any type the trade acts on in the area.
 */
export function gapOf(trade: CategoryId, metro: string, cell: Cell, seen: NeedSeen, present: Partial<Record<RecordType, number>>, mode: CoverMode): Gap | null {
  if (covers(cell, mode)) return null;
  const missingTypes = TRADE_NEEDS[trade].acts.filter((t) => !(present[t] ?? 0));
  let reason: GapReason;
  if (cell.perWeek + EPS >= COVER_MIN_PER_WEEK) reason = 'no-call-path';
  else if (cell.cards > 0) reason = 'too-few';
  else if (seen.background + seen.context > 0) reason = 'feed-only';
  else if (seen.neededRows > 0) reason = 'not-for-trade';
  else reason = 'no-source';
  return { trade, metro, reason, missingTypes, cell, seen };
}

export function gapsOf(m: Measured, centres: readonly Centre[], mode: CoverMode, trades: readonly CategoryId[] = CATEGORY_IDS): Gap[] {
  const out: Gap[] = [];
  for (const tr of trades) for (const c of centres) {
    const g = gapOf(tr, c.id, m.grid[tr][c.id], m.seen[tr][c.id], m.presence[c.id] ?? {}, mode);
    if (g) out.push(g);
  }
  return out;
}

export interface BuildItem {
  type: RecordType;
  /** Uncovered cells where the trade acts on this type and the metro has no row of it. */
  cells: number;
  /** ... of which the type already gives that trade 1+ call-path cards a week in some other metro (proven yield). */
  provenCells: number;
  /** Trades that would reach 7 of 10 metros if every one of this type's cells were filled (others unchanged). */
  tradesToPay: CategoryId[];
  /** ... counting proven cells only. */
  tradesToPayProven: CategoryId[];
}

export function buildList(m: Measured, centres: readonly Centre[], mode: CoverMode, trades: readonly CategoryId[] = CATEGORY_IDS): BuildItem[] {
  const gaps = gapsOf(m, centres, mode, trades);
  const head = headlineOf(m.grid, centres, mode, trades);
  const coveredCount = new Map(head.trades.map((t) => [t.trade, t.covered.length]));
  const proven = (type: RecordType, trade: CategoryId) => centres.some((c) => {
    const r = m.grid[trade][c.id].byType[type];
    return !!r && callPathRate(r, mode) + EPS >= COVER_MIN_PER_WEEK;
  });
  const items = new Map<RecordType, { cells: Gap[]; proven: Gap[] }>();
  for (const g of gaps) for (const ty of g.missingTypes) {
    const it = items.get(ty) ?? { cells: [], proven: [] };
    it.cells.push(g);
    if (proven(ty, g.trade)) it.proven.push(g);
    items.set(ty, it);
  }
  const toPay = (gs: Gap[]) => {
    const add = new Map<CategoryId, number>();
    for (const g of gs) add.set(g.trade, (add.get(g.trade) ?? 0) + 1);
    return [...add].filter(([tr, n]) => !wouldPay(coveredCount.get(tr) ?? 0) && wouldPay((coveredCount.get(tr) ?? 0) + n)).map(([tr]) => tr);
  };
  return [...items]
    .map(([type, it]) => ({ type, cells: it.cells.length, provenCells: it.proven.length, tradesToPay: toPay(it.cells), tradesToPayProven: toPay(it.proven) }))
    .sort((a, b) => b.tradesToPayProven.length - a.tradesToPayProven.length || b.provenCells - a.provenCells || b.tradesToPay.length - a.tradesToPay.length || b.cells - a.cells || a.type.localeCompare(b.type));
}

export interface MetroBuildItem {
  metro: string;
  type: RecordType;
  /** Uncovered cells in this metro where the trade acts on the type and the metro has no row of it. */
  cells: number;
  /** ... of which the type gives that trade 1+ call-path cards a week in some other metro today (proven yield). */
  provenCells: number;
  provenTrades: CategoryId[];
}

/** The same count per (metro, record type): one new source of that type in that metro. Ranked by proven cells, then cells. */
export function metroBuildList(m: Measured, centres: readonly Centre[], mode: CoverMode, trades: readonly CategoryId[] = CATEGORY_IDS): MetroBuildItem[] {
  const gaps = gapsOf(m, centres, mode, trades);
  const proven = (type: RecordType, trade: CategoryId) => centres.some((c) => {
    const r = m.grid[trade][c.id].byType[type];
    return !!r && callPathRate(r, mode) + EPS >= COVER_MIN_PER_WEEK;
  });
  const items = new Map<string, MetroBuildItem>();
  for (const g of gaps) for (const ty of g.missingTypes) {
    const k = `${g.metro}\u0000${ty}`;
    const it = items.get(k) ?? { metro: g.metro, type: ty, cells: 0, provenCells: 0, provenTrades: [] };
    it.cells++;
    if (proven(ty, g.trade)) {
      it.provenCells++;
      it.provenTrades.push(g.trade);
    }
    items.set(k, it);
  }
  return [...items.values()].sort((a, b) => b.provenCells - a.provenCells || b.cells - a.cells || a.metro.localeCompare(b.metro) || a.type.localeCompare(b.type));
}
