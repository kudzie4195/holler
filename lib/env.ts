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
  'REVENUECAT_WEBHOOK_SECRET',
  'REVENUECAT_ALLOW_SANDBOX',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
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
  REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET,
  REVENUECAT_ALLOW_SANDBOX: process.env.REVENUECAT_ALLOW_SANDBOX,
  FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
};

export function hasEnv(...k: EnvKey[]): boolean {
  return k.every((key) => typeof env[key] === 'string' && env[key]!.length > 0);
}

export const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
