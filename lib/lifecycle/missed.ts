import type { SupabaseClient } from '@supabase/supabase-js';
import { matchOne, type MatchSignal } from '../signals/match';
import { expandCategoriesForRouting } from '../signals/permit-routing';
import { matchScope, type ScopeInput } from '../plan';
import { HOLLER_REQUEST_SOURCE } from '../signals/request-visibility';
import { APPROX_LOCATION_SOURCES, approxReachMi } from '../signals/approx-location';
import { FOLLOWUP_SIGNAL_SELECT, followupDrop, followupFilterEnabled } from '../signals/followup-filter';

/**
 * Trial-ended: how many new public records matched this member's trades and area since the trial ended. A real count or an error, never a guess.
 * The scanner stops matching a member once the trial is over (store.ts canSeeAlerts), so holler_matches has nothing for this window;
 * the count reads holler_signals directly and runs each row through the same matchOne the scanner uses, the way lib/preview/recent.ts
 * does for its 90-day count. Same three queries (a box around each allowed area; state-level rows at severity 2 or more; rows from the
 * approximate-location sources (Cobb County) in a box of radius + 15 miles, the scanner's reach for them), same exclusions
 * (resident requests and kind 'ask' never counted). Columns read: id, source, kind, title, summary, categories, lat, lon, state, severity,
 * occurred_at, data->>subtype, data->>projectOf (followers are skipped), data->>permitStage. Title, summary and stage only feed the label,
 * as at match time (round 19 RULES review P3 item 15); nothing read here is shown. No contacts.
 */
export const MISSED_ROW_CAP = 1000;
const MI_PER_DEG = 68.5;
// projectOf: a follower (a second listing of a project, lib/signals/projects.ts) never makes a card, so it is not counted either.
const COLUMNS = 'id,source,kind,title,summary,state,lat,lon,categories,severity,occurred_at,subtype:data->>subtype,projectOf:data->>projectOf,permitStage:data->>permitStage';

export interface MissedProfile extends ScopeInput {
  radius_mi: number | null;
}

interface Row {
  id: number | string;
  source: string;
  kind: string;
  title?: string | null;
  /** The summary and the stage update feed the label as they do at match time (review P3 item 15). */
  summary?: string | null;
  permitStage?: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  categories: string[] | null;
  severity: number | null;
  occurred_at: string;
  subtype: string | null;
  projectOf?: string | null;
  /** Round 35 (FOLLOWUP_SIGNAL_SELECT, read only while the follow-up filter is on). */
  expires_at?: string | null;
  dueDate?: string | null;
  retiredAt?: string | null;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function box(lat: number, lon: number, radius: number): string {
  const dLat = radius / MI_PER_DEG;
  const dLon = radius / (MI_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const f = (n: number) => n.toFixed(4);
  return `and(lat.gte.${f(lat - dLat)},lat.lte.${f(lat + dLat)},lon.gte.${f(lon - dLon)},lon.lte.${f(lon + dLon)})`;
}

/** Throws when the database cannot be read. Returns count 0 when the member has no usable area or trades. */
export async function missedSince(
  db: Pick<SupabaseClient, 'from'>,
  profile: MissedProfile,
  since: Date,
  now: Date,
): Promise<{ count: number; capped: boolean }> {
  const radius = isNum(profile.radius_mi) && profile.radius_mi > 0 ? profile.radius_mi : null;
  const scope = matchScope(profile);
  const located = scope.areas.filter((a) => isNum(a.lat) && isNum(a.lon));
  if (!radius || located.length === 0 || scope.categories.length === 0) return { count: 0, capped: false };
  const states = [...new Set(scope.areas.map((a) => a.state?.toUpperCase()).filter((s): s is string => !!s))];

  // Round 35: with the follow-up filter on, a retired hand-added bid and a bid whose date has passed are not counted either (matchOne already
  // applies the bid and E-Rate switches). Off, the select is COLUMNS and the count is what it was.
  const filter = followupFilterEnabled();
  const columns: string = filter ? `${COLUMNS},${FOLLOWUP_SIGNAL_SELECT.replace(/, /g, ',')}` : COLUMNS;
  const base = () =>
    db
      .from('holler_signals')
      .select(columns)
      .neq('source', HOLLER_REQUEST_SOURCE)
      .neq('kind', 'ask')
      .overlaps('categories', expandCategoriesForRouting(scope.categories))
      .gte('occurred_at', since.toISOString())
      .lte('occurred_at', now.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(MISSED_ROW_CAP);

  const approxSources = [...APPROX_LOCATION_SOURCES];
  const [a, b, c] = await Promise.all([
    base().not('lat', 'is', null).or(located.map((x) => box(x.lat as number, x.lon as number, radius)).join(',')),
    states.length > 0 ? base().is('lat', null).gte('severity', 2).in('state', states) : Promise.resolve({ data: [] as unknown[], error: null }),
    // Cobb County rows sit at a stand-in point; the scanner matches them within radius + 15 miles of it (matchOne), past the box above.
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
  const capped = rowsA.length >= MISSED_ROW_CAP || rowsB.length >= MISSED_ROW_CAP || rowsC.length >= MISSED_ROW_CAP;

  const mp = {
    user_id: 'lifecycle',
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
  const seen = new Set<string>();
  let count = 0;
  for (const r of [...rowsA, ...rowsB, ...rowsC]) {
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (r.source === HOLLER_REQUEST_SOURCE || r.kind === 'ask' || r.projectOf) continue;
    if (filter && followupDrop(r, { nowMs: now.getTime() })) continue;
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
      // Title and kind feed the opportunity label: a context row is not an alert, so it is not counted as missed.
      kind: r.kind,
      title: r.title ?? null,
      summary: r.summary ?? null,
      data: { permitStage: r.permitStage ?? null },
    };
    if (matchOne(sig, mp)) count++;
  }
  return { count, capped };
}
