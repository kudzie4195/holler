/**
 * THE contract between the Holler server and the Holler mobile app (Capacitor iOS and Android, /mobile).
 *
 * Pure TypeScript types and constants. No imports at all, so the app can import this file by relative path
 * (`../lib/mobile/types`) without pulling server code, env or Next into its bundle. Every endpoint is described in
 * /home/claude/gates/r7/mobile-api.md (copied into the repo docs at integration).
 *
 * Rules every endpoint follows:
 *  - JSON in, JSON out. Success bodies carry `ok: true`; failures carry `ok: false` with an `error` code and a short `message`
 *    that is safe to show as is.
 *  - Member endpoints need `Authorization: Bearer <Supabase access token>`. The server checks the token with the Supabase auth API on
 *    every call (a decoded token alone is never trusted). 401 `unauthorized` means: refresh the session, then sign out if it repeats.
 *    503 `unavailable` means the token could not be checked right now (the sign-in service is busy or down): keep the session and
 *    retry after the Retry-After seconds. It never means signed out.
 *  - Every member endpoint is rate limited per member (and per network address before the token is checked). 429 `rate_limited`
 *    carries Retry-After.
 *  - CORS is open only to the Capacitor origins in MOBILE_CORS_ORIGINS. Native HTTP (CapacitorHttp) sends no Origin and is fine too.
 */

/** Bumped only on a breaking change to this file. Sent back by GET /api/m/config. */
export const MOBILE_API_VERSION = 1;

/** Origins the API answers CORS for: the Capacitor iOS webview, the Android webview (https and http). */
export const MOBILE_CORS_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'] as const;

/** Alerts per page in GET /api/m/feed. */
export const FEED_PAGE_SIZE = 30;

/** Bundle id / application id. Store product ids start with it. */
export const MOBILE_APP_ID = 'com.localholler.app';

/** RevenueCat entitlement ids. Equal to the store plan key: `solo` is the plan stored as `starter`. */
export const ENTITLEMENT_IDS = ['solo', 'pro'] as const;
export type EntitlementId = (typeof ENTITLEMENT_IDS)[number];

/** RevenueCat offering that holds the four packages (monthly and annual per plan). */
export const OFFERING_ID = 'default';

/** Custom package identifiers inside OFFERING_ID (two plans share one offering, so the $rc_ defaults cannot be used twice). */
export const PACKAGE_IDS = {
  solo: { monthly: 'solo_monthly', yearly: 'solo_annual' },
  pro: { monthly: 'pro_monthly', yearly: 'pro_annual' },
} as const;

/**
 * Store product ids. Fixed strings: once created in App Store Connect / Play Console they cannot be renamed.
 * Google Play reports a subscription as `<productId>:<basePlanId>`; the server strips the suffix (see storePlanFromProductId).
 */
export const STORE_PRODUCTS = {
  solo: { monthly: 'com.localholler.app.solo.monthly', yearly: 'com.localholler.app.solo.yearly' },
  pro: { monthly: 'com.localholler.app.pro.monthly', yearly: 'com.localholler.app.pro.yearly' },
} as const;

/** Internal plan id (database, Stripe metadata). Display names: starter = "Solo", pro = "Pro". */
export type PlanTier = 'starter' | 'pro';
export const TIER_FOR_ENTITLEMENT: Record<EntitlementId, PlanTier> = { solo: 'starter', pro: 'pro' };

/** trial: inside the free trial. paid: a paid plan is active (or in the card retry window). locked: trial over and nothing paid. */
export type AccessState = 'trial' | 'paid' | 'locked';

/** Who bills the member. `none`: never paid (trial). */
export type BillingSource = 'none' | 'stripe' | 'apple' | 'google';

export type DevicePlatform = 'ios' | 'android';

// ---------------------------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------------------------

