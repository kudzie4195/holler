import { createAdminClient } from '@/lib/supabase/admin';
import { env, siteUrl } from '@/lib/env';
import {
  decideNotify,
  renderDigest,
  sendEmail,
  signUnsubscribeToken,
  type DigestItem,
  type NotifyProfile,
} from '@/lib/email';
import { isCronAuthorized } from '@/lib/email/cron-auth';

export const maxDuration = 60;

const MAX_USERS_PER_RUN = 150;
const MAX_ITEMS_IN_DIGEST = 10;
const MATCH_FETCH_LIMIT = 3000;

interface SignalRow {
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
interface ProfileRow extends NotifyProfile {
  user_id: string;
  business_name: string;
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  const now = new Date();
  const admin = createAdminClient();

  const counts = { users_considered: 0, emailed: 0, matches_marked: 0, skipped_throttled: 0, skipped_not_entitled: 0, skipped_alerts_off: 0, skipped_no_email_provider: 0, failed: 0 };

  const { data: matches, error } = await admin
    .from('holler_matches')
    .select('id, user_id, created_at, signal:holler_signals(kind, title, url, city, state, occurred_at)')
    .eq('notified', false)
    .eq('status', 'new')
    .order('created_at', { ascending: false })
    .limit(MATCH_FETCH_LIMIT);
  if (error) return Response.json({ error: 'query_failed', detail: error.message }, { status: 500 });

  const byUser = new Map<string, MatchRow[]>();
  for (const m of (matches ?? []) as unknown as MatchRow[]) {
    const list = byUser.get(m.user_id) ?? [];
    list.push(m);
    byUser.set(m.user_id, list);
  }
  const userIds = [...byUser.keys()];
  counts.users_considered = userIds.length;
  if (userIds.length === 0) return Response.json({ ok: true, ...counts, ms: Date.now() - started });

  const { data: profiles, error: pErr } = await admin
    .from('holler_profiles')
    .select('user_id, business_name, alert_email, subscription_status, trial_ends_at, last_notified_at')
    .in('user_id', userIds);
  if (pErr) return Response.json({ error: 'profiles_failed', detail: pErr.message }, { status: 500 });

  const eligible: ProfileRow[] = [];
  for (const p of (profiles ?? []) as ProfileRow[]) {
    const d = decideNotify(p, now);
    if (d.ok) eligible.push(p);
    else if (d.reason === 'throttled') counts.skipped_throttled++;
    else if (d.reason === 'not_entitled') counts.skipped_not_entitled++;
    else counts.skipped_alerts_off++;
  }

  for (const p of eligible.slice(0, MAX_USERS_PER_RUN)) {
    if (Date.now() - started > 50_000) break;
    try {
      const userMatches = byUser.get(p.user_id) ?? [];
      const rows = userMatches
        .map((m) => ({ m, s: Array.isArray(m.signal) ? m.signal[0] : m.signal }))
        .filter((r): r is { m: MatchRow; s: SignalRow } => !!r.s);
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
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
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
      const { error: mErr } = await admin.from('holler_matches').update({ notified: true }).in('id', ids);
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
