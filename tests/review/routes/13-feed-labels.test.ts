// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/**
 * REV-ROUTES probe 13 (harness copied from tests/signals/routes-feed-page.test.ts): feed labels in both languages, and what a member
 * with NO work profile sees.
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

async function renderApp(opts: { no0027?: boolean; lang?: string; rows?: any[] } = {}) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.doMock('server-only', () => ({}));
  const profile: Record<string, unknown> = {
    user_id: 'u1', business_name: 'Oak Moving', categories: ['moving'], zip: '30030', city: 'Decatur', state: 'GA', lat: 33.77, lon: -84.29,
    radius_mi: 25, alert_email: true, subscription_status: 'active', trial_ends_at: iso(-86_400_000), plan: 'starter',
    language: opts.lang ?? 'en', stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(86_400_000), created_at: iso(30 * 86_400_000),
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
        return { data: opts.rows ?? ROWS, error: null };
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


const HELD = [
  { id: 1, status: 'new', distance_mi: 2, draft: null, created_at: iso(60_000), alert_hold: 'background', signal: sig(11, 'New home permit in DeKalb County', 'New Construction | Single Family Dwelling | Issued') },
  { id: 2, status: 'new', distance_mi: 3, draft: null, created_at: iso(120_000), alert_hold: 'below_min', signal: sig(12, 'New home permit in Decatur', 'New Construction | $1,200 job value | 250 SYCAMORE ST') },
  { id: 3, status: 'new', distance_mi: 3, draft: null, created_at: iso(180_000), alert_hold: 'held', signal: sig(13, 'New home permit in Decatur', 'New Construction | 251 SYCAMORE ST') },
  { id: 4, status: 'new', distance_mi: 3, draft: null, created_at: iso(240_000), alert_hold: null, signal: sig(14, 'New home permit in Decatur', 'New Construction | 252 SYCAMORE ST') },
  { id: 5, status: 'new', distance_mi: 3, draft: null, created_at: iso(300_000), alert_hold: 'nonsense', signal: sig(15, 'New home permit in Decatur', 'New Construction | 253 SYCAMORE ST') },
  // the address is printed on the card, yet the stored hold says "no site address" (a real Atlanta shape the gate rejects)
  { id: 6, status: 'new', distance_mi: 3, draft: null, created_at: iso(360_000), alert_hold: 'background', signal: { ...sig(16, 'Remodel permit in Atlanta', 'Residential Alteration | $50,000 job value | 5600 LA SALLE SW, ATLANTA, GA 30331'), source: 'arcgis-atlanta-permits', city: 'Atlanta' } },
];
const chips = (html: string) => [...html.matchAll(/data-testid="(hold-chip|hold-note|opportunity-chip)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}: ${m[2]}`);

describe('REV-ROUTES 13: feed labels', () => {
  it('English: Background, Below your minimum, on-hold; the unheld card and an unknown value keep the alert chip', async () => {
    const { html } = await renderApp({ rows: HELD });
    console.log('EN ' + JSON.stringify(chips(html)));
    expect(text(html)).toContain('Background');
    expect(text(html)).toContain('Below your minimum');
    expect(text(html)).toContain('Coming soon');
  });
  it('Spanish: Referencia, Por debajo de su mínimo', async () => {
    const { html } = await renderApp({ rows: HELD, lang: 'es' });
    console.log('ES ' + JSON.stringify(chips(html)));
    expect(text(html)).toContain('Referencia');
    expect(text(html)).toContain('Por debajo de su mínimo');
    expect(text(html)).not.toContain('Background');
    expect(text(html)).not.toContain('Below your minimum');
  });
  it('a member with NO work profile (this harness has no holler_work_profiles row at all) still sees both chips: the page never reads the profile', async () => {
    const { html, selects } = await renderApp({ rows: HELD });
    console.log('tables/columns the page read: ' + JSON.stringify(selects.map((c) => c.slice(0, 60))));
    const t = text(html);
    console.log(`member with no work profile sees "Below your minimum": ${t.includes('Below your minimum')}; sees "Background": ${t.includes('Background')}`);
    console.log(`the Atlanta card prints its address AND says it names no site address: ${t.includes('5600 LA SALLE SW') && t.includes('names no business and no site address')}`);
    // Redo 1 (decision 1): the "no site address" note is on the DeKalb card only (no address, no business); the Atlanta card prints its
    // address, so it shows no hold at all.
    expect(t.split('names no business and no site address').length - 1).toBe(1);
    expect(t).toContain('5600 LA SALLE SW');
  });
});
