import type { CategoryId } from '@/lib/signals/categories';
import { isAlertLabel, labelFor } from '@/lib/signals/lead-rules';
import { contactPathOf, type ContactLike } from '@/lib/signals/alert-gate';
import type { Db } from '@/lib/signals/store';
import { KEYWORD_TRADE, type AlertRow } from './quality';
import { readPagesCapped } from './quality-load';

/**
 * Quality dashboard line (round 18 ROUTES): of the cards ALERTED in the last 7 days, the share that had a contact path (a named business,
 * or a job-site street address: lib/signals/alert-gate.ts contactPathOf), per trade. "Alerted" = a holler_alert_log row created in the
 * window whose label for that trade is Act now or Coming soon (feed-only cards are not logged as alerts since round 18). Every kind of
 * record counts, not only permits: the line shows how often an alert tells the member who to call or where to go.
 * READ ONLY. Pure builder plus a loader of selects; a failed read is 'unavailable' (blank), never zero.
 */
export const CONTACT_PATH_WINDOW_DAYS = 7;

export interface ContactPathSignal {
  id: number;
  source: string;
  kind: string | null;
  title: string | null;
  summary: string | null;
  subtype: string | null;
  /** data->>permitStage: passed to the labeller only (round 19 integration). */
  permitStage?: string | null;
}

export interface ContactPathRow {
  trade: string;
  alerted: number;
  withPath: number;
  /** withPath / alerted, or null when nothing was alerted. */
  share: number | null;
}

export interface ContactPathReport {
  windowDays: number;
  since: string;
  status: 'ok' | 'unavailable';
  all: ContactPathRow;
  trades: ContactPathRow[];
}

const row = (trade: string, alerted: number, withPath: number): ContactPathRow => ({ trade, alerted, withPath, share: alerted > 0 ? withPath / alerted : null });

export function buildContactPathReport(input: {
  now: Date;
  alerts: readonly AlertRow[];
  signals: readonly ContactPathSignal[];
  contacts: readonly (ContactLike & { signal_id: number })[];
}): ContactPathReport {
  const nowMs = input.now.getTime();
  const sinceMs = nowMs - CONTACT_PATH_WINDOW_DAYS * 86_400_000;
  const sig = new Map(input.signals.map((s) => [s.id, s]));
  const bySignal = new Map<number, ContactLike[]>();
  for (const c of input.contacts) bySignal.set(c.signal_id, [...(bySignal.get(c.signal_id) ?? []), c]);
  const counts = new Map<string, { alerted: number; withPath: number }>();
  let alerted = 0;
  let withPath = 0;
  for (const a of input.alerts) {
    const t = Date.parse(a.created_at);
    if (!Number.isFinite(t) || t < sinceMs || t > nowMs || typeof a.signal_id !== 'number') continue;
    const s = sig.get(a.signal_id);
    if (!s) continue;
    const label = labelFor({ source: s.source, kind: s.kind, subtype: s.subtype ?? a.subtype, title: s.title, summary: s.summary, permitStage: s.permitStage ?? undefined }, (a.trade ?? null) as CategoryId | null);
    if (!isAlertLabel(label)) continue;
    const has = contactPathOf(bySignal.get(s.id), s.summary) !== null;
    const trade = a.trade ?? KEYWORD_TRADE;
    const c = counts.get(trade) ?? { alerted: 0, withPath: 0 };
    c.alerted++;
    if (has) c.withPath++;
    counts.set(trade, c);
    alerted++;
    if (has) withPath++;
  }
  return {
    windowDays: CONTACT_PATH_WINDOW_DAYS,
    since: new Date(sinceMs).toISOString(),
    status: 'ok',
    all: row('all trades', alerted, withPath),
    trades: [...counts].map(([t, c]) => row(t, c.alerted, c.withPath)).sort((x, y) => y.alerted - x.alerted || x.trade.localeCompare(y.trade)),
  };
}

const CHUNK = 150;

/** Pages of alert-log rows read for the line (newest first). A capped read is said in `partial`. */
const MAX_ALERT_PAGES = 10;

/**
 * Reads the alert-log rows of the last 7 days and the signals and contacts behind them (selects only) and builds the line. Never throws:
 * any failed read (a missing table included) gives status 'unavailable', shown blank, never as zero.
 */
export async function loadContactPathReport(db: Db, now: Date): Promise<ContactPathReport & { partial?: boolean }> {
  const since = new Date(now.getTime() - CONTACT_PATH_WINDOW_DAYS * 86_400_000).toISOString();
  const blank = (): ContactPathReport => ({ ...buildContactPathReport({ now, alerts: [], signals: [], contacts: [] }), status: 'unavailable' });
  try {
    const read = await readPagesCapped<AlertRow>(
      (from, to) =>
        db
          .from('holler_alert_log')
          .select('user_id, signal_id, source, kind, subtype, trade, created_at, emailed_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      MAX_ALERT_PAGES,
    );
    const alerts = read.rows;
    const ids = [...new Set(alerts.map((a) => a.signal_id).filter((n): n is number => typeof n === 'number'))];
    const signals: ContactPathSignal[] = [];
    const contacts: (ContactLike & { signal_id: number })[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const s = await db.from('holler_signals').select('id, source, kind, title, summary, subtype:data->>subtype, permitStage:data->>permitStage').in('id', part);
      if (s.error) return blank();
      signals.push(...((s.data ?? []) as unknown as ContactPathSignal[]));
      const c = await db.from('holler_signal_contacts').select('signal_id, role, name, address').in('signal_id', part);
      if (c.error) return blank();
      contacts.push(...((c.data ?? []) as unknown as (ContactLike & { signal_id: number })[]));
    }
    const report = buildContactPathReport({ now, alerts, signals, contacts });
    return read.partial ? { ...report, partial: true } : report;
  } catch {
    return blank();
  }
}
