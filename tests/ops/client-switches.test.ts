/**
 * Round 34 switch audit (reviewer: HOLLER_BUSINESS_TAG_FIX_ENABLED and HOLLER_SAM_LABELS_ENABLED were read at runtime in the browser chunk).
 *
 * The feed card (components/feed/brief-block.tsx) is a client component: Next renders it on the server, then the browser renders it again
 * from the same props. Any switch the card's code reads must have the same value in both places. Here:
 *  - the SERVER card is rendered in this process with the switch set in the environment (as the server sees it);
 *  - the BROWSER card is rendered from a real browser bundle of the same code (rolldown, platform browser) built with the `env` replacements
 *    next.config.ts gives Next, and evaluated with an EMPTY process.env (the browser has no server variables).
 * For each inlined switch, on and off, the two cards must be byte-identical. A bundle built WITHOUT next.config's replacements (main before
 * this change) must disagree with the server when the switch is on, so the test can tell the difference.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rolldown } from 'rolldown';
import { BriefBlock, type BriefBlockItem } from '@/components/feed/brief-block';
import { labelFor, storefrontKindOfName } from '@/lib/signals/lead-rules';
import { INLINED_SWITCHES, inlinedSwitchEnv, normalizeSwitchEnv, switchOn, type InlinedSwitch } from '@/lib/build-switches';
import { envKeysFromSource, main as checkMain, scanChunk, secretValues } from '@/scripts/check-client-switches.mjs';
import { ENV_KEYS } from '@/lib/env';
import type { CategoryId } from '@/lib/signals/categories';

const ROOT = join(__dirname, '../..');
const nodeRequire = createRequire(join(ROOT, 'package.json'));
afterEach(() => vi.unstubAllEnvs());

type Lang = 'en' | 'es';
interface ClientModule {
  BriefBlock: typeof BriefBlock;
  labelFor: typeof labelFor;
  storefrontKindOfName: typeof storefrontKindOfName;
}

/** next.config.ts's `env` block, evaluated with the given switch values in the build's environment. */
async function nextConfigEnv(values: Partial<Record<InlinedSwitch, string>>): Promise<Record<string, string>> {
  for (const name of INLINED_SWITCHES) vi.stubEnv(name, values[name] ?? '');
  vi.resetModules();
  const cfg = (await import('../../next.config')).default;
  vi.unstubAllEnvs();
  return (cfg.env ?? {}) as Record<string, string>;
}

const bundles = new Map<string, ClientModule>();
/** The card code as the browser runs it: bundled for the browser with Next's replacements, evaluated with no environment variables. */
async function browserModule(env: Record<string, string>): Promise<ClientModule> {
  const key = JSON.stringify(env);
  const hit = bundles.get(key);
  if (hit) return hit;
  // Next replaces only the plain member expression `process.env.NAME` (node_modules/next/dist/docs: "dynamic lookups will not be inlined";
  // main's browser chunk kept `env?.NAME`). rolldown's own `define` also rewrites `process.env?.NAME`, which Next does not, so the
  // replacement is done here by text, on exactly that form, to behave like the real build.
  const replace = Object.entries(env).map(([k, v]) => [new RegExp(`(?<![\\w$?.])process\\.env\\.${k}(?![\\w$])`, 'g'), JSON.stringify(v)] as const);
  const build = await rolldown({
    input: join(ROOT, 'tests/ops/fixtures/client-card-entry.ts'),
    cwd: ROOT,
    platform: 'browser',
    resolve: { alias: { '@': ROOT } },
    external: [/^react($|\/)/, /^react-dom($|\/)/],
    transform: { define: { 'process.env.NODE_ENV': '"production"' }, jsx: { runtime: 'automatic' } },
    plugins: [
      {
        name: 'next-env-inline',
        transform(code: string, id: string) {
          if (!/\.[cm]?tsx?$/.test(id) || id.includes('node_modules')) return null;
          let out = code;
          for (const [re, value] of replace) out = out.replace(re, value);
          return out === code ? null : { code: out };
        },
      },
    ],
    logLevel: 'silent',
  });
  const { output } = await build.generate({ format: 'cjs' });
  await build.close();
  const mod = { exports: {} as ClientModule };
  // The browser: Next gives client code a `process` object whose env holds only what was inlined (nothing at runtime).
  new Function('module', 'exports', 'require', 'process', output[0].code)(mod, mod.exports, nodeRequire, { env: {} });
  bundles.set(key, mod.exports);
  return mod.exports;
}

