import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { intentOf, type Intent } from '@/lib/signals/intent';
import { matchOne, subtypeOf, type MatchSignal } from '@/lib/signals/match';
import { matchScope, type ScopeInput } from '@/lib/plan';
import { withoutHiddenBids } from '@/lib/signals/bid-sources';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';
import { RETENTION_DAYS } from '@/lib/signals/store';
import { APPROX_LOCATION_SOURCES, approxReachMi } from '@/lib/signals/approx-location';

/**
 * "Near you in the last 90 days": how many real records in holler_signals would have matched this member's saved area and trades.
 * Retention is 120 days (RETENTION_DAYS), so 90 days is always inside the data.
 *
 * Three queries, run together, no per-row database calls:
 *   A. records with coordinates inside a box around each allowed area, sharing a trade with the member
 *   B. records without coordinates (state level), severity 2 or more, in a state the member covers, sharing a trade
 *   C. records from the approximate-location sources (Cobb County: the point is a stand-in) inside a box of radius + 15 miles, the
 *      scanner's reach for them (lib/signals/approx-location.ts approxReachMi)
 * Each row then goes through the same matchOne the scanner uses (exact distance, exact state rule, plan limits), so the count is what the
 * member's feed would have held. Resident requests (source holler-request) and kind 'ask' are left out: both can carry a person's words.
 * Keyword watches are not counted (the preview is about the saved area and trades).
 *
 * Columns read: id, source, kind, title, city, state, lat, lon, categories, severity, occurred_at, data->>subtype. Never summary, url,
 * zip, county, data or anything from holler_signal_contacts. Titles are the public, already scrubbed titles.
 *
 * Each query returns at most 1000 rows (PostgREST cap). When a query hits the cap, `capped` is true and the counts are a floor, never a
 * guess: the component says "at least".
 */

export const PREVIEW_DAYS = 90;
export const PREVIEW_ROW_CAP = 1000;
export const PREVIEW_EXAMPLES = 5;
export const PREVIEW_COLUMNS =
  'id,source,kind,title,city,state,lat,lon,categories,severity,occurred_at,subtype:data->>subtype';

// ---- type labels ------------------------------------------------------------------------------------------------------------
const TYPE_LABELS: Record<string, { one: string; many: string }> = {
  'storm-report': { one: 'storm report', many: 'storm reports' },
  'weather-alert': { one: 'weather alert', many: 'weather alerts' },
  disaster: { one: 'disaster declaration', many: 'disaster declarations' },
  quake: { one: 'earthquake', many: 'earthquakes' },
  airport: { one: 'airport delay', many: 'airport delays' },
  permit: { one: 'building permit', many: 'building permits' },
  '311': { one: '311 request', many: '311 requests' },
  inspection: { one: 'failed health inspection', many: 'failed health inspections' },
  business: { one: 'new business license', many: 'new business licenses' },
  violation: { one: 'code violation', many: 'code violations' },
  event: { one: 'big event', many: 'big events' },
  'event-permit': { one: 'city event permit', many: 'city event permits' },
  contract: { one: 'federal contract award', many: 'federal contract awards' },
  'federal-bid': { one: 'open federal bid', many: 'open federal bids' },
  other: { one: 'other public record', many: 'other public records' },
};

/** The record type key: data.subtype when it names a known type, else the kind. */
export function typeKeyOf(s: { kind: string; subtype?: string | null; source?: string | null }): string {
  if (s.kind === 'contract' && s.source === 'sam-gov') return 'federal-bid'; // an open solicitation, not an award
  if (s.subtype && TYPE_LABELS[s.subtype]) return s.subtype;
  switch (s.kind) {
    case 'report':
      return 'storm-report';
    case 'alert':
      return 'weather-alert';
    case 'disaster':
    case 'quake':
    case 'permit':
    case 'contract':
    case 'event':
      return s.kind;
    case 'travel':
      return 'airport';
    default:
      return 'other';
  }
}

export function typeLabel(key: string, count: number): string {
  const l = TYPE_LABELS[key] ?? TYPE_LABELS.other;
  return count === 1 ? l.one : l.many;
}

// ---- result -----------------------------------------------------------------------------------------------------------------
export interface TypeCount {
  key: string;
  count: number;
}
export interface PreviewExample {
  title: string;
  city: string | null;
  state: string | null;
  /** ISO date, YYYY-MM-DD */
  date: string;
}
export interface RecentPreview {
  total: number;
  byIntent: Record<Intent, number>;
  /** Biggest first; zero counts are never included. */
  byType: TypeCount[];
  examples: PreviewExample[];
  /** True when a query hit the row cap, so the counts are a floor. */
  capped: boolean;
}

/** What the preview needs from a profile. A subset of the Profile row. */
export interface PreviewProfile extends ScopeInput {
  radius_mi: number | null;
}

interface Row {
  id: number | string;
  source: string;
  kind: string;
  title: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  categories: string[] | null;
  severity: number | null;
  occurred_at: string;
  subtype: string | null;
}

const MI_PER_DEG = 68.5; // a little under the true 69.09, so the box is never smaller than the circle

