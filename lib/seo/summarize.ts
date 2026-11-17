import { WINDOW_DAYS } from './threshold';
import { sectionFor, SECTIONS, type SectionId } from './sections';
import { UPCOMING_DAYS, isUpcoming, newestPast, orderLatest } from '../time';

/** Row shape selected from holler_signals (no jsonb data column). */
export interface SignalRowDb {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  categories: string[] | null;
  severity: number;
  occurred_at: string;
  expires_at: string | null;
  /** holler_signals.data->>'subtype' (permit | 311 | inspection | business | violation | event-permit), when the adapter set it */
  subtype?: string | null;
}

export interface SectionItem {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  severity: number;
  occurredAt: string;
  expiresAt: string | null;
}

export interface TradeTally {
  id: string;
  count: number;
  kinds: string[]; // kinds that drive this trade, most frequent first
}

export interface PlaceData {
  ok: boolean;
  slug: string;
  /** ISO time the data was computed; the page never calls Date itself (Cache Components). */
  asOf: string;
  /** All signals tagged to the place in the window, any kind, expired alerts included. */
  total: number;
  /** Items per section, newest first (alerts: unexpired only), capped by the per-section limit. */
  sections: Partial<Record<SectionId, SectionItem[]>>;
  /** Total count per section (alerts: unexpired only). */
  counts: Partial<Record<SectionId, number>>;
  /** Records per section over the whole window, expired alerts included. Drives titles: a type is named only if present. */
  windowCounts: Partial<Record<SectionId, number>>;
  /** Same, for the last 7 days only. */
  weekCounts: Partial<Record<SectionId, number>>;
  /**
   * Records per section that already happened in the last 7 days: nothing dated ahead, expired alerts included. Feeds the quotable
   * summary sentence on the city page, which counts the past only.
   */
  pastWeekCounts: Partial<Record<SectionId, number>>;
  /** False when the row query was truncated before it reached back 7 days, so pastWeekCounts are lower bounds. */
  pastWeekExact: boolean;
  weekTrades: TradeTally[];
  windowTrades: TradeTally[];
  sources: string[];
  earliestAt: string | null;
  latestAt: string | null;
}

export const DEFAULT_ITEM_LIMIT = 8;
const DAY = 86_400_000;
/** Alerts with no expires_at count as active only for this many days after they occurred (ASSUMED). */
const ALERT_NO_EXPIRY_DAYS = 3;

export function emptyPlaceData(slug: string, asOf: string, ok: boolean): PlaceData {
  return { ok, slug, asOf, total: 0, sections: {}, counts: {}, windowCounts: {}, weekCounts: {}, pastWeekCounts: {}, pastWeekExact: true, weekTrades: [], windowTrades: [], sources: [], earliestAt: null, latestAt: null };
}

