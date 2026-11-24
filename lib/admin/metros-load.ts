import type { Db } from '@/lib/signals/store';
import { loadSourceStates } from '@/lib/signals/source-state-load';
import { isSamplesTableMissing } from '@/lib/signals/samples';
import type { SourceState } from '@/lib/signals/source-state';
import { isAlertLabel, labelFor, recordLabelInput } from '@/lib/signals/lead-rules';
import type { CategoryId } from '@/lib/signals/categories';
import { readPagesCapped, MAX_PAGES } from './quality-load';
import type { SectionStatus } from './quality';
import {
  buildMetroReport,
  CARD_WINDOW_DAYS,
  contactEligible,
  SAMPLE_WINDOW_DAYS,
  type MetroAlertRow,
  type MetroInputs,
  type MetroReport,
  type MetroSignalLite,
} from './metros';

/**
 * Reads what the per-metro scorecard needs and builds it (lib/admin/metros.ts). READ ONLY: every call is a select (tests/admin/metros.test.ts
 * fails on any write). Service-role client, server side only; the route returns counts, shares, source ids and states, nothing else.
 *
 * Reads:
 *   holler_alert_log        rows created in the last 7 days: signal_id, trade, created_at (no member id is selected)
 *   holler_signals          only the records those rows point to: id, source, kind, title, summary, lat, lon, state, city, subtype and the
 *                           managing-company aliases (used to place, label and test the contact path; never returned)
 *   holler_signal_contacts  ids only: which of the alerted, contact-eligible records have a named organisation (not 'site', a name)
 *   holler_source_health + holler_scan_runs   through loadSourceStates (lib/signals/source-state-load.ts)
 *   holler_source_samples   a head count per probation source, last 14 days (migration 0032)
 *   holler_area_waitlist, holler_zip_waitlist  ZIP column only (confirmed, not unsubscribed rows of the second)
 * A failed read makes its section unavailable (blank, never zero); a missing table is said as such. Error text is never returned.
 */

const CHUNK = 150;
const CONTACT_CHUNK = 200;
const DAY = 86_400_000;

function chunks<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const SIGNAL_COLUMNS = 'id, source, kind, title, summary, lat, lon, state, city, severity, subtype:data->>subtype, permitStage:data->>permitStage, managerName:data->>managerName, managerRole:data->>managerRole';

async function readSignals(db: Db, ids: readonly number[]): Promise<MetroSignalLite[]> {
  const out: MetroSignalLite[] = [];
  for (const part of chunks([...new Set(ids)], CHUNK)) {
    const { data, error } = await db.from('holler_signals').select(SIGNAL_COLUMNS).in('id', part);
    if (error) throw new Error('signals read failed');
    out.push(...((data ?? []) as unknown as MetroSignalLite[]));
  }
  return out;
}

async function readNamedContactIds(db: Db, ids: readonly number[]): Promise<Set<number>> {
  const found = new Set<number>();
  for (const part of chunks([...new Set(ids)], CONTACT_CHUNK)) {
    const { data, error } = await db.from('holler_signal_contacts').select('signal_id').neq('role', 'site').neq('name', '').in('signal_id', part);
    if (error) throw new Error('contacts read failed');
    for (const r of (data ?? []) as { signal_id: number }[]) found.add(r.signal_id);
  }
  return found;
}

async function readSampleCounts(db: Db, ids: readonly string[], now: Date): Promise<Map<string, number> | 'missing' | null> {
  const out = new Map<string, number>();
  const since = new Date(now.getTime() - SAMPLE_WINDOW_DAYS * DAY).toISOString();
  try {
    for (const id of ids) {
      const { count, error } = await db.from('holler_source_samples').select('id', { count: 'exact', head: true }).eq('source', id).gte('fetched_at', since);
      if (error) return isSamplesTableMissing(error) ? 'missing' : null;
      out.set(id, count ?? 0);
    }
    return out;
  } catch {
    return null;
  }
}

