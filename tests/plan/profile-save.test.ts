// saveProfile enforces plan limits with field errors. Fakes are hand-written (assumed); lookupZip is mocked with a small table.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '../../lib/signals/categories';
import { tradeComingSoon } from '../../lib/seo/signal-types';

const h = vi.hoisted(() => ({ upserts: [] as any[], saved: null as any, upsertError: null as any }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/geo', async (orig) => ({
  ...(await orig<typeof import('@/lib/geo')>()),
  lookupZip: (zip: string) =>
    ({
      '30303': { zip: '30303', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39 },
      '30601': { zip: '30601', city: 'Athens', state: 'GA', lat: 33.96, lon: -83.38 },
      '31201': { zip: '31201', city: 'Macon', state: 'GA', lat: 32.84, lon: -83.63 },
      '30060': { zip: '30060', city: 'Marietta', state: 'GA', lat: 33.95, lon: -84.55 },
    })[zip] ?? null,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.saved, error: null }) }) }),
      upsert: async (row: any) => (h.upserts.push(row), { error: h.upsertError }),
    }),
  }),
}));

import { saveProfile } from '../../lib/auth/profile';

const live = CATEGORIES.map((c) => c.id as string).filter((c) => !tradeComingSoon(c));
const form = (o: { cats?: string[]; zips?: string[]; keywords?: string[] } = {}) => {
  const f = new FormData();
  f.set('business_name', 'Acme Roofing');
  f.set('zip', '30303');
  f.set('radius', '25');
  for (const c of o.cats ?? [live[0]]) f.append('categories', c);
  for (const z of o.zips ?? []) f.append('extra_zip', z);
  for (const k of o.keywords ?? []) f.append('keyword', k);
  return f;
};
const PRO = { plan: 'pro', subscription_status: 'active' };

beforeEach(() => {
  h.upserts.length = 0;
  h.saved = null;
  h.upsertError = null;
});

