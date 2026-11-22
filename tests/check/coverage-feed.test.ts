// /app feed header: one calm line when a source covering the member's area and trades is behind. Mocked: the session, the member's
// rows, the source states (assumed values). Real: which feeds cover Atlanta and how the line is worded.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const H = 3_600_000;

async function renderApp(opts: { locked?: boolean; snapshot?: unknown; throws?: boolean; trades?: string[] }) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshotCalls = vi.fn();
  const order: string[] = [];
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/auth/session', () => ({
    requireProfile: async () => ({
      user: { id: 'u1' },
      profile: {
        user_id: 'u1', business_name: 'Acme Roofing', categories: opts.trades ?? ['roofing'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
        radius_mi: 25, alert_email: true, subscription_status: opts.locked ? 'canceled' : 'active', trial_ends_at: iso(-86_400_000), plan: 'starter',
        stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000),
      },
    }),
  }));
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => {
      const q: any = {};
      for (const m of ['from', 'select', 'eq', 'order']) q[m] = () => q;
      q.limit = async () => {
        order.push('matches');
        return { data: [], error: null };
      };
      return q;
    },
  }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  vi.doMock('@/lib/signals/source-state-snapshot', () => ({
    loadSourceStateSnapshot: async () => {
      snapshotCalls();
      order.push('snapshot');
      if (opts.throws) throw new Error('down');
      return opts.snapshot ?? null;
    },
  }));
  vi.doMock('@/components/feed', () => ({ Feed: () => null, LockedFeed: () => null }));
  vi.doMock('@/components/feed/empty-feed', () => ({ EmptyFeed: () => null, emptyFeedApplies: () => false }));
  vi.doMock('@/components/coming-next-member', () => ({ ComingNextForMember: () => null }));
  vi.doMock('@/components/billing-button', () => ({ BillingButton: () => null }));
  const AppHome = (await import('@/app/app/page')).default;
  const html = renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
  return { html, snapshotCalls, order };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const m of ['server-only', '@/lib/auth/session', '@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/signals/source-state-snapshot', '@/components/feed', '@/components/feed/empty-feed', '@/components/coming-next-member', '@/components/billing-button']) vi.doUnmock(m);
});

const snap = (over: Record<string, { state: string; lastRecordAt: string | null }>) => ({
  generatedAt: NOW.toISOString(),
  states: { nws: { state: 'healthy', lastRecordAt: iso(-60_000) }, spc: { state: 'healthy', lastRecordAt: iso(-60_000) }, ...over },
});

describe('app feed header coverage line', () => {
  it('shows "Atlanta permits are delayed; last update 9 hours ago" under the title for an Atlanta roofer', async () => {
    const { html } = await renderApp({ snapshot: snap({ 'arcgis-atlanta-permits': { state: 'delayed', lastRecordAt: iso(-9 * H) } }) });
    expect(html).toContain('data-testid="coverage-notice"');
    expect(html).toContain('Atlanta permits are delayed; last update 9 hours ago.');
    expect(html.indexOf('Your matches')).toBeLessThan(html.indexOf('coverage-notice'));
  });
  it('shows nothing when all sources near the member are healthy', async () => {
    const { html } = await renderApp({ snapshot: snap({ 'arcgis-atlanta-permits': { state: 'healthy', lastRecordAt: iso(-H) } }) });
    expect(html).not.toContain('coverage-notice');
  });
  it('shows nothing, and the page still renders, when the states are unknown or the read throws', async () => {
    for (const o of [{ snapshot: null }, { throws: true }]) {
      const { html } = await renderApp(o);
      expect(html).not.toContain('coverage-notice');
      expect(html).toContain('Your matches');
    }
  });
  it('a locked account never triggers the read and sees no line', async () => {
    const { html, snapshotCalls } = await renderApp({ locked: true, snapshot: snap({ nws: { state: 'unavailable', lastRecordAt: null } }) });
    expect(snapshotCalls).not.toHaveBeenCalled();
    expect(html).not.toContain('coverage-notice');
  });
  it('starts the source-state read before the feed query, so the two run side by side', async () => {
    const { order } = await renderApp({ snapshot: snap({}) });
    expect(order).toEqual(['snapshot', 'matches']);
  });
  it('a locked account never starts the read at all (the feed query is the only call)', async () => {
    const { order } = await renderApp({ locked: true, snapshot: snap({}) });
    expect(order).toEqual(['matches']);
  });
  it('a trade the delayed feed never carries is not mentioned (food inspections for a roofer)', async () => {
    const { html } = await renderApp({ snapshot: snap({ 'socrata-chicago-inspections': { state: 'unavailable', lastRecordAt: null } }) });
    expect(html).not.toContain('coverage-notice');
  });
});
