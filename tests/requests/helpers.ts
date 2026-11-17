/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Limit } from '@/lib/auth/limits';
import type { RequestEmail } from '@/lib/requests/mailer';
import type { Db, RequestDeps } from '@/lib/requests/service';
import { isRequestTrade } from '@/lib/requests/trades';
import { FakeDb } from './fake-db';

export const RESIDENT = 'resident.private+home@example.org';
export const SECRET = 'test-secret-for-request-links';
export const SITE = 'https://holler.test';
export const T0 = new Date('2026-11-17T12:00:00.000Z');

export const VALID = {
  trade: 'roofing',
  zip: '30301',
  description: 'Roof leak over the kitchen after the storm. Call me at 404-555-1212, I am Sarah Connor.',
  email: RESIDENT,
  consent: true,
  leave_blank: '',
};

export function profile(userId: string, over: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    business_name: `Biz ${userId}`,
    categories: ['roofing'],
    lat: 33.8,
    lon: -84.45,
    state: 'GA',
    city: 'Atlanta',
    radius_mi: 25,
    subscription_status: 'trialing',
    trial_ends_at: '2026-12-31T00:00:00.000Z',
    email_verified_at: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

export interface Harness {
  db: FakeDb;
  deps: RequestDeps;
  sent: RequestEmail[];
  hits: Limit[][];
  setHit: (fn: (limits: Limit[]) => 'allowed' | 'limited' | 'error') => void;
  setNow: (d: Date) => void;
  setSend: (fn: (m: RequestEmail) => boolean) => void;
}

export function harness(seed: Record<string, any[]> = {}): Harness {
  const db = new FakeDb({ holler_profiles: [profile('u-near'), profile('u-far', { lat: 40.7, lon: -74.0, state: 'NY' })], ...seed });
  let now = T0;
  db.now = () => now;
  const sent: RequestEmail[] = [];
  const hits: Limit[][] = [];
  let hitFn: (limits: Limit[]) => 'allowed' | 'limited' | 'error' = () => 'allowed';
  let sendFn: (m: RequestEmail) => boolean = () => true;
  const deps: RequestDeps = {
    db: db as unknown as Db,
    send: async (m) => {
      const ok = sendFn(m);
      if (ok) sent.push(m);
      return ok;
    },
    hit: async (limits) => {
      hits.push(limits);
      return hitFn(limits);
    },
    secret: SECRET,
    siteUrl: SITE,
    now: () => now,
    adminEmail: 'owner@holler.test',
    isTrade: (id) => isRequestTrade(id, () => false),
  };
  return {
    db,
    deps,
    sent,
    hits,
    setHit: (fn) => (hitFn = fn),
    setNow: (d) => (now = d),
    setSend: (fn) => (sendFn = fn),
  };
}

export function tokenIn(text: string, path: '/request/confirm' | '/request/close'): string {
  const m = text.match(new RegExp(`${path.replace('/', '\\/')}\\?token=([A-Za-z0-9_-]{43})`));
  if (!m) throw new Error(`no ${path} link in email`);
  return m[1];
}
