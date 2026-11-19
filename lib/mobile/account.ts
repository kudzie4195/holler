import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leaveHollerPatch } from '@/lib/auth/membership';
import { isHollerMetadata } from '@/lib/stripe/scope';
import { isStorePlanLive } from '@/lib/storebilling/source';
import { readShadowStore } from '@/lib/storebilling/shadow';
import { MANAGE_URLS } from './types';

type Admin = Pick<SupabaseClient, 'from' | 'auth'>;

export type DeleteAccountResult =
  | { ok: true; storeSubscription: { store: 'apple' | 'google'; manageUrl: string } | null }
  | { ok: false; error: 'billing_cancel_failed' | 'failed' };

interface ProfileForDelete {
  created_at?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  plan_source?: string | null;
  subscription_status?: string | null;
  store_expires_at?: string | null;
}

/**
 * THE Holler account deletion, shared by Settings > Delete account (app/app/settings/actions.ts, after the integration patch) and
 * POST /api/m/account/delete. The project is shared with other products, so the auth user is never deleted. In order:
 *  1. Cancels only Holler Stripe subscriptions (metadata.app === 'holler'). If that fails nothing else is deleted.
 *  2. Writes the trial stamp (app_metadata.holler_trial_started_at, from the profile's created_at) BEFORE any row is deleted, so a
 *     later failure cannot leave a deleted profile with no stamp (coming back would otherwise grant a second trial).
 *  3. Deletes Holler rows: matches, then the profile. Database triggers on the profile delete remove push tokens (migration 0020),
 *     feedback, interest picks, reply records and the other member rows, and detach store billing ledger rows.
 *  4. Strips 'holler' from app_metadata.products and sets holler_left_at. A retry after any partial failure is safe.
 * The caller signs the session out. A live App Store or Google Play plan cannot be canceled from here (only the member can, in the
 * store); it is reported back so the app can say where to cancel it. That includes a store subscription waiting in the billing
 * shadow (a double payer whose live plan is Stripe, review v2 P2): it is read before the profile delete removes the shadow row.
 *
 * Same as the website, on purpose: the shared sign-in (auth.users row: email, password, linked Apple or Google identity) is NOT
 * deleted, because the project is shared and the same sign-in may belong to another product. Only Holler's data and tag go.
 *
 * Sign in with Apple (App Store guideline 5.1.1(v)): when the app offers Sign in with Apple, Apple requires the app's server to revoke
 * the member's Apple tokens on account deletion (POST https://appleid.apple.com/auth/revoke). This server cannot do that today and
 * does not pretend to: it holds no Apple client secret, and it never sees an Apple refresh token (the iPhone sends Apple's id token
 * straight to Supabase, which keeps no Apple refresh token we can read). What it would need:
 *  - env APPLE_TEAM_ID, APPLE_SIGN_IN_KEY_ID, APPLE_SIGN_IN_PRIVATE_KEY (the Sign in with Apple .p8 key) and APPLE_CLIENT_ID
 *    (com.localholler.app), to sign the ES256 client_secret JWT (iss team id, sub client id, aud https://appleid.apple.com);
 *  - the Apple refresh token: the app sends Apple's authorizationCode to the server once at sign-in, the server exchanges it at
 *    POST https://appleid.apple.com/auth/token (grant_type authorization_code) and keeps the refresh token (service role only);
 *  - here, before the rows are deleted: POST https://appleid.apple.com/auth/revoke with client_id, client_secret, token (the refresh
 *    token) and token_type_hint=refresh_token, then forget the stored token.
 * Until then, LAUNCH.md lists this as an owner item before App Review.
 */
export async function deleteHollerAccount(opts: {
  admin: Admin;
  userId: string;
  stripe: Stripe | null;
  /** The member's profile as the caller already read it (null: none). Left out, it is read here with the service role. */
  profile?: ProfileForDelete | null;
  now?: Date;
}): Promise<DeleteAccountResult> {
  const { admin, userId, stripe } = opts;
  const now = opts.now ?? new Date();
  try {
    let profile: ProfileForDelete | null;
    if (opts.profile !== undefined) profile = opts.profile;
    else {
      const { data: profData, error: profErr } = await admin.from('holler_profiles').select('*').eq('user_id', userId).maybeSingle();
      if (profErr) return { ok: false, error: 'failed' };
      profile = (profData as ProfileForDelete | null) ?? null;
    }

    if (stripe && profile && (profile.stripe_subscription_id || profile.stripe_customer_id)) {
      try {
        const ids = new Set<string>();
        if (profile.stripe_customer_id) {
          const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: 'all', limit: 100 });
          for (const sub of subs.data) {
            if (isHollerMetadata(sub.metadata) && sub.status !== 'canceled' && sub.status !== 'incomplete_expired') ids.add(sub.id);
          }
        }
        if (profile.stripe_subscription_id) {
          try {
            const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
            if (isHollerMetadata(sub.metadata) && sub.status !== 'canceled' && sub.status !== 'incomplete_expired') ids.add(sub.id);
          } catch (e) {
            if ((e as { code?: string }).code !== 'resource_missing') throw e;
          }
        }
        for (const id of ids) {
          try {
            await stripe.subscriptions.cancel(id);
          } catch (e) {
            if ((e as { code?: string }).code !== 'resource_missing') throw e;
          }
        }
      } catch {
        return { ok: false, error: 'billing_cancel_failed' };
      }
    }

    const rowStore: 'apple' | 'google' | null = profile?.plan_source === 'apple' || profile?.plan_source === 'google' ? profile.plan_source : null;
    // The live store plan on the row first; otherwise a store subscription still running in the shadow (read before the delete).
    const store = rowStore && isStorePlanLive(profile, now.getTime()) ? rowStore : profile ? await readShadowStore(admin, userId, now.getTime()) : null;
    const storeSubscription = store ? { store, manageUrl: MANAGE_URLS[store] } : null;

    // Stamp first: the profile row is the only record of when the trial started, and the next step deletes it.
    const { data: before, error: bErr } = await admin.auth.admin.getUserById(userId);
    if (bErr || !before?.user) return { ok: false, error: 'failed' };
    const stamp = leaveHollerPatch(before.user.app_metadata, now, profile?.created_at).holler_trial_started_at;
    if (stamp !== undefined) {
      const { error: sErr } = await admin.auth.admin.updateUserById(userId, { app_metadata: { holler_trial_started_at: stamp } });
      if (sErr) return { ok: false, error: 'failed' };
    }

    // Holler rows only. Matches first; profile last. Deleting the profile also deletes the member's push tokens (trigger
    // holler_profiles_delete_mobile, migration 0020, the same migration that creates the table), feedback and interest picks.
    const { error: mErr } = await admin.from('holler_matches').delete().eq('user_id', userId);
    if (mErr) return { ok: false, error: 'failed' };
    const { error: pErr } = await admin.from('holler_profiles').delete().eq('user_id', userId);
    if (pErr) return { ok: false, error: 'failed' };

    const { data: fresh, error: gErr } = await admin.auth.admin.getUserById(userId);
    if (gErr || !fresh?.user) return { ok: false, error: 'failed' };
    const { error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: leaveHollerPatch(fresh.user.app_metadata, now, profile?.created_at),
    });
    if (error) return { ok: false, error: 'failed' };
    return { ok: true, storeSubscription };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

