// Integration round 3, item 2b: the member feed (/app, app/app/page.tsx) leaves out resident requests that have ended, at once,
// before the scan cron deletes them. Other sources, expired or not, stay (they are history the member was sent).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const iso = (ms: number) => new Date(NOW + ms).toISOString();

const h = vi.hoisted(() => ({ rows: [] as unknown[], seen: [] as { title: string }[] }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  requireProfile: async () => ({
    user: { id: 'u1' },
    profile: {
      user_id: 'u1', business_name: 'Acme', categories: ['roofing'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
      radius_mi: 25, alert_email: true, subscription_status: 'active', trial_ends_at: iso(86_400_000), plan: 'starter',
      stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000),
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'order']) q[m] = () => q;
    q.limit = async () => ({ data: h.rows, error: null });
    return q;
  },
}));
vi.mock('@/components/feed', () => ({
  Feed: ({ items }: { items: { title: string }[] }) => (h.seen.push(...items), createElement('ul', null, items.map((i) => createElement('li', { key: i.title }, i.title)))),
  LockedFeed: () => null,
}));

import AppHome from '@/app/app/page';

const row = (id: number, s: Record<string, unknown>) => ({
  id, status: 'new', distance_mi: 2, draft: null, created_at: iso(-60_000),
  // u2: requests carry their trade (categories): the feed labels each row for the member's trades and hides 'context' rows.
  signal: { id, kind: 'ask', categories: ['roofing'], summary: null, url: null, city: 'Atlanta', state: 'GA', occurred_at: iso(-3_600_000), ...s },
});

describe('/app feed and ended resident requests', () => {
  it('shows the live request and other sources, never a closed or expired request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.rows = [
      row(1, { source: 'holler-request', title: 'CLOSED request', expires_at: iso(-60_000) }),
      row(2, { source: 'holler-request', title: 'LIVE request', expires_at: iso(86_400_000) }),
      // u2: a real NWS event name (an unknown event is context and is not shown): 'Coming soon' for roofing.
      row(3, { source: 'nws', kind: 'alert', title: 'High Wind Warning: Old warning', expires_at: iso(-86_400_000) }),
      row(4, { source: 'holler-request', title: 'EXPIRED request', expires_at: iso(-3 * 86_400_000) }),
    ];
    const el = await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never);
    const html = renderToStaticMarkup(el);
    expect(html).toContain('LIVE request');
    expect(html).toContain('Old warning');
    expect(html).not.toContain('CLOSED request');
    expect(html).not.toContain('EXPIRED request');
    expect(h.seen.map((i) => i.title).sort()).toEqual(['High Wind Warning: Old warning', 'LIVE request']);
    vi.useRealTimers();
  });
});
