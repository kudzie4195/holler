/**
 * The /api/m/me body: profile, access and limits for the app. Pure apart from the site URL (passed in).
 * Access follows lib/auth/access.ts computeAccess and lib/plan effectiveTier, the same rules the web feed and settings use.
 */
import type { User } from '@supabase/supabase-js';
import { computeAccess } from '@/lib/auth/access';
import { effectiveTier, parseExtraAreas, parseKeywords, PLAN_LIMITS, TIER_NAMES, type Tier } from '@/lib/plan';
import { billingSourceOf, isStripePlanLive, storePlanLapsed, type BillingRow } from '@/lib/storebilling/source';
import { MANAGE_URLS, type AccessDto, type MeResponse, type PlanLimitsDto, type ProfileDto } from './types';

/** The profile columns this module reads. Every 0004/0020 column is optional so an older database still answers. */
export interface MeProfileRow extends BillingRow {
  business_name: string;
  categories: string[] | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  radius_mi: number;
  alert_email: boolean;
  subscription_status: string;
  trial_ends_at: string;
  plan?: string | null;
  extra_areas?: unknown;
  keywords?: unknown;
  push_alerts?: boolean | null;
  store_product_id?: string | null;
  email_verified_at: string | null;
  created_at: string;
}

export function limitsDto(tier: Tier): PlanLimitsDto {
  const l = PLAN_LIMITS[tier];
  return { serviceAreas: l.areas, extraZips: l.extraAreas, trades: l.trades, keywordWatches: l.keywords };
}

export function profileDto(p: MeProfileRow): ProfileDto {
  return {
    businessName: p.business_name,
    trades: Array.isArray(p.categories) ? p.categories : [],
    zip: p.zip,
    city: p.city,
    state: p.state,
    radiusMi: p.radius_mi,
    extraZips: parseExtraAreas(p.extra_areas).map((a) => a.zip),
    keywords: parseKeywords(p.keywords),
    alertEmail: p.alert_email !== false,
    pushAlerts: p.push_alerts !== false,
    emailVerified: Boolean(p.email_verified_at),
    createdAt: p.created_at,
  };
}

export function accessDto(p: MeProfileRow, siteUrl: string, now: number = Date.now()): AccessDto {
  const a = computeAccess(p, now);
  const paid = (a.status === 'active' || a.status === 'past_due') && !storePlanLapsed(p, now);
  const state = a.locked ? 'locked' : paid ? 'paid' : 'trial';
  const tier = effectiveTier({ plan: p.plan ?? null, subscription_status: paid ? a.status : 'canceled' });
  const source = billingSourceOf(p);
  const manageUrl = !paid
    ? null
    : source === 'apple'
      ? MANAGE_URLS.apple
      : source === 'google'
        ? MANAGE_URLS.google
        : source === 'stripe'
          ? `${siteUrl}/app/settings`
          : null;
  const isStore = source === 'apple' || source === 'google';
  return {
    state,
    tier,
    tierName: TIER_NAMES[tier],
    subscriptionStatus: a.status,
    trialEndsAt: p.trial_ends_at,
    trialDaysLeft: a.daysLeft,
    billingSource: source,
    storeProductId: isStore ? (p.store_product_id ?? null) : null,
    storeExpiresAt: isStore ? (p.store_expires_at ?? null) : null,
    mayBuyInStore: !isStripePlanLive(p),
    manageUrl,
  };
}

export function meBody(user: Pick<User, 'id' | 'email'>, p: MeProfileRow | null, siteUrl: string, now: number = Date.now()): Omit<MeResponse, 'ok'> {
  if (!p) {
    return { user: { id: user.id, email: user.email ?? null }, needsOnboarding: true, profile: null, access: null, limits: limitsDto('starter') };
  }
  const access = accessDto(p, siteUrl, now);
  return { user: { id: user.id, email: user.email ?? null }, needsOnboarding: false, profile: profileDto(p), access, limits: limitsDto(access.tier) };
}
