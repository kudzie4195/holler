import { siteUrl } from '@/lib/env';
import { hasHollerTag, rejoinHollerPatch } from '@/lib/auth/membership';
import { LIMITS } from '@/lib/auth/limits';
import { applyTrialRules } from '@/lib/auth/trial';
import { applyPendingVerification, sendVerifyEmail } from '@/lib/auth/verification';
import { recordSignup } from '@/lib/analytics/request';
import { priorTrial, shouldRecordSignup } from '@/lib/analytics/signup';
import { effectiveTier } from '@/lib/plan';
import { backfillWithLimit } from '@/lib/signals/backfill-run';
import { adminOrNull } from '@/lib/mobile/admin';
import { requireMember } from '@/lib/mobile/auth';
import { fail, ok, preflight, readBody } from '@/lib/mobile/http';
import { MOBILE_LIMITS, safeHit } from '@/lib/mobile/limits';
import { sendConfirmOnlyEmail } from '@/lib/mobile/verify-email';
import { meBody, type MeProfileRow } from '@/lib/mobile/me';
import { formMessage, mapFieldErrors, parseProfileInput, profileSaver, toFormData } from '@/lib/mobile/profile';

const METHODS = 'POST';
export const maxDuration = 30;

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/**
 * POST /api/m/onboarding: creates the member's Holler profile. The same steps as the web onboarding action
 * (app/onboarding/actions.ts), in the same order, through the same library functions:
 *  saveProfile (validation, plan limits) -> applyTrialRules (one trial per person) -> recordSignup (not for a returning person)
 *  -> backfillWithLimit (the last 14 days, awaited so the first feed is full) -> applyPendingVerification.
 *
 * Who may onboard here (the rule, stated): any account whose bearer token the Auth server accepts. A bearer token only exists after a
 * sign-in inside the Holler app (email and password, Sign in with Apple or Google), so the person has just chosen Holler. That is the
 * mobile counterpart of the website's signup form, and it is why this route, unlike web login, does not refuse an account of another
 * product on the shared project that has no Holler tag yet.
 * The account is then tagged exactly as web signup tags it: app_metadata.products gains 'holler' (rejoinHollerPatch, the same patch web
 * login uses for a returning member; every other product's tag is kept, and holler_left_at is cleared). The tag is written with
 * auth.admin.updateUserById, which sends no email. No Supabase Auth email is ever triggered from here (no signUp, resend, invite or
 * generateLink): the shared project's templates may carry another product's brand.
 * Email: a first-time member who has not confirmed the address gets Holler's own welcome and confirm email (lib/auth/verification.ts,
 * the one web signup sends), under the website's limiter: 3 an hour per member (LIMITS.verifyResendUser, the web resend limit) and
 * 3 an hour per address. The counters survive account deletion, so delete and onboard again does not reset them. When the limiter
 * says no, or cannot run, the email is skipped (the member can ask for it again in Settings). The route itself allows 10 tries an
 * hour per member.
 * A returning member (the account had a Holler trial stamp before this onboarding: deleted the account and came back) never gets the
 * welcome that promises a trial (verify-v3 P1): one trial per person, so their trial keeps its original end. If the address still
 * needs confirming they get the plain confirm message (lib/mobile/verify-email.ts), under the same limiter; if not, nothing. When
 * the stamp could not be read, only a trial that applyTrialRules just started counts as a first trial (shouldRecordSignup).
 */
export async function POST(req: Request) {
  const m = await requireMember(req, METHODS, { needProfile: false, limit: 'onboarding' });
  if (!m.ok) return m.response;
  const { user, db, profile: before } = m.ctx;

  const body = await readBody(req);
  if (!body.ok) return fail(req, METHODS, body.error);
  const parsed = parseProfileInput(body.data, 'onboarding');
  if (!parsed.ok) return fail(req, METHODS, 'invalid', 'Fix the highlighted fields and try again.', parsed.fieldErrors);

  const save = profileSaver();
  if (!save) return fail(req, METHODS, 'not_configured');
  const tier = effectiveTier(
    before
      ? {
          plan: before.plan ?? null,
          subscription_status: before.subscription_status,
          plan_source: before.plan_source ?? null,
          store_expires_at: before.store_expires_at ?? null,
        }
      : null,
  );
  const result = await save(user.id, toFormData(parsed.input, before, tier), { db });
  if (!result.ok) return fail(req, METHODS, 'invalid', formMessage(result.error), mapFieldErrors(result.fieldErrors));

  const admin = adminOrNull();
  const wasTagged = hasHollerTag(user.app_metadata);
  // Read the trial stamp before applyTrialRules writes it: a stamp already there means a returning member, not a new signup.
  const prior = await priorTrial(user.id);
  let trial: Awaited<ReturnType<typeof applyTrialRules>> = 'error';
  if (admin) {
    if (!wasTagged) {
      try {
        const { error } = await admin.auth.admin.updateUserById(user.id, { app_metadata: rejoinHollerPatch(user.app_metadata) });
        if (error) console.error('[mobile] onboarding tag failed', error.code ?? 'unknown');
      } catch (e) {
        console.error('[mobile] onboarding tag failed', e instanceof Error ? e.message : e);
      }
    }
    trial = await applyTrialRules(admin, user.id);
  }
  const firstTrial = shouldRecordSignup(prior, trial);
  if (firstTrial) await recordSignup(user.id);
  await backfillWithLimit(user.id);
  await applyPendingVerification(user);

  const { data, error } = await db.from('holler_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error || !data) return fail(req, METHODS, 'server_error');
  const row = data as MeProfileRow;
  const pendingVerified = typeof (user.app_metadata as { holler_email_verified_at?: unknown } | undefined)?.holler_email_verified_at === 'string';
  if (!before && !wasTagged && !row.email_verified_at && !pendingVerified && user.email) {
    const gate = await safeHit([LIMITS.verifyResendUser(user.id), MOBILE_LIMITS.verifyEmail(user.email)], admin);
    if (gate !== 'allowed') console.warn(`[mobile] onboarding welcome email skipped: ${gate}`);
    else if (firstTrial) await sendVerifyEmail(user.id, user.email);
    else await sendConfirmOnlyEmail(user.id, user.email);
  }
  return ok(req, METHODS, meBody(user, row, siteUrl, Date.now()));
}
