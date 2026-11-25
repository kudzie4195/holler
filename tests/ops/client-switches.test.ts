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
import { INLINED_SWITCHES, OTHER_SWITCHES, inlinedSwitchEnv, inlinedSwitchValue, normalizeSwitchEnv, switchOn, type InlinedSwitch } from '@/lib/build-switches';
import {
  CLIENT_ENV_ALLOW,
  MIN_SECRET_LENGTH,
  allowListProblems,
  envKeysFromSource,
  isAllowed,
  isSecretName,
  main as checkMain,
  maskSecrets,
  scanChunk,
  scanServerForInlinedReads,
  scanSourceForOptionalReads,
  secretValues,
} from '@/scripts/check-client-switches.mjs';
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
function itemFor(sig: typeof SAM_SIG | typeof BIZ_SIG | typeof ROAD_SIG, trade: CategoryId): BriefBlockItem {
  return { ...sig, label: labelFor(sig, trade), trade, url: 'https://example.test/record', occurredAt: '2026-11-24T15:00:00.000Z' };
}

// A wind damage report that puts a tree on a road and names no home or yard: with HOLLER_ROAD_WORDS_ENABLED on, the card's "Why it matters" line is
// the road sentence (lib/signals/brief.ts reasonCopyFor), chosen by code that runs in the server AND the browser.
const ROAD_SIG = { source: 'spc', kind: 'report', subtype: null, title: 'Wind damage reported near Burbank, CA', summary: 'tree down blocking freeway lanes on the I-5' };
const ROAD_TRADE: CategoryId = 'tree-service';

const CASES: { name: InlinedSwitch; sig: typeof SAM_SIG | typeof BIZ_SIG | typeof ROAD_SIG; trade: CategoryId }[] = [
  { name: 'HOLLER_SAM_LABELS_ENABLED', sig: SAM_SIG, trade: SAM_TRADE },
  { name: 'HOLLER_BUSINESS_TAG_FIX_ENABLED', sig: BIZ_SIG, trade: BIZ_TRADE },
  { name: 'HOLLER_ROAD_WORDS_ENABLED', sig: ROAD_SIG, trade: ROAD_TRADE },
];

