// R12 review P1-2: scripts/check-dist-gating.mjs must FAIL a build that has push, Apple sign-in or a
// RevenueCat key on. Builds the real app twice with vite into temp folders and runs the gate on each.
// Shell variables beat the .env files, so these builds do not depend on mobile/.env.production.local.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDist } from '../scripts/check-dist-gating.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function build(env: Record<string, string>): string {
  const out = mkdtempSync(path.join(tmpdir(), 'holler-dist-gate-'));
  made.push(out);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('VITE_')) clean[k] = v;
  const base = {
    VITE_API_BASE: 'https://localholler.com',
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-public-key',
    VITE_REVENUECAT_IOS_KEY: '',
    VITE_REVENUECAT_ANDROID_KEY: '',
    VITE_APPLE_SIGN_IN: 'false',
    VITE_GOOGLE_SIGN_IN: 'false',
    VITE_PUSH_ENABLED: 'false',
    VITE_IOS_EXTERNAL_PURCHASE_LINK: 'false',
  };
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: root,
    env: { ...clean, ...base, ...env },
    encoding: 'utf8',
  });
  expect(r.status, r.stderr || r.stdout).toBe(0);
  return out;
}

describe('check:dist gate', () => {
  it('passes a flags-off, keyless build', () => {
    const { problems } = checkDist(build({}));
    expect(problems).toEqual([]);
  }, 60000);

  it('FAILS a build with push, Apple sign-in and a RevenueCat key on, naming each and never the key value', () => {
    const { problems } = checkDist(
      build({ VITE_PUSH_ENABLED: 'true', VITE_APPLE_SIGN_IN: 'true', VITE_REVENUECAT_IOS_KEY: 'appl_TESTKEY123456789' }),
    );
    const text = problems.join('\n');
    expect(problems.length).toBeGreaterThan(0);
    expect(text).toContain('VITE_PUSH_ENABLED is on');
    expect(text).toContain('VITE_APPLE_SIGN_IN is on');
    expect(text).toContain('VITE_REVENUECAT_IOS_KEY is set');
    expect(text).toMatch(/RevenueCat public key/);
    expect(text).not.toContain('TESTKEY123456789');
  }, 60000);

  it('FAILS a build with only the external purchase link flag on', () => {
    const { problems } = checkDist(build({ VITE_IOS_EXTERNAL_PURCHASE_LINK: 'true' }));
    expect(problems.join('\n')).toContain('VITE_IOS_EXTERNAL_PURCHASE_LINK is on');
  }, 60000);
});
