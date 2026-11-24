// Round 25: loadCheck's seven reads run on the 14-day export (gates/r19/data/signals-14d.json, read only), with the same parameters and
// row limits as lib/check/load.ts and the ordering of holler_signals_near (supabase/migrations/0003_holler_ops.sql: distance from the cell
// centre in miles, newest first by occurred_at then id, or soonest first; limit after the distance test). The rows then go through the
// page's own code: assembleCheck (load.ts), memberItems and alertTotals (delivery.ts). Nothing here re-implements a delivery rule.
import { existsSync, readFileSync } from 'node:fs';
import { CHECK_READ_LIMITS, assembleCheck, type CheckReadName, type CheckRow } from '@/lib/check/load';
import { alertTotals, memberItems, memberTrades, type AlertTotals } from '@/lib/check/delivery';
import { CHECK_CORE_RADIUS_MI, CHECK_SEARCH_RADIUS_MI, CHECK_WINDOW_DAYS, deriveScope } from '@/lib/check/scope';
import { haversineMi, lookupZip } from '@/lib/geo';
import { expandCategoriesForRouting } from '@/lib/signals/permit-routing';
import { UPCOMING_DAYS } from '@/lib/time';
import type { CheckItem } from '@/lib/check/group';

export const EXPORT = '/home/claude/gates/r19/data/signals-14d.json';
export const HAVE_EXPORT = existsSync(EXPORT);
export const EXPORT_NOW = new Date('2026-11-23T12:00:00.000Z');
const DAY = 86_400_000;

export type ExportRow = CheckRow & { categories: string[]; data: Record<string, unknown> | null; summary: string | null };
let cache: ExportRow[] | null = null;
export function exportRows(): ExportRow[] {
  return (cache ??= HAVE_EXPORT ? (JSON.parse(readFileSync(EXPORT, 'utf8')) as ExportRow[]) : []);
}

/** The seven reads of loadCheck for this ZIP's cell and trade, on the export rows. */
export function simulateReads(zip: string, trade: string, nowMs: number = EXPORT_NOW.getTime(), rows: readonly ExportRow[] = exportRows()) {
  const place = lookupZip(zip)!;
  const sc = deriveScope(place);
  const own = memberTrades(trade);
  const routed = expandCategoriesForRouting(own).filter((c) => !own.includes(c));
  const since = nowMs - CHECK_WINDOW_DAYS * DAY;
  const live = (r: ExportRow) => !r.expires_at || Date.parse(r.expires_at) > nowMs;
  const overlaps = (r: ExportRow, cats: readonly string[]) => (r.categories ?? []).some((c) => cats.includes(c));
  const near = (from: number, until: number, limit: number, soonest: boolean, radius: number, minSev: number, cats: readonly string[]): CheckRow[] =>
    rows
      .filter((r) => r.lat != null && r.lon != null && overlaps(r, cats) && live(r) && r.severity >= minSev)
      .filter((r) => {
        const t = Date.parse(r.occurred_at);
        return t >= from && t <= until && haversineMi(sc.cellLat, sc.cellLon, r.lat as number, r.lon as number) <= radius;
      })
      .sort((a, b) => (soonest ? Date.parse(a.occurred_at) - Date.parse(b.occurred_at) : 0) || Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.id - a.id)
      .slice(0, Math.min(limit, 500));
  const L = CHECK_READ_LIMITS;
  const stateLevel = rows
    .filter((r) => r.lat == null && r.state === sc.state && r.severity >= 2 && overlaps(r, own) && live(r))
    .filter((r) => {
      const t = Date.parse(r.occurred_at);
      return t >= since && t <= nowMs;
    })
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, L.stateLevel);
  const reads: Record<CheckReadName, [CheckRow[], number]> = {
    recent: [near(since, nowMs, L.recent, false, CHECK_SEARCH_RADIUS_MI, 1, own), L.recent],
    core: [near(since, nowMs, L.core, false, CHECK_CORE_RADIUS_MI, 1, own), L.core],
    severe: [near(since, nowMs, L.severe, false, CHECK_SEARCH_RADIUS_MI, 2, own), L.severe],
    upcoming: [near(nowMs, nowMs + UPCOMING_DAYS * DAY, L.upcoming, true, CHECK_SEARCH_RADIUS_MI, 1, own), L.upcoming],
    stateLevel: [stateLevel, L.stateLevel],
    routedRecent: [routed.length ? near(since, nowMs, L.routedRecent, false, CHECK_SEARCH_RADIUS_MI, 1, routed) : [], L.routedRecent],
    routedCore: [routed.length ? near(since, nowMs, L.routedCore, false, CHECK_CORE_RADIUS_MI, 1, routed) : [], L.routedCore],
  };
  return reads;
}

/** What the page computes for this ZIP and trade from the export: the member items and the counted answer. */
export function checkFromExport(zip: string, trade: string, nowMs: number = EXPORT_NOW.getTime()): { member: Omit<CheckItem, 'signal'>[]; totals: AlertTotals; clippedReads: CheckReadName[] } {
  const place = lookupZip(zip)!;
  const reads = simulateReads(zip, trade, nowMs);
  const { items, clipped } = assembleCheck(reads, trade, nowMs);
  const member = memberItems(items, place, trade);
  const clippedReads = (Object.keys(reads) as CheckReadName[]).filter((k) => reads[k][0].length >= reads[k][1]);
  return { member, totals: alertTotals(member, clipped), clippedReads };
}

/** The same member's emailed count with no row limit at all (every candidate row in the cell), for comparison. */
export function unlimitedEmailed(zip: string, trade: string, nowMs: number = EXPORT_NOW.getTime()): AlertTotals {
  const place = lookupZip(zip)!;
  const sc = deriveScope(place);
  const own = memberTrades(trade);
  const cats = expandCategoriesForRouting(own);
  const cand = exportRows().filter((r) => {
    const t = Date.parse(r.occurred_at);
    if (!(t <= nowMs && t >= nowMs - CHECK_WINDOW_DAYS * DAY)) return false;
    if (r.expires_at && Date.parse(r.expires_at) <= nowMs) return false;
    return (r.categories ?? []).some((c) => cats.includes(c)) && (r.lat == null ? r.state === sc.state && r.severity >= 2 : haversineMi(sc.cellLat, sc.cellLon, r.lat, r.lon as number) <= CHECK_SEARCH_RADIUS_MI);
  });
  const { items } = assembleCheck({ recent: [cand, Infinity], core: [[], 1], severe: [[], 1], upcoming: [[], 1], stateLevel: [[], 1], routedRecent: [[], 1], routedCore: [[], 1] }, trade, nowMs);
  return alertTotals(memberItems(items, place, trade), false);
}
