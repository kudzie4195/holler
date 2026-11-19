import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findClientEnvProblems, parseEnv } from '../scripts/clientEnvRules.mjs';

type Problem = { level: string; key: string; message: string };
const errors = (vars: Record<string, string>) => (findClientEnvProblems(vars) as Problem[]).filter((p) => p.level === 'error');
const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;

describe('check-client-env rules', () => {
  it('accepts the public values the app needs', () => {
    expect(
      errors({
        VITE_API_BASE: 'https://localholler.com',
        VITE_SUPABASE_URL: 'https://abc.supabase.co',
        VITE_SUPABASE_ANON_KEY: jwt('anon'),
        VITE_REVENUECAT_IOS_KEY: 'appl_abc',
        VITE_REVENUECAT_ANDROID_KEY: 'goog_abc',
        VITE_APPLE_SIGN_IN: 'true',
        NOT_VITE_SECRET: 'sk_live_whatever',
      }),
    ).toEqual([]);
    expect(errors({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' })).toEqual([]);
  });

  it.each([
    ['VITE_REVENUECAT_IOS_KEY', 'sk_abcdef'],
    ['VITE_SUPABASE_ANON_KEY', jwt('service_role')],
    ['VITE_SUPABASE_ANON_KEY', 'sb_secret_abcdef'],
    ['VITE_SOMETHING', 'whsec_abcdef'],
    ['VITE_SOMETHING', 'AAAAabc1234:APA91bxyz'],
    ['VITE_SOMETHING', '-----BEGIN PRIVATE KEY-----'],
    ['VITE_SOMETHING', 're_12345678abc'],
    ['VITE_SOMETHING', 'sk-ant-xyz'],
    ['VITE_STRIPE_SECRET', 'anything'],
    ['VITE_REVENUECAT_ANDROID_KEY', 'appl_wrong_store'],
  ])('refuses %s with a secret-looking value', (key, value) => {
    const found = errors({ [key]: value });
    expect(found).toHaveLength(1);
    expect(found[0].message).not.toContain(value); // never echo the value
  });

  it('parses env files', () => {
    expect(parseEnv('# c\nA=1\nexport B="two"\nC=\'3\'\nbad line\n')).toEqual({ A: '1', B: 'two', C: '3' });
  });

  it('the build script exits non-zero on a secret and zero when clean', () => {
    const script = path.resolve(__dirname, '../scripts/check-client-env.mjs');
    const clean = { ...process.env, VITE_API_BASE: 'https://localholler.com' };
    expect(() => execFileSync('node', [script], { env: clean, stdio: 'pipe' })).not.toThrow();
    let code = 0;
    try {
      execFileSync('node', [script], { env: { ...process.env, VITE_REVENUECAT_IOS_KEY: 'sk_live_123' }, stdio: 'pipe' });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(1);
  });
});

describe('version parity', async () => {
  // @ts-ignore plain .mjs script
  const { readVersions, parityProblems } = await import('../scripts/check-version.mjs');
  it('the committed native projects match package.json', () => {
    expect(parityProblems(readVersions())).toEqual([]);
  });
  it('catches a drift', () => {
    const v = { pkg: '1.0.1', marketing: ['1.0.0', '1.0.0'], iosBuild: ['1', '1'], versionName: '1.0.0', versionCode: '1' };
    expect(parityProblems(v)).toHaveLength(2);
  });
});
