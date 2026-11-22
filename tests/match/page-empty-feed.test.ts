// Round 7 MATCH: /app renders the empty feed (components/feed/empty-feed.tsx) for a member with access and zero matches.
// Harness copied from tests/outreach/page.test.ts (same mocks); EmptyFeed itself is async, so it is replaced by a marker here and its
// data and markup are tested in tests/match/smyrna.test.ts.
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
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
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
vi.mock('@/components/feed/empty-feed', async (orig) => ({
  ...(await orig<typeof import('@/components/feed/empty-feed')>()),
  EmptyFeed: ({ userId }: { userId: string }) => createElement('div', { 'data-empty-feed': userId }, 'empty feed'),
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
  // u2: the feed labels rows for the member's trades and hides 'context' rows, so the permit carries its trade.
  signal: { id, kind: 'permit', source: 'socrata-chicago-permits', categories: ['roofing'], summary: null, url: null, city: 'Atlanta', state: 'GA', county: 'Fulton County', zip: '30301', occurred_at: iso(-3_600_000), expires_at: null, title: `Signal ${id}`, ...s },
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

describe('/app: the empty feed replaces the bare empty state', () => {
  it('a member with access and zero matches gets the empty-feed component', async () => {
    h.rows = [];
    const html = await renderPage();
    expect(html).toContain('data-empty-feed="u1"');
    expect(h.seen).toHaveLength(0);
  });
  it('a member with matches gets the feed, not the empty feed', async () => {
    h.rows = [row(1, {})];
    const html = await renderPage();
    expect(html).not.toContain('data-empty-feed');
    expect(html).toContain('Signal 1');
  });
  it('a locked member keeps the locked card', async () => {
    h.locked = true;
    h.rows = [];
    const html = await renderPage();
    expect(html).not.toContain('data-empty-feed'); // LockedFeed (mocked here) keeps its card
  });
});
