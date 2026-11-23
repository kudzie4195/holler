import { parseLang, type Lang } from '@/lib/i18n';
import { missingStoreColumn, STORE_PROFILE_COLUMNS } from '@/lib/storebilling/source';
import { digestCoverage } from './coverage';
import { chunk, decideNotify, type NotifyProfile } from './notify-logic';
import { renderDigest } from './templates';
import { signUnsubscribeToken } from './token';

/**
 * The quiet-week email (round 24, review P1-5): the one email a member gets in a week with nothing to alert on, so a quiet inbox is never
 * mistaken for a broken one. Sent by the notify cron (app/api/cron/notify/route.ts) AFTER the alert digests, and only while
 * HOLLER_QUIET_WEEK_ENABLED is exactly "1". Unset (the default) or any other value: this file is never called and the cron does exactly
 * what it did before round 24.
 *
 * Who gets it, all of these at once:
 *  - email alerts on, a verified email, an active trial or a paid plan that is paid now (lib/email/notify-logic.ts decideNotify, the
 *    digest's own gate), and an account at least 7 days old (a new member's first week is the lifecycle welcome's job);
 *  - no alert email in the last 7 days: `last_notified_at` older than 7 days, or never set;
 *  - no un-notified match at all (an alert is on its way, or is held for a reason the digest owns), checked per member;
 *  - not emailed by this run already.
 * After a send, `last_notified_at` is stamped, so the next one is 7 days away at the earliest. At most `cap` emails a run (the digest's
 * MAX_USERS_PER_RUN) and none after the run's time budget.
 *
 * What it says is checked, not assumed: the cron counts this member's matches of the last 7 days. None: "No public record near you
 * matched your trades in the last week" (or, in a limited or waitlist cell of the site's coverage gate, lib/email/coverage.ts, the site's
 * own words for that). Some, all feed only: says they are in the feed. A failed count: no email for that member this run.
 *
 * A missing column on the live database never breaks the cron: the store columns (0020) and the area columns are read again without them,
 * and any other read failure ends this step with a reason in the run's JSON. Never throws.
 */
export const QUIET_WEEK_DAYS = 7;
const DAY_MS = 86_400_000;
const PAGE = 1000;
const MAX_PAGES = 5;

/** On only when HOLLER_QUIET_WEEK_ENABLED is exactly "1". Read at call time. */
export function quietWeekEnabled(value: string | undefined = process.env.HOLLER_QUIET_WEEK_ENABLED): boolean {
  return value === '1';
}

type DbError = { code?: string | null; message?: string | null } | null;
type Result<T> = PromiseLike<{ data: T | null; error: DbError }>;
interface Query<T> extends Result<T> {
  select(cols: string): Query<T>;
  eq(col: string, v: unknown): Query<T>;
  in(col: string, v: unknown[]): Query<T>;
  is(col: string, v: null): Query<T>;
  lt(col: string, v: string): Query<T>;
  gte(col: string, v: string): Query<T>;
  not(col: string, op: string, v: null): Query<T>;
  order(col: string, o?: { ascending?: boolean }): Query<T>;
  range(a: number, b: number): Query<T>;
  limit(n: number): Query<T>;
  update(patch: Record<string, unknown>): Query<T>;
}
export interface QuietDb {
  from(table: string): unknown;
}

interface QuietProfile extends NotifyProfile {
  user_id: string;
  business_name: string;
  created_at: string | null;
  categories?: string[] | null;
  plan?: string | null;
  lat?: number | null;
  lon?: number | null;
  state?: string | null;
  extra_areas?: unknown;
}

