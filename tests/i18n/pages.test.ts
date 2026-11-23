/**
 * Round 17, unit ES: the public Spanish pages /es and /es/check: copy, lang, hreflang pairs, canonical, noindex variants, sitemap,
 * Content-Language header. No network: the check data is a fake.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
const loadCheck = vi.hoisted(() => vi.fn());
vi.mock('@/lib/check/load', () => ({ loadCheck }));
vi.mock('@/lib/check/limit', () => ({ gateCheck: async () => 'ok' }));
vi.mock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import HomeEs, { generateMetadata as homeMeta } from '@/app/es/page';
import CheckPageEs, { generateMetadata as checkMeta } from '@/app/es/check/page';
import { generateMetadata as enHomeMeta } from '@/app/page';
import { generateMetadata as enCheckMeta } from '@/app/check/page';
import EsLayout from '@/app/es/layout';
import { LangSync } from '@/components/es/lang-sync';
import { ES_PAIRS, ES_PATHS, contentLanguageRules, pairAlternates } from '@/lib/i18n/seo';
import { buildEntries } from '@/lib/seo/sitemap-entries';
import { securityHeaderRules } from '@/lib/security-headers';
import { spanishProblems } from '@/lib/i18n/rules';
import { es } from '@/lib/i18n/es';

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

type Sp = Record<string, string>;
type Props = { searchParams: Promise<Sp> };
function findAsync(node: ReactNode): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findAsync(n);
      if (f) return f;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { searchParams?: unknown; children?: ReactNode };
  if (props.searchParams && typeof node.type === 'function') return node as ReactElement<Props>;
  if (typeof node.type === 'function' && !props.children) return findAsync((node.type as (p: unknown) => ReactNode)(node.props));
  return findAsync(props.children);
}
async function renderCheck(sp: Sp) {
  const page = CheckPageEs({ searchParams: Promise.resolve(sp) } as never) as ReactElement;
  const shell = renderToStaticMarkup(page);
  const check = findAsync(page);
  if (!check) throw new Error('no async Check element found');
  const out = await (check.type as (p: Props) => Promise<ReactNode>)(check.props);
  return { shell, html: renderToStaticMarkup(createElement('div', null, out)) };
}

describe('/es (home)', () => {
  const html = renderToStaticMarkup(HomeEs());
  const t = text(html);
  it('has one h1, in Spanish, and the Spanish sections', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(t).toContain(es['hero.h1']);
    for (const k of ['how.h', 'five.h', 'fam.h', 'faq.h', 'close.h'] as const) expect(t, k).toContain(es[k]);
    expect(t).toContain('Holler');
  });
  it('the ZIP form posts to /es/check and says so in Spanish', () => {
    expect(html).toContain('action="/es/check"');
    expect(html).not.toContain('action="/check"');
    expect(html).toContain(es['zip.button']);
    expect(html).toContain(`placeholder="${es['zip.placeholder']}"`);
  });
  it('links to the English counterpart with hreflang, and says which pages are English', () => {
    expect(html).toMatch(/<a href="\/"[^>]*hrefLang="en"|<a href="\/"[^>]*hreflang="en"/i);
    expect(t).toContain('(en inglés)');
  });
  it('the FAQ JSON-LD is Spanish', () => {
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1];
    const j = JSON.parse(ld.replace(/\\u003c/g, '<'));
    expect(j['@type']).toBe('FAQPage');
    expect(j.inLanguage).toBe('es');
    expect(j.mainEntity).toHaveLength(4);
    expect(j.mainEntity[0].name).toBe(es['faq.q1']);
  });
  it('breaks no Spanish wording rule and has no English page chrome', () => {
    expect(spanishProblems(t)).toEqual([]);
    for (const english of ['Check my area', 'How it works', 'Straight answers', 'Start free', 'Log in', 'Skip to content']) expect(t, english).not.toContain(english);
    expect(t).not.toMatch(/\bleads?\b|garantiz|cliente potencial/i);
  });
  it('metadata: Spanish title and description, own canonical, hreflang en/es/x-default, es_US', () => {
    const m = homeMeta();
    expect((m.title as { absolute: string }).absolute).toBe(es['land.title']);
    expect(m.description).toMatch(/Holler revisa datos públicos/);
    expect(m.alternates).toEqual({ canonical: '/es', languages: { en: '/', es: '/es', 'x-default': '/' } });
    expect((m.openGraph as { locale?: string }).locale).toBe('es_US');
    expect((m.openGraph as { url?: string }).url).toBe('/es');
  });
});

describe('/es/check', () => {
  it('shell: one Spanish h1 and a Spanish form', async () => {
    const { shell } = await renderCheck({});
    expect(shell.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(text(shell)).toContain(es['chk.h1']);
    expect(shell).toContain('action="/es/check"');
  });
  it('empty: the Spanish preview of what the check lists, no English', async () => {
    const { html } = await renderCheck({});
    const t = text(html);
    expect(t).toContain(es['chk.preview.h']);
    expect(t).toContain(es['chk.pick']);
    expect(t).not.toContain('What the check lists');
    expect(spanishProblems(t)).toEqual([]);
  });
  it('the trade select lists Spanish trade and group names (the values are still the trade ids)', async () => {
    const { html } = await renderCheck({});
    expect(html).toContain('value="roofing"');
    expect(html).toContain('>Techos<');
    expect(html).toMatch(/<optgroup label="Casa y propiedad"/);
    expect(html).not.toContain('>Roofing<');
  });
  it('a known ZIP with no trade: the Spanish prompt, no error', async () => {
    const { html } = await renderCheck({ zip: '60614' });
    expect(html).toContain(es['chk.prompt.trade']);
    expect(html).not.toContain('role="alert"');
  });
  it('bad, missing and unknown ZIPs and an unknown trade get Spanish errors', async () => {
    expect((await renderCheck({ zip: 'abc' })).html).toContain(es['chk.err.zip_bad']);
    expect((await renderCheck({ zip: '00000' })).html).toContain(es['chk.err.zip_unknown']);
    expect((await renderCheck({ zip: '60614', trade: 'astronaut' })).html).toContain(es['chk.err.trade']);
    expect((await renderCheck({ trade: 'roofing' })).html).toContain(es['chk.err.zip_missing']);
  });
  it('results: Spanish headings, group titles, distance, age and source line; the record titles stay as the source wrote them', async () => {
    const now = Date.now();
    loadCheck.mockResolvedValue({
      ok: true,
      checkedAt: new Date(now - 5 * 60_000).toISOString(),
      items: [
        { id: 1, kind: 'report', source: 'spc', title: '1.50 inch hail reported near 2 ESE Atlanta, GA', url: 'https://www.spc.noaa.gov/climo/reports/', place: 'Atlanta, GA', lat: 33.8, lon: -84.4, occurredAt: new Date(now - 3 * 3_600_000).toISOString(), severity: 2 },
        { id: 2, kind: 'permit', source: 'arcgis-atlanta-permits', title: 'Roof permit in Atlanta', url: 'https://services5.arcgis.com/x', place: 'Atlanta, GA', lat: 33.75, lon: -84.39, occurredAt: new Date(now - 2 * 86_400_000).toISOString(), severity: 1 },
      ],
    });
    const { html } = await renderCheck({ zip: '30303', trade: 'roofing' });
    const t = text(html);
    expect(t).toContain('Techos: dentro de 25 millas de Atlanta, GA, últimos 30 días');
    expect(t).toContain('Clima y desastres');
    expect(t).toContain('Permisos de construcción');
    expect(t).toContain('Granizo de 1.50 pulgadas reportado cerca de 2 ESE Atlanta, GA');
    expect(t).toContain('Fuente pública: Reportes de tormenta del Centro de Predicción de Tormentas de NOAA');
    expect(t).toContain('Fuente pública: Datos abiertos de Atlanta: permisos de construcción');
    expect(t).toMatch(/hace 3 h|hace 3 horas/);
    expect(t).toContain(es['chk.cta.intro']);
    // Round 23: the Spanish CTA goes to the Spanish sign-up. It used to build '/signup?city=...' and ignore `lang`, so every /es
    // conversion landed on the English page.
    expect(html).toContain('href="/es/signup?city=');
    expect(html).not.toMatch(/href="\/signup/);
    expect(t).not.toMatch(/Source:|Weather and disasters|Building permits|ago\b/);
    expect(spanishProblems(t.replace(/1\.50 inch hail reported near 2 ESE Atlanta, GA|Roof permit in Atlanta/g, ' '))).toEqual([]);
  });
  it('an empty result says what Holler watches, in Spanish, and never claims damage', async () => {
    loadCheck.mockResolvedValue({ ok: true, checkedAt: new Date().toISOString(), items: [] });
    const { html } = await renderCheck({ zip: '30303', trade: 'roofing' });
    const t = text(html);
    expect(t).toContain('Holler busca trabajo de');
    expect(t).toContain(es['chk.watch_h']);
    expect(spanishProblems(t)).toEqual([]);
  });
  it('unreadable data is a Spanish sentence, not a broken page', async () => {
    loadCheck.mockResolvedValue({ ok: false, items: [], checkedAt: new Date().toISOString() });
    expect(text((await renderCheck({ zip: '30303', trade: 'roofing' })).html)).toContain(es['chk.empty.unreadable']);
  });
  // Round 24 INT2: the waitlist card is on the Spanish page itself (it posts lang 'es'); nothing sends the visitor to the English page.
  it('a ZIP Holler does not cover: says so in Spanish and shows the Spanish waitlist form on this page', async () => {
    const { html } = await renderCheck({ zip: '00601', trade: 'roofing' });
    expect(html).not.toContain('href="/check?zip=00601');
    expect(html).not.toMatch(/hrefLang="en"[^>]*>[^<]*lista de espera/i);
    expect(text(html)).toContain(es['wl.card.button']);
    expect(text(html)).toContain(es['wl.card.email']);
    expect(html).toMatch(/<input[^>]*type="email"/);
  });
  it('metadata: only the bare page is indexed, every ?zip= variant is noindex, canonical and hreflang pairs are the same either way', async () => {
    const bare = await checkMeta({ searchParams: Promise.resolve({}) } as never);
    const variant = await checkMeta({ searchParams: Promise.resolve({ zip: '30303' }) } as never);
    expect(bare.robots).toEqual({ index: true, follow: true });
    expect(variant.robots).toEqual({ index: false, follow: true });
    for (const m of [bare, variant]) expect(m.alternates).toEqual({ canonical: '/es/check', languages: { en: '/check', es: '/es/check', 'x-default': '/check' } });
    expect(bare.title).toBe(es['chk.meta.title']);
    expect(bare.description).toBe(es['chk.meta.desc']);
  });
});

describe('hreflang pairs on the English twins', () => {
  it('/ and /check keep their own canonical and add the same en/es/x-default set', async () => {
    expect(enHomeMeta().alternates).toEqual({ canonical: '/', languages: { en: '/', es: '/es', 'x-default': '/' } });
    expect((await enCheckMeta({ searchParams: Promise.resolve({}) } as never)).alternates).toEqual({ canonical: '/check', languages: { en: '/check', es: '/es/check', 'x-default': '/check' } });
  });
  it('the pair table points at pages that exist, and only those pages are paired', () => {
    // Round 18 ES added pricing and the four account pages.
    const spanish = ['/es', '/es/check', '/es/pricing', '/es/signup', '/es/login', '/es/forgot', '/es/reset'];
    expect(ES_PAIRS.map((p) => p.es)).toEqual(spanish);
    expect(ES_PATHS).toEqual(spanish);
    for (const p of spanish) expect(existsSync(`app${p}/page.tsx`), p).toBe(true);
    expect(pairAlternates(ES_PAIRS[0], 'es').canonical).toBe('/es');
    expect(pairAlternates(ES_PAIRS[0], 'en').canonical).toBe('/');
  });
});

describe('sitemap', () => {
  const entries = buildEntries({ places: { ok: true, counts: {}, latest: {} } as never, trades: [] });
  const url = (p: string) => entries.find((e) => new URL(e.url).pathname === p);
  it('lists /es and /es/check next to / and /check, each with the same hreflang set', () => {
    expect(url('/es')).toBeDefined();
    expect(url('/es/check')).toBeDefined();
    const home = url('/')!.alternates!.languages;
    expect(home).toEqual(url('/es')!.alternates!.languages);
    expect(Object.keys(home).sort()).toEqual(['en', 'es', 'x-default']);
    expect(new URL(home.es).pathname).toBe('/es');
    expect(new URL(home['x-default']).pathname).toBe('/');
    const check = url('/check')!.alternates!.languages;
    expect(check).toEqual(url('/es/check')!.alternates!.languages);
    expect(new URL(check.es).pathname).toBe('/es/check');
  });
  it('no other page is paired or listed in Spanish (the SEO city pages are not translated)', () => {
    // Round 18 ES: pricing (both languages) and the Spanish account pages; the English account pages are noindex and not listed, and
    // /es/reset (noindex, works only from an emailed link) is left out.
    const withAlt = entries.filter((e) => e.alternates).map((e) => new URL(e.url).pathname).sort();
    expect(withAlt).toEqual(['/', '/check', '/es', '/es/check', '/es/forgot', '/es/login', '/es/pricing', '/es/signup', '/pricing'].sort());
    expect(entries.filter((e) => new URL(e.url).pathname.startsWith('/es')).map((e) => new URL(e.url).pathname).sort()).toEqual(['/es', '/es/check', '/es/forgot', '/es/login', '/es/pricing', '/es/signup']);
  });
});

describe('language of the page', () => {
  it('the Spanish layout wraps the page in lang="es" and mounts LangSync', () => {
    const html = renderToStaticMarkup(EsLayout({ children: createElement('p', null, 'x') }));
    expect(html).toMatch(/^<div lang="es"/);
  });
  it('LangSync sets document.documentElement.lang and puts it back on unmount', async () => {
    vi.resetModules();
    let effect: (() => void | (() => void)) | undefined;
    vi.doMock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), useEffect: (fn: () => void | (() => void)) => void (effect = fn) }));
    const root = { lang: 'en' };
    vi.stubGlobal('document', { documentElement: root });
    const { LangSync: Fresh } = await import('@/components/es/lang-sync');
    Fresh({ lang: 'es' });
    const cleanup = effect!() as () => void;
    expect(root.lang).toBe('es');
    cleanup();
    expect(root.lang).toBe('en');
    vi.unstubAllGlobals();
    vi.doUnmock('react');
    expect(typeof LangSync).toBe('function');
  });
  it('next.config sends Content-Language: es for /es and /es/check, and keeps every security header', async () => {
    const rules = contentLanguageRules();
    expect(rules).toEqual([{ source: '/es/:path*', headers: [{ key: 'Content-Language', value: 'es' }] }]);
    const { default: nextConfig } = await import('../../next.config');
    const all = await nextConfig.headers!();
    expect(all).toEqual([...securityHeaderRules(), ...rules]);
    // the rule matches /es and /es/check but not /espresso or /en/es
    // @ts-expect-error next ships this compiled module without a type declaration
    const { pathToRegexp } = (await import('next/dist/compiled/path-to-regexp')) as { pathToRegexp: (p: string) => RegExp };
    const re = pathToRegexp('/es/:path*');
    expect(['/es', '/es/check'].every((p) => re.test(p))).toBe(true);
    expect(['/espresso', '/check', '/'].some((p) => re.test(p))).toBe(false);
  });
});
