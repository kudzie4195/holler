import { PAGE_SIZE, type Db } from '@/lib/signals/store';
import { loadDuplicateRates } from '@/lib/signals/dedupe-metrics';
import { missingStoreColumn, STORE_PROFILE_COLUMNS } from '@/lib/storebilling/source';
import {
  buildQualityReport,
  QUALITY_WINDOW_DAYS,
  type AlertRow,
  type FeedbackRow,
  type MatchLite,
  type ProfileLite,
  type QualityInputs,
  type QualityReport,
  type SectionStatus,
  type SignalLite,
} from './quality';

/**
 * Reads the rows the alert-quality dashboard needs and builds the report. READ ONLY: every call here is a `select` (tests/admin/quality.test.ts
 * fails if a write method is ever called). Service-role client, server side only; nothing is sent to a browser except the finished report.
 *
 * Reads (all through the Db passed in):
 *   holler_profiles        every member: id, signup time, trades and the plan/billing columns that decide access and plan trades.
 *                          No name, email, address or phone is selected.
 *   holler_alert_log       rows created in the window (emailed or not): ids, source, kind, subtype, trade, created_at, emailed_at.
 *   holler_signal_feedback answers updated in the window: ids, verdict, updated_at. job_value_usd is not selected.
 *   holler_matches         matches of members who signed up in the window: ids and created_at.
 *   holler_signals         only the signals those rows point to: id, source, kind, title, subtype, categories (public record fields).
 * A section whose read hits the page cap is reported as partial (kept, and said so); one whose read fails is reported as unavailable (blank, never zero) and the others still run. Error text is never returned.
 */

const CHUNK = 150;
/** Pages (of PAGE_SIZE rows) read per table. A table with more rows than this is reported as partial, never silently cut. */
export const MAX_PAGES = 30;
const DAY = 86_400_000;

/**
 * Like readAllPages, but the cap is not silent: when the last allowed page still had rows and one more page has rows too, the read
 * is `partial` (the dashboard says so). Newest rows are read first (callers order descending) so a cap loses the oldest.
 */
export async function readPagesCapped<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  maxPages: number,
): Promise<{ rows: T[]; partial: boolean }> {
  const rows: T[] = [];
  let offset = 0;
  for (let page = 0; page <= maxPages; page++) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const got = (data ?? []) as T[];
    if (got.length === 0) return { rows, partial: false };
    // Page number maxPages is only a probe: it proves there is more, and its rows are not kept.
    if (page === maxPages) return { rows, partial: true };
    rows.push(...got);
    offset += got.length;
  }
  return { rows, partial: false };
}

function chunks<T>(arr: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const PROFILE_COLUMNS = 'user_id, created_at, categories, plan, subscription_status, trial_ends_at';

async function readProfiles(db: Db, maxPages: number) {
  const page = (cols: string) => (from: number, to: number) => db.from('holler_profiles').select(cols).order('created_at', { ascending: false }).order('user_id', { ascending: false }).range(from, to);
  try {
    return await readPagesCapped<ProfileLite>(page(`${PROFILE_COLUMNS}, ${STORE_PROFILE_COLUMNS}`), maxPages);
  } catch (e) {
    // Before migration 0020 the two store columns do not exist: read without them (no store plan can exist then).
    if (e instanceof Error && missingStoreColumn(e.message)) return readPagesCapped<ProfileLite>(page(PROFILE_COLUMNS), maxPages);
    throw e;
  }
}

async function readSignals(db: Db, ids: readonly number[]): Promise<SignalLite[]> {
  const out: SignalLite[] = [];
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await db
      .from('holler_signals')
      .select('id, source, kind, title, summary, categories, lat, lon, state, severity, subtype:data->>subtype, permitStage:data->>permitStage')
      .in('id', part);
    if (error) throw new Error('signals read failed');
    out.push(...((data ?? []) as unknown as SignalLite[]));
  }
  return out;
}

/** `maxPages` is a parameter so a test can prove the cap is reported; production uses MAX_PAGES. */
export async function loadQualityReport(db: Db, now: Date, maxPages: number = MAX_PAGES): Promise<QualityReport> {
  const since = new Date(now.getTime() - QUALITY_WINDOW_DAYS * DAY).toISOString();
  const status: Required<NonNullable<QualityInputs['status']>> = { alerts: 'ok', feedback: 'ok', members: 'ok', firstCard: 'ok' };
  const fail = (k: keyof typeof status): void => {
    const unavailable: SectionStatus = 'unavailable';
    status[k] = unavailable;
  };
  // A capped read keeps what it has and says so: the section is 'partial' unless it already failed.
  const partial = (k: keyof typeof status): void => {
    if (status[k] === 'ok') status[k] = 'partial';
  };

  let profiles: ProfileLite[] = [];
  try {
    const r = await readProfiles(db, maxPages);
    profiles = r.rows;
    if (r.partial) {
      partial('members');
      partial('firstCard');
    }
  } catch {
    fail('members');
    fail('firstCard');
  }

  let alerts: AlertRow[] = [];
  try {
    const r = await readPagesCapped<AlertRow>(
      (from, to) =>
        db
          .from('holler_alert_log')
          .select('user_id, signal_id, source, kind, subtype, trade, created_at, emailed_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      maxPages,
    );
    alerts = r.rows;
    if (r.partial) partial('alerts');
  } catch {
    // A missing table (migration 0015 not applied) lands here too: blank, not zero.
    fail('alerts');
  }

  let feedback: FeedbackRow[] = [];
  try {
    const r = await readPagesCapped<FeedbackRow>(
      (from, to) =>
        db
          .from('holler_signal_feedback')
          .select('user_id, signal_id, verdict, updated_at')
          .gte('updated_at', since)
          .order('updated_at', { ascending: false })
          .order('signal_id', { ascending: false })
          .range(from, to),
      maxPages,
    );
    feedback = r.rows;
    if (r.partial) partial('feedback');
  } catch {
    fail('feedback');
  }

  let matches: MatchLite[] = [];
  if (status.firstCard === 'ok') {
    try {
      const sinceMs = Date.parse(since);
      const newIds = profiles.filter((p) => Date.parse(p.created_at) >= sinceMs).map((p) => p.user_id);
      for (const part of chunks(newIds, 50)) {
        const r = await readPagesCapped<MatchLite>(
            (from, to) =>
              db
                .from('holler_matches')
                .select('user_id, signal_id, created_at')
                .in('user_id', part)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to),
            maxPages,
          );
        matches.push(...r.rows);
        if (r.partial) partial('firstCard');
      }
    } catch {
      matches = [];
      fail('firstCard');
    }
  }

  let signals: SignalLite[] = [];
  try {
    const ids = [
      ...alerts.map((a) => a.signal_id),
      ...feedback.map((f) => f.signal_id),
      ...matches.map((m) => m.signal_id),
    ].filter((n): n is number => typeof n === 'number');
    signals = await readSignals(db, ids);
  } catch {
    // Without the records' titles and trades nothing can be labelled: every section that needs them is unavailable.
    fail('alerts');
    fail('feedback');
    fail('firstCard');
  }

  const report = buildQualityReport({ now, alerts, signals, feedback, profiles, matches, status });
  // Duplicates dropped per source, last 7 days (read only; a missing table or a failed read is 'unavailable', never zero).
  return { ...report, duplicates: await loadDuplicateRates(db, now) };
}