export interface QuietWeekDeps {
  db: QuietDb;
  now: Date;
  siteUrl: string;
  /** CRON_SECRET: signs the unsubscribe link, as for the digest. */
  secret: string;
  /** The member's sign-in email, or null. */
  emailOf: (userId: string) => Promise<string | null>;
  send: (msg: { to: string; subject: string; html: string; text: string; headers: Record<string, string>; idempotencyKey: string }) => Promise<
    { skipped: true } | { skipped?: false; ok: true } | { skipped?: false; ok: false }
  >;
  /** Members this run already handled: every member with an un-notified match read by the digest, and every member it emailed. */
  skip: ReadonlySet<string>;
  /** Most emails in one run (the digest's MAX_USERS_PER_RUN). */
  cap: number;
  /** True once the run's time budget is spent. */
  outOfTime: () => boolean;
}

export interface QuietWeekCounts {
  candidates: number;
  sent: number;
  skipped_pending: number;
  skipped_check_failed: number;
  skipped_no_email_provider: number;
  failed: number;
  capped: number;
  /** Set when the candidate read failed: nothing was sent. */
  error?: string;
}

const BASE = 'user_id, business_name, categories, plan, alert_email, subscription_status, trial_ends_at, last_notified_at, email_verified_at, created_at';
const AREA = 'lat, lon, state, extra_areas';
const isMissingColumn = (e: DbError) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /does not exist|could not find/i.test(e.message ?? ''));

/** Members with alerts on, a verified email and a trialing or active status whose last alert email is older than 7 days (or never). */
async function readCandidates(db: QuietDb, since: string): Promise<{ rows: QuietProfile[]; error?: string }> {
  // Widest read first; a database without the 0020 store columns or the area columns is read again without them.
  const shapes = [`${BASE}, ${AREA}, ${STORE_PROFILE_COLUMNS}`, `${BASE}, ${AREA}`, BASE];
  for (const cols of shapes) {
    const rows: QuietProfile[] = [];
    let failed: DbError = null;
    for (const stamp of ['never', 'old'] as const) {
      for (let page = 0; page < MAX_PAGES; page++) {
        let q = (db.from('holler_profiles') as Query<QuietProfile[]>)
          .select(cols)
          .eq('alert_email', true)
          .not('email_verified_at', 'is', null)
          .in('subscription_status', ['trialing', 'active']);
        q = stamp === 'never' ? q.is('last_notified_at', null) : q.lt('last_notified_at', since);
        const { data, error } = await q.order('user_id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) {
          failed = error;
          break;
        }
        rows.push(...(data ?? []));
        if ((data ?? []).length < PAGE) break;
      }
      if (failed) break;
    }
    if (!failed) return { rows };
    const storeGone = missingStoreColumn(failed.message);
    if (!storeGone && !isMissingColumn(failed)) return { rows: [], error: 'profiles_failed' };
  }
  return { rows: [], error: 'profiles_failed' };
}

/** Member language (migration 0024), read on its own: any failure is English, as for the digest. */
async function readLanguages(db: QuietDb, ids: string[]): Promise<Map<string, Lang>> {
  const out = new Map<string, Lang>();
  try {
    for (const part of chunk(ids)) {
      const { data, error } = await (db.from('holler_profiles') as Query<Array<{ user_id?: string; language?: unknown }>>).select('user_id, language').in('user_id', part);
      if (error) break;
      for (const r of data ?? []) if (r && typeof r.user_id === 'string') out.set(r.user_id, parseLang(r.language));
    }
  } catch {
    out.clear();
  }
  return out;
}

/** 0 or 1 rows of this member's matches under one more filter. Null when the read failed (missing table, network): then nothing is sent. */
async function anyMatch(db: QuietDb, userId: string, filter: (q: Query<Array<{ id: number }>>) => Query<Array<{ id: number }>>): Promise<number | null> {
  try {
    const q = (db.from('holler_matches') as Query<Array<{ id: number }>>).select('id').eq('user_id', userId);
    const { data, error } = await filter(q).limit(1);
    return error ? null : (data ?? []).length;
  } catch {
    return null;
  }
}

