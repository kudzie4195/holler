import { parseLang, type Lang } from '@/lib/i18n';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk, decideNotify, signUnsubscribeToken, type PlanProfile } from '@/lib/email';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';
import { FOLLOWUP_SIGNAL_SELECT, followupDrop, followupFilterEnabled } from '@/lib/signals/followup-filter';
import { ASK_AFTER_DAYS, ASK_WINDOW_DAYS, EMAIL_GAP_DAYS, EMAIL_MAX_ALERTS } from './outcome';
import { signOutcomeToken } from './token';
import { missingStoreColumn, STORE_PROFILE_COLUMNS } from '@/lib/storebilling/source';
import { renderFollowUp, type FollowUpItem } from './email';

type Db = Pick<SupabaseClient, 'from' | 'auth'>;
type SendFn = (input: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }) => Promise<
  { skipped: true; reason: string } | { skipped?: false; ok: true; id?: string } | { skipped?: false; ok: false; error: string }
>;

const MAX_CANDIDATES = 600;
/** Pages of MAX_CANDIDATES feedback rows read per run while looking for un-asked ones (6,000 rows at most). */
const MAX_SCAN_PAGES = 10;
/**
 * The already-asked lookup is paged (verify-v3 P2): PostgREST caps one answer at max_rows (Supabase default 1000), and 100 members
 * can hold more ask rows than that. Pages of ASK_PAGE rows in a stable order until an EMPTY page (a short page is not the last one when
 * max_rows is below ASK_PAGE). A lookup longer than MAX_ASK_PAGES pages throws: the run stops rather than ask anyone twice.
 */
const ASK_PAGE = 1000;
const MAX_ASK_PAGES = 200;
const MAX_USERS_PER_RUN = 100;
const PROFILE_COLUMNS: string = 'user_id, business_name, alert_email, subscription_status, trial_ends_at, last_notified_at, email_verified_at, created_at';
const DAY = 86_400_000;

export interface MoatRunCounts {
  dry: boolean;
  candidates: number;
  users: number;
  emailed: number;
  emailed_alerts: number;
  feed_only_asks: number;
  skipped_gap: number;
  skipped_ineligible: number;
  send_failed: number;
  failed: number;
  /**
   * Round 35: candidates left out by the follow-up filter (HOLLER_FOLLOWUP_FILTER_ENABLED, lib/signals/followup-filter.ts): a bid whose source
   * switch is off (or an E-Rate row with HOLLER_ERATE_ENABLED empty), or a hand-added bid the owner retired. Absent while the switch is off.
   * A dry run counts the same. Left-out candidates are not asked, so they are read again next run while inside the window.
   */
  followup_dropped?: { bid_hidden: number; retired: number };
}

interface Cand {
  user_id: string;
  signal_id: number;
  updated_at: string;
}
interface Sig {
  id: number;
  source: string;
  kind: string;
  title: string;
  city: string | null;
  state: string | null;
  occurred_at: string;
  /** Round 35 (FOLLOWUP_SIGNAL_SELECT, read only while the follow-up filter is on). */
  subtype?: string | null;
  expires_at?: string | null;
  dueDate?: string | null;
  retiredAt?: string | null;
}
interface Prof extends PlanProfile {
  business_name: string;
}

/**
 * The daily follow-up. For every alert a member marked Useful 7 to 37 days ago (and has not moved to Led to work) with no ask yet:
 *  - the ask row is written FIRST (unique on member and alert), so an alert is asked once even if the job runs twice;
 *  - a member who can be emailed (alerts on, verified, entitled, no follow-up email in the last 7 days) gets ONE email with up to 5
 *    alerts, each with signed Yes and No links; the rest of their candidates wait for next week;
 *  - a member who cannot be emailed gets feed-only asks (the prompt shows on the card).
 * dry: reads and counts, writes nothing, sends nothing. Never sends to a member whose email alerts are off.
 */
