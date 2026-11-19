// What may be compiled into the app bundle. Every VITE_ variable is inlined into dist/ and from
// there into the iOS and Android binaries, so a VITE_ value is public by definition.
// Pure and dependency-free so tests/check-client-env.test.ts can drive it. Values are never echoed.

/** Value shapes that are never safe in a client bundle, whatever the variable is called. */
export const SECRET_SHAPES = [
  { test: /^sk_/i, what: 'a RevenueCat or Stripe SECRET key' },
  { test: /^rk_(live|test)_/i, what: 'a Stripe restricted key' },
  { test: /^sk-/i, what: 'an OpenAI or Anthropic style secret key' },
  { test: /^sb_secret_/i, what: 'a Supabase SECRET key' },
  { test: /^whsec_/i, what: 'a webhook signing secret' },
  { test: /^re_[A-Za-z0-9_]{8,}/, what: 'a Resend API key' },
  { test: /^AKIA[0-9A-Z]{16}$/, what: 'an AWS access key id' },
  { test: /^(ghp_|gho_|github_pat_)/, what: 'a GitHub token' },
  { test: /^xox[abprs]-/, what: 'a Slack token' },
  { test: /^AAAA[A-Za-z0-9_-]{7}:/, what: 'a Firebase Cloud Messaging server key' },
  { test: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'a private key' },
  { test: /"private_key"\s*:/, what: 'a Google service account file' },
  { test: /^vck_/i, what: 'a Vercel AI Gateway key' },
];

/** Variable NAMES that announce a secret. Such a variable must never carry the VITE_ prefix. */
const SECRET_NAME = /(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|WEBHOOK|SERVER_KEY|ACCESS_TOKEN)/i;

/** Variables with a known public prefix. */
export const EXPECTED_PREFIXES = {
  VITE_REVENUECAT_IOS_KEY: { prefix: 'appl_', what: "RevenueCat's PUBLIC App Store key (appl_...)" },
  VITE_REVENUECAT_ANDROID_KEY: { prefix: 'goog_', what: "RevenueCat's PUBLIC Play Store key (goog_...)" },
};

/** The role inside a Supabase JWT, or null when the value is not a JWT. */
export function jwtRole(value) {
  const parts = String(value).split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Every problem in a map of variables. `error` fails the build. Messages name variables, never values. */
export function findClientEnvProblems(vars) {
  const problems = [];
  for (const [key, raw] of Object.entries(vars ?? {})) {
    if (!key.startsWith('VITE_')) continue;
    const value = String(raw ?? '').trim();
    if (value === '') continue;

    if (SECRET_NAME.test(key.slice(5))) {
      problems.push({ level: 'error', key, message: `${key} is named like a secret. VITE_ variables ship inside the app. Remove it from the app's env files.` });
      continue;
    }
    let flagged = false;
    for (const { test, what } of SECRET_SHAPES) {
      if (test.test(value)) {
        problems.push({ level: 'error', key, message: `${key} looks like ${what}. It would ship inside the app. Roll that credential and use a public key.` });
        flagged = true;
        break;
      }
    }
    if (flagged) continue;
    const role = jwtRole(value);
    if (role && role !== 'anon') {
      problems.push({ level: 'error', key, message: `${key} is a JWT with role "${role}". Only the anon key may ship. Roll it.` });
      continue;
    }
    const expected = EXPECTED_PREFIXES[key];
    if (expected && !value.startsWith(expected.prefix)) {
      problems.push({ level: 'error', key, message: `${key} does not start with "${expected.prefix}". It should be ${expected.what}.` });
    }
    if (/^VITE_[A-Z0-9_]+$/.test(key) && /^(VITE_APPLE_SIGN_IN|VITE_GOOGLE_SIGN_IN|VITE_PUSH_ENABLED|VITE_IOS_EXTERNAL_PURCHASE_LINK)$/.test(key) && value !== 'true' && value !== 'false') {
      problems.push({ level: 'warn', key, message: `${key} is a flag. Only the exact text "true" turns it on.` });
    }
  }
  return problems.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

/** KEY=value lines, # comments, optional quotes. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const at = t.indexOf('=');
    if (at <= 0) continue;
    const key = t.slice(0, at).replace(/^export\s+/, '').trim();
    let value = t.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
