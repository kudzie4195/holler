import { missingHoldColumn } from '@/lib/signals/alert-gate';
import { isPermitRecord } from '@/lib/signals/permit-routing';
import { getSourceMeta } from '@/lib/signals/source-meta';
import type { Db } from '@/lib/signals/store';
import { readPagesCapped } from './quality-load';

/**
 * Round 18 integration (Part B item 4): a source whose permit cards are mostly held as Background by the contact gate (round 18 ROUTES,
 * lib/signals/alert-gate.ts: a permit card with no named business and no job-site street address is feed-only). Most often the source's
 * site-address field is empty or no longer read, so the owner gets one line per such source in the daily health email and on the quality
 * dashboard: "DeKalb permits: 92% held for no contact path, check the site-address field".
 *
 * Counted per permit record (a card), not per member: the contact path belongs to the record, so a record is held for every member or for
 * none. Of the permit records of one source that were alert-eligible in the last 7 days (alerted to at least one member, holler_alert_log,
 * or held as 'background' for at least one member, holler_matches.alert_hold), the share held as background.
 *
 * Silent (no line) when:
 *  - the gate is off: migration 0027 is not applied (holler_matches.alert_hold missing, PGRST204 / 42703, or the table missing);
 *  - a source has fewer than HELD_MIN_CARDS such permit cards in the window;
 *  - the share is HELD_SHARE_FLAG (80%) or less;
 *  - any read fails (status 'unavailable': the dashboard says so, the health email says nothing).
 * READ ONLY: selects only.
 */
export const HELD_PERMIT_WINDOW_DAYS = 7;
/** More than this share held flags the source. */
export const HELD_SHARE_FLAG = 0.8;
/** Fewer permit cards than this in the window: no line (too few to judge). */
export const HELD_MIN_CARDS = 10;

export interface HeldSourceRow {
  source: string;
  /** Alert-eligible permit records of this source in the window (alerted or held as background). */
  cards: number;
  /** Of those, held as background by the contact gate. */
  held: number;
  share: number;
}

export interface HeldPermitReport {
  windowDays: number;
  since: string;
  /** 'off': the contact gate is off (0027 not applied), nothing to report. 'unavailable': a read failed. */
  status: 'ok' | 'off' | 'unavailable';
  /** Every source with at least one alert-eligible permit card, most held first. */
  sources: HeldSourceRow[];
  /** The owner lines, one per flagged source (more than 80% held, at least 10 cards). Empty when status is not 'ok'. */
  lines: string[];
}

export interface HeldSignal {
  id: number;
  source: string;
  kind: string | null;
  subtype: string | null;
}

/** "DeKalb County open data: building permits" -> "DeKalb County permits"; "Chicago open data: building permits" -> "Chicago permits". */
export function sourcePermitName(source: string): string {
  const label = getSourceMeta(source)?.label;
  const place = label ? label.split(/\s+(?:open data|Open Data|ArcGIS|Socrata)\b|:/)[0].trim() : '';
  return place ? `${place} permits` : source;
}

export function heldLine(r: HeldSourceRow): string {
  return `${sourcePermitName(r.source)}: ${Math.round(r.share * 100)}% held for no contact path, check the site-address field`;
}

export function buildHeldPermitReport(input: {
  now: Date;
  heldSignalIds: readonly number[];
  alertedSignalIds: readonly number[];
  signals: readonly HeldSignal[];
}): HeldPermitReport {
  const since = new Date(input.now.getTime() - HELD_PERMIT_WINDOW_DAYS * 86_400_000).toISOString();
  const sig = new Map(input.signals.map((s) => [s.id, s]));
  const held = new Set(input.heldSignalIds);
  const counts = new Map<string, { cards: number; held: number }>();
  for (const id of new Set([...input.heldSignalIds, ...input.alertedSignalIds])) {
    const s = sig.get(id);
    if (!s || !isPermitRecord({ source: s.source, kind: s.kind, subtype: s.subtype })) continue;
    const c = counts.get(s.source) ?? { cards: 0, held: 0 };
    c.cards++;
    if (held.has(id)) c.held++;
    counts.set(s.source, c);
  }
  const sources = [...counts]
    .map(([source, c]) => ({ source, cards: c.cards, held: c.held, share: c.held / c.cards }))
    .sort((a, b) => b.share - a.share || b.cards - a.cards || a.source.localeCompare(b.source));
  const lines = sources.filter((r) => r.cards >= HELD_MIN_CARDS && r.share > HELD_SHARE_FLAG).map(heldLine);
  return { windowDays: HELD_PERMIT_WINDOW_DAYS, since, status: 'ok', sources, lines };
}

const CHUNK = 150;
const MAX_PAGES = 10;

/** Reads the window's held matches, alert-log rows and their signals (selects only). Never throws. */
export async function loadHeldPermitReport(db: Pick<Db, 'from'>, now: Date): Promise<HeldPermitReport & { partial?: boolean }> {
  const since = new Date(now.getTime() - HELD_PERMIT_WINDOW_DAYS * 86_400_000).toISOString();
  const empty = (status: 'off' | 'unavailable'): HeldPermitReport => ({ windowDays: HELD_PERMIT_WINDOW_DAYS, since, status, sources: [], lines: [] });
  try {
    // The gate is on only with migration 0027 (the same probe as lib/signals/store.ts contactGateOn).
    const probe = await db.from('holler_matches').select('alert_hold').limit(1);
    if (probe.error) return empty(missingHoldColumn(probe.error) || /PGRST205|42P01/.test(String(probe.error.code ?? '')) ? 'off' : 'unavailable');
    const heldRead = await readPagesCapped<{ signal_id: number }>(
      (from, to) =>
        db.from('holler_matches').select('signal_id').eq('alert_hold', 'background').gte('created_at', since).order('id', { ascending: false }).range(from, to),
      MAX_PAGES,
    );
    // A permit record is kind 'permit' or subtype 'permit' (lib/signals/permit-routing.ts isPermitRecord): two reads, joined.
    const alertReads = await Promise.all(
      (['kind', 'subtype'] as const).map((col) =>
        readPagesCapped<{ signal_id: number | null }>(
          (from, to) => db.from('holler_alert_log').select('signal_id').eq(col, 'permit').gte('created_at', since).order('id', { ascending: false }).range(from, to),
          MAX_PAGES,
        ),
      ),
    );
    const heldIds = [...new Set(heldRead.rows.map((r) => r.signal_id).filter((n): n is number => typeof n === 'number'))];
    const alertedIds = [...new Set(alertReads.flatMap((r) => r.rows).map((r) => r.signal_id).filter((n): n is number => typeof n === 'number'))];
    const ids = [...new Set([...heldIds, ...alertedIds])];
    const signals: HeldSignal[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const s = await db.from('holler_signals').select('id, source, kind, subtype:data->>subtype').in('id', ids.slice(i, i + CHUNK));
      if (s.error) return empty('unavailable');
      signals.push(...((s.data ?? []) as unknown as HeldSignal[]));
    }
    const report = buildHeldPermitReport({ now, heldSignalIds: heldIds, alertedSignalIds: alertedIds, signals });
    return heldRead.partial || alertReads.some((r) => r.partial) ? { ...report, partial: true } : report;
  } catch {
    return empty('unavailable');
  }
}
