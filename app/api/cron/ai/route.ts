import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { sendEmail } from '@/lib/email';
import { runClassify, classifyModelId, type RunSummary } from '@/lib/ai/classify';
import { claimAlert, dayKey, monthKey, monthlyCapUsd, releaseAlert, type AlertKind, type Db } from '@/lib/ai/budget';
import { renderAiSpendAlert } from '@/lib/ai/alert-email';
import { rematchSignals } from '@/lib/ai/rematch-link';

// Hourly AI step after the scan (lib/ai/classify.ts). Classification runs only from here, never per page view. Reply drafts
// (lib/ai/draft.ts) run only when a signed-in member with access asks for one, under the same monthly cap.
// GET with Authorization: Bearer CRON_SECRET or ?key= (same helper as every other cron route). ?dry=1 reports what it would do:
// no model call, no spend row, no write, no email.
// Every outcome that is not an auth failure answers 200 with a reason, so a failure never looks like an outage to pg_cron:
// the rule-based categories simply stay in place.
// Internal: the response is for the owner, nothing here is shown on a public page.
export const maxDuration = 60;

/** Work stops starting new model calls so that every call (cut at 20 s) is done by this point. */
const RUN_BUDGET_MS = 45_000;

type AlertStatus = 'sent' | 'already_sent' | 'no_recipient' | 'skipped' | 'failed';

async function sendAlerts(db: Db, s: RunSummary): Promise<Partial<Record<AlertKind, AlertStatus>>> {
  const out: Partial<Record<AlertKind, AlertStatus>> = {};
  if (s.dry || s.alerts.length === 0) return out;
  const to = env.ADMIN_EMAIL?.trim() || env.SUPPORT_EMAIL?.trim() || null;
  // The cap alert goes first. Once it is sent, the 80% alert for the month is marked as sent too: it would only be stale news.
  // A model with no price (alert_price) is claimed once per UTC day.
  const order: AlertKind[] = s.alerts.includes('alert_price')
    ? ['alert_price']
    : s.alerts.includes('alert_100')
      ? ['alert_100', 'alert_80']
      : ['alert_80'];
  const day = dayKey(new Date());
  for (const kind of order) {
    if (!to) {
      out[kind] = 'no_recipient';
      continue;
    }
    if (kind === 'alert_80' && out.alert_100 === 'sent') {
      await claimAlert(db, s.month, 'alert_80');
      continue;
    }
    if (!(await claimAlert(db, s.month, kind, day))) {
      out[kind] = 'already_sent';
      continue;
    }
    const mail = renderAiSpendAlert({ kind, month: s.month, spentUsd: s.monthSpentUsd ?? s.capUsd, capUsd: s.capUsd, model: s.model });
    const res = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    if ('ok' in res && res.ok) out[kind] = 'sent';
    else {
      // Give the claim back so a later run tries again.
      await releaseAlert(db, s.month, kind, day);
      out[kind] = 'skipped' in res && res.skipped ? 'skipped' : 'failed';
    }
  }
  return out;
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const started = Date.now();
  const dry = ['1', 'true'].includes(new URL(req.url).searchParams.get('dry') ?? '');
  const noStore = { headers: { 'Cache-Control': 'no-store' } };
  const base = { dry, month: monthKey(new Date()), model: classifyModelId(), capUsd: monthlyCapUsd() };

  let db: Db;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    db = createAdminClient();
  } catch {
    return Response.json({ ...base, ok: false, reason: 'not_configured', elapsedMs: Date.now() - started }, noStore);
  }

  try {
    const summary = await runClassify({ db, dry, deadline: started + RUN_BUDGET_MS, rematch: rematchSignals });
    const alertEmails = await sendAlerts(db, summary);
    return Response.json({ ...summary, alertEmails, elapsedMs: Date.now() - started }, noStore);
  } catch (e) {
    console.error('[cron/ai] failed:', e instanceof Error ? e.message : e);
    return Response.json({ ...base, ok: false, reason: 'error', elapsedMs: Date.now() - started }, noStore);
  }
}
