/**
 * Push notifications for new matches: at most one per member per hour, independent of the email digest.
 * Called once per run by the notify cron (app/api/cron/notify/route.ts) with the service-role client.
 *
 * Push has its own record of what was sent: holler_matches.pushed_at (migration 0020, push section). The email planner may mark a
 * match `notified` (emailed, or skipped because email alerts are off or the address is unconfirmed); that does not touch pushed_at,
 * so a member who gets no email still gets a push. Each run:
 *  1. reads every active device (holler_push_tokens, keyset pages) and the profiles of their owners (chunks of 200);
 *  2. leaves out members with push off (push_alerts), without access (computeAccess, the web feed's rule) and members pushed in the
 *     last hour (last_pushed_at): their matches wait, with pushed_at still empty, and go in the next push;
 *  3. reads, for the rest, the new matches (status 'new') of the last PUSH_LOOKBACK_MS that were never pushed (pushed_at is null),
 *     and counts only those whose record is news (isNews: occurred within 3 days; history rows also carry pushed_at from insert);
 *  4. claims the hour atomically on last_pushed_at (so two overlapping runs cannot both push), sends one notification to each of the
 *     member's devices, and when at least one device took it, stamps pushed_at on exactly the matches that notification counted.
 * So the count in the text is always "new since the last push", never a running total. The text uses the public signal title and
 * city only (the same fields the public pages show): never contacts, never request text.
 * Fail soft: before migration 0020 (no table, no pushed_at or push columns) a read fails and the run is `not_ready`: nothing is sent.
 * Never throws; every failure is a count in the result.
 */
import { alertKeyOf } from '@/lib/signals/alert-dedupe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bidHidden } from '@/lib/signals/bid-sources';
import { computeAccess } from '@/lib/auth/access';
import { HOLLER_REQUEST_SOURCE, isEndedRequest } from '@/lib/signals/request-visibility';
import { isAlertLabel, labelForMember } from '@/lib/signals/lead-rules';
import { matchScope } from '@/lib/plan/scope';
import type { PushData } from '@/lib/mobile/types';
import { isFcmConfigured, sendPush, type PushMessage, type SendResult } from './fcm';
import { isStageUpdate, stageName, STAGE_SELECT } from '@/lib/signals/stage';
import { parseLang, t, type Lang } from '@/lib/i18n';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { allActiveTokens, disableTokens, isMissingTable, type ActiveToken } from './tokens';

type Db = Pick<SupabaseClient, 'from'>;

export const PUSH_INTERVAL_MS = 3_600_000;
/** Matches older than this are never pushed (a member who turns push on is not sent last week's alerts). */
export const PUSH_LOOKBACK_MS = 24 * 3_600_000;
export const PUSH_TITLE_MAX = 80;
/**
 * Second guard for "history, not news" (commander decision 2, verify-v1 finding 1): a push counts a match only when its record occurred
 * within this long before the run AND within this long before the match was inserted. The same 3 days as REMATCH_QUIET_AFTER_MS
 * (lib/signals/rematch.ts): a record older than that when it was matched was inserted as history (backfill, re-map gain, late rematch).
 * The first guard is pushed_at, set at insert on every history row (lib/signals/quiet-matches.ts).
 */
export const PUSH_MAX_SIGNAL_AGE_MS = 3 * 86_400_000;
/**
 * A stage update is pushed even though its record is old (isNews would refuse a permit filed weeks ago, which is the point of the update),
 * but only while the stage date itself is this recent. This bypass is for stage updates only; every other match keeps the isNews check.
 */
export const PUSH_STAGE_MAX_AGE_MS = 14 * 86_400_000;
/** A re-sent stage update is an OLD match (created before the push lookback): the second read looks this far back for them. */
const STAGE_REARM_LOOKBACK_MS = 120 * 86_400_000;
const CHUNK = 200;
const PAGE = 1000;
const MAX_MATCH_PAGES = 10;

export interface PushEntry {
  /** Matches never pushed to this member (new since the last push). */
  count: number;
  /** The newest of them. `title` is the public signal title. */
  top: { signalId: number; title: string; city: string | null; stage?: string | null; source?: string };
  /** How many of the counted matches are stage updates (data.permitStageUpdate). */
  updates?: number;
  /** The matches this notification counts: stamped pushed_at once it is delivered. */
  matchIds: number[];
}