export async function sendQuietWeek(deps: QuietWeekDeps): Promise<QuietWeekCounts> {
  const counts: QuietWeekCounts = { candidates: 0, sent: 0, skipped_pending: 0, skipped_check_failed: 0, skipped_no_email_provider: 0, failed: 0, capped: 0 };
  try {
    const nowMs = deps.now.getTime();
    const since = new Date(nowMs - QUIET_WEEK_DAYS * DAY_MS).toISOString();
    const read = await readCandidates(deps.db, since);
    if (read.error) return { ...counts, error: read.error };
    const due = read.rows
      .filter((p) => !deps.skip.has(p.user_id))
      // The digest's own gate, with a gap of QUIET_WEEK_DAYS instead of 60 minutes: alerts on, verified, entitled now, last alert email > 7 days ago.
      .filter((p) => decideNotify(p, deps.now, QUIET_WEEK_DAYS * 24 * 60).ok)
      .filter((p) => {
        const created = p.created_at ? new Date(p.created_at).getTime() : NaN;
        return Number.isFinite(created) && nowMs - created >= QUIET_WEEK_DAYS * DAY_MS;
      })
      // Longest without an email first, so a capped run is fair.
      .sort((a, b) => (a.last_notified_at ?? '').localeCompare(b.last_notified_at ?? '') || a.user_id.localeCompare(b.user_id));
    counts.candidates = due.length;
    const langs = due.length ? await readLanguages(deps.db, due.map((p) => p.user_id)) : new Map<string, Lang>();
    for (const p of due) {
      if (counts.sent >= deps.cap) {
        counts.capped = due.length - due.indexOf(p);
        break;
      }
      if (deps.outOfTime()) break;
      const pending = await anyMatch(deps.db, p.user_id, (q) => q.eq('notified', false));
      if (pending === null) {
        counts.skipped_check_failed++;
        continue;
      }
      if (pending > 0) {
        counts.skipped_pending++;
        continue;
      }
      const matchedLastWeek = await anyMatch(deps.db, p.user_id, (q) => q.gte('created_at', since));
      if (matchedLastWeek === null) {
        counts.skipped_check_failed++;
        continue;
      }
      const to = await deps.emailOf(p.user_id).catch(() => null);
      if (!to) {
        counts.failed++;
        continue;
      }
      const lang = langs.get(p.user_id) ?? 'en';
      const unsubscribeUrl = `${deps.siteUrl}/api/cron/notify/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(p.user_id, deps.secret))}`;
      const coverage = (() => {
        try {
          return digestCoverage({ categories: p.categories ?? null, lat: p.lat ?? null, lon: p.lon ?? null, state: p.state ?? null, plan: p.plan ?? null, subscription_status: p.subscription_status, plan_source: p.plan_source ?? null, store_expires_at: p.store_expires_at ?? null, extra_areas: p.extra_areas });
        } catch {
          return null;
        }
      })();
      const mail = renderDigest({ businessName: p.business_name, items: [], totalCount: 0, appUrl: `${deps.siteUrl}/app`, unsubscribeUrl, now: deps.now, lang, coverage, matchedLastWeek });
      const res = await deps.send({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        // The same headers as the digest (RFC 8058 one-click, required by Gmail and Yahoo for bulk senders).
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        // A retry of the same member on the same day is dropped by the provider.
        idempotencyKey: `holler-quiet-week-${p.user_id}-${deps.now.toISOString().slice(0, 10)}`,
      });
      if ('skipped' in res && res.skipped) {
        // No email provider configured: nothing can go out this run, so stop asking the database.
        counts.skipped_no_email_provider++;
        break;
      }
      if (!('ok' in res) || !res.ok) {
        counts.failed++;
        continue;
      }
      counts.sent++;
      const { error } = await (deps.db.from('holler_profiles') as Query<null>).update({ last_notified_at: deps.now.toISOString() }).eq('user_id', p.user_id);
      if (error) counts.failed++;
    }
    return counts;
  } catch (e) {
    console.error('[notify] quiet week failed', e instanceof Error ? e.name : 'unknown');
    return { ...counts, error: 'failed' };
  }
}