/** The browser render: the bundle's own BriefBlock with the bundle's own React (the same package the server render uses). */
function clientCard(m: ClientModule, item: BriefBlockItem, lang: Lang): string {
  const react = nodeRequire('react') as typeof import('react');
  const server = nodeRequire('react-dom/server') as typeof import('react-dom/server');
  return server.renderToStaticMarkup(react.createElement(m.BriefBlock, { item, lang }));
}

/** The server render, with the switch as the server environment has it. */
function serverCard(item: BriefBlockItem, lang: Lang): string {
  return renderToStaticMarkup(createElement(BriefBlock, { item, lang }));
}

// A federal notice whose type is the hyphenated "Pre-solicitation": with HOLLER_SAM_LABELS_ENABLED on it is an early notice (a heads-up, and
// the card's "Why it matters" line says it may not be open yet); off, it is main's open bid.
const SAM_SIG = { source: 'sam-gov', kind: 'contract', subtype: null, title: 'Federal bid in Denver, CO: Janitorial services', summary: 'Pre-solicitation | GSA | NAICS 561720' };
const SAM_TRADE: CategoryId = 'janitorial-commercial';
// A Los Angeles licence the base storefront list misses and the round 33 list adds ("Retail Bakeries" is a food premises).
const BIZ_SIG = { source: 'socrata-la-business', kind: 'permit', subtype: 'business', title: 'New business license in Los Angeles: Retail Bakeries', summary: 'Retail Bakeries | 90012' };
const BIZ_TRADE: CategoryId = 'pest-control';

/** The feed item the server sends: label and trade decided on the server with the switch as it is there. */
function itemFor(sig: typeof SAM_SIG | typeof BIZ_SIG, trade: CategoryId): BriefBlockItem {
  return { ...sig, label: labelFor(sig, trade), trade, url: 'https://example.test/record', occurredAt: '2026-11-24T15:00:00.000Z' };
}

const CASES: { name: InlinedSwitch; sig: typeof SAM_SIG | typeof BIZ_SIG; trade: CategoryId }[] = [
  { name: 'HOLLER_SAM_LABELS_ENABLED', sig: SAM_SIG, trade: SAM_TRADE },
  { name: 'HOLLER_BUSINESS_TAG_FIX_ENABLED', sig: BIZ_SIG, trade: BIZ_TRADE },
];

