import { alertKeyOf } from './alert-dedupe';
import { MAX_MATCHES_PER_USER, matchSignals, withoutWorkProfile, type MatchProfile, type MatchSignal } from './match';
import { contactGateOn, loadProfiles, markStoredContactPaths, readAllPages, type Db } from './store';
import { alertLogRowsFor, logAlerts } from '@/lib/moat/log';
import { missingPushedAtColumn, upsertMatchRows, type MatchInsertRow } from './quiet-matches';
import { licenceGateApplies } from './alert-gate';

/** A signal that happened longer ago than this is matched quietly (notified = true): no email for old news, like the backfill. */
export const REMATCH_QUIET_AFTER_MS = 3 * 86_400_000;
const CHUNK = 200;
const SIGNAL_COLUMNS = 'id,source,kind,categories,lat,lon,state,severity,occurred_at,expires_at,title,summary,subtype:data->>subtype,data';

interface Row extends MatchSignal {
  expires_at: string | null;
  /** read for the alert log (lib/moat/log) */
  source?: string | null;
  kind?: string | null;
}

export interface RematchOptions {
  now?: Date;
  /** Profiles to match against (the remap pass loads them once for all its batches). Default: loadProfiles(db, now). */
  profiles?: MatchProfile[] | (() => Promise<MatchProfile[]>);
  log?: (m: string) => void;
  /**
   * Insert every new pair as already notified (history in the feed, no email, no push), whatever the record's age. The rule re-map
   * passes this: a record that newly fits a member's trade after a mapping change is not news.
   */
  quiet?: boolean;
}

