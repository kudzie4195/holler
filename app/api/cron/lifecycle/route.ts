import { createAdminClient } from '@/lib/supabase/admin';
import { env, siteUrl } from '@/lib/env';
import { sendEmail } from '@/lib/email';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { createStore, runLifecycle } from '@/lib/lifecycle';
import { rankSignals, scoresFor } from '@/lib/ai';
import { matchScope } from '@/lib/plan/scope';
import { loadMemberLangs } from '@/lib/auth/member-lang';

export const maxDuration = 60;

/**
 * Hourly. Sends the welcome, trial_ending and trial_ended emails (lib/lifecycle). Same Bearer-only protection as the other cron routes.
 *   ?dry=1  lists who would get what (user id, kind, variant) and sends nothing; no ledger row is written.
 * At most 200 members per run. Overlapping runs send once: the ledger row is inserted first and only the insert that succeeds sends.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  try {
    const result = await runLifecycle({
      store: createStore(admin),
      send: sendEmail,
      siteUrl,
      secret: env.CRON_SECRET as string,
      dry,
      // The members' languages (round 18 ES): the profile's language column, read once per run in chunks of 100, on its own so a
      // database without migration 0024 changes nothing (English). Never throws.
      langsFor: (userIds) => loadMemberLangs(admin, userIds),
      // Trial-ending "best 3": the stored AI scores for this member's trades (holler_signal_ai, no model call). scoresFor returns an
      // empty map on any error (and before migration 0014), and rankSignals then keeps severity and recency, so the order never breaks.
      rankFor: async (p, items) => {
        // The plan-limited trades (lib/plan/scope.ts), the same list matching uses.
        const scores = await scoresFor(admin, items.map((i) => i.id), matchScope(p).categories);
        if (scores.size === 0) return undefined;
        const idOf = (x: unknown) => (typeof (x as { id?: unknown }).id === 'number' ? ((x as { id: number }).id) : -1);
        return (list) =>
          rankSignals(list.map((x) => ({ id: idOf(x), severity: x.severity ?? null, occurred_at: x.occurredAt, x })), scores).map((r) => r.x);
      },
    });
    return Response.json({ ...result, ms: Date.now() - started });
  } catch (e) {
    console.error('[lifecycle] run failed:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'run_failed' }, { status: 500 });
  }
}
