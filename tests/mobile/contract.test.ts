// The app contract (lib/mobile/types.ts) stays importable by the app, agrees with the server constants, and every user-facing string
// in the mobile server code follows the copy rules (no em or en dashes, no banned words).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@/lib/mobile/http';
import { ENTITLEMENT_IDS, FEED_PAGE_SIZE, MANAGE_URLS, MOBILE_APP_ID, MOBILE_CORS_ORIGINS, STORE_PRODUCTS, TIER_FOR_ENTITLEMENT } from '@/lib/mobile/types';
import { APP_ID, ENTITLEMENTS, TIER_FOR_ENTITLEMENT as PRICE_TIERS } from '@/lib/plan/public-prices';

const ROOT = path.resolve(__dirname, '../..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

describe('lib/mobile/types.ts', () => {
  const src = readFileSync(path.join(ROOT, 'lib/mobile/types.ts'), 'utf8');
  it('has no imports at all (the app imports it by relative path)', () => {
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(/);
  });
  it('agrees with the server constants', () => {
    expect(MOBILE_APP_ID).toBe(APP_ID);
    expect([...ENTITLEMENT_IDS]).toEqual([...ENTITLEMENTS]);
    expect(TIER_FOR_ENTITLEMENT).toEqual(PRICE_TIERS);
    for (const e of ENTITLEMENT_IDS) for (const k of ['monthly', 'yearly'] as const) expect(STORE_PRODUCTS[e][k]).toBe(`${APP_ID}.${e}.${k}`);
    expect([...MOBILE_CORS_ORIGINS]).toEqual(['capacitor://localhost', 'https://localhost', 'http://localhost']);
    expect(FEED_PAGE_SIZE).toBe(30);
    expect(MANAGE_URLS.apple).toMatch(/^https:\/\/apps\.apple\.com\//);
    expect(MANAGE_URLS.google).toMatch(/^https:\/\/play\.google\.com\//);
  });
});

describe('copy rules in the mobile server code', () => {
  const files = [...walk(path.join(ROOT, 'lib/mobile')), ...walk(path.join(ROOT, 'lib/push')), ...walk(path.join(ROOT, 'lib/storebilling')), ...walk(path.join(ROOT, 'app/api/m')), ...walk(path.join(ROOT, 'app/api/revenuecat'))];
  it('no em or en dashes anywhere in these files', () => {
    for (const f of files) expect(/[–—]/.test(readFileSync(f, 'utf8')), f).toBe(false);
  });
  it('no banned words in user-facing messages', () => {
    const banned = /\b(delve|robust|seamless|elevate|unlock|empower|journey|leverage)\b|not only|more than just|it's worth noting|whether you're/i;
    for (const m of Object.values(MESSAGES)) expect(banned.test(m), m).toBe(false);
    for (const f of files) {
      const strings = readFileSync(f, 'utf8').match(/'[^'\n]{12,}'|`[^`\n]{12,}`|"[^"\n]{12,}"/g) ?? [];
      for (const s of strings) expect(banned.test(s), `${f}: ${s}`).toBe(false);
    }
  });
});