export interface PushCounts {
  status: 'ok' | 'not_configured' | 'not_ready';
  /** Members with at least one active device. */
  considered: number;
  members_pushed: number;
  devices_sent: number;
  /** Matches stamped pushed_at in this run. */
  matches_pushed: number;
  skipped_off: number;
  skipped_locked: number;
  /** Pushed in the last hour: their new matches wait for the next push. */
  skipped_recent: number;
  /** Nothing new since the last push. */
  skipped_nothing_new: number;
  dead_tokens: number;
  /** Sends FCM refused because of our payload (logged once per run; no token is disabled). */
  payload_errors: number;
  failed: number;
}

interface ProfileRow {
  user_id: string;
  city: string | null;
  subscription_status: string;
  trial_ends_at: string;
  plan_source?: string | null;
  store_expires_at?: string | null;
  push_alerts?: boolean | null;
  last_pushed_at?: string | null;
  /** The member's saved trades and plan: the opportunity label of a record depends on the trade that matched it. */
  categories?: string[] | null;
  plan?: string | null;
}

export function truncate(text: string, max: number = PUSH_TITLE_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}...`;
}

/** The notification for one member: "3 new alerts near Smyrna" (new since the last push), the newest alert's title, and a deep link. Pure. */
export function buildNotification(entry: Pick<PushEntry, 'count' | 'top' | 'updates'>, memberCity: string | null, lang: Lang = 'en'): { title: string; body: string; data: PushData } {
  const count = Math.max(1, Math.floor(entry.count));
  const city = (entry.top.city ?? memberCity ?? '').trim();
  const where = city ? t(lang, 'push.where.near', { city }) : t(lang, 'push.where.you');
  const updates = Math.min(count, Math.max(0, Math.floor(entry.updates ?? 0)));
  // The record title is source data; a Holler-built title is rebuilt in the member's language (English is returned unchanged).
  const topTitle = lang === 'en' ? entry.top.title : localizeTitle(entry.top.title, lang, entry.top.source);
  // A stage update never says "new": "Update near Smyrna" with the stage in the body.
  let title = count === 1 ? t(lang, 'push.title.new_one', { where }) : t(lang, 'push.title.new_many', { n: count, where });
  if (updates === count) title = count === 1 ? t(lang, 'push.title.update_one', { where }) : t(lang, 'push.title.update_many', { n: count, where });
  else if (updates > 0) title = t(lang, 'push.title.mixed', { n: count, where });
  if (count === 1 && updates === 1) {
    const name = stageName(entry.top.stage, lang);
    return { title, body: truncate(name ? t(lang, 'push.body.stage', { name, title: topTitle }) : topTitle), data: { type: 'alert', signalId: String(entry.top.signalId), path: `/alert/${entry.top.signalId}` } };
  }
  const data: PushData =
    count === 1 ? { type: 'alert', signalId: String(entry.top.signalId), path: `/alert/${entry.top.signalId}` } : { type: 'feed', path: '/feed' };
  return { title, body: truncate(topTitle), data };
}

interface SignalLike {
  id?: number;
  title: string;
  city: string | null;
  source?: string | null;
  expires_at?: string | null;
  occurred_at?: string | null;
  /** For the opportunity label (lib/signals/lead-rules.ts). */
  kind?: string | null;
  subtype?: string | null;
  /** A permit's summary holds its structured type and class, which downstream routing reads (permit-routing.ts). */
  summary?: string | null;
  categories?: string[] | null;
  /** Multi-county weather alerts: data.alertId (one alert is stored once per county). */
  alertId?: string | null;
  /** data.permitStage, data.permitStageAt and data.permitStageUpdate (STAGE_SELECT): a stage update bypasses the isNews check. */
  permitStage?: string | null;
  permitStageAt?: string | null;
  permitStageUpdate?: string | boolean | null;
}

interface MatchLike {
  id: number;
  user_id: string;
  created_at: string;
  signal: SignalLike | SignalLike[] | null;
}

/**
 * True when a match is news a push may count: its record occurred within PUSH_MAX_SIGNAL_AGE_MS of now and of the match's insert
 * time. A record with no readable date is not counted (fail safe: no push rather than an old alert). A future start counts. Pure.
 */
export function isNews(occurredAt: string | null | undefined, createdAt: string | null | undefined, now: number): boolean {
  const t = occurredAt ? Date.parse(occurredAt) : NaN;
  if (!Number.isFinite(t)) return false;
  if (now - t > PUSH_MAX_SIGNAL_AGE_MS) return false;
  const c = createdAt ? Date.parse(createdAt) : NaN;
  return !(Number.isFinite(c) && c - t > PUSH_MAX_SIGNAL_AGE_MS);
}

/**
 * Builds the per-member entries from never-pushed new matches. Ended resident requests and history (not isNews) are left out (and stay
 * unstamped). With `tradesByUser`, a match whose record is not an alert for that member (context, market_insight: items 0.2 and 1.1)
 * is left out too, so a match stored before the label rules existed is never pushed. Pure.
 */
export function pushEntriesFromMatches(
  matches: MatchLike[],
  now: number = Date.now(),
  tradesByUser?: ReadonlyMap<string, readonly string[]>,
): Map<string, PushEntry> {
  const out = new Map<string, PushEntry>();
  const newest = new Map<string, string>();
  const seenAlerts = new Map<string, Set<string>>();
  for (const m of matches) {
    const s = Array.isArray(m.signal) ? m.signal[0] : m.signal;
    if (!s || typeof s.id !== 'number' || !s.title) continue;
    // A city bid is never pushed while HOLLER_BIDS_ENABLED is off, including matches stored while it was on.
    if (bidHidden(s, undefined, now)) continue;
    if (s.source === HOLLER_REQUEST_SOURCE && isEndedRequest({ source: s.source, expires_at: s.expires_at ?? null }, now)) continue;
    const stageUpdate = isStageUpdate(s) && now - Date.parse(s.permitStageAt as string) <= PUSH_STAGE_MAX_AGE_MS;
    if (!stageUpdate && !isNews(s.occurred_at, m.created_at, now)) continue;
    const trades = tradesByUser?.get(m.user_id);
    if (trades && !isAlertLabel(labelForMember({ source: s.source ?? '', kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary, permitStage: s.permitStage, categories: s.categories }, trades))) continue;
    // One weather alert stored once per county is one alert in the count; its other match rows are still stamped with the push.
    const alertKey = alertKeyOf({ source: s.source, alertId: s.alertId });
    const cur = out.get(m.user_id);
    if (cur && alertKey && seenAlerts.get(m.user_id)?.has(alertKey)) {
      if (!cur.matchIds.includes(m.id)) cur.matchIds.push(m.id);
      continue;
    }
    if (alertKey) seenAlerts.set(m.user_id, (seenAlerts.get(m.user_id) ?? new Set<string>()).add(alertKey));
    if (!cur) {
      out.set(m.user_id, { count: 1, ...(stageUpdate ? { updates: 1 } : {}), top: { signalId: s.id, title: s.title, city: s.city, ...(stageUpdate ? { stage: s.permitStage } : {}), ...(s.source ? { source: s.source } : {}) }, matchIds: [m.id] });
      newest.set(m.user_id, m.created_at);
      continue;
    }
    if (cur.matchIds.includes(m.id)) continue;
    cur.count++;
    if (stageUpdate) cur.updates = (cur.updates ?? 0) + 1;
    cur.matchIds.push(m.id);
    if (Date.parse(m.created_at) > Date.parse(newest.get(m.user_id) ?? '')) {
      cur.top = { signalId: s.id, title: s.title, city: s.city, ...(stageUpdate ? { stage: s.permitStage } : {}), ...(s.source ? { source: s.source } : {}) };
      newest.set(m.user_id, m.created_at);
    }
  }
  return out;
}

export interface NotifyDeps {
  now?: Date;
  /** Stop starting new members after this epoch ms. */
  deadline?: number;
  send?: (m: PushMessage) => Promise<SendResult>;
  configured?: boolean;
}

const chunks = <T>(list: T[], n: number): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** Never-pushed new matches of these members since `since`, in pages. 'not_ready' before migration 0020 (no pushed_at column). */
async function unpushedMatches(db: Db, userIds: string[], since: string, before?: string): Promise<{ rows: MatchLike[]; error: 'not_ready' | 'failed' | null }> {
  const rows: MatchLike[] = [];
  for (const ids of chunks(userIds, CHUNK)) {
    for (let page = 0; page < MAX_MATCH_PAGES; page++) {
      let q = db
        .from('holler_matches')
        .select(`id, user_id, created_at, signal:holler_signals(id, title, city, source, expires_at, occurred_at, kind, summary, categories, subtype:data->>subtype, alertId:data->>alertId, ${STAGE_SELECT})`)
        .in('user_id', ids)
        .eq('status', 'new')
        .is('pushed_at', null)
        .gte('created_at', since);
      if (before) q = q.lt('created_at', before);
      const { data, error } = await q
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return { rows, error: isMissingTable(error) ? 'not_ready' : 'failed' };
      const got = (Array.isArray(data) ? data : []) as unknown as MatchLike[];
      rows.push(...got);
      if (got.length < PAGE) break;
    }
  }
  return { rows, error: null };
}

export async function pushNewMatches(db: Db, deps: NotifyDeps = {}): Promise<PushCounts> {
  const counts: PushCounts = {
    status: 'ok',
    considered: 0,
    members_pushed: 0,
    devices_sent: 0,
    matches_pushed: 0,
    skipped_off: 0,
    skipped_locked: 0,
    skipped_recent: 0,
    skipped_nothing_new: 0,
    dead_tokens: 0,
    payload_errors: 0,
    failed: 0,
  };
  if (!(deps.configured ?? isFcmConfigured())) return { ...counts, status: 'not_configured' };
  const now = deps.now ?? new Date();
  const nowMs = now.getTime();
  const send = deps.send ?? ((m: PushMessage) => sendPush(m));

  try {
    // 1. Devices, then their owners' profiles.
    const read = await allActiveTokens(db);
    if (read.error === 'not_ready') return { ...counts, status: 'not_ready' };
    if (read.error) counts.failed++; // keep going with the devices read so far
    const byUser = new Map<string, ActiveToken[]>();
    for (const t of read.tokens) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t]);
    counts.considered = byUser.size;
    if (byUser.size === 0) return counts;

    const profiles: ProfileRow[] = [];
    for (const ids of chunks([...byUser.keys()], CHUNK)) {
      const { data, error } = await db
        .from('holler_profiles')
        .select('user_id, city, subscription_status, trial_ends_at, plan_source, store_expires_at, push_alerts, last_pushed_at, categories, plan')
        .in('user_id', ids);
      if (error) return { ...counts, status: 'not_ready' }; // migration 0020 not applied yet, or a read failure: no push this run
      profiles.push(...((data ?? []) as ProfileRow[]));
    }

    // Member language (migration 0024), read on its own: a database without the column fails this read and every push stays English.
    const langById = new Map<string, Lang>();
    for (const ids of chunks([...byUser.keys()], CHUNK)) {
      const { data: langRows, error: langErr } = await db.from('holler_profiles').select('user_id, language').in('user_id', ids);
      if (langErr) {
        langById.clear();
        break;
      }
      for (const r of (langRows ?? []) as unknown as Array<{ user_id?: string; language?: unknown }>) {
        if (r && typeof r.user_id === 'string') langById.set(r.user_id, parseLang(r.language));
      }
    }

    // 2. Preference, access and the hour.
    const cutoff = nowMs - PUSH_INTERVAL_MS;
    const ready: ProfileRow[] = [];
    for (const p of profiles) {
      if (p.push_alerts === false) {
        counts.skipped_off++;
        continue;
      }
      if (computeAccess(p, nowMs).locked) {
        counts.skipped_locked++;
        continue;
      }
      const last = p.last_pushed_at ? Date.parse(p.last_pushed_at) : NaN;
      if (Number.isFinite(last) && last > cutoff) {
        counts.skipped_recent++;
        continue;
      }
      ready.push(p);
    }
    if (ready.length === 0) return counts;

    // 3. What is new since each member's last push.
    const m = await unpushedMatches(db, ready.map((p) => p.user_id), new Date(nowMs - PUSH_LOOKBACK_MS).toISOString());
    if (m.error === 'not_ready') return { ...counts, status: 'not_ready' };
    if (m.error) counts.failed++;
    // Each member's plan-limited trades, so a context or market_insight match is not pushed (it stays unstamped).
    const tradesByUser = new Map(
      ready.map((p) => [
        p.user_id,
        matchScope({ categories: p.categories ?? null, lat: null, lon: null, state: null, plan: p.plan ?? null, subscription_status: p.subscription_status, plan_source: p.plan_source ?? null, store_expires_at: p.store_expires_at ?? null }).categories,
      ]),
    );
    // A re-sent stage update is an old match (created long before the lookback): read those once more, keep ONLY stage updates from them.
    const sinceMs = nowMs - PUSH_LOOKBACK_MS;
    const old = await unpushedMatches(db, ready.map((p) => p.user_id), new Date(nowMs - STAGE_REARM_LOOKBACK_MS).toISOString(), new Date(sinceMs).toISOString());
    if (old.error === 'failed') counts.failed++;
    const oldUpdates = old.error ? [] : old.rows.filter((r) => isStageUpdate(Array.isArray(r.signal) ? r.signal[0] : r.signal));
    const entries = pushEntriesFromMatches([...m.rows, ...oldUpdates], nowMs, tradesByUser);

    // 4. Claim the hour, send, stamp.
    const dead: string[] = [];
    let payloadLogged = false;
    for (const p of ready) {
      if (deps.deadline && Date.now() > deps.deadline) break;
      const entry = entries.get(p.user_id);
      if (!entry || entry.count < 1) {
        counts.skipped_nothing_new++;
        continue;
      }
      const devices = byUser.get(p.user_id) ?? [];
      // Claim the hour first (atomic: only one run can move last_pushed_at past the cutoff).
      const { data: claimed, error: cErr } = await db
        .from('holler_profiles')
        .update({ last_pushed_at: now.toISOString() })
        .eq('user_id', p.user_id)
        .or(`last_pushed_at.is.null,last_pushed_at.lt."${new Date(cutoff).toISOString()}"`)
        .select('user_id');
      if (cErr) {
        counts.failed++;
        continue;
      }
      if (!Array.isArray(claimed) || claimed.length === 0) {
        counts.skipped_recent++;
        continue;
      }
      const n = buildNotification(entry, p.city, langById.get(p.user_id) ?? 'en');
      const results: SendResult[] = await Promise.all(
        devices.map((d) =>
          send({ token: d.token, title: n.title, body: n.body, data: n.data as Record<string, string> }).catch(
            (): SendResult => ({ ok: false, reason: 'error', status: 0, code: 'THROWN' }),
          ),
        ),
      );
      let delivered = 0;
      results.forEach((r, i) => {
        if (r.ok) delivered++;
        else if (r.reason === 'dead') dead.push(devices[i].id);
        else if (r.reason === 'payload') {
          counts.payload_errors++;
          if (!payloadLogged) {
            payloadLogged = true;
            console.error('[push] FCM refused the message payload; no device was disabled', r.code);
          }
        }
      });
      counts.devices_sent += delivered;
      if (delivered === 0) {
        // Nothing delivered: the matches stay unstamped and go in the next push.
        counts.failed++;
        continue;
      }
      counts.members_pushed++;
      let stamped = 0;
      for (const ids of chunks(entry.matchIds, CHUNK)) {
        const { error: sErr } = await db
          .from('holler_matches')
          .update({ pushed_at: now.toISOString() })
          .in('id', ids)
          .eq('user_id', p.user_id)
          .is('pushed_at', null);
        if (sErr) counts.failed++;
        else stamped += ids.length;
      }
      counts.matches_pushed += stamped;
    }
    counts.dead_tokens = dead.length;
    await disableTokens(db, dead, now);
  } catch (e) {
    console.error('[push] run failed', e instanceof Error ? e.message : e);
    counts.failed++;
  }
  return counts;
}
