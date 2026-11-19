// /app loads contacts for the signed-in member's OWN matches only, never for a locked account, and survives a failing loader.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactRecord } from '@/lib/contacts/types';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const iso = (ms: number) => new Date(NOW + ms).toISOString();

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  seen: [] as Array<{ title: string; contacts?: Array<Record<string, unknown>> }>,
  locked: false,
  calls: [] as Array<{ userId: string; ids: number[] }>,
  loaderThrows: false,
}));

// Every contact in the system, owned by whoever has a match on that signal. Signal 2 belongs to another member.
const ALL: ContactRecord[] = [
  { signalId: 1, role: 'contractor', name: 'Mine Roofing LLC', phone: '404-555-0100' },
  { signalId: 2, role: 'contractor', name: 'Someone Elses Plumbing Inc' },
];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  requireProfile: async () => ({
    user: { id: 'u1' },
    profile: {
      user_id: 'u1', business_name: 'Acme', categories: ['roofing'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
      radius_mi: 25, alert_email: true, subscription_status: h.locked ? 'canceled' : 'active', trial_ends_at: iso(h.locked ? -86_400_000 : 86_400_000), plan: 'starter',
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
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/requests/details', () => ({ requestTextForMember: async () => ({}) }));
vi.mock('@/components/feed', () => ({
  Feed: ({ items }: { items: typeof h.seen }) => (h.seen.push(...items), createElement('ul', null, items.map((i) => createElement('li', { key: i.title }, i.title)))),
  LockedFeed: ({ items }: { items: typeof h.seen }) => (h.seen.push(...items), null),
}));
vi.mock('@/components/feed/recent-activity', () => ({
  RecentActivity: ({ userId }: { userId: string }) => createElement('div', { 'data-recent': userId }, 'recent activity'),
}));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/components/feed/empty-feed', async (orig) => ({
  ...(await orig<typeof import('@/components/feed/empty-feed')>()),
  EmptyFeed: ({ userId }: { userId: string }) => createElement('div', { 'data-recent': userId }, 'empty feed with recent activity'),
}));
// Fake of lib/contacts/load.ts contactsForMember: a member only ever gets contacts for signals they have a match for.
vi.mock('@/lib/outreach/loader', async (orig) => {
  const real = await orig<typeof import('@/lib/outreach/loader')>();
  const ownedByUser: Record<string, number[]> = { u1: [1, 3] };
  const loader = async (_db: unknown, userId: string, ids: number[]) => {
    h.calls.push({ userId, ids });
    if (h.loaderThrows) throw new Error('boom');
    const out = new Map<number, ContactRecord[]>();
    for (const id of ids) if (ownedByUser[userId]?.includes(id)) out.set(id, ALL.filter((c) => c.signalId === id));
    // A misbehaving loader that leaks another member's signal: the wrapper must drop it.
    out.set(2, ALL.filter((c) => c.signalId === 2));
    return out;
  };
  return { ...real, loadMemberContacts: (o: Parameters<typeof real.loadMemberContacts>[0]) => real.loadMemberContacts({ ...o, loader: loader as never, orgCheck: null }) };
});

import AppHome from '@/app/app/page';

const row = (id: number, s: Record<string, unknown>) => ({
  id: id * 100, status: 'new', distance_mi: 2, draft: null, created_at: iso(-60_000),
  signal: { id, kind: 'permit', source: 'socrata-chicago-permits', summary: null, url: null, city: 'Atlanta', state: 'GA', county: 'Fulton County', zip: '30301', occurred_at: iso(-3_600_000), expires_at: null, title: `Signal ${id}`, ...s },
});

async function renderPage() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const el = await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never);
  const html = renderToStaticMarkup(el);
  vi.useRealTimers();
  return html;
}

afterEach(() => {
  h.rows = [];
  h.seen.length = 0;
  h.calls.length = 0;
  h.locked = false;
  h.loaderThrows = false;
});

describe('/app: contacts for the feed', () => {
  it('passes only the member\'s own contacts, and only for records that can carry them', async () => {
    h.rows = [
      row(1, {}),
      row(3, { title: 'Signal 3' }),
      row(4, { source: 'nws', kind: 'alert', title: 'Hail' }),
      row(5, { source: 'socrata-nyc-311', kind: 'civic', title: 'Pothole' }),
    ];
    await renderPage();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].userId).toBe('u1');
    expect(h.calls[0].ids.sort()).toEqual([1, 3]); // not the weather alert, not the 311 request
    const byTitle = Object.fromEntries(h.seen.map((i) => [i.title, i.contacts]));
    expect(byTitle['Signal 1']).toEqual([{ role: 'contractor', name: 'Mine Roofing LLC', phone: '404-555-0100' }]);
    expect(byTitle['Signal 1']![0]).not.toHaveProperty('signalId');
    expect(byTitle['Signal 3']).toBeUndefined();
    expect(byTitle['Hail']).toBeUndefined();
    expect(byTitle['Pothole']).toBeUndefined();
    expect(JSON.stringify(h.seen)).not.toContain('Someone Elses');
  });

  it('a locked member: the loader is never called and no contact data is in any item', async () => {
    h.locked = true;
    h.rows = [row(1, {})];
    await renderPage();
    expect(h.calls).toHaveLength(0);
    expect(h.seen).toHaveLength(1);
    expect(JSON.stringify(h.seen)).not.toContain('Mine Roofing');
    expect(JSON.stringify(h.seen)).not.toContain('404-555-0100');
    expect(h.seen[0].contacts).toBeUndefined();
  });

  it('a failing loader leaves the feed exactly as before', async () => {
    h.loaderThrows = true;
    h.rows = [row(1, {})];
    const html = await renderPage();
    expect(html).toContain('Signal 1');
    expect(h.seen[0].contacts).toBeUndefined();
  });

  it('public fields only: the page never copies contacts into title or summary', async () => {
    h.rows = [row(1, {})];
    await renderPage();
    const item = h.seen[0] as unknown as Record<string, unknown>;
    expect(String(item.title) + String(item.summary ?? '')).not.toContain('Mine Roofing');
  });
});

describe('/app: recent activity on an empty feed', () => {
  it('renders RecentActivity for the member when the feed has no items', async () => {
    h.rows = [];
    const html = await renderPage();
    expect(html).toContain('data-recent="u1"');
  });
  it('does not render it when the feed has items', async () => {
    h.rows = [row(1, {})];
    expect(await renderPage()).not.toContain('data-recent');
  });
  it('does not render it for a locked member', async () => {
    h.locked = true;
    h.rows = [];
    expect(await renderPage()).not.toContain('data-recent');
  });
});
