import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchScope, type ScopeInput } from '@/lib/plan/scope';
import { approxReachMi } from '@/lib/signals/approx-location';
import { matchArea } from '@/lib/signals/match';
import { memberHasAccess } from '@/lib/contacts/load';
import { BUILDER_WINDOW_DAYS, summarizeBuilders, type ActiveBuilder, type BuilderRow } from './active';

/**
 * Builders active near one member: permits in the last 30 days inside the member's area, joined to their contractor contacts.
 * Access: the member's profile is re-read here with the same rule lib/contacts/load.ts uses (memberHasAccess); a canceled, unpaid,
 * paused or unknown account gets nothing, so the page is not the only gate.
 * Area: the database cuts a coarse box around every area (wide enough for stand-in records) PLUS permits with no coordinates in a
 * state of the member's areas; matchArea (the feed's own test, including its severity >= 2 rule for records without coordinates)
 * then decides who is really in the member's area, before anything is counted.
 * Window: permits are read newest first in pages, at most MAX_PERMITS. When the read stops at the cap, windowDays is the whole number
 * of days actually covered (minimum 1) so the UI never claims 30 days it did not read.
 * Pass the service-role client (holler_signal_contacts is service role only, migration 0006).
 * Never throws: any error gives an empty list and logs the step and the error code only.
 */

type Db = SupabaseClient;

export interface ActiveBuildersResult {
  builders: ActiveBuilder[];
  /** 30 when the read reached the 30-day cutoff; otherwise the whole days actually covered (at least 1). */
  windowDays: number;
}

/** Contact rows read at most, in total. */
export const MAX_CONTACT_ROWS = 20_000;
/** Permit records read at most (newest first), across all pages. */
export const MAX_PERMITS = 3000;
const PAGE = 1000;
const ID_CHUNK = 150;
const CHUNK_PARALLEL = 5;
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
  state: string | null;
  severity: number | null;
  occurred_at: string;
  categories: string[] | null;
  data?: { loc?: unknown } | null;
}

interface ContactRec {
  signal_id: number;
  role: string;
  name: string | null;
  phone: string | null;
}

const EMPTY = (windowDays = BUILDER_WINDOW_DAYS): ActiveBuildersResult => ({ builders: [], windowDays });

