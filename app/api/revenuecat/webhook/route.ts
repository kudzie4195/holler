import { createAdminClient } from '@/lib/supabase/admin';
import { planEvent, sandboxGrantsAllowed, secretMatches, trimRaw } from '@/lib/storebilling/revenuecat';

/**
 * POST /api/revenuecat/webhook: RevenueCat tells Holler about App Store and Google Play subscriptions (server to server).
 *
 * Auth: the Authorization header must equal REVENUECAT_WEBHOOK_SECRET exactly (RevenueCat sends the literal string typed into its
 * dashboard; it does not sign bodies). Compared in constant time. Unset secret: 503 on everything. Wrong or missing header: 401.
 * After auth the answer is always 200, except when the database fails (500, so RevenueCat delivers the event again; the ledger makes
 * a re-delivery harmless). RevenueCat retries any non-2xx, so an event we cannot use (TEST, an anonymous app_user_id, a store we do
 * not sell in, bad JSON) is a 200 with `ignored`.
 * Sandbox events (TestFlight, Play license testers, App Review) are sent like production ones with their env; the database never
 * lets a sandbox event end or change a plan granted by a production event. A sandbox grant gives a plan only when
 * REVENUECAT_ALLOW_SANDBOX is '1' (set it for TestFlight, license testing and App Review; see LAUNCH.md) and the member has no live
 * production store plan; otherwise it is ledgered as 'sandbox' and gives nothing. Every ledger row records the env.
 * TRANSFER (Restore purchases on another account): TRANSFER_TO goes first and names the old owners. In that one database call the old
 * owners are revoked and, when an old owner's plan from this store is live right now, the new owner gets that plan with its product,
 * env and expiry; a lapsed, canceled or refunded plan moves nothing. The TRANSFER_FROM calls that follow are then duplicates.
 * Every state change goes through holler_apply_store_event (migration 0020), the single writer: idempotency, stale events, the
 * product to plan mapping, the expiry rule, refunds, the sandbox rule and the guard against overwriting a live web (Stripe) plan all
 * live there, in one transaction.
 */
export async function POST(req: Request) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET ?? '';
  if (!secret) {
    console.error('[revenuecat] not configured: REVENUECAT_WEBHOOK_SECRET is missing');
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!secretMatches(req.headers.get('authorization'), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    console.warn('[revenuecat] ignored=bad_json');
    return Response.json({ ok: true, ignored: 'bad_json' });
  }

  const plan = planEvent(body);
  if (plan.ignored) {
    console.log(`[revenuecat] ignored=${plan.ignored}`);
    return Response.json({ ok: true, ignored: plan.ignored });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  const raw = trimRaw(body);
  const allowSandbox = sandboxGrantsAllowed();
  const calls = plan.calls;
  const results: { userId: string; result: string }[] = [];
  for (const c of calls) {
    const { data, error } = await admin.rpc('holler_apply_store_event', {
      p_event_id: c.eventId,
      p_user_id: c.userId,
      p_type: c.type,
      p_store: c.store,
      p_env: c.env,
      p_product_id: c.productId,
      p_expires_at: c.expiresAt,
      p_event_ts: c.eventTs,
      p_raw: raw,
      p_from_user_ids: c.fromUserIds ?? null,
      p_allow_sandbox: allowSandbox,
    });
    if (error) {
      console.error(`[revenuecat] type=${c.type} rpc_failed code=${error.code ?? 'unknown'}`);
      return Response.json({ error: 'database' }, { status: 500 });
    }
    const result = typeof data === 'string' ? data : 'unknown';
    results.push({ userId: c.userId, result });
    const line = `[revenuecat] type=${c.type} store=${c.store} env=${c.env ?? '-'} product=${c.productId ?? '-'} result=${result}`;
    // no_profile: money was taken and no plan was granted yet (bought before onboarding). other_store: a member is paying two places.
    // no_expiry / expired: a grant that named no future expiry was refused (a store plan is never granted without one).
    if (result === 'no_profile' || result === 'other_store' || result === 'no_expiry' || result === 'expired') console.error(`${line} NEEDS A LOOK`);
    else console.log(line);
  }
  return Response.json({ ok: true, results });
}