describe('the switches the browser reads are inlined at build', () => {
  it('lists exactly the two switches the audit found in the browser chunk, each an ENV_KEYS on/off switch and never a secret', () => {
    expect([...INLINED_SWITCHES].sort()).toEqual(['HOLLER_BUSINESS_TAG_FIX_ENABLED', 'HOLLER_SAM_LABELS_ENABLED']);
    for (const name of INLINED_SWITCHES) {
      expect(ENV_KEYS as readonly string[]).toContain(name);
      expect(name).toMatch(/^HOLLER_[A-Z_]+_ENABLED$/);
      expect(name).not.toMatch(/KEY|SECRET|PASSWORD|TOKEN|LOGIN|JSON/);
    }
  });

  it('inlines only "1" or "", never the raw text of the variable', () => {
    expect(inlinedSwitchEnv({})).toEqual({ HOLLER_SAM_LABELS_ENABLED: '', HOLLER_BUSINESS_TAG_FIX_ENABLED: '' });
    expect(inlinedSwitchEnv({ HOLLER_SAM_LABELS_ENABLED: ' Yes ', HOLLER_BUSINESS_TAG_FIX_ENABLED: 'sk_live_not_a_switch' })).toEqual({
      HOLLER_SAM_LABELS_ENABLED: '1',
      HOLLER_BUSINESS_TAG_FIX_ENABLED: '',
    });
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(switchOn(v)).toBe(true);
    for (const v of [undefined, null, '', '0', 'false', 'off', 'no', '2']) expect(switchOn(v)).toBe(false);
  });

  it('next.config.ts puts them in `env` (so Next replaces them in both bundles); every entry is a switch holding "1" or ""', async () => {
    expect(await nextConfigEnv({})).toMatchObject({ HOLLER_SAM_LABELS_ENABLED: '', HOLLER_BUSINESS_TAG_FIX_ENABLED: '' });
    const on = await nextConfigEnv({ HOLLER_SAM_LABELS_ENABLED: 'on', HOLLER_BUSINESS_TAG_FIX_ENABLED: '1' });
    expect(on).toMatchObject({ HOLLER_SAM_LABELS_ENABLED: '1', HOLLER_BUSINESS_TAG_FIX_ENABLED: '1' });
    // Every key (also one another change adds to the object literal) is an on/off switch, and every value is "1" or "".
    for (const [k, v] of Object.entries(on)) {
      expect(k).toMatch(/^HOLLER_[A-Z0-9_]+_ENABLED$/);
      expect(['1', '']).toContain(v);
    }
    expect(readFileSync(join(ROOT, 'next.config.ts'), 'utf8')).toContain('nextConfig.env = normalizeSwitchEnv({ ...nextConfig.env, ...inlinedSwitchEnv(process.env) });');
  });

  it('normalizeSwitchEnv inlines any switch as "1" or "" and stops the build on a name that is not a switch', () => {
    expect(normalizeSwitchEnv({ HOLLER_OTHER_ENABLED: ' TRUE ', HOLLER_SAM_LABELS_ENABLED: 'sk_live_raw_text' })).toEqual({ HOLLER_OTHER_ENABLED: '1', HOLLER_SAM_LABELS_ENABLED: '' });
    expect(normalizeSwitchEnv(undefined)).toEqual({});
    for (const bad of ['CRON_SECRET', 'HOLLER_BUILDING_REF_SECRET', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SITE_URL', 'HOLLER_LOOKUP_MAX_PER_RUN']) {
      expect(() => normalizeSwitchEnv({ [bad]: '1' }), bad).toThrow(/not an on\/off switch/);
    }
  });

  it('every reader uses the plain member expression Next can replace (no `?.`, no computed lookup) in app code', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    for (const d of ['app', 'components', 'lib']) walk(join(ROOT, d));
    for (const name of INLINED_SWITCHES) {
      const readers = files.filter((f) => readFileSync(f, 'utf8').includes(`process.env.${name}`));
      expect(readers.length).toBeGreaterThan(0);
      for (const f of files) {
        const src = readFileSync(f, 'utf8');
        expect(src, f).not.toContain(`process.env?.${name}`);
        expect(src, f).not.toMatch(new RegExp(`process\\.env\\[['"\`]${name}`));
      }
    }
  });
});

describe('client-rendered card equals server-rendered card, switch on and off', () => {
  for (const c of CASES) {
    for (const state of ['on', 'off'] as const) {
      it(`${c.name} ${state}: EN and ES cards are identical in the server and the browser`, async () => {
        const value = state === 'on' ? '1' : '';
        const browser = await browserModule(await nextConfigEnv({ [c.name]: value }));
        vi.stubEnv(c.name, value);
        const item = itemFor(c.sig, c.trade);
        for (const lang of ['en', 'es'] as const) expect(clientCard(browser, item, lang)).toBe(serverCard(item, lang));
        // The label code the card calls agrees too (the browser recomputes it to pick the "Why it matters" sentence).
        expect(browser.labelFor(c.sig, c.trade)).toBe(labelFor(c.sig, c.trade));
        expect(browser.storefrontKindOfName(BIZ_SIG.source, 'Retail Bakeries')).toBe(storefrontKindOfName(BIZ_SIG.source, 'Retail Bakeries'));
      }, 60_000);
    }
  }

  it('the switch really changes what the server sends: the card differs between on and off', () => {
    for (const c of CASES) {
      vi.stubEnv(c.name, '1');
      const on = serverCard(itemFor(c.sig, c.trade), 'en');
      vi.stubEnv(c.name, '');
      const off = serverCard(itemFor(c.sig, c.trade), 'en');
      expect(on, c.name).not.toBe(off);
    }
  });

  it('the SAM card shows the early-notice reason in both renders when on', async () => {
    const browser = await browserModule(await nextConfigEnv({ HOLLER_SAM_LABELS_ENABLED: '1' }));
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    const item = itemFor(SAM_SIG, SAM_TRADE);
    expect(item.label).toBe('coming_soon');
    expect(clientCard(browser, item, 'en')).toContain('it may not be open yet');
  }, 60_000);

  it('control: a browser bundle WITHOUT next.config.ts replacements (main before this change) disagrees with the server when on', async () => {
    const runtimeRead = await browserModule({});
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    const sam = itemFor(SAM_SIG, SAM_TRADE);
    expect(clientCard(runtimeRead, sam, 'en')).not.toBe(serverCard(sam, 'en'));
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    expect(runtimeRead.labelFor(BIZ_SIG, BIZ_TRADE)).not.toBe(labelFor(BIZ_SIG, BIZ_TRADE));
  }, 60_000);
});