describe('saveProfile plan limits', () => {
  it('has enough live trades to test with', () => expect(live.length).toBeGreaterThanOrEqual(7));

  it('starter / trial: a 6th trade is a field error, 5 is fine', async () => {
    h.saved = { plan: 'starter', subscription_status: 'trialing', categories: [live[0]] };
    const bad = await saveProfile('u1', form({ cats: live.slice(0, 6) }));
    expect(bad.fieldErrors?.categories).toMatch(/up to 5 trades.*Pro/);
    expect(h.upserts).toHaveLength(0);
    expect((await saveProfile('u1', form({ cats: live.slice(0, 5) }))).ok).toBe(true);
  });

  it('starter: extra ZIPs and keywords are Pro-only field errors', async () => {
    h.saved = { plan: 'starter', subscription_status: 'active', categories: [live[0]] };
    expect((await saveProfile('u1', form({ zips: ['30601'] }))).fieldErrors?.extra_zips).toBe('More ZIP codes are part of Pro.');
    expect((await saveProfile('u1', form({ keywords: ['tree removal'] }))).fieldErrors?.keywords).toBe('Keyword watches are part of Pro.');
    expect(h.upserts).toHaveLength(0);
  });

  it('pro: geocodes 2 extra ZIPs with the main-ZIP lookup and saves keywords cleaned', async () => {
    h.saved = { ...PRO, categories: [live[0]] };
    const r = await saveProfile('u1', form({ cats: live.slice(0, 7), zips: ['30601', '31201', '', '30303'], keywords: ['  Tree   removal ', 'tree removal', 'pool fence'] }));
    expect(r.ok).toBe(true);
    const row = h.upserts[0];
    expect(row.categories).toHaveLength(7);
    expect(row.extra_areas).toEqual([
      { zip: '30601', city: 'Athens', state: 'GA', lat: 33.96, lon: -83.38 },
      { zip: '31201', city: 'Macon', state: 'GA', lat: 32.84, lon: -83.63 },
    ]); // blank dropped, main ZIP dropped
    expect(row.keywords).toEqual(['Tree removal', 'pool fence']); // spaces collapsed, case-insensitive duplicate dropped
  });

  it('pro: limits and validation give clear field errors', async () => {
    h.saved = { ...PRO, categories: [live[0]] };
    expect((await saveProfile('u1', form({ zips: ['30601', '31201', '30060'] }))).fieldErrors?.extra_zips).toBe('Add up to 2 more ZIP codes.');
    expect((await saveProfile('u1', form({ zips: ['3060'] }))).fieldErrors?.extra_zips).toMatch(/not a 5-digit ZIP/);
    expect((await saveProfile('u1', form({ zips: ['99999'] }))).fieldErrors?.extra_zips).toMatch(/couldn't find ZIP 99999/);
    expect((await saveProfile('u1', form({ keywords: ['ab'] }))).fieldErrors?.keywords).toMatch(/3 to 40 characters/);
    expect((await saveProfile('u1', form({ keywords: ['x'.repeat(41)] }))).fieldErrors?.keywords).toMatch(/3 to 40 characters/);
    expect((await saveProfile('u1', form({ keywords: ['roof, gutters'] }))).fieldErrors?.keywords).toMatch(/letters, numbers/);
    expect((await saveProfile('u1', form({ keywords: ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff'] }))).fieldErrors?.keywords).toBe('Watch up to 5 keywords.');
    expect(h.upserts).toHaveLength(0);
  });

  it('keyword rules match migration 0004: 3+ characters, accents folded, slash allowed, at least one letter or digit (P2 hardening)', async () => {
    h.saved = { ...PRO, categories: [live[0]] };
    const ok = await saveProfile('u1', form({ keywords: ['A/C repair', "O'Brien & Sons", 'Café  remodel', 'ROOF', 'roof'] }));
    expect(ok.ok).toBe(true);
    expect(h.upserts[0].keywords).toEqual(['A/C repair', "O'Brien & Sons", 'Cafe remodel', 'ROOF']); // folded, collapsed, duplicate dropped
    for (const bad of ['st', '---', 'a.b.c', 'tree\tremoval%', 'roof_deck', '屋根修理']) {
      expect((await saveProfile('u1', form({ keywords: [bad] }))).fieldErrors?.keywords, bad).toBeTruthy();
    }
    expect(h.upserts).toHaveLength(1);
  });

  it('pro: an empty extras list clears them', async () => {
    h.saved = { ...PRO, categories: [live[0]], extra_areas: [{ zip: '30601' }], keywords: ['x y'] };
    await saveProfile('u1', form());
    expect(h.upserts[0].extra_areas).toEqual([]);
    expect(h.upserts[0].keywords).toEqual([]);
  });

  it('downgraded (canceled pro): saved extras are left out of the write, unchanged 8 trades are kept as saved', async () => {
    const saved8 = live.slice(0, 8);
    h.saved = { plan: 'pro', subscription_status: 'canceled', categories: saved8, extra_areas: [{ zip: '30601' }], keywords: ['tree removal'] };
    const r = await saveProfile('u1', form({ cats: [...saved8].reverse() }));
    expect(r.ok).toBe(true);
    expect(h.upserts[0].categories).toEqual(saved8); // saved order, so "first 5" stays the same
    expect(h.upserts[0]).not.toHaveProperty('extra_areas');
    expect(h.upserts[0]).not.toHaveProperty('keywords');
    // changing them means fitting the plan
    expect((await saveProfile('u1', form({ cats: live.slice(0, 7) }))).fieldErrors?.categories).toMatch(/up to 5 trades/);
  });

  it('a database plan-limit rejection becomes a plain message', async () => {
    h.saved = { ...PRO, categories: [live[0]] };
    h.upsertError = { message: 'holler_plan_limit: extra areas need Pro' };
    expect((await saveProfile('u1', form({ zips: ['30601'] }))).error).toMatch(/more than your plan allows/);
  });

  it('never more than 15 trades, even on Pro', async () => {
    h.saved = { ...PRO, categories: [live[0]] };
    const many = Array.from({ length: 16 }, (_, i) => live[i % live.length] + (i >= live.length ? `-${i}` : ''));
    expect((await saveProfile('u1', form({ cats: many }))).fieldErrors?.categories).toMatch(/up to 15/i);
  });
});
