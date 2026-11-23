import type { SupabaseClient } from '@supabase/supabase-js';
import { intentOf, type Intent } from '@/lib/signals/intent';
import { effectiveTier, matchScope } from '@/lib/plan';

/**
 * Training log (migration 0015, holler_alert_log): one row per match with coarse facts only.
 * No titles, summaries, addresses or free text ever go in: every text field is a short machine token or null.
 */
type Db = Pick<SupabaseClient, 'from'>;

export type DistanceBucket = '0-5' | '5-15' | '15-30' | '30+';

export interface AlertLogRow {
  user_id: string;
  signal_id: number;
  source?: string | null;
  kind?: string | null;
  subtype?: string | null;
  trade?: string | null;
  distance_mi?: number | null;
  severity?: number | null;
  plan?: string | null;
  /** Computed from source, kind and subtype when absent. */
  intent?: Intent | null;
}

const TOKEN = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
const CHUNK = 500;

function token(v: unknown): string | null {
  return typeof v === 'string' && TOKEN.test(v) ? v : null;
}

export function distanceBucket(mi: number | null | undefined): DistanceBucket | null {
  if (typeof mi !== 'number' || !Number.isFinite(mi) || mi < 0) return null;
  if (mi < 5) return '0-5';
  if (mi < 15) return '5-15';
  if (mi < 30) return '15-30';
  return '30+';
}

/** The database row for one input, or null when it has no usable user or signal. Pure. */
export function toLogRecord(r: AlertLogRow): Record<string, unknown> | null {
  if (!r || typeof r.user_id !== 'string' || !r.user_id) return null;
  if (!Number.isSafeInteger(r.signal_id) || r.signal_id <= 0) return null;
  const source = token(r.source);
  const kind = token(r.kind);
  const subtype = token(r.subtype);
  const intent = r.intent ?? intentOf({ kind: kind ?? '', subtype, source: source ?? '' });
  return {
    user_id: r.user_id,
    signal_id: r.signal_id,
    source,
    kind,
    subtype,
    intent,
    trade: token(r.trade),
    distance_bucket: distanceBucket(r.distance_mi),
    severity: typeof r.severity === 'number' && r.severity >= 1 && r.severity <= 3 ? Math.round(r.severity) : null,
    plan: r.plan === 'pro' || r.plan === 'starter' ? r.plan : null,
  };
}

/** Writes the rows (a repeat of a member and signal is ignored). NEVER throws: any failure, including a missing table, returns 0. */
export async function logAlerts(db: Db, rows: AlertLogRow[]): Promise<number> {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    const records = rows.map((r) => toLogRecord(r)).filter((r): r is Record<string, unknown> => r !== null);
    let n = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      try {
        const { data, error } = await db
          .from('holler_alert_log')
          .upsert(records.slice(i, i + CHUNK), { onConflict: 'user_id,signal_id', ignoreDuplicates: true })
          .select('id');
        if (!error) n += data?.length ?? 0;
      } catch {
        // one bad batch never stops the next
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/** Stamps emailed_at on the log rows of alerts just emailed. Never throws. */
export async function markAlertsEmailed(db: Db, userId: string, signalIds: number[], at: Date = new Date()): Promise<void> {
  try {
    const ids = signalIds.filter((n) => Number.isSafeInteger(n) && n > 0);
    for (let i = 0; i < ids.length; i += 200) {
      try {
        await db
          .from('holler_alert_log')
          .update({ emailed_at: at.toISOString() })
          .eq('user_id', userId)
          .in('signal_id', ids.slice(i, i + 200))
          .is('emailed_at', null);
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }
}

interface LogSignal {
  id: number;
  source?: string | null;
  kind?: string | null;
  subtype?: string | null;
  categories?: string[] | null;
  severity?: number | null;
}
interface LogProfile {
  user_id: string;
  categories: string[];
  lat: number | null;
  lon: number | null;
  state: string | null;
  plan?: string | null;
  subscription_status?: string | null;
  extra_areas?: unknown;
  keywords?: string[] | null;
}

/**
 * Builds log rows for new matches. Trade = the first category of the signal that is among the member's allowed trades (null for a
 * keyword-only match). Plan = the tier in force right now. Never throws.
 */
export function alertLogRowsFor(
  matches: Array<{ user_id: string; signal_id: number; distance_mi: number | null }>,
  signals: LogSignal[],
  profiles: LogProfile[],
): AlertLogRow[] {
  try {
    const sig = new Map(signals.map((s) => [s.id, s]));
    const scopes = new Map<string, { trades: string[]; plan: string }>();
    for (const p of profiles) {
      try {
        scopes.set(p.user_id, { trades: matchScope(p as Parameters<typeof matchScope>[0]).categories, plan: effectiveTier(p) });
      } catch {
        scopes.set(p.user_id, { trades: [], plan: 'starter' });
      }
    }
    const out: AlertLogRow[] = [];
    for (const m of matches) {
      const s = sig.get(m.signal_id);
      if (!s) continue;
      const sc = scopes.get(m.user_id);
      const trade = sc ? ((s.categories ?? []).find((c) => sc.trades.includes(c)) ?? null) : null;
      out.push({
        user_id: m.user_id,
        signal_id: m.signal_id,
        source: s.source ?? null,
        kind: s.kind ?? null,
        subtype: s.subtype ?? null,
        trade,
        distance_mi: m.distance_mi,
        severity: s.severity ?? null,
        plan: sc?.plan ?? null,
      });
    }
    return out;
  } catch {
    return [];
  }
}