export type ApiErrorCode =
  | 'unauthorized' // 401: no token, malformed, expired, or not from this project. Refresh the session, then sign out.
  | 'not_member' // 403: reserved, not sent today (any signed-in account may onboard: see POST /api/m/onboarding)
  | 'needs_onboarding' // 409: no Holler profile yet. Send the member to onboarding.
  | 'forbidden' // 403: the member may not do this
  | 'not_found' // 404: nothing there, or not this member's (the two are never told apart)
  | 'invalid' // 400: the body or query is wrong; see fieldErrors when present
  | 'confirm_required' // 400: account delete without { confirm: "DELETE" }
  | 'unsupported' // 415: body was not application/json
  | 'rate_limited' // 429: wait, then try again
  | 'billing_cancel_failed' // 409: account delete stopped because the web subscription could not be canceled; nothing was deleted
  | 'not_configured' // 503: the server is missing a setting (or a migration). Try later.
  | 'unavailable' // 503 with Retry-After: the sign-in service is busy or down, so the token could not be checked. Keep the session, retry.
  | 'server_error'; // 500

/** Field names in validation errors (onboarding and profile). */
export type ProfileField = 'businessName' | 'trades' | 'zip' | 'radiusMi' | 'extraZips' | 'keywords';

export interface ApiError {
  ok: false;
  error: ApiErrorCode;
  /** Short, plain, safe to show. */
  message: string;
  fieldErrors?: Partial<Record<ProfileField, string>>;
}

export type ApiResult<T> = (T & { ok: true }) | ApiError;

// ---------------------------------------------------------------------------------------------------------------------------------
// GET /api/m/config (public)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PriceDto {
  /** Store product id to buy through RevenueCat. */
  productId: string;
  /** Amount in US cents. */
  cents: number;
  /** "$7.99" */
  display: string;
  /** "$7.99 a month" / "$79.99 a year" */
  displayLong: string;
  /** ISO 8601 period: P1M / P1Y */
  period: 'P1M' | 'P1Y';
}

export interface PlanDto {
  entitlement: EntitlementId;
  tier: PlanTier;
  /** "Solo" / "Pro" */
  name: string;
  monthly: PriceDto;
  yearly: PriceDto;
  /** "about 2 months free", computed from the prices. Empty string when the math does not support a claim. */
  yearlySaving: string;
  limits: PlanLimitsDto;
}

export interface PlanLimitsDto {
  /** Service areas in total (main ZIP plus extra ZIPs). */
  serviceAreas: number;
  /** Extra ZIPs on top of the main one. */
  extraZips: number;
  trades: number;
  keywordWatches: number;
}

export interface TradeDto {
  id: string;
  label: string;
  /** Group heading for the picker, or null for a flat list. */
  group: string | null;
}