function box(lat: number, lon: number, radius: number): string {
  const dLat = radius / MI_PER_DEG;
  const dLon = radius / (MI_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const f = (n: number) => n.toFixed(4);
  return `and(lat.gte.${f(lat - dLat)},lat.lte.${f(lat + dLat)},lon.gte.${f(lon - dLon)},lon.lte.${f(lon + dLon)})`;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Count what would have matched. Returns null when the member has no usable area or no trades (nothing to match against), and when
 * the database cannot be read (never a made-up number). `db` and `now` are for tests.
 */
export async function recentPreviewFor(
  profile: PreviewProfile,
  opts: { db?: SupabaseClient; now?: Date } = {},
): Promise<RecentPreview | null> {
  const radius = isNum(profile.radius_mi) && profile.radius_mi > 0 ? profile.radius_mi : null;
  const scope = matchScope(profile);
  const located = scope.areas.filter((a) => isNum(a.lat) && isNum(a.lon));
  if (!radius || located.length === 0 || scope.categories.length === 0) return null;

  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - Math.min(PREVIEW_DAYS, RETENTION_DAYS) * 86_400_000).toISOString();
  const states = [...new Set(scope.areas.map((a) => a.state?.toUpperCase()).filter((s): s is string => !!s))];

  try {
    const db = opts.db ?? createAdminClient();
    const base = () =>
      db
        .from('holler_signals')
        .select(PREVIEW_COLUMNS)
        .neq('source', HOLLER_REQUEST_SOURCE)
        .neq('kind', 'ask')
        .overlaps('categories', scope.categories)
        .gte('occurred_at', since)
        .lte('occurred_at', now.toISOString())
        .order('occurred_at', { ascending: false })
        .limit(PREVIEW_ROW_CAP);

    const approxSources = [...APPROX_LOCATION_SOURCES];
    const [a, b, c] = await Promise.all([
      base().not('lat', 'is', null).or(located.map((x) => box(x.lat as number, x.lon as number, radius)).join(',')),
      states.length > 0
        ? base().is('lat', null).gte('severity', 2).in('state', states)
        : Promise.resolve({ data: [] as unknown[], error: null }),
      approxSources.length > 0
        ? base()
            .in('source', approxSources)
            .not('lat', 'is', null)
            .or(located.map((x) => box(x.lat as number, x.lon as number, approxReachMi(radius))).join(','))
        : Promise.resolve({ data: [] as unknown[], error: null }),
    ]);
    if (a.error || b.error || c.error) throw new Error((a.error ?? b.error ?? c.error)?.message ?? 'query failed');

    const rowsA = (a.data ?? []) as unknown as Row[];
    const rowsB = (b.data ?? []) as unknown as Row[];
    const rowsC = (c.data ?? []) as unknown as Row[];
    const capped = rowsA.length >= PREVIEW_ROW_CAP || rowsB.length >= PREVIEW_ROW_CAP || rowsC.length >= PREVIEW_ROW_CAP;

    const mp = {
      user_id: 'preview',
      categories: profile.categories ?? [],
      lat: profile.lat,
      lon: profile.lon,
      state: profile.state,
      radius_mi: radius,
      plan: profile.plan ?? null,
      subscription_status: profile.subscription_status ?? null,
      extra_areas: profile.extra_areas,
      keywords: null,
    };
    const byIntent: Record<Intent, number> = { demand: 0, spending: 0, asking: 0 };
    const types = new Map<string, number>();
    const hits: Row[] = [];
    const seen = new Set<string>();
    for (const r of withoutHiddenBids([...rowsA, ...rowsB, ...rowsC], now.getTime())) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (r.source === HOLLER_REQUEST_SOURCE || r.kind === 'ask') continue;
      const sig: MatchSignal = {
        id: Number(r.id),
        categories: r.categories ?? [],
        lat: r.lat,
        lon: r.lon,
        state: r.state,
        severity: r.severity ?? 1,
        occurred_at: r.occurred_at,
        subtype: r.subtype,
        // The source tells matchOne a Cobb row's point is a stand-in (radius + 15 miles, as the scanner).
        source: r.source,
        // Title and kind feed the opportunity label: context rows are not alerts, so the preview does not count them.
        kind: r.kind,
        title: r.title ?? null,
      };
      if (!matchOne(sig, mp)) continue;
      const sub = subtypeOf(sig);
      byIntent[intentOf({ kind: r.kind, subtype: sub, source: r.source })]++;
      const key = typeKeyOf({ kind: r.kind, subtype: sub, source: r.source });
      types.set(key, (types.get(key) ?? 0) + 1);
      hits.push(r);
    }

    hits.sort((x, y) => (x.occurred_at < y.occurred_at ? 1 : x.occurred_at > y.occurred_at ? -1 : 0));
    const examples: PreviewExample[] = [];
    for (const r of hits) {
      if (examples.length >= PREVIEW_EXAMPLES) break;
      const title = (r.title ?? '').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      examples.push({ title, city: r.city?.trim() || null, state: r.state?.trim() || null, date: r.occurred_at.slice(0, 10) });
    }

    return {
      total: hits.length,
      byIntent,
      byType: [...types.entries()].map(([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count || x.key.localeCompare(y.key)),
      examples,
      capped,
    };
  } catch (e) {
    console.error('[preview] recent activity failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}
