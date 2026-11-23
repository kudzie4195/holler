import 'server-only';
import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/signals/categories';
import { tradeSignupPickable } from '@/lib/plan/profile-categories';
import { PUBLIC_PRICES, type PublicIntervalPrice, type PublicPlan } from '@/lib/plan/public-prices';
import { limitsDto } from './me';
import { ENTITLEMENT_IDS, MANAGE_URLS, MOBILE_API_VERSION, OFFERING_ID, type ConfigResponse, type PlanDto, type PriceDto } from './types';

/** Builds older than this must update. Raise it only when an old build would break against the server. */
export const MIN_APP_VERSION = '1.0.0';

function price(p: PublicIntervalPrice): PriceDto {
  return { productId: p.storeProductId, cents: p.cents, display: p.display, displayLong: p.displayLong, period: p.period };
}

function plan(p: PublicPlan): PlanDto {
  return {
    entitlement: p.entitlement,
    tier: p.tier,
    name: p.name,
    monthly: price(p.monthly),
    yearly: price(p.annual),
    yearlySaving: p.annualSaving,
    limits: limitsDto(p.tier),
  };
}

const GROUP_LABEL: Record<string, string> = Object.fromEntries(CATEGORY_GROUPS.map((g) => [g.id, g.label]));

/** The /api/m/config body. Every price and the trial length come from lib/plan/public-prices.ts; nothing is typed here. */
export function configBody(siteUrl: string, supportEmail: string | null): Omit<ConfigResponse, 'ok'> {
  return {
    apiVersion: MOBILE_API_VERSION,
    currency: 'USD',
    trialDays: PUBLIC_PRICES.trialDays,
    trialHeadline: PUBLIC_PRICES.trialHeadline,
    trialPhrase: PUBLIC_PRICES.trialPhrase,
    plans: { solo: plan(PUBLIC_PRICES.plans.solo), pro: plan(PUBLIC_PRICES.plans.pro) },
    entitlements: ENTITLEMENT_IDS,
    offeringId: OFFERING_ID,
    // Same rule as the web form (lib/plan/profile-categories.ts tradeSignupPickable): a trade with no live data source, or one sign-up
    // no longer takes (round 24, "coming soon" on the web), is not offered. The server refuses both for a new profile anyway.
    trades: CATEGORIES.filter((c) => tradeSignupPickable(c.id)).map((c) => ({ id: c.id, label: c.label, group: GROUP_LABEL[c.group] ?? null })),
    radius: { min: 5, max: 100, default: 25 },
    links: {
      terms: `${siteUrl}/terms`,
      privacy: `${siteUrl}/privacy`,
      support: supportEmail?.trim() ? `mailto:${supportEmail.trim()}` : `${siteUrl}/faq`,
      manageApple: MANAGE_URLS.apple,
      manageGoogle: MANAGE_URLS.google,
    },
    minAppVersion: MIN_APP_VERSION,
  };
}
