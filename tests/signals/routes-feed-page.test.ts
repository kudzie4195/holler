/**
 * Round 18 ROUTES, item 3 on the real /app page: a feed-only permit card (holler_matches.alert_hold) is shown after the alerts with the
 * "Background" chip and its reason; with migration 0027 missing the feed read is made again without the column and the page is as before.
 * Harness follows tests/i18n/app-page.test.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-11-20T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const sig = (id: number, title: string, summary: string) => ({
  id, source: 'arcgis-dekalb-permits', kind: 'permit', title, summary, url: null, city: 'Decatur', state: 'GA', county: null, zip: null,
  occurred_at: iso(3_600_000), expires_at: null, severity: 1, categories: ['general-contractor', 'real-estate', 'moving'], subtype: 'permit', approxLocation: null,
});
const ROWS = [
  { id: 1, status: 'new', distance_mi: 2, draft: null, created_at: iso(60_000), alert_hold: 'background', signal: sig(11, 'New home permit in DeKalb County', 'New Construction | Single Family Dwelling | Issued') },
  { id: 2, status: 'new', distance_mi: 3, draft: null, created_at: iso(120_000), alert_hold: null, signal: sig(12, 'New home permit in Decatur', 'New Construction | 250 SYCAMORE ST') },
];

async function renderApp(opts: { no0027?: boolean } = {}) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.doMock('server-only', () => ({}));
  const profile: Record<string, unknown> = {
    user_id: 'u1', business_name: 'Oak Moving', categories: ['moving'], zip: '30030', city: 'Decatur', state: 'GA', lat: 33.77, lon: -84.29,
    radius_mi: 25, alert_email: true, subscription_status: 'active', trial_ends_at: iso(-86_400_000), plan: 'starter',
    stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(86_400_000), created_at: iso(30 * 86_400_000),
  };
  vi.doMock('@/lib/auth/session', () => ({ requireProfile: async () => ({ user: { id: 'u1' }, profile }), getProfile: async () => profile }));
  const selects: string[] = [];
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => {
      const q: any = {};
      let cols = '';
      q.from = () => q;
      q.select = (c: string) => ((cols = c), selects.push(c), q);
      for (const m of ['eq', 'order']) q[m] = () => q;
      q.limit = async () => {
        if (opts.no0027 && cols.includes('alert_hold')) return { data: null, error: { code: '42703', message: 'column holler_matches.alert_hold does not exist' } };
        return { data: opts.no0027 ? ROWS.map(({ alert_hold: _h, ...r }) => (void _h, r)) : ROWS, error: null };
      };
      return q;
    },
  }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  vi.doMock('@/lib/feedback/service', () => ({ loadFeedback: async () => new Map() }));
  vi.doMock('@/lib/ai', async (orig) => ({ ...(await orig<typeof import('@/lib/ai')>()), notesFor: async () => new Map(), scoresFor: async () => new Map() }));
  vi.doMock('@/lib/outreach/loader', () => ({ loadMemberContacts: async () => new Map() }));
  vi.doMock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
  vi.doMock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));
  vi.doMock('@/components/coming-next-member', () => ({ ComingNextForMember: () => null }));
  vi.doMock('@/components/billing-button', () => ({ BillingButton: () => null }));
  vi.doMock('@/components/feed/empty-feed', () => ({ EmptyFeed: () => null, emptyFeedApplies: (o: { items: number; locked: boolean; failed: boolean }) => o.items === 0 && !o.locked && !o.failed }));
  const AppHome = (await import('@/app/app/page')).default;
  const html = renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
  return { html, selects };
}

afterEach(() => {
  vi.useRealTimers();
  for (const m of ['server-only', '@/lib/auth/session', '@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/feedback/service', '@/lib/ai', '@/lib/outreach/loader', '@/lib/signals/source-state-snapshot', '@/app/app/actions', '@/components/coming-next-member', '@/components/billing-button', '@/components/feed/empty-feed']) vi.doUnmock(m);
});

describe('/app feed with feed-only cards', () => {
  it('the held permit is shown after the alert, labelled Background with its reason; the alert keeps its chip', async () => {
    const { html, selects } = await renderApp();
    const t = text(html);
    expect(selects[0]).toContain('alert_hold');
    expect(t).toContain('Background');
    expect(t).toContain('This permit names no business and no site address, so it was not sent as an alert.');
    expect(t).toContain('Coming soon');
    expect(t.indexOf('New home permit in Decatur')).toBeLessThan(t.indexOf('New home permit in DeKalb County'));
  });
  it('migration 0027 NOT applied: the read is made again without alert_hold, both cards show as before', async () => {
    const { html, selects } = await renderApp({ no0027: true });
    const t = text(html);
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain('alert_hold');
    expect(t).not.toContain('Background');
    expect(t).toContain('New home permit in DeKalb County');
    expect(t).toContain('New home permit in Decatur');
  });
});
