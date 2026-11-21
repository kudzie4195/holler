// R12 READY: with push, purchases and Apple sign-in OFF (the first TestFlight / Play internal build),
// nothing may touch the native Firebase Messaging, RevenueCat or Apple sign-in plugins, not even to
// check. Behaviour is tested against a phone-shaped runtime (platform mocked to iOS and Android);
// the wiring is checked from source. scripts/check-dist-gating.mjs repeats the check on dist/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'ios' as 'ios' | 'android' | 'web',
  loads: { firebase: 0, revenuecat: 0, apple: 0 },
}));

vi.mock('../src/lib/platform', () => ({
  platform: () => h.platform,
  isNative: () => h.platform !== 'web',
}));

// The three plugin modules count how many times they are loaded at all. Loading = registering the native plugin.
vi.mock('@capacitor-firebase/messaging', () => {
  h.loads.firebase++;
  return { FirebaseMessaging: {} };
});
vi.mock('@revenuecat/purchases-capacitor', () => {
  h.loads.revenuecat++;
  return { Purchases: {} };
});
vi.mock('@capawesome/capacitor-apple-sign-in', () => {
  h.loads.apple++;
  return { AppleSignIn: {}, SignInScope: {} };
});

// The first test build: every flag off, no RevenueCat keys.
vi.mock('../src/lib/env', async () => {
  const real = await vi.importActual<typeof import('../src/lib/env')>('../src/lib/env');
  return {
    ...real,
    config: {
      apiBase: 'https://localholler.com',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
      revenueCatIosKey: '',
      revenueCatAndroidKey: '',
      appVersion: '1.0.0',
      flags: { appleSignIn: false, googleSignIn: false, push: false, iosExternalPurchaseLink: false },
    },
  };
});

