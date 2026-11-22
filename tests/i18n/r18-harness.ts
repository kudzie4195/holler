/**
 * Test harness (round 18, ES): mocks for rendering pages, the app and Settings with a fake session and profile, used by
 * english-identity-r18.test.ts (English, against the base render), english-leak.test.ts and es-account.test.ts (Spanish).
 * Call baseMocks() before each dynamic import of a page: it resets the module registry.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createElement } from 'react';
import { vi } from 'vitest';
import { NOW, iso } from '../signals/brief-fixtures';

export function baseMocks(over: { profile?: Record<string, unknown> | null; user?: Record<string, unknown> | null; stripe?: boolean; shadow?: string | null; pathname?: string; hint?: string } = {}) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.doMock('server-only', () => ({}));
  // The request's cookies: only the holler_lang hint matters to these renders (components/app-header.tsx MemberHeaderBar).
  vi.doMock('next/headers', async (orig) => ({
    ...(await orig<typeof import('next/headers')>()),
    cookies: async () => ({ get: (n: string) => (n === 'holler_lang' && over.hint !== undefined ? { name: n, value: over.hint } : undefined), getAll: () => [], set: () => {} }),
    headers: async () => new Headers(),
  }));
  vi.doMock('next/navigation', async (orig) => ({
    ...(await orig<typeof import('next/navigation')>()),
    usePathname: () => over.pathname ?? '/app',
    redirect: (to: string) => {
      throw new Error(`redirect:${to}`);
    },
  }));
  vi.doMock('@/lib/env', async (orig) => {
    const real = await orig<typeof import('@/lib/env')>();
    return {
      ...real,
      env: { ...real.env, SUPPORT_EMAIL: 'help@localholler.test', CRON_SECRET: 'test-secret', STRIPE_SECRET_KEY: over.stripe === false ? undefined : 'sk_test_x' },
      siteUrl: 'https://localholler.test',
      hasEnv: (...k: string[]) => (k.includes('STRIPE_SECRET_KEY') ? over.stripe !== false : real.hasEnv(...(k as never[]))),
    };
  });
  const user = over.user === undefined ? { id: 'u1', email: 'owner@example.test', app_metadata: { products: ['holler'] } } : over.user;
  const profile = over.profile === undefined ? null : over.profile;
  vi.doMock('@/lib/auth/session', () => ({
    getUser: async () => user,
    getProfile: async () => profile,
    requireUser: async () => {
      if (!user) throw new Error('redirect:/login');
      return user;
    },
    requireProfile: async () => {
      if (!user) throw new Error('redirect:/login');
      if (!profile) throw new Error('redirect:/onboarding');
      return { user, profile };
    },
  }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  vi.doMock('@/lib/storebilling/shadow', () => ({ readShadowStore: async () => over.shadow ?? null }));
  vi.doMock('@/lib/interest/deps', () => ({ loadMemberPicks: async () => [] }));
}

export function member(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: 'u1', business_name: 'Dale Roofing', categories: ['roofing', 'hvac'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
    radius_mi: 25, alert_email: true, subscription_status: 'trialing', trial_ends_at: iso(5 * 86_400_000), plan: 'starter',
    stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000),
    keywords: [], extra_areas: [],
    ...extra,
  };
}

export function appMocks(rows: unknown[] = []) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => {
      const q: any = {};
      q.from = () => q;
      q.select = () => q;
      for (const m of ['eq', 'order', 'in', 'is', 'gte']) q[m] = () => q;
      q.limit = async () => ({ data: rows, error: null });
      q.maybeSingle = async () => ({ data: null, error: null });
      return q;
    },
  }));
  vi.doMock('@/lib/feedback/service', () => ({ loadFeedback: async () => new Map() }));
  vi.doMock('@/lib/ai', async (orig) => ({ ...(await orig<typeof import('@/lib/ai')>()), notesFor: async () => new Map(), scoresFor: async () => new Map() }));
  vi.doMock('@/lib/outreach/loader', () => ({ loadMemberContacts: async () => new Map() }));
  vi.doMock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
  vi.doMock('@/components/feed/empty-feed', () => ({ EmptyFeed: () => createElement('div', null, 'EMPTY-FEED-EN'), emptyFeedApplies: (o: { items: number; locked: boolean; failed: boolean }) => o.items === 0 && !o.locked && !o.failed }));
  vi.doMock('@/components/feed/recent-activity', () => ({ RecentActivity: () => null, RecentActivityView: () => null }));
}

export const lockedRow = {
  id: 1, status: 'new', distance_mi: 3, draft: null, created_at: iso(-3_600_000),
  signal: { id: 9, source: 'nws', kind: 'alert', title: 'Severe Thunderstorm Warning', summary: null, url: null, city: 'Atlanta', state: 'GA', county: null, zip: null, occurred_at: iso(-3_600_000), expires_at: null, severity: 2, categories: ['roofing'] },
};

