import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';

export const maxDuration = 30;

/**
 * GET /api/admin/lookup-probe?name=...&city=...&state=GA (Authorization: Bearer CRON_SECRET). Owner only, Bearer ONLY like the other admin
 * routes: a ?key= secret is refused (401), and so is every caller without the secret.
 * A dry check of the round 18 business listing lookup (lib/enrich/business-lookup.ts): runs ONE DataForSEO Business Listings search for
 * the name near the city, applies the same name and place checks as the alert run, and returns what would be attached and the call's
 * cost. It writes nothing except the DataForSEO spend ledger row (holler_dataforseo_spend, so the monthly cap and the daily lookup cap
 * cover it): no cache row, no contact, no card. ?dry=1 makes no call and returns the request and the estimated cost. Like the alert run it
 * makes no call until migration 0026 is applied (`cache_missing`). One request, no retry, 10 s timeout (maxDuration is 30 s).
 * A name the business classifier rejects (a person) is never sent. The response never carries the DataForSEO login or password.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const q = new URL(req.url).searchParams;
  const name = (q.get('name') ?? '').slice(0, 200);
  const city = (q.get('city') ?? '').slice(0, 80);
  const state = (q.get('state') ?? '').slice(0, 30);
  const dry = ['1', 'true'].includes(q.get('dry') ?? '');
  if (!name || !city || !state) return Response.json({ error: 'name_city_state_required' }, { status: 400, headers });

  const { lookupBusiness, ESTIMATE_PER_LOOKUP_USD } = await import('@/lib/enrich/business-lookup');
  let db = null;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    db = createAdminClient(); // the spend ledger only: the caps apply to a probe too
  } catch {
    db = null;
  }
  try {
    const r = await lookupBusiness({ name, city, state }, { db, timeoutMs: 10_000 }, { probe: true, dryRun: dry });
    const body =
      r.status === 'found'
        ? { status: 'found', wouldAttach: { phone: r.listing.phone, website: r.listing.website }, listingName: r.listing.name, candidates: r.candidates ?? 1, costUsd: r.costUsd }
        : r.status === 'not_found'
          ? { status: 'not_found', wouldAttach: null, reason: r.reason ?? null, costUsd: r.costUsd }
          : { status: 'skipped', wouldAttach: null, reason: r.reason, costUsd: 0, estimateUsd: r.estimateUsd ?? ESTIMATE_PER_LOOKUP_USD, ...(r.request ? { request: r.request } : {}) };
    return Response.json(body, { status: 200, headers });
  } catch {
    return Response.json({ error: 'probe_failed' }, { status: 500, headers });
  }
}