export async function loadActiveBuilders(
  db: Db,
  userId: string,
  profile: ScopeInput & { radius_mi: number },
  now: Date = new Date(),
): Promise<ActiveBuildersResult> {
  try {
    if (!db || typeof userId !== 'string' || !userId) return EMPTY();
    if (!(await memberHasAccess(db, userId, now))) return EMPTY();
    const scope = matchScope(profile);
    const areas = scope.areas.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number');
    const states = [...new Set(scope.areas.map((a) => (typeof a.state === 'string' ? a.state.trim().toUpperCase() : '')).filter((s) => /^[A-Z]{2}$/.test(s)))];
    if (areas.length === 0 && states.length === 0) return EMPTY();
    const cutoff = new Date(now.getTime() - BUILDER_WINDOW_DAYS * DAY_MS).toISOString();

    // Coarse database cut: a box around every area (wide enough for stand-in records), or no coordinates in the member's state(s).
    const clauses: string[] = [];
    if (areas.length > 0) {
      const reach = approxReachMi(Math.max(0, Number(profile.radius_mi) || 0));
      const dLat = reach / MI_PER_DEG_LAT;
      const lats = areas.map((a) => a.lat as number);
      const lons = areas.map((a) => a.lon as number);
      const cosLat = Math.max(0.2, Math.cos((Math.max(...lats.map(Math.abs)) * Math.PI) / 180));
      const dLon = reach / (MI_PER_DEG_LAT * cosLat);
      clauses.push(
        `and(lat.gte.${Math.min(...lats) - dLat},lat.lt.${Math.max(...lats) + dLat},lon.gte.${Math.min(...lons) - dLon},lon.lt.${Math.max(...lons) + dLon})`,
      );
    }
    if (states.length > 0) clauses.push(`and(lat.is.null,state.in.(${states.join(',')}))`);

    // 1. Permit records, newest first, paged, at most MAX_PERMITS.
    const sigs = new Map<number, SignalRec>();
    let fetched = 0;
    let exhausted = false;
    let oldestMs = Infinity;
    for (let from = 0; fetched < MAX_PERMITS; from += PAGE) {
      const size = Math.min(PAGE, MAX_PERMITS - fetched);
      const { data, error } = await db
        .from('holler_signals')
        .select('id, title, source, lat, lon, state, severity, occurred_at, categories, data')
        .eq('kind', 'permit')
        .gte('occurred_at', cutoff)
        .or(clauses.join(','))
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + size - 1);
      if (error) {
        logFailure('signals', error);
        return EMPTY();
      }
      if (!Array.isArray(data)) return EMPTY();
      for (const r of data as SignalRec[]) {
        sigs.set(r.id, r);
        const t = Date.parse(r.occurred_at);
        if (Number.isFinite(t) && t < oldestMs) oldestMs = t;
      }
      fetched += data.length;
      if (data.length < size) {
        exhausted = true;
        break;
      }
    }
    const windowDays = exhausted || !Number.isFinite(oldestMs) ? BUILDER_WINDOW_DAYS : Math.min(BUILDER_WINDOW_DAYS, Math.max(1, Math.floor((now.getTime() - oldestMs) / DAY_MS)));

    const profileForArea: Parameters<typeof matchArea>[1] = { ...profile, user_id: '', categories: profile.categories ?? [], radius_mi: Number(profile.radius_mi) || 0, keywords: null };
    const inArea = [...sigs.values()].filter(
      (s) =>
        matchArea(
          {
            id: s.id,
            kind: 'permit',
            categories: s.categories ?? [],
            lat: typeof s.lat === 'number' ? s.lat : null,
            lon: typeof s.lon === 'number' ? s.lon : null,
            state: s.state ?? null,
            severity: typeof s.severity === 'number' ? s.severity : 0,
            occurred_at: s.occurred_at,
            source: s.source,
            data: s.data ?? null,
          },
          profileForArea,
        ) !== null,
    );
    if (inArea.length === 0) return EMPTY(windowDays);
    const bySignal = new Map(inArea.map((s) => [s.id, s]));

    // 2. Their contractor contacts, in id chunks (a long id list does not fit in one request).
    const ids = [...bySignal.keys()];
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
    const contacts: ContactRec[] = [];
    for (let i = 0; i < chunks.length; i += CHUNK_PARALLEL) {
      const results = await Promise.all(
        chunks.slice(i, i + CHUNK_PARALLEL).map(async (chunk) => {
          const got: ContactRec[] = [];
          for (let from = 0; got.length < MAX_CONTACT_ROWS; from += PAGE) {
            const { data, error } = await db
              .from('holler_signal_contacts')
              .select('signal_id, role, name, phone')
              .in('signal_id', chunk)
              .eq('role', 'contractor')
              .order('id', { ascending: true })
              .range(from, from + PAGE - 1);
            if (error) throw Object.assign(new Error('contacts'), { step: 'contacts', cause: error });
            if (!Array.isArray(data)) throw Object.assign(new Error('contacts'), { step: 'contacts', cause: null });
            got.push(...(data as ContactRec[]));
            if (data.length < PAGE) break;
          }
          return got;
        }),
      );
      for (const r of results) contacts.push(...r);
      if (contacts.length >= MAX_CONTACT_ROWS) break;
    }
    const rows: BuilderRow[] = [];
    for (const c of contacts) {
      const s = c ? bySignal.get(c.signal_id) : undefined;
      if (!s) continue;
      rows.push({ signal_id: s.id, title: s.title, occurred_at: s.occurred_at, categories: s.categories, role: c.role, name: c.name, phone: c.phone });
    }
    return { builders: summarizeBuilders(rows, scope.categories, now), windowDays };
  } catch (e) {
    const step = e && typeof e === 'object' && (e as { step?: unknown }).step === 'contacts' ? 'contacts' : 'exception';
    logFailure(step, step === 'contacts' ? (e as { cause?: unknown }).cause : e);
    return EMPTY();
  }
}
