import { siteUrl } from '@/lib/env';
import { effectiveTier } from '@/lib/plan';
import { backfillWithLimit } from '@/lib/signals/backfill-run';
import { requireMember } from '@/lib/mobile/auth';
import { fail, ok, preflight, readBody } from '@/lib/mobile/http';
import { later } from '@/lib/mobile/later';
import { meBody, type MeProfileRow } from '@/lib/mobile/me';
import { repairShortTrial } from '@/lib/auth/trial';
import { createAdminClient } from '@/lib/supabase/admin';
import { formMessage, mapFieldErrors, parseProfileInput, profileSaver, targetingChanged, toFormData } from '@/lib/mobile/profile';

const METHODS = 'PATCH';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

const PROFILE_KEYS = ['businessName', 'trades', 'zip', 'radiusMi', 'extraZips', 'keywords', 'alertEmail'] as const;

/**
 * PATCH /api/m/profile: the web Settings save (app/app/settings/actions.ts saveSettings) for the app. Fields left out keep their saved
 * values. Validation and plan limits are saveProfile's. A change to what matching reads (trades, ZIPs, radius, keywords) runs the same
 * rate-limited backfill after the response. `pushAlerts` is the member's own column (migration 0020), written with their own client.
 * Allowed while locked, like the web Settings page.
 */
export async function PATCH(req: Request) {
  const m = await requireMember(req, METHODS, { limit: 'write' });
  if (!m.ok) return m.response;
  const { user, db, profile } = m.ctx;
  const before = profile!;

  const body = await readBody(req);
  if (!body.ok) return fail(req, METHODS, body.error);
  const parsed = parseProfileInput(body.data, 'patch');
  if (!parsed.ok) return fail(req, METHODS, 'invalid', 'Fix the highlighted fields and try again.', parsed.fieldErrors);
  const input = parsed.input;

  if (PROFILE_KEYS.some((k) => input[k] !== undefined)) {
    const save = profileSaver();
    if (!save) return fail(req, METHODS, 'not_configured');
    const tier = effectiveTier({
      plan: before.plan ?? null,
      subscription_status: before.subscription_status,
      plan_source: before.plan_source ?? null,
      store_expires_at: before.store_expires_at ?? null,
    });
    const fd = toFormData(input, before, tier);
    const result = await save(user.id, fd, { db, alertEmail: input.alertEmail });
    if (!result.ok) return fail(req, METHODS, 'invalid', formMessage(result.error), mapFieldErrors(result.fieldErrors));
    if (targetingChanged(before, fd)) {
      const userId = user.id;
      later(async () => {
        const out = await backfillWithLimit(userId);
        if (!out.ran) console.warn(`[mobile] profile backfill skipped: ${out.reason}`);
      });
    }
  }

  if (input.pushAlerts !== undefined) {
    const { error } = await db.from('holler_profiles').update({ push_alerts: input.pushAlerts }).eq('user_id', user.id);
    if (error) return fail(req, METHODS, /push_alerts|column|schema cache/i.test(error.message ?? '') ? 'not_configured' : 'server_error');
  }

  const { data, error } = await db.from('holler_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error || !data) return fail(req, METHODS, 'server_error');
  // Round 18 review r2 R1: the app shows trial days and the paywall from this body, so the same signed-in repair as GET /api/m/me runs first.
  const repairedEnd = await repairShortTrial(user, data as MeProfileRow, createAdminClient);
  const row = repairedEnd ? { ...(data as MeProfileRow), trial_ends_at: repairedEnd } : (data as MeProfileRow);
  return ok(req, METHODS, meBody(user, row, siteUrl, Date.now()));
}