export async function runMoat(args: {
  db: Db;
  now: Date;
  dry: boolean;
  siteUrl: string;
  secret: string;
  send: SendFn;
}): Promise<MoatRunCounts> {
  const { db, now, dry, siteUrl, secret, send } = args;
  const counts: MoatRunCounts = { dry, candidates: 0, users: 0, emailed: 0, emailed_alerts: 0, feed_only_asks: 0, skipped_gap: 0, skipped_ineligible: 0, send_failed: 0, failed: 0 };

  const newest = new Date(now.getTime() - ASK_AFTER_DAYS * DAY).toISOString();
  const oldest = new Date(now.getTime() - ASK_WINDOW_DAYS * DAY).toISOString();
  // Already-asked rows are dropped page by page BEFORE the candidate limit: an answered "no" or "not yet" keeps the verdict useful, so
  // a window full of asked rows must not hide a new one. Oldest first, at most MAX_SCAN_PAGES pages of MAX_CANDIDATES rows.
  let cands: Cand[] = [];
  // Round 35: the same bid switches and retirement the feed applies (a bid that has simply closed is still asked about: that is when "did it
  // lead to work?" is asked). The test runs page by page BEFORE the candidate limit, so hidden bids never use up the 600 places. Off, nothing
  // here differs from before.
  const filterOn = followupFilterEnabled();
  const sigs = new Map<number, Sig>();
  const dropped = { bid_hidden: 0, retired: 0 };
  const hiddenNow = (c: Cand): boolean => {
    const s = sigs.get(c.signal_id);
    const why = s ? followupDrop(s, { nowMs: now.getTime(), keepClosed: true }) : null;
    if (!why) return false;
    dropped[why]++;
    return true;
  };
  const readSigs = async (signalIds: number[]) => {
    for (const ids of chunk([...new Set(signalIds)].filter((n) => !sigs.has(n)))) {
      const columns: string = filterOn ? `id, source, kind, title, city, state, occurred_at, subtype:data->>subtype, ${FOLLOWUP_SIGNAL_SELECT}` : 'id, source, kind, title, city, state, occurred_at';
      const r = await db.from('holler_signals').select(columns).in('id', ids);
      if (r.error) throw new Error(`signals read failed: ${r.error.message}`);
      for (const s of (r.data ?? []) as unknown as Sig[]) sigs.set(s.id, s);
    }
  };
  // The next page starts after the rows actually returned, and only an EMPTY page ends the read (max_rows may be below a page).
  let from = 0;
  for (let page = 0; page < MAX_SCAN_PAGES && cands.length < MAX_CANDIDATES; page++) {
    const fb = await db
      .from('holler_signal_feedback')
      .select('user_id, signal_id, updated_at')
      .eq('verdict', 'useful')
      .lte('updated_at', newest)
      .gte('updated_at', oldest)
      .order('updated_at', { ascending: true })
      .order('user_id', { ascending: true })
      .order('signal_id', { ascending: true })
      .range(from, from + MAX_CANDIDATES - 1);
    if (fb.error) throw new Error(`feedback read failed: ${fb.error.message}`);
    const rows = (fb.data ?? []) as Cand[];
    const asked = new Set<string>();
    for (const ids of chunk([...new Set(rows.map((c) => c.user_id))], 100)) {
      for (let offset = 0, n = 0; ; n++) {
        if (n >= MAX_ASK_PAGES) throw new Error('asks read failed: more than the page limit');
        const r = await db
          .from('holler_outcome_asks')
          .select('user_id, signal_id')
          .in('user_id', ids)
          .order('user_id', { ascending: true })
          .order('signal_id', { ascending: true })
          .range(offset, offset + ASK_PAGE - 1);
        if (r.error) throw new Error(`asks read failed: ${r.error.message}`);
        const got = (r.data ?? []) as Array<{ user_id: string; signal_id: number }>;
        if (got.length === 0) break;
        for (const a of got) asked.add(`${a.user_id}:${a.signal_id}`);
        offset += got.length;
      }
    }
    if (rows.length === 0) break;
    const fresh = rows.filter((c) => !asked.has(`${c.user_id}:${c.signal_id}`));
    if (filterOn) {
      await readSigs(fresh.map((c) => c.signal_id));
      cands.push(...fresh.filter((c) => !hiddenNow(c)));
    } else cands.push(...fresh);
    from += rows.length;
  }
  cands = cands.slice(0, MAX_CANDIDATES);

  // Public signal fields only. A resident request is never asked about.
  await readSigs(cands.map((c) => c.signal_id));
  cands = cands.filter((c) => {
    const s = sigs.get(c.signal_id);
    return !!s && s.source !== HOLLER_REQUEST_SOURCE;
  });
  if (filterOn) counts.followup_dropped = dropped;
  counts.candidates = cands.length;

  const byUser = new Map<string, Cand[]>();
  for (const c of cands) byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c]);
  const userIds = [...byUser.keys()].slice(0, MAX_USERS_PER_RUN);
  counts.users = userIds.length;
  if (userIds.length === 0) return counts;

  const profiles = new Map<string, Prof>();
  // The member's language (round 18 ES), read on its own like the notify cron does: a database without migration 0024 (no column), a
  // fake without the table, or any error leaves the map empty, and the email is English as before.
  const langs = new Map<string, Lang>();
  const lastEmailAsk = new Map<string, number>();
  for (const ids of chunk(userIds, 100)) {
    // The 0020 store columns let decideNotify skip a lapsed store plan; before 0020 the read retries without them.
    const read = (columns: string) => db.from('holler_profiles').select(columns).in('user_id', ids);
    let p = await read(`${PROFILE_COLUMNS}, ${STORE_PROFILE_COLUMNS}`);
    if (p.error && missingStoreColumn(p.error.message)) p = await read(PROFILE_COLUMNS);
    if (p.error) throw new Error(`profiles read failed: ${p.error.message}`);
    for (const row of (p.data ?? []) as unknown as Prof[]) profiles.set(row.user_id, row);
    try {
      const l = await db.from('holler_profiles').select('user_id, language').in('user_id', ids);
      if (!l.error) for (const row of (l.data ?? []) as unknown as Array<{ user_id?: unknown; language?: unknown }>) if (typeof row.user_id === 'string') langs.set(row.user_id, parseLang(row.language));
    } catch {
      // English
    }
    const gap = await db
      .from('holler_outcome_asks')
      .select('user_id, asked_at')
      .in('user_id', ids)
      .eq('channel', 'email')
      .gte('asked_at', new Date(now.getTime() - EMAIL_GAP_DAYS * DAY).toISOString());
    if (gap.error) throw new Error(`gap read failed: ${gap.error.message}`);
    for (const g of (gap.data ?? []) as Array<{ user_id: string; asked_at: string }>) {
      lastEmailAsk.set(g.user_id, Math.max(lastEmailAsk.get(g.user_id) ?? 0, Date.parse(g.asked_at) || 0));
    }
  }

  const claim = async (rows: Cand[], channel: 'email' | 'feed'): Promise<number[]> => {
    const { data, error } = await db
      .from('holler_outcome_asks')
      .upsert(
        rows.map((c) => ({ user_id: c.user_id, signal_id: c.signal_id, channel, asked_at: now.toISOString() })),
        { onConflict: 'user_id,signal_id', ignoreDuplicates: true },
      )
      .select('signal_id');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ signal_id: number }>).map((r) => r.signal_id);
  };

  for (const userId of userIds) {
    try {
      const list = byUser.get(userId) ?? [];
      const prof = profiles.get(userId);
      // decideNotify with a zero gap: alerts on, verified, trialing inside the trial or active. The hourly digest throttle does not apply.
      const eligible = !!prof && decideNotify(prof, now, 0).ok;
      if (!eligible) {
        counts.skipped_ineligible++;
        if (dry) {
          counts.feed_only_asks += list.length;
          continue;
        }
        counts.feed_only_asks += (await claim(list, 'feed')).length;
        continue;
      }
      if (now.getTime() - (lastEmailAsk.get(userId) ?? 0) < EMAIL_GAP_DAYS * DAY) {
        counts.skipped_gap++;
        continue;
      }
      const chosen = list.slice(0, EMAIL_MAX_ALERTS);
      if (dry) {
        counts.emailed++;
        counts.emailed_alerts += chosen.length;
        continue;
      }
      const claimedIds = new Set(await claim(chosen, 'email'));
      const mine = chosen.filter((c) => claimedIds.has(c.signal_id));
      if (mine.length === 0) continue;

      const demote = async () => {
        for (const part of chunk(mine.map((m) => m.signal_id))) {
          await db.from('holler_outcome_asks').update({ channel: 'feed' }).eq('user_id', userId).in('signal_id', part);
        }
        counts.feed_only_asks += mine.length;
      };

      const { data: u, error: uErr } = await db.auth.admin.getUserById(userId);
      const email = u?.user?.email;
      if (uErr || !email) {
        await demote();
        counts.failed++;
        continue;
      }
      const lang: Lang = langs.get(userId) ?? 'en';
      // A Spanish email's links say l=es, which only picks the language of the answer page (app/api/feedback/outcome/route.ts).
      const l = lang === 'en' ? '' : `&l=${lang}`;
      const items: FollowUpItem[] = mine.map((c) => {
        const s = sigs.get(c.signal_id) as Sig;
        const item: FollowUpItem = {
          title: s.title,
          kind: s.kind,
          place: [s.city, s.state].filter(Boolean).join(', ') || null,
          occurredAt: s.occurred_at,
          yesUrl: `${siteUrl}/api/feedback/outcome?t=${encodeURIComponent(signOutcomeToken(userId, c.signal_id, 'yes', secret, now.getTime()))}${l}`,
          noUrl: `${siteUrl}/api/feedback/outcome?t=${encodeURIComponent(signOutcomeToken(userId, c.signal_id, 'no', secret, now.getTime()))}${l}`,
        };
        return lang === 'en' ? item : { ...item, source: s.source };
      });
      const unsubscribeUrl = `${siteUrl}/api/cron/notify/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(userId, secret))}`;
      const mail =
        lang === 'en'
          ? renderFollowUp({ businessName: prof?.business_name ?? 'your business', items, unsubscribeUrl, now })
          : renderFollowUp({ businessName: prof?.business_name ?? 'su negocio', items, unsubscribeUrl, now, lang });
      const res = await send({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      if ('skipped' in res && res.skipped) {
        await demote();
        continue;
      }
      if (!('ok' in res) || !res.ok) {
        await demote();
        counts.send_failed++;
        continue;
      }
      counts.emailed++;
      counts.emailed_alerts += mine.length;
    } catch (e) {
      console.error('[moat] user failed', userId, e instanceof Error ? e.message : e);
      counts.failed++;
    }
  }
  return counts;
}
