import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTE_MAX_CHARS } from './note-rules';

/**
 * Reads for the feed and the digest. No model call: everything comes from holler_signal_ai rows the cron AI step stored.
 * holler_signal_ai is service-role only, so pass the admin client. Any error (missing table, network) gives an empty map and the
 * caller renders exactly as before.
 */

type Db = SupabaseClient;

const CHUNK = 200;

interface AiRow {
  signal_id: number;
  trades: Record<string, unknown> | null;
  notes: Record<string, unknown> | null;
}

async function loadRows(db: Db, signalIds: number[]): Promise<AiRow[]> {
  const ids = [...new Set(signalIds.filter((n) => Number.isInteger(n)))];
  const out: AiRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from('holler_signal_ai').select('signal_id,trades,notes').in('signal_id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as AiRow[]));
  }
  return out;
}

function conf(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/** Last line of defense at read time: the note was checked when it was written; this only refuses anything odd. */
function safeNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > NOTE_MAX_CHARS) return null;
  if (/[\r\n<>@]|https?:|www\.|:\/\/|[\u2013\u2014]/i.test(t)) return null;
  return t;
}

/**
 * One "why this matters" line per signal, for the member's best-matching trade: of the member's trades that have a note, the one the
 * model was most confident about (ties: the member's own trade order). Signals without such a note are absent from the map.
 */
export async function notesFor(db: Db, signalIds: number[], trades: string[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (signalIds.length === 0 || trades.length === 0) return out;
  try {
    for (const r of await loadRows(db, signalIds)) {
      const notes = r.notes && typeof r.notes === 'object' ? r.notes : {};
      const tr = r.trades && typeof r.trades === 'object' ? r.trades : {};
      let best: { note: string; p: number } | null = null;
      for (const t of trades) {
        const note = safeNote(notes[t]);
        if (!note) continue;
        const p = conf(tr[t]) ?? 0;
        if (!best || p > best.p) best = { note, p };
      }
      if (best) out.set(Number(r.signal_id), best.note);
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * Model confidence for the member's best trade, per signal. A signal the model classified but gave none of the member's trades
 * scores 0. Signals without a stored result, or with an empty one, are absent (rankSignals treats them as 0.5).
 */
export async function scoresFor(db: Db, signalIds: number[], trades: string[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (signalIds.length === 0 || trades.length === 0) return out;
  try {
    for (const r of await loadRows(db, signalIds)) {
      const tr = r.trades && typeof r.trades === 'object' ? r.trades : {};
      if (Object.keys(tr).length === 0) continue;
      let best = 0;
      for (const t of trades) best = Math.max(best, conf(tr[t]) ?? 0);
      out.set(Number(r.signal_id), best);
    }
    return out;
  } catch {
    return new Map();
  }
}

export const RANK_WEIGHTS = { confidence: 0.6, severity: 0.25, recency: 0.15 } as const;
export const UNKNOWN_CONFIDENCE = 0.5;
export const RECENCY_WINDOW_MS = 14 * 86_400_000;

/**
 * Deterministic ranking, no model call.
 *
 *   score = 0.60 * c + 0.25 * s + 0.15 * r
 *   c = scores.get(id), the model's confidence for the member's best trade (0.5 when unknown)
 *   s = (severity - 1) / 2, severity clamped to 1..3 (null counts as 1), so 1 -> 0, 2 -> 0.5, 3 -> 1
 *   r = 1 - (newest - occurred_at) / 14 days, clamped to 0..1, where newest is the latest occurred_at in the list
 *       (relative to the list itself, so the same input always gives the same order; an unreadable date gives 0)
 *
 * Highest score first. Equal scores keep their input order (stable sort).
 */
export function rankSignals<T extends { id: number; severity: number | null; occurred_at: string }>(items: T[], scores: Map<number, number>): T[] {
  const times = items.map((it) => Date.parse(it.occurred_at));
  const valid = times.filter((t) => Number.isFinite(t));
  const newest = valid.length ? Math.max(...valid) : 0;
  const scored = items.map((it, i) => {
    const raw = scores.get(it.id);
    const c = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : UNKNOWN_CONFIDENCE;
    const sevN = typeof it.severity === 'number' && Number.isFinite(it.severity) ? Math.min(3, Math.max(1, it.severity)) : 1;
    const s = (sevN - 1) / 2;
    const t = times[i];
    const r = Number.isFinite(t) ? Math.min(1, Math.max(0, 1 - (newest - t) / RECENCY_WINDOW_MS)) : 0;
    const score = RANK_WEIGHTS.confidence * c + RANK_WEIGHTS.severity * s + RANK_WEIGHTS.recency * r;
    return { it, i, score: Math.round(score * 1e9) / 1e9 };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((x) => x.it);
}
