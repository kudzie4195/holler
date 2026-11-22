import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';

export const maxDuration = 30;

/**
 * GET /api/admin/lookup-probe?name=...&city=...&state=GA[&zip=30303][&address=200 W Addison St] (Authorization: Bearer CRON_SECRET).
 * Owner only, Bearer ONLY like the other admin routes: a ?key= secret is refused (401), and so is every caller without the secret.
 *
 * A dry check of the round 18 business listing lookup (lib/enrich/business-lookup.ts). It runs ONE DataForSEO Business Listings search
 * and applies the same name, place and address checks as the alert run, then returns what would be attached and the call's cost.
 *   - zip= tests the ZIP path (a contractor whose record gives its own ZIP): the search is centred on that ZIP.
 *   - address= (with zip=) tests the site path (a business on a license or inspection): the listing must carry the same house number
 *     and street in the same ZIP.
 *   - A refused answer carries `reason`: closed, ambiguous, truncated, address_mismatch, state_mismatch, too_far, shared_phone, no_match,
 *     no_listing, no_contact_detail; a name that is never sent carries generic_name, not_business or short_name.
 * It writes nothing except the DataForSEO spend ledger row (holler_dataforseo_spend, migration 0011: the monthly cap and the daily lookup cap
 * cover it): no cache row, no contact, no card. It does NOT need migration 0026, so the owner can run it before applying 0026 (LAUNCH.md:
 * apply 0026 only after the probe has returned `found` for two businesses the owner knows). ?dry=1 makes no call and returns the request
 * and the estimated cost. One request, no retry, 10 s timeout (maxDuration is 30 s). The response never carries the DataForSEO login or
 * password.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const q = new URL(req.url).searchParams;
  const name = (q.get('name') ?? '').slice(0, 200);
  const city = (q.get('city') ?? '').slice(0, 80);
  const state = (q.get('state') ?? '').slice(0, 30);
  const zip = (q.get('zip') ?? '').trim().slice(0, 10) || null;
  const address = (q.get('address') ?? '').trim().slice(0, 200) || null;
  const dry = ['1', 'true'].includes(q.get('dry') ?? '');
  if (!name || !state || (!city && !zip)) return Response.json({ error: 'name_state_and_city_or_zip_required' }, { status: 400, headers });
  if (address && !zip) return Response.json({ error: 'zip_required_with_address' }, { status: 400, headers });

  const { lookupBusiness, ESTIMATE_PER_LOOKUP_USD } = await import('@/lib/enrich/business-lookup');
  let db = null;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    db = createAdminClient(); // the spend ledger only: the caps apply to a probe too
  } catch {
    db = null;
  }
  const path = address ? 'site' : zip ? 'zip' : 'city';
  try {
    const r = await lookupBusiness(
      { name, city: city || null, state, zip, strict: !!address, street: address },
      { db, timeoutMs: 10_000 },
      { probe: true, dryRun: dry },
    );
    const body =
      r.status === 'found'
        ? { status: 'found', path, wouldAttach: { phone: r.listing.phone, website: r.listing.website }, listingName: r.listing.name, candidates: r.candidates ?? 1, costUsd: r.costUsd }
        : r.status === 'not_found'
          ? { status: 'not_found', path, wouldAttach: null, reason: r.reason ?? null, costUsd: r.costUsd }
          : { status: 'skipped', path, wouldAttach: null, reason: r.reason, costUsd: 0, estimateUsd: r.estimateUsd ?? ESTIMATE_PER_LOOKUP_USD, ...(r.request ? { request: r.request } : {}) };
    return Response.json(body, { status: 200, headers });
  } catch {
    return Response.json({ error: 'probe_failed' }, { status: 500, headers });
  }
}
