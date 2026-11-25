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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rolldown } from 'rolldown';
import { BriefBlock, type BriefBlockItem } from '@/components/feed/brief-block';
import { labelFor, storefrontKindOfName } from '@/lib/signals/lead-rules';
import { INLINED_SWITCHES, inlinedSwitchEnv, switchOn, type InlinedSwitch } from '@/lib/build-switches';
import { chunkHits, serverEnvNames } from '@/lib/build-switch-check';
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

  it('next.config.ts puts them in `env` (so Next replaces them in both bundles) and keeps any other `env` entry', async () => {
    expect(await nextConfigEnv({})).toMatchObject({ HOLLER_SAM_LABELS_ENABLED: '', HOLLER_BUSINESS_TAG_FIX_ENABLED: '' });
    expect(await nextConfigEnv({ HOLLER_SAM_LABELS_ENABLED: 'on', HOLLER_BUSINESS_TAG_FIX_ENABLED: '1' })).toMatchObject({
      HOLLER_SAM_LABELS_ENABLED: '1',
      HOLLER_BUSINESS_TAG_FIX_ENABLED: '1',
    });
    expect(readFileSync(join(ROOT, 'next.config.ts'), 'utf8')).toContain('nextConfig.env = { ...nextConfig.env, ...inlinedSwitchEnv(process.env) };');
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

describe('scripts/check-client-switches.ts (the build-chunk check)', () => {
  const names = serverEnvNames();
  it('checks every ENV_KEYS name except NEXT_PUBLIC_*, so every switch and every secret is covered', () => {
    expect(names).toContain('HOLLER_SAM_LABELS_ENABLED');
    expect(names).toContain('HOLLER_BUSINESS_TAG_FIX_ENABLED');
    expect(names).toContain('HOLLER_HAIL_ROUTING_ENABLED');
    expect(names).toContain('CRON_SECRET');
    expect(names.some((n) => n.startsWith('NEXT_PUBLIC_'))).toBe(false);
    expect(names.length).toBe(ENV_KEYS.length - ENV_KEYS.filter((k) => k.startsWith('NEXT_PUBLIC_')).length);
  });

  it('flags the runtime reads seen in main\'s browser chunk, in every form', () => {
    const mainChunk = 'n=function(e=void 0!==nD.default?nD.default.env?.HOLLER_SAM_LABELS_ENABLED:void 0){return"string"==typeof e}';
    expect(chunkHits('a.js', mainChunk, names)).toEqual([expect.objectContaining({ file: 'a.js', name: 'HOLLER_SAM_LABELS_ENABLED', envRead: true })]);
    expect(chunkHits('b.js', 'x=process.env.HOLLER_BUSINESS_TAG_FIX_ENABLED', names)[0]).toMatchObject({ name: 'HOLLER_BUSINESS_TAG_FIX_ENABLED', envRead: true });
    expect(chunkHits('c.js', 'x=e.env["HOLLER_ERATE_ENABLED"]', names)[0]).toMatchObject({ envRead: true });
    expect(chunkHits('d.js', 'let F="HOLLER_STAGE_UPDATES_ENABLED";y=e.env[F]', names)[0]).toMatchObject({ name: 'HOLLER_STAGE_UPDATES_ENABLED', envRead: false });
  });

  it('passes an inlined chunk and does not match a longer name or NEXT_PUBLIC_*', () => {
    const inlined = 'n=function(e=void 0!==nD.default?"1":void 0){return"string"==typeof e}';
    expect(chunkHits('a.js', inlined, names)).toEqual([]);
    expect(chunkHits('a.js', 'x=y.HOLLER_SAM_LABELS_ENABLED_V2+z.NEXT_PUBLIC_SUPABASE_URL', names)).toEqual([]);
  });

  it('is wired as npm run check:client-switches', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:client-switches']).toContain('scripts/check-client-switches.ts');
  });
});