export interface RematchResult {
  /** holler_matches rows actually inserted. */
  created: number;
  /** Set when something failed; the function never throws. */
  error?: string;
}

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Creates any missing holler_matches rows for these signals against every current profile, with the scan's own rules (matchSignals:
 * area and trade or keyword test, plan limits, 25 rows per user and 5 business rows per user per call). Called after a signal's
 * categories change (the scan's rule remap, the AI step).
 *  - Idempotent: pairs that already exist are left out BEFORE the per-user cap, so they cannot crowd out the new ones, and the insert
 *    ignores duplicates.
 *  - Expired signals are skipped.
 *  - Signals older than 3 days are inserted notified = true and pushed_at = now, so a re-mapped record from last week never arrives as
 *    a new alert email or push. With `quiet`, every new pair is inserted that way. Without migration 0020 the insert is retried without
 *    pushed_at (lib/signals/quiet-matches.ts).
 *  - The existing-pairs read is paged (PostgREST returns at most 1000 rows a response), so a busy signal's pairs are all seen.
 * Never throws.
 */
export async function rematchSignals(db: Db, signalIds: number[], opts: RematchOptions = {}): Promise<RematchResult> {
  const now = opts.now ?? new Date();
  const ids = [...new Set((signalIds ?? []).filter((x) => Number.isSafeInteger(x) && x > 0))];
  if (ids.length === 0) return { created: 0 };
  try {
    const signals: Row[] = [];
    for (const part of chunks(ids)) {
      const { data, error } = await db.from('holler_signals').select(SIGNAL_COLUMNS).in('id', part);
      if (error) throw new Error(`signals read failed: ${error.message}`);
      for (const r of (data ?? []) as unknown as Row[]) {
        if (r.expires_at && Date.parse(r.expires_at) <= now.getTime()) continue;
        signals.push(r);
      }
    }
    if (signals.length === 0) return { created: 0 };
    // The contact gate applies here too: a permit with no business and no site address is feed-only whoever it is matched to, and whenever.
    // Round 33 (review 2, P1-2): a new-business licence is read too (switch on), with or without 0027.
    await markStoredContactPaths(db, signals, { permits: await contactGateOn(db) });

    const profiles =
      typeof opts.profiles === 'function' ? await opts.profiles() : (opts.profiles ?? (await loadProfiles(db, now)));
    if (profiles.length === 0) return { created: 0 };

    // Pairs that already exist (any user) for these signals.
    const existing = new Set<string>();
    for (const part of chunks(signals.map((s) => s.id))) {
      let pairs: { user_id: string; signal_id: number }[];
      try {
        pairs = await readAllPages<{ user_id: string; signal_id: number }>(
          (a, b) => db.from('holler_matches').select('user_id,signal_id').in('signal_id', part).order('id', { ascending: true }).range(a, b),
          200,
        );
      } catch (e) {
        throw new Error(`matches read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const m of pairs) existing.add(`${m.user_id}\u0000${m.signal_id}`);
    }

    const rows: MatchInsertRow[] = [];
    // The new-business licences among these signals (switch on): only their rows keep "already handled" when alert_hold is not a column.
    const licenceIds = new Set(signals.filter((s) => licenceGateApplies({ subtype: s.subtype ?? (typeof s.data?.subtype === 'string' ? s.data.subtype : null) })).map((s) => s.id));
    const nowIso = now.toISOString();
    const byId = new Map(signals.map((s) => [s.id, s]));
    for (const p of profiles) {
      let fresh = existing.size ? signals.filter((s) => !existing.has(`${p.user_id}\u0000${s.id}`)) : signals;
      // A county row of an alert this member already has through another county row is not matched again (one alert, one match).
      if (existing.size && fresh.length > 0) {
        const have = new Set(signals.filter((s) => existing.has(`${p.user_id}\u0000${s.id}`)).map((s) => alertKeyOf(s)).filter((k): k is string => !!k));
        if (have.size) fresh = fresh.filter((s) => !have.has(alertKeyOf(s) ?? ''));
      }
      if (fresh.length === 0) continue;
      for (const r of matchSignals(fresh, [p], MAX_MATCHES_PER_USER, now)) {
        const s = byId.get(r.signal_id);
        const t = s ? Date.parse(s.occurred_at) : NaN;
        // A row the SAM backfill stored (data.backfill) is history whoever rematches it and whenever: the hourly AI step must never email one.
        const backfilled = (s?.data as { backfill?: unknown } | null | undefined)?.backfill === true;
        const quiet = opts.quiet === true || backfilled || !Number.isFinite(t) || now.getTime() - t > REMATCH_QUIET_AFTER_MS;
        // History is never pushed either: pushed_at is set at insert (verify-v1 decision 2).
        // Round 33 (review 3, P2-2): a feed-only NEW-BUSINESS LICENCE is stored as already handled (like the scan), switch on only: the email and
        // push runs never read it. Any other held card (a permit) and every card with the switch off is stored as before: handled only when quiet.
        const handled = quiet || (!!r.alert_hold && !!s && licenceGateApplies({ subtype: s.subtype ?? (typeof s.data?.subtype === 'string' ? s.data.subtype : null) }));
        rows.push({ user_id: r.user_id, signal_id: r.signal_id, distance_mi: r.distance_mi, notified: handled, pushed_at: handled ? nowIso : null, ...(r.alert_hold ? { alert_hold: r.alert_hold } : {}) });
      }
    }
    if (rows.length === 0) return { created: 0 };

    let created = 0;
    for (const part of chunks(rows, 500)) {
      try {
        created += await upsertMatchRows(db, part, { count: true, licenceIds });
      } catch (e) {
        throw new Error(`matches upsert failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Outcome log (migration 0015): one coarse row per new pair. Never throws; a repeat pair is ignored by its unique key.
    // A feed-only card (alert_hold) is not an alert, so it is not logged as one.
    await logAlerts(db, alertLogRowsFor(rows.filter((r) => !r.alert_hold), signals, profiles));
    return { created };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    (opts.log ?? ((m: string) => console.error(m)))(`rematchSignals failed: ${message}`);
    return { created: 0, error: message };
  }
}

export interface PruneResult {
  /** Untouched holler_matches rows deleted because the member no longer matches the record. */
  removed: number;
  error?: string;
}

/** Tables whose row for (member, record) means the member acted on the match: it is never pruned. */
const TOUCH_TABLES = ['holler_signal_feedback', 'holler_outcome_asks'] as const;

function isMissingTableError(message: string | null | undefined): boolean {
  return /does not exist|schema cache|PGRST20[25]|42P01/i.test(message ?? '');
}

/**
 * After a re-map took trades away from these signals: deletes the members' UNTOUCHED matches that the record no longer earns (the same
 * matchSignals test as the scan, against the member's current profile). Untouched means (commander decision 3, verify-v1 finding 4):
 * status 'new' (not saved or done), no draft, not emailed (notified false), not pushed (pushed_at null, when 0020 is applied), and no
 * feedback or outcome answer from the member (holler_signal_feedback, holler_outcome_asks). Anything else is the member's and stays.
 * A member whose profile is not loaded (canceled, trial over) keeps the row. Paged reads; never throws.
 */
export async function pruneStaleMatches(db: Db, signalIds: number[], opts: RematchOptions = {}): Promise<PruneResult> {
  const now = opts.now ?? new Date();
  const ids = [...new Set((signalIds ?? []).filter((x) => Number.isSafeInteger(x) && x > 0))];
  if (ids.length === 0) return { removed: 0 };
  try {
    const signals: Row[] = [];
    for (const part of chunks(ids)) {
      const { data, error } = await db.from('holler_signals').select(SIGNAL_COLUMNS).in('id', part);
      if (error) throw new Error(`signals read failed: ${error.message}`);
      signals.push(...((data ?? []) as unknown as Row[]));
    }
    if (signals.length === 0) return { removed: 0 };
    let withPushed = true;
    const readPending = async (part: number[]) =>
      readAllPages<{ id: number; user_id: string; signal_id: number }>(
        (a, b) => {
          // Untouched: still 'new' (not saved or done), no draft, never emailed and, with 0020, never pushed.
          const q = db.from('holler_matches').select('id,user_id,signal_id').in('signal_id', part).eq('notified', false).eq('status', 'new').is('draft', null);
          return (withPushed ? q.is('pushed_at', null) : q).order('id', { ascending: true }).range(a, b);
        },
        200,
      );
    const pending: { id: number; user_id: string; signal_id: number }[] = [];
    for (const part of chunks(signals.map((s) => s.id))) {
      try {
        pending.push(...(await readPending(part)));
      } catch (e) {
        // Before migration 0020 there is no pushed_at column: read without it (no push can have been sent).
        if (!withPushed || !missingPushedAtColumn(e instanceof Error ? e.message : String(e))) throw e;
        withPushed = false;
        pending.push(...(await readPending(part)));
      }
    }
    if (pending.length === 0) return { removed: 0 };
    // Feedback or an outcome answer: the member acted on the match. A missing table means no such rows; any other error keeps all.
    const touched = new Set<string>();
    const pendingSignals = [...new Set(pending.map((m) => m.signal_id))];
    for (const table of TOUCH_TABLES) {
      for (const part of chunks(pendingSignals)) {
        let rows: { user_id: string; signal_id: number }[];
        try {
          rows = await readAllPages<{ user_id: string; signal_id: number }>(
            (a, b) => db.from(table).select('user_id,signal_id').in('signal_id', part).order('signal_id', { ascending: true }).range(a, b),
            200,
          );
        } catch (e) {
          if (isMissingTableError(e instanceof Error ? e.message : String(e))) break;
          throw new Error(`${table} read failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        for (const r of rows) touched.add(`${r.user_id}\u0000${r.signal_id}`);
      }
    }
    const profiles =
      typeof opts.profiles === 'function' ? await opts.profiles() : (opts.profiles ?? (await loadProfiles(db, now)));
    const byUser = new Map(profiles.map((p) => [p.user_id, p]));
    const byId = new Map(signals.map((s) => [s.id, s]));
    const stale: number[] = [];
    for (const m of pending) {
      if (touched.has(`${m.user_id}\u0000${m.signal_id}`)) continue;
      const p = byUser.get(m.user_id);
      const s = byId.get(m.signal_id);
      if (!p || !s) continue;
      // Without the work profile (migration 0027): a new setting applies to new scans only and never removes a card the member already has.
      if (matchSignals([s], [withoutWorkProfile(p)], MAX_MATCHES_PER_USER, now).length === 0) stale.push(m.id);
    }
    let removed = 0;
    for (const part of chunks(stale)) {
      // The same untouched filters again on the delete: a match saved, drafted, emailed or pushed since the read stays.
      const del = db.from('holler_matches').delete().in('id', part).eq('notified', false).eq('status', 'new').is('draft', null);
      const { data, error } = await (withPushed ? del.is('pushed_at', null) : del).select('id');
      if (error) throw new Error(`matches delete failed: ${error.message}`);
      removed += Array.isArray(data) ? data.length : 0;
    }
    return { removed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    (opts.log ?? ((m: string) => console.error(m)))(`pruneStaleMatches failed: ${message}`);
    return { removed: 0, error: message };
  }
}