async function readWaitlistZips(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }>,
  maxPages: number,
): Promise<{ zips: string[] | 'missing' | null; trades: (string | null)[] | null; status: SectionStatus }> {
  try {
    // readPagesCapped throws the message only; keep the first error object to tell a missing table from a failure.
    let firstError: { code?: string; message: string } | null = null;
    const r = await readPagesCapped<{ zip: string; trade?: string | null }>(async (from, to) => {
      const res = await build(from, to);
      if (res.error && !firstError) firstError = res.error;
      return res;
    }, maxPages).catch(() => null);
    const err = firstError as { code?: string; message: string } | null;
    if (!r) return { zips: err && isSamplesTableMissing(err) ? 'missing' : null, trades: null, status: 'unavailable' };
    const rows = r.rows.filter((x) => typeof x.zip === 'string');
    // Round 24 FIX2 (review D8): the trade of each row, parallel to the ZIPs, so the admin view shows who waits for what.
    return { zips: rows.map((x) => x.zip), trades: rows.map((x) => (typeof x.trade === 'string' ? x.trade : null)), status: r.partial ? 'partial' : 'ok' };
  } catch {
    return { zips: null, trades: null, status: 'unavailable' };
  }
}

/** `maxPages` is a parameter so a test can prove the cap is reported; production uses MAX_PAGES. */
export async function loadMetroReport(
  db: Db,
  now: Date,
  opts: { maxPages?: number; adapters?: ReadonlyArray<{ id: string; probation?: boolean; kind?: string; cadenceMinutes?: number }> } = {},
): Promise<MetroReport> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const since = new Date(now.getTime() - CARD_WINDOW_DAYS * DAY).toISOString();
  const status: NonNullable<MetroInputs['status']> = { cards: 'ok' };

  let alerts: MetroAlertRow[] = [];
  let signals: MetroSignalLite[] = [];
  try {
    const r = await readPagesCapped<MetroAlertRow>(
      (from, to) =>
        db
          .from('holler_alert_log')
          .select('signal_id, trade, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      maxPages,
    );
    alerts = r.rows;
    if (r.partial) status.cards = 'partial';
    signals = await readSignals(db, alerts.map((a) => a.signal_id).filter((n): n is number => typeof n === 'number'));
  } catch {
    alerts = [];
    signals = [];
    status.cards = 'unavailable';
  }

  // Contact path: only for the records of alerted cards that can carry one.
  let namedContactIds: Set<number> | null = new Set();
  try {
    const sigBy = new Map(signals.map((s) => [s.id, s]));
    const ids = alerts
      .filter((a) => {
        const s = a.signal_id === null ? undefined : sigBy.get(a.signal_id);
        if (!s || !contactEligible(s)) return false;
        return isAlertLabel(labelFor(recordLabelInput(s), (a.trade ?? null) as CategoryId | null));
      })
      .map((a) => a.signal_id as number);
    namedContactIds = await readNamedContactIds(db, ids);
  } catch {
    namedContactIds = null;
  }

  const adapters = opts.adapters ?? (await import('@/lib/signals/registry')).ALL_ADAPTERS;

  let states: Map<string, SourceState> | null = null;
  try {
    const results = await loadSourceStates(db, now);
    states = new Map(results.map((r) => [r.id, r.state]));
  } catch {
    states = null;
  }

  const samples = await readSampleCounts(db, adapters.filter((a) => a.probation).map((a) => a.id), now);

  const area = await readWaitlistZips(
    (from, to) => db.from('holler_area_waitlist').select('zip').order('id', { ascending: true }).range(from, to),
    maxPages,
  );
  const zip = await readWaitlistZips(
    (from, to) =>
      db.from('holler_zip_waitlist').select('zip,trade').not('confirmed_at', 'is', null).is('unsubscribed_at', null).order('id', { ascending: true }).range(from, to),
    maxPages,
  );
  status.areaWaitlist = area.status;
  status.zipWaitlist = zip.status;

  return buildMetroReport({
    now,
    alerts,
    signals,
    namedContactIds,
    adapters,
    states,
    samples,
    areaWaitlistZips: area.zips,
    zipWaitlistZips: zip.zips,
    zipWaitlistTrades: zip.trades,
    status,
  });
}

