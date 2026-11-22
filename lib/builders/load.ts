import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchScope, type ScopeInput } from '@/lib/plan/scope';
import { approxReachMi } from '@/lib/signals/approx-location';
import { matchArea } from '@/lib/signals/match';
import { BUILDER_WINDOW_DAYS, summarizeBuilders, type ActiveBuilder, type BuilderRow } from './active';

/**
 * Builders active near one member: permits in the last 30 days inside the member's area (same area test as the feed: matchArea,
 * radius plus extra areas the plan allows), joined to their contractor contacts. Two queries, no per-row reads.
 * Pass the service-role client (holler_signal_contacts is service role only, migration 0006) and call only for a member with access.
 * Never throws: any error gives an empty list and logs the step and the error code only.
 */

type Db = SupabaseClient;

/** Contact rows read at most. */
export const MAX_CONTACT_ROWS = 2000;
/** Permit records read at most (newest first); also bounds the id list of the contacts query. */
export const MAX_PERMITS = 600;
const DAY_MS = 86_400_000;
const MI_PER_DEG_LAT = 69;

function logFailure(step: string, err: unknown): void {
  const code = err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : 'unknown';
  console.error('builders: load failed', step, code);
}

interface SignalRec {
  id: number;
  title: string | null;
  source: string | null;
  lat: number | null;
  lon: number | null;
  occurred_at: string;
  categories: string[] | null;
  data?: { loc?: unknown } | null;
}

interface ContactRec {
  signal_id: number;
  role: string;
  name: string | null;
  phone: string | null;
  website: string | null;
}

export async function loadActiveBuilders(db: Db, profile: ScopeInput & { radius_mi: number }, now: Date = new Date()): Promise<ActiveBuilder[]> {
  try {
    if (!db) return [];
    const scope = matchScope(profile);
    const areas = scope.areas.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number');
    if (areas.length === 0) return [];
    const cutoff = new Date(now.getTime() - BUILDER_WINDOW_DAYS * DAY_MS).toISOString();
    // A box around every area, wide enough for stand-in (county centre) records, so the database does the coarse cut.
    const reach = approxReachMi(Math.max(0, Number(profile.radius_mi) || 0));
    const dLat = reach / MI_PER_DEG_LAT;
    const lats = areas.map((a) => a.lat as number);
    const lons = areas.map((a) => a.lon as number);
    const minLat = Math.min(...lats) - dLat;
    const maxLat = Math.max(...lats) + dLat;
    const cosLat = Math.max(0.2, Math.cos((Math.max(...lats.map(Math.abs)) * Math.PI) / 180));
    const dLon = reach / (MI_PER_DEG_LAT * cosLat);
    const minLon = Math.min(...lons) - dLon;
    const maxLon = Math.max(...lons) + dLon;

    // 1. Permit records in the window and the box.
    const { data: sigs, error: sErr } = await db
      .from('holler_signals')
      .select('id, title, source, lat, lon, occurred_at, categories, data')
      .eq('kind', 'permit')
      .gte('occurred_at', cutoff)
      .gte('lat', minLat)
      .lt('lat', maxLat)
      .gte('lon', minLon)
      .lt('lon', maxLon)
      .order('occurred_at', { ascending: false })
      .limit(MAX_PERMITS);
    if (sErr) {
      logFailure('signals', sErr);
      return [];
    }
    if (!Array.isArray(sigs)) return [];
    const profileForArea: Parameters<typeof matchArea>[1] = { ...profile, user_id: '', categories: profile.categories ?? [], radius_mi: Number(profile.radius_mi) || 0, keywords: null };
    const inArea = (sigs as SignalRec[]).filter((s) => {
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return false;
      return (
        matchArea(
          { id: s.id, kind: 'permit', categories: s.categories ?? [], lat: s.lat, lon: s.lon, state: null, severity: 0, occurred_at: s.occurred_at, source: s.source, data: s.data ?? null },
          profileForArea,
        ) !== null
      );
    });
    if (inArea.length === 0) return [];
    const bySignal = new Map(inArea.map((s) => [s.id, s]));

    // 2. Their contractor contacts, one query.
    const { data: contacts, error: cErr } = await db
      .from('holler_signal_contacts')
      .select('signal_id, role, name, phone, website')
      .in('signal_id', [...bySignal.keys()])
      .eq('role', 'contractor')
      .order('id', { ascending: true })
      .limit(MAX_CONTACT_ROWS);
    if (cErr) {
      logFailure('contacts', cErr);
      return [];
    }
    if (!Array.isArray(contacts)) return [];
    const rows: BuilderRow[] = [];
    for (const c of contacts as ContactRec[]) {
      const s = c ? bySignal.get(c.signal_id) : undefined;
      if (!s) continue;
      rows.push({ signal_id: s.id, title: s.title, occurred_at: s.occurred_at, categories: s.categories, role: c.role, name: c.name, phone: c.phone, website: c.website });
    }
    return summarizeBuilders(rows, scope.categories, now);
  } catch (e) {
    logFailure('exception', e);
    return [];
  }
}
