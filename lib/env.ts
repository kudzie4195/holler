export const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'CRON_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'AI_GATEWAY_API_KEY',
  'AI_CLASSIFY_MODEL',
  'AI_MONTHLY_CAP_USD',
  'AI_MAX_SIGNALS_PER_RUN',
  'AI_MAX_SIGNALS_PER_DAY',
  'BRAVE_SEARCH_API_KEY',
  'SERPER_API_KEY',
  'SAM_API_KEY',
  'TICKETMASTER_API_KEY',
  'SOCRATA_APP_TOKEN',
  'SUPPORT_EMAIL',
  'ADMIN_EMAIL',
  'BLUESKY_HANDLE',
  'BLUESKY_APP_PASSWORD',
  'INDEXNOW_KEY',
  'REQUESTS_ENABLED',
  'HOLLER_BIDS_ENABLED',
  'HOLLER_LOCAL_BIDS_ENABLED',
  'HOLLER_PAGE_WATCH_ENABLED',
  'HOLLER_STAGE_UPDATES_ENABLED',
  'HOLLER_VIOLATION_OWNERS_ENABLED',
  'HOLLER_BUILDERS_PANEL_ENABLED',
  'HOLLER_LICENSE_SYNC_ENABLED',
  'FIRECRAWL_API_KEY',
  'FIRECRAWL_RUN_CREDIT_CAP',
  'FIRECRAWL_DAILY_CREDIT_CAP',
  'FIRECRAWL_MONTHLY_CREDIT_CAP',
  'FIRECRAWL_MIN_REMAINING',
  'FIRECRAWL_PROBE_DAILY_CAP',
  'REVENUECAT_WEBHOOK_SECRET',
  'REVENUECAT_ALLOW_SANDBOX',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'DATAFORSEO_MONTHLY_CAP_USD',
  'HOLLER_LOOKUP_MAX_PER_RUN',
  'HOLLER_LOOKUP_MAX_PER_DAY',
  'HOLLER_LOOKUP_DRY_RUN',
  'HOLLER_PREVIEW_FIXTURES',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

// NEXT_PUBLIC_* must be referenced literally so Next can inline them in client bundles.
export const env: Record<EnvKey, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  CRON_SECRET: process.env.CRON_SECRET,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  // Vercel stores this key as `resend_api_key_holler` (sensitive keys cannot be renamed); either name works.
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? process.env.resend_api_key_holler,
  EMAIL_FROM: process.env.EMAIL_FROM,
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  // Read again from process.env inside lib/ai (classifyModelId, monthlyCapUsd); listed here so .env.example and LAUNCH.md name them.
  AI_CLASSIFY_MODEL: process.env.AI_CLASSIFY_MODEL,
  AI_MONTHLY_CAP_USD: process.env.AI_MONTHLY_CAP_USD,
  AI_MAX_SIGNALS_PER_RUN: process.env.AI_MAX_SIGNALS_PER_RUN,
  AI_MAX_SIGNALS_PER_DAY: process.env.AI_MAX_SIGNALS_PER_DAY,
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  SERPER_API_KEY: process.env.SERPER_API_KEY,
  SAM_API_KEY: process.env.SAM_API_KEY,
  TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY,
  SOCRATA_APP_TOKEN: process.env.SOCRATA_APP_TOKEN,
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  BLUESKY_HANDLE: process.env.BLUESKY_HANDLE,
  BLUESKY_APP_PASSWORD: process.env.BLUESKY_APP_PASSWORD,
  INDEXNOW_KEY: process.env.INDEXNOW_KEY,
  REQUESTS_ENABLED: process.env.REQUESTS_ENABLED,
  HOLLER_BIDS_ENABLED: process.env.HOLLER_BIDS_ENABLED,
  HOLLER_LOCAL_BIDS_ENABLED: process.env.HOLLER_LOCAL_BIDS_ENABLED,
  /** Round 20 page watch: the master switch (default off). Nothing is requested from any bid page while it is off. */
  HOLLER_PAGE_WATCH_ENABLED: process.env.HOLLER_PAGE_WATCH_ENABLED,
  HOLLER_STAGE_UPDATES_ENABLED: process.env.HOLLER_STAGE_UPDATES_ENABLED,
  // Round 18: owner companies on code-violation cards; read at call time in lib/contacts/owner-switch.ts. Off unless 1, true, on or yes.
  HOLLER_VIOLATION_OWNERS_ENABLED: process.env.HOLLER_VIOLATION_OWNERS_ENABLED,
  // Round 19 integration: "Who's building near you" on /app; read at call time in lib/builders/switch.ts. Off unless 1, true, on or yes.
  HOLLER_BUILDERS_PANEL_ENABLED: process.env.HOLLER_BUILDERS_PANEL_ENABLED,
  // Round 20 licence files (lib/licenses/switch.ts reads it again from process.env).
  HOLLER_LICENSE_SYNC_ENABLED: process.env.HOLLER_LICENSE_SYNC_ENABLED,
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  FIRECRAWL_RUN_CREDIT_CAP: process.env.FIRECRAWL_RUN_CREDIT_CAP,
  FIRECRAWL_DAILY_CREDIT_CAP: process.env.FIRECRAWL_DAILY_CREDIT_CAP,
  FIRECRAWL_MONTHLY_CREDIT_CAP: process.env.FIRECRAWL_MONTHLY_CREDIT_CAP,
  FIRECRAWL_MIN_REMAINING: process.env.FIRECRAWL_MIN_REMAINING,
  FIRECRAWL_PROBE_DAILY_CAP: process.env.FIRECRAWL_PROBE_DAILY_CAP,
  REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET,
  REVENUECAT_ALLOW_SANDBOX: process.env.REVENUECAT_ALLOW_SANDBOX,
  FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  // Read again from process.env in lib/dataforseo/client.ts and app/api/cron/dataforseo; listed here so .env.example and LAUNCH.md name them.
  DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN,
  DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD,
  DATAFORSEO_MONTHLY_CAP_USD: process.env.DATAFORSEO_MONTHLY_CAP_USD,
  // Round 18 business listing lookup (lib/enrich/business-lookup.ts lookupSettings reads them again from process.env).
  HOLLER_LOOKUP_MAX_PER_RUN: process.env.HOLLER_LOOKUP_MAX_PER_RUN,
  HOLLER_LOOKUP_MAX_PER_DAY: process.env.HOLLER_LOOKUP_MAX_PER_DAY,
  HOLLER_LOOKUP_DRY_RUN: process.env.HOLLER_LOOKUP_DRY_RUN,
  // Local only (lib/seo/home-live.ts previewFixturesEnabled): ignored whenever VERCEL is set.
  HOLLER_PREVIEW_FIXTURES: process.env.HOLLER_PREVIEW_FIXTURES,
};

export function hasEnv(...k: EnvKey[]): boolean {
  return k.every((key) => typeof env[key] === 'string' && env[key]!.length > 0);
}

export const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