describe('the switches the browser reads are inlined at build', () => {
  it('lists exactly the three switches the browser reads (SAM labels, business tag fix, road words), each an ENV_KEYS on/off switch and never a secret', () => {
    expect([...INLINED_SWITCHES].sort()).toEqual(['HOLLER_BUSINESS_TAG_FIX_ENABLED', 'HOLLER_ROAD_WORDS_ENABLED', 'HOLLER_SAM_LABELS_ENABLED']);
    for (const name of INLINED_SWITCHES) {
      expect(ENV_KEYS as readonly string[]).toContain(name);
      expect(name).toMatch(/^HOLLER_[A-Z_]+_ENABLED$/);
      expect(name).not.toMatch(/KEY|SECRET|PASSWORD|TOKEN|LOGIN|JSON/);
    }
  });

  it('inlines only "1" or "", never the raw text of the variable', () => {
    expect(inlinedSwitchEnv({})).toEqual({ HOLLER_SAM_LABELS_ENABLED: '', HOLLER_BUSINESS_TAG_FIX_ENABLED: '', HOLLER_ROAD_WORDS_ENABLED: '' });
    expect(inlinedSwitchEnv({ HOLLER_SAM_LABELS_ENABLED: ' Yes ', HOLLER_BUSINESS_TAG_FIX_ENABLED: 'sk_live_not_a_switch', HOLLER_ROAD_WORDS_ENABLED: 'true' })).toEqual({
      HOLLER_SAM_LABELS_ENABLED: '1',
      HOLLER_BUSINESS_TAG_FIX_ENABLED: '',
      HOLLER_ROAD_WORDS_ENABLED: '1',
    });
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(switchOn(v)).toBe(true);
    for (const v of [undefined, null, '', '0', 'false', 'off', 'no', '2']) expect(switchOn(v)).toBe(false);
  });

  it('next.config.ts puts them in `env` (so Next replaces them in both bundles); every entry is a switch holding "1" or ""', async () => {
    expect(await nextConfigEnv({})).toEqual({ HOLLER_SAM_LABELS_ENABLED: '', HOLLER_BUSINESS_TAG_FIX_ENABLED: '', HOLLER_ROAD_WORDS_ENABLED: '' });
    const on = await nextConfigEnv({ HOLLER_SAM_LABELS_ENABLED: 'on', HOLLER_BUSINESS_TAG_FIX_ENABLED: '1', HOLLER_ROAD_WORDS_ENABLED: 'yes' });
    expect(on).toEqual({ HOLLER_SAM_LABELS_ENABLED: '1', HOLLER_BUSINESS_TAG_FIX_ENABLED: '1', HOLLER_ROAD_WORDS_ENABLED: '1' });
    // Every key (also one another change adds to the object literal) is an on/off switch, and every value is "1" or "".
    for (const [k, v] of Object.entries(on)) {
      expect(k).toMatch(/^HOLLER_[A-Z0-9_]+_ENABLED$/);
      expect(['1', '']).toContain(v);
    }
    const cfgSrc = readFileSync(join(ROOT, 'next.config.ts'), 'utf8');
    expect(cfgSrc).toContain('nextConfig.env = normalizeSwitchEnv({ ...nextConfig.env, ...inlinedSwitchEnv(process.env) });');
    // No switch is written into next.config.ts by hand (a raw `process.env.HOLLER_X ?? ''` there skipped the normalizer once: mutant M5).
    expect(cfgSrc).not.toMatch(/process\.env\.HOLLER_/);
  });

  it('every inlined switch, given a RAW value, reaches the config as "1" or "" and never as the raw text (kills the raw road-words entry, mutant M5)', async () => {
    for (const name of INLINED_SWITCHES) {
      for (const raw of ['true', 'TRUE', ' on ', 'yes', 'sk_live_raw_text_not_a_switch', 'enabled', '2']) {
        const cfg = await nextConfigEnv({ [name]: raw });
        expect(cfg[name], `${name}=${raw}`).toBe(switchOn(raw) ? '1' : '');
        expect(JSON.stringify(cfg), `${name}=${raw}`).not.toContain('sk_live_raw_text');
      }
    }
    // The road-words switch with the raw text PR 25 used to inline, byte for byte.
    expect((await nextConfigEnv({ HOLLER_ROAD_WORDS_ENABLED: 'true' })).HOLLER_ROAD_WORDS_ENABLED).toBe('1');
    expect((await nextConfigEnv({ HOLLER_ROAD_WORDS_ENABLED: 'no' })).HOLLER_ROAD_WORDS_ENABLED).toBe('');
  });

  it('normalizeSwitchEnv inlines any switch as "1" or "" and stops the build on a name that is not a switch', () => {
    expect(normalizeSwitchEnv({ HOLLER_OTHER_ENABLED: ' TRUE ', HOLLER_SAM_LABELS_ENABLED: 'sk_live_raw_text' })).toEqual({ HOLLER_OTHER_ENABLED: '1', HOLLER_SAM_LABELS_ENABLED: '' });
    expect(normalizeSwitchEnv(undefined)).toEqual({});
    for (const bad of ['CRON_SECRET', 'HOLLER_BUILDING_REF_SECRET', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SITE_URL', 'HOLLER_LOOKUP_MAX_PER_RUN', 'HOLLER_OWNER_USER_ID', 'requests_enabled', 'REQUESTS_ENABLED_X', 'toString', '__proto__']) {
      expect(() => normalizeSwitchEnv({ [bad]: '1' }), bad).toThrow(/not an on\/off switch/);
    }
  });

  it('accepts the five older on/off switches by name, each inlined by the rule its own reader uses (default-on ones as "1" or "0", never "")', () => {
    expect(Object.keys(OTHER_SWITCHES).sort()).toEqual(['HOLLER_LOOKUP_DRY_RUN', 'HOLLER_PREVIEW_FIXTURES', 'HOLLER_PROBATION_FETCH', 'REQUESTS_ENABLED', 'REVENUECAT_ALLOW_SANDBOX']);
    for (const name of Object.keys(OTHER_SWITCHES)) expect(ENV_KEYS as readonly string[], name).toContain(name);
    // Default ON: unset is on; only 0, false, off, no turn it off (lib/requests/enabled.ts, lib/signals/probation-fetch.ts).
    for (const name of ['REQUESTS_ENABLED', 'HOLLER_PROBATION_FETCH']) {
      for (const v of [undefined, '', '1', 'true', 'whatever']) expect(inlinedSwitchValue(name, v), `${name}=${String(v)}`).toBe('1');
      for (const v of ['0', 'false', 'OFF', ' no ']) expect(inlinedSwitchValue(name, v), `${name}=${v}`).toBe('0');
    }
    expect(inlinedSwitchValue('HOLLER_LOOKUP_DRY_RUN', 'yes')).toBe('1');
    expect(inlinedSwitchValue('HOLLER_LOOKUP_DRY_RUN', undefined)).toBe('');
    // Exactly "1" (REVENUECAT_ALLOW_SANDBOX trims, HOLLER_PREVIEW_FIXTURES does not): "true" is OFF for both readers.
    expect(inlinedSwitchValue('REVENUECAT_ALLOW_SANDBOX', ' 1 ')).toBe('1');
    expect(inlinedSwitchValue('REVENUECAT_ALLOW_SANDBOX', 'true')).toBe('');
    expect(inlinedSwitchValue('HOLLER_PREVIEW_FIXTURES', '1')).toBe('1');
    expect(inlinedSwitchValue('HOLLER_PREVIEW_FIXTURES', ' 1')).toBe('');
    expect(inlinedSwitchValue('HOLLER_PREVIEW_FIXTURES', 'true')).toBe('');
    expect(normalizeSwitchEnv({ REQUESTS_ENABLED: '0', HOLLER_PROBATION_FETCH: undefined, REVENUECAT_ALLOW_SANDBOX: 'sk_live_raw' })).toEqual({ REQUESTS_ENABLED: '0', HOLLER_PROBATION_FETCH: '1', REVENUECAT_ALLOW_SANDBOX: '' });
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

  it('only compares secret-like variables, never NEXT_PUBLIC_ or build metadata', () => {
    expect(
      Object.keys(
        secretValues({
          CRON_SECRET: 'x',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y',
          EMAIL_FROM: 'z',
          DATAFORSEO_LOGIN: 'l',
          FIREBASE_SERVICE_ACCOUNT_JSON: 'j',
          resend_api_key_holler: 'r',
          HOLLER_OWNER_USER_ID: 'u',
          VERCEL_GIT_COMMIT_AUTHOR_LOGIN: 'a',
          npm_package_name: 'holler',
          NODE_ENV: 'production',
        }),
      ).sort(),
    ).toEqual(['CRON_SECRET', 'DATAFORSEO_LOGIN', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'HOLLER_OWNER_USER_ID', 'resend_api_key_holler']);
  });

  it('knows every secret of lib/env.ts ENV_KEYS and .env.example by name (any case, any position), and no switch, cap or public value', () => {
    const exampleNames = [...readFileSync(join(ROOT, '.env.example'), 'utf8').matchAll(/^([A-Za-z0-9_]+)=/gm)].map((m) => m[1]);
    const SECRETS = [
      'AI_GATEWAY_API_KEY', 'BLUESKY_APP_PASSWORD', 'BRAVE_SEARCH_API_KEY', 'CRON_SECRET', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD',
      'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIRECRAWL_API_KEY', 'HOLLER_OWNER_USER_ID', 'INDEXNOW_KEY', 'RESEND_API_KEY', 'REVENUECAT_WEBHOOK_SECRET',
      'SAM_API_KEY', 'SERPER_API_KEY', 'SOCRATA_APP_TOKEN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'TICKETMASTER_API_KEY',
    ];
    const all = [...new Set([...ENV_KEYS, ...exampleNames])];
    // A new name in either list that looks secret fails here until it is added above on purpose; a secret whose name has none of the words must go in SECRET_EXTRA_NAMES.
    expect(all.filter((n) => isSecretName(n)).sort()).toEqual(SECRETS);
    for (const n of [...SECRETS, 'resend_api_key_holler', 'my_api_key_2', 'db_pass']) expect(Object.keys(secretValues({ [n]: 'a-secret-value-123' })), n).toEqual([n]);
    // The Vercel alias of the Resend key (lower case, ends in "holler") and a name that holds the word in the middle.
    for (const n of ['resend_api_key_holler', 'HOLLER_BUILDING_REF_SECRET', 'my_api_key_2', 'STRIPE_SECRETKEY', 'db_pass', 'KEY', 'x-token']) expect(isSecretName(n), n).toBe(true);
    for (const n of ['EMAIL_FROM', 'SUPPORT_EMAIL', 'HOLLER_BIDS_ENABLED', 'AI_MONTHLY_CAP_USD', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VERCEL_GIT_COMMIT_AUTHOR_LOGIN', 'npm_package_name', 'NODE_ENV', 'MONKEYS', 'PASSAGE']) expect(isSecretName(n), n).toBe(false);
  });

  it('compares a lower-case secret name and a short value, plain or JSON-escaped, and never reports the value', () => {
    const rec = (text: string, secrets: Record<string, string>) => scanChunk('a.js', text, { envKeys, secrets }).reads;
    const lower = rec('x="re_abcdefghijklmnop"', secretValues({ resend_api_key_holler: 're_abcdefghijklmnop' }));
    expect(lower).toEqual([{ file: 'a.js', rule: 'secret-value', name: 'resend_api_key_holler', context: '(value not printed)' }]);
    expect(MIN_SECRET_LENGTH).toBe(8);
    expect(rec('x="s3cr3t-9ch"', secretValues({ DB_PASSWORD: 's3cr3t-9ch' })).map((r) => r.name)).toEqual(['DB_PASSWORD']); // 10 characters: was skipped under 12
    expect(rec('x="abc1234"', secretValues({ DB_PASSWORD: 'abc1234' }))).toEqual([]); // 7 characters: too short to mean anything
    const json = JSON.stringify({ private_key: 'line1\nline2', client_email: 'a@b.c' });
    const escaped = JSON.stringify(json); // a bundler writes the JSON secret as a string literal
    expect(rec(`x=${escaped}`, secretValues({ FIREBASE_SERVICE_ACCOUNT_JSON: json })).map((r) => r.name)).toEqual(['FIREBASE_SERVICE_ACCOUNT_JSON']);
  });

  it('never prints a secret value: not as the hit, not in the context of another hit, not cut at the edge of the context window, not in the final line', () => {
    const value = 'sk_live_51ABCdefGHIjklMNOpqrSTU';
    const secrets = { STRIPE_SECRET_KEY: value };
    const pad = 'a'.repeat(60);
    const chunks = [
      `let a="${value}";`,
      `x=process.env.HOLLER_BIDS_ENABLED;k="${value}"`, // value just after a failing read
      `k="${value}";x=process.env.HOLLER_BIDS_ENABLED`, // value just before it
      `${pad}${value}${pad.slice(0, 20)}x=process.env.HOLLER_BIDS_ENABLED`, // the window starts inside the value
      `children:"HOLLER_BIDS_ENABLED is off";k="${value}"`, // value next to a warned sentence
      `x=e.env["${value}"]`, // the value used as a name
      `x=e.env.HOLLER_BIDS_ENABLED+"${value}".slice(0)+e.env.HOLLER_LSR_ENABLED`,
    ];
    for (const text of chunks) {
      const r = scanChunk('a.js', text, { envKeys, secrets });
      const printed = JSON.stringify(r);
      expect(printed, text).not.toContain(value);
      for (let i = 12; i <= value.length; i++) expect(printed, `${i} chars of the value in: ${text}`).not.toContain(value.slice(0, i));
      expect(r.reads.some((x) => x.rule === 'secret-value'), text).toBe(true);
    }
    expect(maskSecrets(`a ${value} b`, secrets)).toBe(`a ${'*'.repeat(value.length)} b`);
    expect(maskSecrets(`a ${value} b`, secrets, () => '[redacted]')).toBe('a [redacted] b');
    // main(): the whole log, with the secret in the environment as the build has it.
    vi.stubEnv('STRIPE_SECRET_KEY', value);
    const dir = mkdtempSync(join(tmpdir(), 'r34-check-'));
    try {
      writeFileSync(join(dir, 'a.js'), chunks.join('\n'));
      const log: string[] = [];
      expect(checkMain([dir], (l: string) => log.push(l))).toBe(1);
      expect(log.join('\n')).not.toContain(value);
      expect(log.join('\n')).not.toContain(value.slice(0, 14));
      expect(log.some((l) => l.includes('secret-value STRIPE_SECRET_KEY'))).toBe(true);
      // Last line of defence: even a file NAME that holds the value is masked in the log.
      writeFileSync(join(dir, `${value}.js`), 'children:"HOLLER_BIDS_ENABLED is off"');
      const named: string[] = [];
      checkMain([dir], (l: string) => named.push(l));
      expect(named.join('\n')).not.toContain(value);
      expect(named.join('\n')).toContain('[redacted]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('catches the env object copied by spread or with a fallback, and an inline read of a name that is not listed anywhere', () => {
    expect(readNames('let o={...t.default.env};f(o.SOME_API_KEY)')).toEqual(['env-alias:']);
    expect(readNames('let o={a:1,...process.env,b:2}')).toEqual(['env-alias:']);
    expect(readNames('let o=t.default.env||{};f(o.SOME_API_KEY)')).toEqual(['env-alias:']);
    expect(readNames('let o=t.default.env??{};f(o.SOME_API_KEY)')).toEqual(['env-alias:']);
    expect(readNames('f((process.env||{}).X)')).toEqual(['env-alias:']);
    expect(readNames('x=process.env?.HOLLER_NEW_THING_ENABLED')).toEqual(['env-member:HOLLER_NEW_THING_ENABLED']);
    // Still fine: the guard Next's polyfill and libraries write, and `&&` after the object.
    expect(readNames('"undefined"!=typeof process&&process.env&&process.env.NODE_ENV')).toEqual([]);
  });

  it('allows the library names of CLIENT_ENV_ALLOW (each with its library), and nothing near them', () => {
    expect(Object.keys(CLIENT_ENV_ALLOW).sort()).toEqual(['POSTHOG_RELEASE_ID', 'REACT_APP_VERCEL_OBSERVABILITY_BASEPATH', 'REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG', 'npm_package_name', 'npm_package_version']);
    for (const [name, why] of Object.entries(CLIENT_ENV_ALLOW)) expect(why.length, name).toBeGreaterThan(20);
    // The shapes the published files have (node_modules/@supabase/ssr, @vercel/analytics, @vercel/speed-insights, posthog-js).
    const lib = [
      'if("undefined"==typeof process||!process.env?.npm_package_name)return;const t=process.env.npm_package_name;',
      'function getBasePath(){return"undefined"==typeof process||"undefined"==typeof process.env?void 0:process.env.REACT_APP_VERCEL_OBSERVABILITY_BASEPATH}',
      'function getConfigString(){return process.env.REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG}',
      'if("u">typeof process){var t;const i=null===(t=process.env.POSTHOG_RELEASE_ID)||void 0===t?void 0:t.trim();if(i)return i}',
      'let{npm_package_version:v}=process.env;',
      'x=process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH',
      // Verbatim from the scratch build with @vercel/analytics, @vercel/speed-insights and posthog-js (gates log build-B3): the guard compares env with undefined.
      'basePath:e.basePath??function(){if(void 0!==M.default&&void 0!==M.default.env)return M.default.env.REACT_APP_VERCEL_OBSERVABILITY_BASEPATH}(),...e},e.configString??function(){if(void 0!==M.default&&void 0!==M.default.env)return M.default.env.REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG}())',
      'i=function(){if("u">typeof M.default){var e;let t=null==(e=M.default.env.POSTHOG_RELEASE_ID)?void 0:e.trim();if(t)return t}return 1}',
      '(function(){if(vl||void 0===M.default||!M.default.env?.npm_package_name)return;let e=M.default.env.npm_package_name;vu.includes(e)&&(vl=!0)})()',
    ];
    for (const cmp of ['void 0!==t.default.env', 'void 0===t.default.env', 'x!=process.env', 'x==process.env', 'a<=process.env', 'a>=process.env']) expect(readNames(`if(${cmp})f()`), cmp).toEqual([]);
    for (const text of lib) expect(readNames(text), text).toEqual([]);
    // Near misses and the forbidden names still fail, even when someone lists them.
    for (const name of ['npm_package_nam', 'NPM_PACKAGE_NAME', 'npm_package_name2', 'npm_config_cache', 'VERCEL_URL', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'POSTHOG_RELEASE_IDS', 'LANG']) {
      expect(readNames(`x=process.env.${name}`), name).toEqual([`env-member:${name}`]);
    }
    for (const name of ['HOLLER_HAIL_ROUTING_ENABLED', 'HOLLER_ROAD_WORDS_ENABLED', 'CRON_SECRET', 'STRIPE_SECRET_KEY', 'SAM_API_KEY', 'DATAFORSEO_PASSWORD', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'resend_api_key_holler', 'INDEXNOW_KEY', 'REQUESTS_ENABLED', 'SUPPORT_EMAIL']) {
      expect(readNames(`x=process.env.${name}`), name).toEqual([`env-member:${name}`]);
      expect(readNames(`x=process.env?.${name}`), name).toEqual([`env-member:${name}`]);
    }
  });

  it('the allow-list holds no HOLLER_* name, no secret-like name and no lib/env.ts name, and a list that does is refused', () => {
    expect(allowListProblems(envKeys)).toEqual([]);
    for (const name of Object.keys(CLIENT_ENV_ALLOW)) {
      expect(name).not.toMatch(/^HOLLER_/i);
      expect(isSecretName(name), name).toBe(false);
      expect(envKeys.map((k: string) => k.toLowerCase()), name).not.toContain(name.toLowerCase());
    }
    const hostile = { HOLLER_SAM_LABELS_ENABLED: 'x', holler_x: 'x', CRON_SECRET: 'x', STRIPE_SECRET_KEY: 'x', SOME_TOKEN: 'x', DB_PASSWORD: 'x', API_KEY: 'x', EMAIL_FROM: 'x', 'bad name': 'x' };
    expect(allowListProblems(envKeys, hostile).sort()).toEqual(Object.keys(hostile).sort());
    // A forbidden name is never allowed, whatever a list says.
    for (const name of Object.keys(hostile)) expect(isAllowed(name, envKeys, hostile), name).toBe(false);
    expect(isAllowed('npm_package_name', envKeys)).toBe(true);
    expect(isAllowed('NODE_ENV', envKeys)).toBe(true);
    expect(isAllowed('NEXT_PUBLIC_SITE_URL', envKeys)).toBe(true);
    expect(isAllowed('toString', envKeys)).toBe(false);
    expect(isAllowed('__proto__', envKeys)).toBe(false);
  });

  it('finds a server-bundle read of an inlined name that Next did not replace (process.env?.NAME), and ignores the replaced form', () => {
    const names = ['HOLLER_ROAD_WORDS_ENABLED', 'HOLLER_SAM_LABELS_ENABLED'];
    const rule = (t: string) => scanServerForInlinedReads('server/a.js', t, names).map((r: { name: string }) => r.name);
    expect(rule('x=void 0!==e.default?e.default.env?.HOLLER_ROAD_WORDS_ENABLED:void 0')).toEqual(['HOLLER_ROAD_WORDS_ENABLED']);
    expect(rule('x=process.env?.HOLLER_SAM_LABELS_ENABLED')).toEqual(['HOLLER_SAM_LABELS_ENABLED']);
    expect(rule('x=process.env.HOLLER_SAM_LABELS_ENABLED')).toEqual(['HOLLER_SAM_LABELS_ENABLED']);
    expect(rule('x=e.env["HOLLER_ROAD_WORDS_ENABLED"]')).toEqual(['HOLLER_ROAD_WORDS_ENABLED']);
    expect(rule('x=e.env?.["HOLLER_ROAD_WORDS_ENABLED"]')).toEqual(['HOLLER_ROAD_WORDS_ENABLED']);
    // Replaced by Next: the value is in the text, the name is gone; a message or a key name is not a read.
    expect(rule('x="1"==="1"?a:b')).toEqual([]);
    expect(rule('t="HOLLER_ROAD_WORDS_ENABLED is on";u={HOLLER_ROAD_WORDS_ENABLED:"1"}')).toEqual([]);
    expect(rule('x=process.env.HOLLER_ROAD_WORDS_ENABLED_OTHER')).toEqual([]);
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

  it('finds source that writes an inlined name as process.env?.NAME (documented form is the plain member), and skips comments and other names', () => {
    const names = ['HOLLER_ROAD_WORDS_ENABLED', 'HOLLER_SAM_LABELS_ENABLED'];
    const hit = (t: string) => scanSourceForOptionalReads('lib/x.ts', t, names).map((r: { name: string; file: string }) => `${r.name}@${r.file}`);
    expect(hit("export function f(value = typeof process !== 'undefined' ? process.env?.HOLLER_ROAD_WORDS_ENABLED : undefined) {}")).toEqual(['HOLLER_ROAD_WORDS_ENABLED@lib/x.ts:1']);
    expect(hit('const a = 1;\nconst x = env?.HOLLER_SAM_LABELS_ENABLED;')).toEqual(['HOLLER_SAM_LABELS_ENABLED@lib/x.ts:2']);
    expect(hit('const x = process.env?.["HOLLER_SAM_LABELS_ENABLED"];')).toEqual(['HOLLER_SAM_LABELS_ENABLED@lib/x.ts:1']);
    expect(hit("const x = process.env.HOLLER_SAM_LABELS_ENABLED;")).toEqual([]);
    expect(hit('// the reader must not be process.env?.HOLLER_SAM_LABELS_ENABLED\n * or process.env?.HOLLER_ROAD_WORDS_ENABLED')).toEqual([]);
    expect(hit('const x = process.env?.HOLLER_LSR_ENABLED;')).toEqual([]); // not an inlined name: a runtime read on purpose
    expect(hit('const x = process.env?.HOLLER_SAM_LABELS_ENABLED_OTHER;')).toEqual([]);
  });

  it('main() fails when a server bundle still reads an inlined name, and passes when the browser is clean and the server was replaced', () => {
    const base = mkdtempSync(join(tmpdir(), 'r34-check-'));
    try {
      const next = join(base, '.next');
      mkdirSync(join(next, 'static', 'chunks'), { recursive: true });
      mkdirSync(join(next, 'server', 'chunks'), { recursive: true });
      writeFileSync(join(next, 'static', 'chunks', 'a.js'), 'n=function(e=void 0!==nD.default?"1":void 0){return e}');
      writeFileSync(join(next, 'required-server-files.json'), JSON.stringify({ config: { env: { HOLLER_ROAD_WORDS_ENABLED: '1' } } }));
      writeFileSync(join(next, 'server', 'chunks', 'ok.js'), 'x=""==="1"?1:2;t="HOLLER_ROAD_WORDS_ENABLED is on"');
      const log: string[] = [];
      expect(checkMain([join(next, 'static')], (l: string) => log.push(l))).toBe(0);
      expect(log.some((l) => l.includes('1 server files checked'))).toBe(true);
      writeFileSync(join(next, 'server', 'chunks', 'bad.js'), 'x=e.default.env?.HOLLER_ROAD_WORDS_ENABLED');
      const bad: string[] = [];
      expect(checkMain([join(next, 'static')], (l: string) => bad.push(l))).toBe(1);
      expect(bad.some((l) => l.startsWith('FAIL inlined-read-left HOLLER_ROAD_WORDS_ENABLED in server/chunks/bad.js'))).toBe(true);
      expect(bad.join('\n')).toContain('CLIENT_ENV_ALLOW');
      // The source rule: a project whose lib/ writes process.env?.NAME for an inlined name fails the build, with the file and line.
      rmSync(join(next, 'server', 'chunks', 'bad.js'));
      const proj = join(base, 'proj');
      mkdirSync(join(proj, 'lib'), { recursive: true });
      writeFileSync(join(proj, 'lib', 'ok.ts'), 'export const a = process.env.HOLLER_ROAD_WORDS_ENABLED;\n');
      expect(checkMain([join(next, 'static')], () => {}, proj)).toBe(0);
      writeFileSync(join(proj, 'lib', 'bad.ts'), 'const x = 1;\nexport const b = process.env?.HOLLER_ROAD_WORDS_ENABLED;\n');
      const src: string[] = [];
      expect(checkMain([join(next, 'static')], (l: string) => src.push(l), proj)).toBe(1);
      expect(src.some((l) => l.startsWith('FAIL inlined-optional-read HOLLER_ROAD_WORDS_ENABLED in lib/bad.ts:2'))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
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