export interface ConfigResponse {
  ok: true;
  apiVersion: number;
  currency: 'USD';
  /** Free trial length in days (14). Store introductory offers are set up to match. */
  trialDays: number;
  plans: Record<EntitlementId, PlanDto>;
  entitlements: readonly EntitlementId[];
  offeringId: string;
  /** Trades a member can pick at onboarding (trades with no live source are left out). */
  trades: TradeDto[];
  radius: { min: number; max: number; default: number };
  links: {
    terms: string;
    privacy: string;
    support: string;
    /** Apple's subscription management page. */
    manageApple: string;
    /** Google Play's subscription management page. */
    manageGoogle: string;
  };
  /** Builds older than this must update before use (semver "1.0.0"). */
  minAppVersion: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GET /api/m/me
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ProfileDto {
  businessName: string;
  trades: string[];
  zip: string | null;
  city: string | null;
  state: string | null;
  radiusMi: number;
  /** Pro only: up to 2 extra ZIPs (saved ones stay listed after a downgrade but are not used). */
  extraZips: string[];
  /** Pro only: up to 5 keyword watches. */
  keywords: string[];
  /** Email digest on or off. */
  alertEmail: boolean;
  /** Push notifications for new alerts on or off (all devices). */
  pushAlerts: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface AccessDto {
  state: AccessState;
  /** The plan whose limits apply now. Trial and locked members get Solo limits. */
  tier: PlanTier;
  /** "Solo" / "Pro" */
  tierName: string;
  /** Raw subscription status: trialing | active | past_due | canceled. */
  subscriptionStatus: string;
  trialEndsAt: string;
  /** Whole days left in the trial, 0 when over. */
  trialDaysLeft: number;
  billingSource: BillingSource;
  /** Store product id of a store plan (Play suffix removed), else null. */
  storeProductId: string | null;
  /** When the store plan ends unless renewed, else null. */
  storeExpiresAt: string | null;
  /** False while a live web (Stripe) plan exists: the app must not offer a store purchase then. */
  mayBuyInStore: boolean;
  /** Where the member manages the paid plan: App Store, Google Play or the web Settings page. Null when nothing is paid. */
  manageUrl: string | null;
}

export interface MeResponse {
  ok: true;
  user: { id: string; email: string | null };
  /** True when there is no Holler profile yet: show onboarding. profile and access are then null. */
  needsOnboarding: boolean;
  profile: ProfileDto | null;
  access: AccessDto | null;
  /** Limits of `access.tier` (Solo limits when needsOnboarding). */
  limits: PlanLimitsDto;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// POST /api/m/onboarding and PATCH /api/m/profile
// ---------------------------------------------------------------------------------------------------------------------------------

/** Onboarding needs businessName, trades, zip and radiusMi. PATCH takes any subset; fields left out keep their saved values. */
export interface ProfileInput {
  businessName?: string;
  trades?: string[];
  zip?: string;
  radiusMi?: number;
  /** Pro only. Omit to keep the saved list; [] clears it. */
  extraZips?: string[];
  /** Pro only. Omit to keep the saved list; [] clears it. */
  keywords?: string[];
  /** PATCH only. */
  alertEmail?: boolean;
  /** PATCH only. */
  pushAlerts?: boolean;
}

/** Both endpoints answer with the fresh /api/m/me body. */
export type ProfileSaveResponse = MeResponse;

// ---------------------------------------------------------------------------------------------------------------------------------
// GET /api/m/feed?cursor=   and   GET /api/m/alert/[signalId]
// ---------------------------------------------------------------------------------------------------------------------------------

export type MatchStatus = 'new' | 'saved' | 'done' | 'dismissed';
export type Verdict = 'useful' | 'not_relevant' | 'led_to_work';
export type IntentKey = 'demand' | 'spending' | 'asking' | 'open-bid' | 'new-business' | 'public-post';

export interface FeedbackDto {
  verdict: Verdict;
  /** Whole dollars, only with led_to_work. */
  jobValueUsd: number | null;
}

/** "Who to contact": organisations and public offices only. Members with access only. */
export interface ContactDto {
  role: 'site' | 'business' | 'contractor' | 'awardee' | 'buyer';
  name: string;
  attn?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface AlertDto {
  matchId: number;
  signalId: number;
  /** When the alert reached this member. Feed order (newest first). */
  matchedAt: string;
  status: MatchStatus;
  kind: string;
  source: string;
  /** Human name of the data source, e.g. "National Weather Service alerts". */
  sourceLabel: string | null;
  /** Home page of the data source. */
  sourceUrl: string | null;
  /** Masked (letters and digits replaced by x) for a locked member. */
  title: string;
  summary: string | null;
  /** Link to the record itself. Null for a locked member. */
  url: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  zip: string | null;
  /** "Atlanta, GA" or null. */
  place: string | null;
  occurredAt: string;
  expiresAt: string | null;
  severity: number;
  intent: { key: IntentKey; label: string; line: string };
  /**
   * Opportunity label for this member's trades (lib/signals/lead-rules.ts). `context` records are never sent. Additive field: older
   * app builds ignore it. Show "Act now", "Coming soon" or "Market insight" as a chip; Act Now rows carry the deadline line.
   */
  label: 'act_now' | 'coming_soon' | 'market_insight';
  /** ISO date of a fix-by, due or response date the record publishes. Null means "No deadline published". */
  deadline: string | null;
  /** An open city bid only: "Buyer: X. Due Dec 10, 2026, 19 days left." Null for every other record. Additive: older app builds ignore it. */
  bidLine: string | null;
  distanceMi: number | null;
  /** "3.2 mi away", "under 1 mi away", or null. */
  distanceLabel: string | null;
  feedback: FeedbackDto | null;
  /** Empty for a locked member, and when the record names nobody. */
  contacts: ContactDto[];
  /** Saved outreach draft for this alert, null when none or locked. */
  draft: string | null;
  /** Reserved: a one-line "why this matters" note. Always null for now. */
  ai: { note: string | null };
}

export interface FeedResponse {
  ok: true;
  /** True when the trial is over and nothing is paid: titles are masked, links and contacts are left out. */
  locked: boolean;
  items: AlertDto[];
  /** Pass as ?cursor= for the next page. Null on the last page. */
  nextCursor: string | null;
}

export interface AlertResponse {
  ok: true;
  locked: boolean;
  item: AlertDto;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// POST /api/m/feedback
// ---------------------------------------------------------------------------------------------------------------------------------

export interface FeedbackInput {
  signalId: number;
  verdict: Verdict;
  /** Whole dollars 0 to 1,000,000, only with led_to_work. */
  jobValueUsd?: number | null;
}

export interface FeedbackResponse {
  ok: true;
  feedback: FeedbackDto;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GET /api/m/check?zip=&trade= (public)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface CheckItemDto {
  id: number;
  kind: string;
  source: string;
  sourceLabel: string | null;
  title: string;
  url: string | null;
  place: string | null;
  occurredAt: string;
  severity: number;
  distanceMi: number | null;
}

export interface CheckGroupDto {
  id: string;
  title: string;
  items: CheckItemDto[];
}

export interface CheckResponse {
  ok: true;
  /** results: rows below. uncovered: no sources for this ZIP yet. limited: too many checks, wait a minute. unreadable: try later. */
  mode: 'results' | 'uncovered' | 'limited' | 'unreadable';
  place: { zip: string; city: string; state: string };
  trade: { id: string; label: string };
  groups: CheckGroupDto[];
  checkedAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// POST / DELETE /api/m/push/register
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PushRegisterInput {
  /** FCM registration token (both platforms use FCM). */
  token: string;
  platform: DevicePlatform;
  /** App version, e.g. "1.0.0". Optional. */
  appVersion?: string;
}

export interface PushUnregisterInput {
  token: string;
}

export interface PushRegisterResponse {
  ok: true;
}

/**
 * Data payload of a push (FCM data values are always strings). Tapping the notification should open `path`:
 *  - one new alert: { type: 'alert', signalId: '123', path: '/alert/123' }
 *  - several:       { type: 'feed', path: '/feed' }
 */
export type PushData = { type: 'alert'; signalId: string; path: string } | { type: 'feed'; path: '/feed' };

/** Android notification channel id the server sends to. Create it in the app before asking for permission. */
export const PUSH_CHANNEL_ID = 'alerts';

// ---------------------------------------------------------------------------------------------------------------------------------
// POST /api/m/account/delete
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DeleteAccountInput {
  confirm: 'DELETE';
}

export interface DeleteAccountResponse {
  ok: true;
  /** Always true: sign out locally (supabase.auth.signOut({ scope: 'local' })) and go to the welcome screen. */
  signOut: true;
  /**
   * Set when an App Store or Google Play subscription was active. The server cannot cancel a store subscription: tell the member to
   * cancel it at manageUrl so they are not charged again.
   */
  storeSubscription: { store: 'apple' | 'google'; manageUrl: string } | null;
}

/** Store subscription management pages. */
export const MANAGE_URLS = {
  apple: 'https://apps.apple.com/account/subscriptions',
  google: 'https://play.google.com/store/account/subscriptions',
} as const;
