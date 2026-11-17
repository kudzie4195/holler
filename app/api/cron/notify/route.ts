import { createAdminClient } from '@/lib/supabase/admin';
import { env, siteUrl } from '@/lib/env';
import {
  chunk,
  planNotify,
  type PlanProfile,
  renderDigest,
  sendEmail,
  signUnsubscribeToken,
  type DigestItem,
} from '@/lib/email';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { HOLLER_REQUEST_SOURCE, isEndedRequest } from '@/lib/signals/request-visibility';
import { requestTextByPublicId } from '@/lib/requests/details';

export const maxDuration = 60;

const MAX_USERS_PER_RUN = 150;
const MAX_ITEMS_IN_DIGEST = 10;
// PostgREST caps a response at 1000 rows, so read in pages of 1000 and stop after MAX_PAGES (newest first).
const PAGE_SIZE = 1000;
const MAX_PAGES = 15;

interface SignalRow {
  source?: string | null;
  external_id?: string | null;
  expires_at?: string | null;
  kind: string;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  occurred_at: string;
}
interface MatchRow {
  id: number;
  user_id: string;
  created_at: string;
  signal: SignalRow | SignalRow[] | null;
}
interface ProfileRow extends PlanProfile {
  business_name: string;
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  const now = new Date();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  const counts = { users_considered: 0, emailed: 0, matches_marked: 0, matches_skipped_marked: 0, skipped_throttled: 0, skipped_not_entitled: 0, skipped_alerts_off: 0, skipped_unverified: 0, skipped_no_email_provider: 0, failed: 0 };

  // Read every page BEFORE writing anything, so marking rows notified cannot shift the offsets.
  const matches: MatchRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from('holler_matches')
      .select('id, user_id, created_at, signal:holler_signals(source, external_id, expires_at, kind, title, url, city, state, occurred_at)')
      .eq('notified', false)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) return Response.json({ error: 'query_failed', detail: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as MatchRow[];
    matches.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const byUser = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const list = byUser.get(m.user_id) ?? [];
    list.push(m);
    byUser.set(m.user_id, list);
  }
  const userIds = [...byUser.keys()];
  counts.users_considered = userIds.length;
  if (userIds.length === 0) return Response.json({ ok: true, ...counts, ms: Date.now() - started });

  const profiles: ProfileRow[] = [];
  for (const ids of chunk(userIds)) {
    const { data, error: pErr } = await admin
      .from('holler_profiles')
      .select('user_id, business_name, alert_email, subscription_status, trial_ends_at, last_notified_at, email_verified_at, created_at')
      .in('user_id', ids);
    if (pErr) return Response.json({ error: 'profiles_failed', detail: pErr.message }, { status: 500 });
    profiles.push(...((data ?? []) as ProfileRow[]));
  }

  const plan = planNotify(userIds, profiles, now);
  counts.skipped_throttled = plan.counts.throttled ?? 0;
  counts.skipped_alerts_off = plan.counts.alerts_off ?? 0;
  counts.skipped_unverified = (plan.counts.unverified ?? 0) + (plan.counts.unverified_grace ?? 0);
  counts.skipped_not_entitled = (plan.counts.not_entitled ?? 0) + (plan.counts.past_due ?? 0) + (plan.counts.missing ?? 0);

  // Ineligible users will never be emailed these matches: mark them notified so they stop crowding out paying users.
  const skipMatchIds = plan.skip.flatMap((id) => (byUser.get(id) ?? []).map((m) => m.id));
  for (const ids of chunk(skipMatchIds)) {
    const { error: sErr } = await admin.from('holler_matches').update({ notified: true }).in('id', ids);
    if (sErr) counts.failed++;
    else counts.matches_skipped_marked += ids.length;
  }

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const eligible = plan.send.map((id) => profileById.get(id)).filter((p): p is ProfileRow => !!p);

  // A resident request's filtered description is not in the public record. For the request matches of the members about to be
  // emailed, read it here with the service role by the request's public id (open requests only). A failed read only drops the text.
  const requestIds = eligible
    .slice(0, MAX_USERS_PER_RUN)
    .flatMap((p) => byUser.get(p.user_id) ?? [])
    .map((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal))
    .filter((s): s is SignalRow => !!s && s.source === HOLLER_REQUEST_SOURCE && typeof s.external_id === 'string')
    .map((s) => s.external_id as string);
  const requestText = requestIds.length > 0 ? await requestTextByPublicId(admin, requestIds, now) : new Map<string, string>();

  for (const p of eligible.slice(0, MAX_USERS_PER_RUN)) {
    if (Date.now() - started > 50_000) break;
    try {
      const userMatches = byUser.get(p.user_id) ?? [];
      const rows = userMatches
        .map((m) => ({ m, s: Array.isArray(m.signal) ? m.signal[0] : m.signal }))
        // A resident request that has ended is never mailed. Its match is left unmarked: the scan cron deletes the record and the
        // match goes with it (ON DELETE CASCADE).
        .filter((r): r is { m: MatchRow; s: SignalRow } => !!r.s && !isEndedRequest(r.s, now.getTime()));
      if (rows.length === 0) continue;

      const { data: userRes, error: uErr } = await admin.auth.admin.getUserById(p.user_id);
      const email = userRes?.user?.email;
      if (uErr || !email) {
        counts.failed++;
        continue;
      }

      const items: DigestItem[] = rows.slice(0, MAX_ITEMS_IN_DIGEST).map(({ s }) => ({
        kind: s.kind,
        title: s.title,
        place: [s.city, s.state].filter(Boolean).join(', ') || null,
        occurredAt: s.occurred_at,
        sourceUrl: s.url,
        detail: s.source === HOLLER_REQUEST_SOURCE && s.external_id ? (requestText.get(s.external_id) ?? null) : null,
      }));
      const unsubscribeUrl = `${siteUrl}/api/cron/notify/unsubscribe?t=${encodeURIComponent(
        signUnsubscribeToken(p.user_id, env.CRON_SECRET!),
      )}`;
      const mail = renderDigest({
        businessName: p.business_name,
        items,
        totalCount: rows.length,
        appUrl: `${siteUrl}/app`,
        unsubscribeUrl,
        now,
      });
      const res = await sendEmail({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        // RFC 8058 one-click: both headers are required for Gmail/Yahoo bulk-sender rules.
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      if ('skipped' in res && res.skipped) {
        counts.skipped_no_email_provider++;
        continue;
      }
      if (!('ok' in res) || !res.ok) {
        counts.failed++;
        continue;
      }
      const ids = rows.map((r) => r.m.id);
      let mErr = null;
      for (const part of chunk(ids)) {
        const r = await admin.from('holler_matches').update({ notified: true }).in('id', part);
        if (r.error) mErr = r.error;
      }
      const { error: lErr } = await admin
        .from('holler_profiles')
        .update({ last_notified_at: now.toISOString() })
        .eq('user_id', p.user_id);
      if (mErr || lErr) counts.failed++;
      counts.emailed++;
      counts.matches_marked += ids.length;
    } catch (e) {
      console.error('[notify] user failed', p.user_id, e instanceof Error ? e.message : e);
      counts.failed++;
    }
  }

  return Response.json({ ok: true, ...counts, ms: Date.now() - started });
}
