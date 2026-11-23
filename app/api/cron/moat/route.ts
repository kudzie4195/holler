import { createAdminClient } from '@/lib/supabase/admin';
import { env, siteUrl } from '@/lib/env';
import { sendEmail } from '@/lib/email';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { runMoat } from '@/lib/moat/run';

export const maxDuration = 60;

/** Daily outcome follow-up. Same protection as the other cron routes (Bearer CRON_SECRET only). ?dry=1 sends and writes nothing. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  const started = Date.now();
  try {
    const counts = await runMoat({ db: admin, now: new Date(), dry, siteUrl, secret: env.CRON_SECRET as string, send: dry ? async () => ({ skipped: true, reason: 'dry' }) : sendEmail });
    return Response.json({ ok: true, ...counts, ms: Date.now() - started });
  } catch (e) {
    // A missing table (migration 0015 not applied yet) is not an outage: report it and do nothing.
    const msg = e instanceof Error ? e.message : String(e);
    if (/holler_outcome_asks|holler_signal_feedback/.test(msg) && /does not exist|could not find|schema cache/i.test(msg)) {
      return Response.json({ ok: true, skipped: 'migration_0015_not_applied' });
    }
    console.error('[moat] failed', msg);
    return Response.json({ error: 'moat_failed' }, { status: 500 });
  }
}
