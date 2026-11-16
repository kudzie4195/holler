import { WINDOW_DAYS } from './threshold';
import { sectionFor, SECTIONS, type SectionId } from './sections';

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
  /** holler_signals.data->>'subtype' (permit | 311 | inspection), when the adapter set it */
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
  return { ok, slug, asOf, total: 0, sections: {}, counts: {}, weekTrades: [], windowTrades: [], sources: [], earliestAt: null, latestAt: null };
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
  opts: { limit?: number; totalOverride?: number; exactSectionCounts?: Partial<Record<SectionId, number>> } = {},
): PlaceData {
  const limit = opts.limit ?? DEFAULT_ITEM_LIMIT;
  const now = Date.parse(nowIso);
  const windowStart = now - WINDOW_DAYS * DAY;
  const weekStart = now - 7 * DAY;

  const inWindow = rows.filter((r) => Date.parse(r.occurred_at) >= windowStart);
  const grouped: Partial<Record<SectionId, SectionItem[]>> = {};
  const counts: Partial<Record<SectionId, number>> = {};
  const sources = new Set<string>();

  for (const r of inWindow) {
    sources.add(r.source);
    const sec = sectionFor(r.kind, r.source, r.title, r.subtype);
    if (!sec) continue;
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
    items.sort((a, b) => {
      if (def.id === 'alerts' && b.severity !== a.severity) return b.severity - a.severity;
      return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    });
    sections[def.id] = items.slice(0, limit);
  }
  for (const [k, v] of Object.entries(opts.exactSectionCounts ?? {})) {
    if (typeof v === 'number' && v >= (counts[k as SectionId] ?? 0) && k !== 'alerts') counts[k as SectionId] = v;
  }

  const times = inWindow.map((r) => Date.parse(r.occurred_at)).filter(Number.isFinite);
  return {
    ok: true,
    slug,
    asOf: nowIso,
    total: Math.max(opts.totalOverride ?? 0, inWindow.length),
    sections,
    counts,
    weekTrades: tally(inWindow.filter((r) => Date.parse(r.occurred_at) >= weekStart)),
    windowTrades: tally(inWindow),
    sources: [...sources].sort(),
    earliestAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    latestAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}
