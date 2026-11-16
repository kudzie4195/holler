const keys = [
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
  'BRAVE_SEARCH_API_KEY',
  'SERPER_API_KEY',
  'SAM_API_KEY',
  'TICKETMASTER_API_KEY',
  'SOCRATA_APP_TOKEN',
] as const;

export type EnvKey = (typeof keys)[number];

// NEXT_PUBLIC_* must be referenced literally so Next can inline them in client bundles.
export const env: Record<EnvKey, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  CRON_SECRET: process.env.CRON_SECRET,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  SERPER_API_KEY: process.env.SERPER_API_KEY,
  SAM_API_KEY: process.env.SAM_API_KEY,
  TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY,
  SOCRATA_APP_TOKEN: process.env.SOCRATA_APP_TOKEN,
};

export function hasEnv(...k: EnvKey[]): boolean {
  return k.every((key) => typeof env[key] === 'string' && env[key]!.length > 0);
}

export const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