export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function tally(rows: { categories: string[] | null; kind: string }[]): TradeTally[] {
  const byCat = new Map<string, { count: number; kinds: Map<string, number> }>();
  for (const r of rows) {
    for (const c of r.categories ?? []) {
      const e = byCat.get(c) ?? { count: 0, kinds: new Map<string, number>() };
      e.count += 1;
      e.kinds.set(r.kind, (e.kinds.get(r.kind) ?? 0) + 1);
      byCat.set(c, e);
    }
  }
  return [...byCat.entries()]
    .map(([id, e]) => ({
      id,
      count: e.count,
      kinds: [...e.kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k),
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/**
 * Pure: turns raw rows into the page's data. `exactKindCounts` (optional) overrides per-section counts
 * when the row query was truncated.
 */
export function summarize(
  slug: string,
  rows: SignalRowDb[],
  nowIso: string,
  opts: { limit?: number; totalOverride?: number; exactSectionCounts?: Partial<Record<SectionId, number>>; truncated?: boolean } = {},
): PlaceData {
  const limit = opts.limit ?? DEFAULT_ITEM_LIMIT;
  const now = Date.parse(nowIso);
  const windowStart = now - WINDOW_DAYS * DAY;
  const weekStart = now - 7 * DAY;
  // Events and event permits can be dated ahead. They count when they start within UPCOMING_DAYS; anything further out is not shown yet.
  const windowEnd = now + UPCOMING_DAYS * DAY;
  const weekEnd = now + 7 * DAY;

  const inWindow = rows.filter((r) => {
    const t = Date.parse(r.occurred_at);
    return t >= windowStart && t <= windowEnd;
  });
  const grouped: Partial<Record<SectionId, SectionItem[]>> = {};
  const counts: Partial<Record<SectionId, number>> = {};
  const windowCounts: Partial<Record<SectionId, number>> = {};
  const weekCounts: Partial<Record<SectionId, number>> = {};
  const pastWeekCounts: Partial<Record<SectionId, number>> = {};
  const sources = new Set<string>();

  for (const r of inWindow) {
    sources.add(r.source);
    const sec = sectionFor(r.kind, r.source, r.title, r.subtype);
    if (!sec) continue;
    windowCounts[sec] = (windowCounts[sec] ?? 0) + 1;
    if (Date.parse(r.occurred_at) >= weekStart && Date.parse(r.occurred_at) <= weekEnd) weekCounts[sec] = (weekCounts[sec] ?? 0) + 1;
    if (Date.parse(r.occurred_at) >= weekStart && !isUpcoming(r.occurred_at, now)) pastWeekCounts[sec] = (pastWeekCounts[sec] ?? 0) + 1;
    if (sec === 'alerts') {
      const exp = r.expires_at ? Date.parse(r.expires_at) : null;
      const active = exp !== null ? exp > now : Date.parse(r.occurred_at) >= now - ALERT_NO_EXPIRY_DAYS * DAY;
      if (!active) continue;
    }
    counts[sec] = (counts[sec] ?? 0) + 1;
    (grouped[sec] ??= []).push({
      id: r.id,
      source: r.source,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      url: safeUrl(r.url),
      severity: r.severity,
      occurredAt: r.occurred_at,
      expiresAt: r.expires_at,
    });
  }

  const sections: Partial<Record<SectionId, SectionItem[]>> = {};
  for (const def of SECTIONS) {
    const items = grouped[def.id];
    if (!items?.length) continue;
    // Upcoming items first (soonest first), then everything else newest first. Alerts rank by severity first.
    const ordered = orderLatest(items, (i) => i.occurredAt, now);
    if (def.id === 'alerts') ordered.sort((a, b) => b.severity - a.severity); // stable: ties keep the order above
    sections[def.id] = ordered.slice(0, limit);
  }
  for (const [k, v] of Object.entries(opts.exactSectionCounts ?? {})) {
    if (typeof v === 'number' && v >= (counts[k as SectionId] ?? 0) && k !== 'alerts') counts[k as SectionId] = v;
    if (typeof v === 'number' && v > 0 && !windowCounts[k as SectionId]) windowCounts[k as SectionId] = v;
  }

  // Rows come newest first and the query stops at a row cap. If the oldest row read is still inside the last 7 days, older rows of that
  // week may be missing, so the past-week counts are lower bounds.
  const oldestRead = rows.reduce((m, r) => Math.min(m, Date.parse(r.occurred_at)), Infinity);
  const pastWeekExact = !opts.truncated || oldestRead < weekStart;

  const times = inWindow.map((r) => Date.parse(r.occurred_at)).filter(Number.isFinite);
  return {
    ok: true,
    slug,
    asOf: nowIso,
    total: Math.max(opts.totalOverride ?? 0, inWindow.length),
    sections,
    counts,
    windowCounts,
    weekCounts,
    pastWeekCounts,
    pastWeekExact,
    weekTrades: tally(inWindow.filter((r) => Date.parse(r.occurred_at) >= weekStart && Date.parse(r.occurred_at) <= weekEnd)),
    windowTrades: tally(inWindow),
    sources: [...sources].sort(),
    earliestAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    // The newest record that has already happened: wording like "the most recent one is dated ..." must never name a future date.
    latestAt: newestPast(inWindow.map((r) => r.occurred_at), now),
  };
}