import { socialButtonsFor } from '../src/auth/social';
import { paywallView } from '../src/purchases/paywall';
import {
  configurePurchases,
  currentStoreState,
  ensurePurchases,
  getPackages,
  logOutPurchases,
  onStoreChange,
  purchase,
  restorePurchases,
  storeAvailable,
  storefrontCountry,
  PurchaseError,
} from '../src/purchases/purchases';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..', 'src');
const read = (f: string) => readFileSync(path.join(srcRoot, f), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe.each(['ios', 'android'] as const)('flags off on %s', (plat) => {
  beforeEach(() => {
    h.platform = plat;
  });

  it('push: every call answers "unavailable" and the Firebase plugin is never loaded', async () => {
    const { push } = await import('../src/services');
    expect(push.available()).toBe(false);
    await push.listen(() => undefined);
    expect(await push.permission()).toBe('unavailable');
    expect(await push.enable()).toBe('unavailable');
    expect(await push.refreshIfGranted()).toBe(false);
    await expect(push.unregister()).resolves.toBeUndefined();
    expect(h.loads.firebase).toBe(0);
  });

  it('purchases: no RevenueCat key means no store, and the plugin is never loaded or configured', async () => {
    expect(storeAvailable()).toBe(false);
    expect(await configurePurchases('user-1')).toBe(false);
    expect(await ensurePurchases('user-1')).toBe(false);
    expect(await getPackages('user-1')).toEqual([]);
    expect(await currentStoreState('user-1')).toBeNull();
    expect(await onStoreChange(() => undefined)).toBeNull();
    expect(await storefrontCountry()).toBeNull();
    await expect(logOutPurchases()).resolves.toBeUndefined();
    await expect(purchase('pkg', 'user-1')).rejects.toBeInstanceOf(PurchaseError);
    await expect(restorePurchases('user-1')).rejects.toBeInstanceOf(PurchaseError);
    expect(h.loads.revenuecat).toBe(0);
  });

  it('the paywall shows the calm "unavailable" card, no buy buttons', () => {
    const view = paywallView({ me: null, plans: null, storeAvailable: storeAvailable(), packages: null, storeEntitlement: null });
    expect(view).toEqual({ kind: 'unavailable' });
  });

  it('Apple sign-in: the flag off gives no social buttons at all, even with the Google flag on', () => {
    expect(socialButtonsFor({ appleSignIn: false, googleSignIn: false })).toEqual([]);
    expect(socialButtonsFor({ appleSignIn: false, googleSignIn: true })).toEqual([]);
    expect(h.loads.apple).toBe(0);
  });
});

describe('wiring in source', () => {
  const files = walk(srcRoot);
  const PLUGINS = ['@capacitor-firebase/messaging', '@revenuecat/purchases-capacitor', '@capawesome/capacitor-apple-sign-in'];

  it('each of the three plugins is only ever reached through a dynamic import()', () => {
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      for (const name of PLUGINS) {
        const escaped = name.replace(/[/@-]/g, (c) => `\\${c}`);
        // A static `import ... from 'plugin'` or a bare `import 'plugin'`.
        expect(code, `${path.relative(srcRoot, f)} statically imports ${name}`).not.toMatch(new RegExp(`^\\s*import\\s+(?:[^'"(]+\\s+from\\s+)?['"]${escaped}['"]`, 'm'));
      }
    }
  });

  it('only the three wrapper files name the plugins at all', () => {
    const holders = files.filter((f) => PLUGINS.some((n) => readFileSync(f, 'utf8').includes(`'${n}'`))).map((f) => path.relative(srcRoot, f));
    expect(holders.sort()).toEqual(['auth/social.ts', 'purchases/purchases.ts', 'services.ts']);
  });

  it('push is built enabled only when the flag is on AND the app runs on a phone', () => {
    expect(read('services.ts')).toMatch(/enabled:\s*config\.flags\.push\s*&&\s*isNative\(\)/);
  });

  it('start-up (main.tsx, App.tsx) never imports a plugin and loads only the status bar', () => {
    for (const f of ['main.tsx', 'App.tsx']) {
      const code = read(f);
      for (const name of PLUGINS) expect(code).not.toContain(name);
    }
    expect(read('main.tsx')).toMatch(/import\('@capacitor\/status-bar'\)/);
  });

  it('Welcome draws its social buttons only from socialButtonsFor(config.flags)', () => {
    const welcome = read('screens/Welcome.tsx');
    expect(welcome).toMatch(/const buttons = socialButtonsFor\(config\.flags\)/);
    expect(welcome).toMatch(/buttons\.(length|map|includes)/);
  });

  it('Settings and the push prompt route are gated by push.available(); Settings says "Not available in this build"', () => {
    const settings = read('screens/Settings.tsx');
    expect(settings).toMatch(/const pushAvailable = push\.available\(\)/);
    expect(settings).toMatch(/\{pushAvailable \? \(/);
    expect(settings).toContain('Not available in this build');
    expect(read('state/AppContext.tsx')).toMatch(/askPush = push\.available\(\) && !\(await push\.promptSeen\(\)\)/);
    expect(read('screens/Onboarding.tsx')).toMatch(/push\.available\(\) && !\(await push\.promptSeen\(\)\)/);
  });

  it('Settings shows Restore and Manage subscription only when the store is available', () => {
    const settings = read('screens/Settings.tsx');
    expect(settings).toMatch(/\{store \? \(\s*<button[^>]*onClick=\{\(\) => void restore\(\)\}/);
  });

  it('the "unavailable" paywall card says plans are not open yet and points to no outside purchase (guideline 3.1.1)', () => {
    const paywall = read('screens/Paywall.tsx');
    const card = paywall.slice(paywall.indexOf("view.kind === 'unavailable'"), paywall.indexOf("view.kind === 'unavailable'") + 600);
    expect(card).toContain('<h3>Plans are not open in this build</h3>');
    expect(card).toContain('Your free trial keeps working. Plans will appear here in a later update.');
    expect(paywall).not.toContain('Plans are in the phone app');
    expect(paywall).not.toContain('Subscriptions can be bought');
    expect(card).not.toMatch(/website|localholler|web|http|browser|openInApp/i);
  });

  it('the Paywall does not load packages or call the store when the store is unavailable', () => {
    const paywall = read('screens/Paywall.tsx');
    expect(paywall).toMatch(/useEffect\(\(\) => \{\s*if \(!available\) return;/);
    expect(paywall).toContain("view.kind === 'unavailable'");
  });
});
