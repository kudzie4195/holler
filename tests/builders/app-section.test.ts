/**
 * Round 19 UNIFY: "Who's building near you" on the real /app page (harness after tests/i18n/app-page.test.ts). The loader is mocked
 * here (tests/builders/load.test.ts covers it); this file checks the wiring: English and Spanish text, a locked account never reads it,
 * the section is a panel and not a card, and an empty list leaves the page exactly as it was.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spanishProblems } from '@/lib/i18n/rules';
import type { ActiveBuilder } from '@/lib/builders/active';

const NOW = new Date('2026-11-22T12:00:00Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const BUILDERS: ActiveBuilder[] = [
  { name: 'Victory Plumbing Company', permits: 3, kinds: ['plumbing', 'new home'], newest: iso(-86_400_000), phone: '512-990-7200', relation: 'same-trade' },
  { name: 'Charge Electrical Services LLC', permits: 1, kinds: ['electrical'], newest: iso(-2 * 86_400_000), phone: null, relation: 'other' },
];

async function renderApp(opts: { language?: 'en' | 'es'; locked?: boolean; builders?: ActiveBuilder[] | 'throw'; windowDays?: number } = {}) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.doMock('server-only', () => ({}));
  const profile: Record<string, unknown> = {
    user_id: 'u1', business_name: 'Pinos Plumbing', categories: ['plumbing'], zip: '78701', city: 'Austin', state: 'TX', lat: 30.27, lon: -97.74,
    radius_mi: 25, alert_email: true, subscription_status: opts.locked ? 'trialing' : 'active', trial_ends_at: opts.locked ? iso(-86_400_000) : iso(86_400_000),
    plan: 'starter', stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000),
    language: opts.language ?? 'en',
  };
  vi.doMock('@/lib/auth/session', () => ({ requireProfile: async () => ({ user: { id: 'u1' }, profile }), getProfile: async () => profile }));
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => {
      const q: any = {};
      q.from = () => q;
      q.select = () => q;
      for (const m of ['eq', 'order']) q[m] = () => q;
      q.limit = async () => ({ data: [], error: null });
      return q;
    },
  }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  const loader = vi.fn(async () => {
    if (opts.builders === 'throw') throw new Error('boom');
    return { builders: opts.builders ?? BUILDERS, windowDays: opts.windowDays ?? 30 };
  });
  // Round 19 review (defect 4): the page renders <BuildersPanel> in its own Suspense below the feed, and the panel reads the cached
  // loader. renderToStaticMarkup shows a Suspense fallback for an async child, so the panel is found in the element tree and rendered
  // on its own, exactly as the page passes it.
  vi.doMock('@/lib/builders/cached', async (orig) => ({ ...(await orig<typeof import('@/lib/builders/cached')>()), cachedActiveBuilders: loader }));
  vi.doMock('@/lib/feedback/service', () => ({ loadFeedback: async () => new Map() }));
  vi.doMock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
  vi.doMock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));
  vi.doMock('@/components/coming-next-member', () => ({ ComingNextForMember: () => null }));
  vi.doMock('@/components/billing-button', () => ({ BillingButton: () => null }));
  vi.doMock('@/components/feed/empty-feed', () => ({ EmptyFeed: () => null, emptyFeedApplies: (o: { items: number; locked: boolean; failed: boolean }) => o.items === 0 && !o.locked && !o.failed }));
  vi.doMock('@/components/feed/recent-activity', () => ({ RecentActivity: () => null }));
  const AppHome = (await import('@/app/app/page')).default;
  const { BuildersPanel } = await import('@/components/builders/builders-panel');
  const tree = await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never);
  const callsBeforePanel = loader.mock.calls.length;
  const found = findElement(tree, BuildersPanel);
  const pageHtml = renderToStaticMarkup(tree);
  const callsInPage = loader.mock.calls.length - callsBeforePanel;
  loader.mockClear();
  const panelHtml = found ? renderToStaticMarkup(await BuildersPanel(found.props as Parameters<typeof BuildersPanel>[0])) : '';
  // The static page render shows the Suspense fallback (null) for the async panel; the panel's own HTML is appended for the text checks.
  return { html: pageHtml.replace(/<section aria-labelledby="builders-h"[\s\S]*?<\/section>/, '') + panelHtml, pageHtml, panelHtml, loader, found, callsBeforePanel, callsInPage, tree, BuildersPanel };
}

/** Depth-first search of a React element tree for an element of `type`, with its position (order of visit). */
function findElement(node: unknown, type: unknown, order = { n: 0 }): { props: Record<string, unknown>; at: number } | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = findElement(c, type, order);
      if (r) return r;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  order.n++;
  if (el.type === type) return { props: el.props ?? {}, at: order.n };
  return el.props ? findElement(el.props.children, type, order) : null;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('/app: who is building near you', () => {
  it('English: heading, the public-record note, counts, kinds, the same-trade line and a tel link', async () => {
    const { html, loader } = await renderApp();
    const t = text(html);
    expect(loader).toHaveBeenCalledTimes(1);
    expect((loader.mock.calls[0] as unknown[])[0]).toBe('u1');
    expect(t).toContain("Who's building near you");
    expect(t).toContain('From public permit records. Companies only.');
    expect(t).toContain('Victory Plumbing Company');
    expect(t).toContain('3 permits in the last 30 days: plumbing, new home');
    expect(t).toContain('1 permit in the last 30 days: electrical');
    expect(t).toContain('Works in your trade');
    expect(html).toContain('href="tel:5129907200"');
    // Wording rules: no "lead(s)" noun, no promise, no claim the company was hired by the owner.
    expect(t).not.toMatch(/\bleads?\b|guaranteed|you will win|they need you|official record/i);
  });

  it('the window the loader actually covered is the one printed (honest window)', async () => {
    expect(text((await renderApp({ windowDays: 9 })).html)).toContain('3 permits in the last 9 days');
    expect(text((await renderApp({ windowDays: 1 })).html)).toContain('3 permits in the last day');
  });

  it('Spanish: the whole section is Spanish (usted) and breaks no Spanish wording rule', async () => {
    const { html } = await renderApp({ language: 'es' });
    const t = text(html);
    expect(t).toContain('Quién está construyendo cerca de usted');
    expect(t).toContain('Según registros públicos de permisos. Solo empresas.');
    expect(t).toContain('3 permisos en los últimos 30 días: plomería, vivienda nueva');
    expect(t).toContain('1 permiso en los últimos 30 días');
    expect(t).toContain('Trabaja en su mismo oficio');
    for (const en of ["Who's building near you", 'Companies only', 'Works in your trade', 'permits in the last']) expect(t, en).not.toContain(en);
    const section = t.slice(t.indexOf('Quién está construyendo'), t.indexOf('Trabaja en su mismo oficio') + 30);
    expect(spanishProblems(section)).toEqual([]);
  });

  it('a locked account never calls the loader and shows no section', async () => {
    const { html, loader } = await renderApp({ locked: true });
    expect(loader).not.toHaveBeenCalled();
    expect(text(html)).not.toContain("Who's building near you");
  });

  it('no builders, or a loader that throws: the page is exactly the page without the section', async () => {
    const none = await renderApp({ builders: [] });
    const failed = await renderApp({ builders: 'throw' });
    expect(text(none.html)).not.toContain("Who's building near you");
    expect(none.panelHtml).toBe('');
    expect(failed.panelHtml).toBe('');
    expect(failed.html).toBe(none.html);
  });

  it('review defect 4: the page itself never waits for the loader; the panel sits in its own Suspense after the feed', async () => {
    const { loader, callsBeforePanel, found, tree } = await renderApp();
    expect(callsBeforePanel).toBe(0);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(found).not.toBeNull();
    // The feed block comes first: a Suspense whose child is the panel is found after the element holding the feed.
    const names: string[] = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const el = n as { type?: unknown; props?: { children?: unknown; fallback?: unknown } };
      if (typeof el.type === 'function') names.push(el.type.name);
      else if (typeof el.type === 'symbol') names.push(String(el.type));
      if (el.props) {
        walk(el.props.fallback);
        walk(el.props.children);
      }
    };
    walk(tree);
    const panel = names.indexOf('BuildersPanel');
    expect(panel).toBeGreaterThan(names.indexOf('Feed'));
    expect(panel).toBeGreaterThan(names.indexOf('EmptyFeed'));
    expect(names[panel - 1]).toBe('Symbol(react.suspense)');
  });

  it('review defect 4: the loader is a remote cache entry, 15 minutes fresh, keyed by member and scope', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('lib/builders/cached.ts', 'utf8');
    expect(src).toMatch(/'use cache: remote'/);
    expect(src).toMatch(/revalidate: 900/);
    expect(src).toMatch(/export async function cachedActiveBuilders\(userId: string, scope: BuilderScope\)/);
    const { builderScopeOf } = await import('@/lib/builders/cached');
    expect(Object.keys(builderScopeOf({ categories: ['plumbing'], lat: 1, lon: 2, state: 'TX', radius_mi: 25 })).sort()).toEqual(
      ['categories', 'extra_areas', 'lat', 'lon', 'plan', 'plan_source', 'radius_mi', 'state', 'store_expires_at', 'subscription_status'],
    );
  });
});
