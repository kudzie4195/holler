// Build-time settings. Every VITE_ variable is compiled into the public bundle, so only public values
// belong here (scripts/check-client-env.mjs refuses to build otherwise). Feature flags are on only
// when set to the literal string "true".

type Env = Record<string, string | boolean | undefined>;

function readEnv(): Env {
  try {
    return (import.meta as unknown as { env?: Env }).env ?? {};
  } catch {
    return {};
  }
}

const env = readEnv();

function str(name: string, fallback = ''): string {
  const v = env[name];
  return typeof v === 'string' ? v.trim() : fallback;
}

export function flag(value: unknown): boolean {
  return value === 'true' || value === true;
}

export interface BuildFlags {
  appleSignIn: boolean;
  googleSignIn: boolean;
  push: boolean;
  iosExternalPurchaseLink: boolean;
}

export const config = {
  apiBase: (str('VITE_API_BASE') || 'https://localholler.com').replace(/\/+$/, ''),
  supabaseUrl: str('VITE_SUPABASE_URL'),
  supabaseAnonKey: str('VITE_SUPABASE_ANON_KEY'),
  revenueCatIosKey: str('VITE_REVENUECAT_IOS_KEY'),
  revenueCatAndroidKey: str('VITE_REVENUECAT_ANDROID_KEY'),
  appVersion: str('VITE_APP_VERSION', '0.0.0'),
  flags: {
    appleSignIn: flag(env.VITE_APPLE_SIGN_IN),
    googleSignIn: flag(env.VITE_GOOGLE_SIGN_IN),
    push: flag(env.VITE_PUSH_ENABLED),
    iosExternalPurchaseLink: flag(env.VITE_IOS_EXTERNAL_PURCHASE_LINK),
  } satisfies BuildFlags,
};

/** Where the website lives, for Terms, Privacy, Support and the email sign-up route. */
export function siteUrl(path: string): string {
  return `${config.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}