describe('scripts/check-client-switches.mjs (the build-chunk check, run by npm run build)', () => {
  const envKeys = envKeysFromSource(readFileSync(join(ROOT, 'lib/env.ts'), 'utf8'));
  const reads = (text: string, secrets: Record<string, string> = {}) => scanChunk('a.js', text, { envKeys, secrets }).reads;
  const readNames = (text: string) => reads(text).map((r) => `${r.rule}:${r.name ?? ''}`);

  it('reads ENV_KEYS from lib/env.ts', () => {
    expect(envKeys).toContain('HOLLER_SAM_LABELS_ENABLED');
    expect(envKeys).toContain('CRON_SECRET');
    expect(envKeys.length).toBeGreaterThan(50);
  });

  it('fails on the runtime reads seen in main\'s browser chunk', () => {
    const mainChunk = 'n=function(e=void 0!==nD.default?nD.default.env?.HOLLER_SAM_LABELS_ENABLED:void 0){return"string"==typeof e}';
    expect(readNames(mainChunk)).toEqual(['env-member:HOLLER_SAM_LABELS_ENABLED']);
  });

  it('fails on every form of a read: member, literal, dynamic, destructuring, alias, unlisted names and secrets', () => {
    expect(readNames('x=process.env.HOLLER_BUSINESS_TAG_FIX_ENABLED')).toEqual(['env-member:HOLLER_BUSINESS_TAG_FIX_ENABLED']);
    expect(readNames('x=e.env["HOLLER_ERATE_ENABLED"]')).toEqual(['env-literal:HOLLER_ERATE_ENABLED']);
    expect(readNames('x=e.env?.["HOLLER_ERATE_ENABLED"]')).toEqual(['env-literal:HOLLER_ERATE_ENABLED']);
    expect(readNames('let F="HOLLER_STAGE_UPDATES_ENABLED";y=e.env[F]')).toEqual(['env-dynamic:']);
    expect(readNames('let{HOLLER_BIDS_ENABLED:a,CRON_SECRET:b}=n.default.env;')).toEqual(['env-destructure:HOLLER_BIDS_ENABLED', 'env-destructure:CRON_SECRET']);
    expect(readNames('const { HOLLER_LSR_ENABLED } = process.env;')).toEqual(['env-destructure:HOLLER_LSR_ENABLED']);
    expect(readNames('let t=n.default.env;f(t.HOLLER_HAIL_ROUTING_ENABLED)')).toEqual(['env-alias:', 'watched-member:HOLLER_HAIL_ROUTING_ENABLED']);
    // Names that are not in ENV_KEYS: the building-reference secret and the Vercel alias of the Resend key.
    expect(readNames('k=process.env.HOLLER_BUILDING_REF_SECRET||""')).toEqual(['env-member:HOLLER_BUILDING_REF_SECRET']);
    expect(readNames('k=process.env.resend_api_key_holler')).toEqual(['env-member:resend_api_key_holler']);
    expect(readNames('k=process.env.SOME_NEW_API_KEY')).toEqual(['env-member:SOME_NEW_API_KEY']);
    expect(readNames('k=o.HOLLER_NEW_THING_ENABLED')).toEqual(['watched-member:HOLLER_NEW_THING_ENABLED']);
    expect(readNames('k=o["STRIPE_WEBHOOK_SECRET"]')).toEqual(['watched-member:STRIPE_WEBHOOK_SECRET']);
    const hit = reads('let a="whsec_0123456789abcdef";', { STRIPE_WEBHOOK_SECRET: 'whsec_0123456789abcdef' });
    expect(hit).toEqual([{ file: 'a.js', rule: 'secret-value', name: 'STRIPE_WEBHOOK_SECRET', context: '(value not printed)' }]);
  });

  it('does not fail on text that names a variable (PR 18 owner message), inlined values, NEXT_PUBLIC_, NODE_ENV or framework constants', () => {
    const pr18 = 'children:"HOLLER_BIDS_ENABLED is off, so no bid reaches a member until the owner turns it on."';
    const r = scanChunk('a.js', pr18, { envKeys });
    expect(r.reads).toEqual([]);
    expect(r.mentions.map((m) => m.name)).toEqual(['HOLLER_BIDS_ENABLED']);
    expect(scanChunk('a.js', 'let F="HOLLER_STAGE_UPDATES_ENABLED";', { envKeys }).reads).toEqual([]);
    for (const ok of [
      'n=function(e=void 0!==nD.default?"1":void 0){return"string"==typeof e}',
      'u=process.env.NEXT_PUBLIC_SUPABASE_URL,v=n.env.NODE_ENV,w=e.env?.["NEXT_PUBLIC_SITE_URL"]',
      // Next's process polyfill, verbatim from a browser chunk.
      'exports=(null==(n=e.g.process)?void 0:n.env)&&"object"==typeof(null==(u=e.g.process)?void 0:u.env)?e.g.process:e.r(35451)',
      'u.title="browser",u.browser=!0,u.env={},u.argv=[]',
      'e===i.PAGE_SEGMENT_KEY||t===g.HEAD_REQUEST_KEY||r.requestKey===g.ROOT_SEGMENT_REQUEST_KEY',
      '"verify.done_p":"Holler se lo envía por correo.","a":"envío"',
    ]) {
      expect(reads(ok), ok).toEqual([]);
    }
  });

  it('only compares secret-like variables, never NEXT_PUBLIC_ ones', () => {
    expect(Object.keys(secretValues({ CRON_SECRET: 'x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y', EMAIL_FROM: 'z', DATAFORSEO_LOGIN: 'l', FIREBASE_SERVICE_ACCOUNT_JSON: 'j' })).sort()).toEqual([
      'CRON_SECRET',
      'DATAFORSEO_LOGIN',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    ]);
  });

  it('exits 0 on a clean build folder, 1 on a planted read, 2 when there is no build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r34-check-'));
    try {
      mkdirSync(join(dir, 'chunks'));
      writeFileSync(join(dir, 'chunks', 'a.js'), 'n=function(e=void 0!==nD.default?"1":void 0){return e};t="HOLLER_BIDS_ENABLED is off"');
      const log: string[] = [];
      expect(checkMain([dir], (l: string) => log.push(l))).toBe(0);
      expect(log.some((l) => l.startsWith('WARN HOLLER_BIDS_ENABLED'))).toBe(true);
      writeFileSync(join(dir, 'chunks', 'b.js'), 'x=nD.default.env?.HOLLER_HAIL_ROUTING_ENABLED');
      expect(checkMain([dir], () => {})).toBe(1);
      expect(checkMain([join(dir, 'missing')], () => {})).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs inside npm run build (so a Vercel build fails), and rolldown is a pinned devDependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.scripts.build).toBe('next build && node scripts/check-client-switches.mjs');
    expect(pkg.scripts['check:client-switches']).toBe('node scripts/check-client-switches.mjs');
    const vite = JSON.parse(readFileSync(join(ROOT, 'node_modules/rolldown/package.json'), 'utf8')) as { version: string };
    expect(pkg.devDependencies.rolldown).toBe(vite.version);
  });
});
