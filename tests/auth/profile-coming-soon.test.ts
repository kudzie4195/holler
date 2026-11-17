// Server-side profile validation drops "coming soon" trades. Fakes are hand written (assumed); ZIP 30060 is Marietta, GA.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '../../lib/signals/categories';
import { tradeComingSoon } from '../../lib/seo/signal-types';

const h = vi.hoisted(() => ({ upserts: [] as any[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/geo', async (orig) => ({
  ...(await orig<typeof import('@/lib/geo')>()),
  lookupZip: (zip: string) => ({ zip, city: 'Marietta', state: 'GA', lat: 33.95, lon: -84.55 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ upsert: async (row: any) => (h.upserts.push(row), { error: null }) }) }),
}));

import { saveProfile } from '../../lib/auth/profile';

const form = (cats: string[]) => {
  const f = new FormData();
  f.set('business_name', 'Acme Roofing');
  f.set('zip', '30060');
  f.set('radius', '25');
  for (const c of cats) f.append('categories', c);
  return f;
};
const ids = CATEGORIES.map((c) => c.id as string);
const soon = ids.filter((c) => tradeComingSoon(c));
const live = ids.filter((c) => !tradeComingSoon(c));

describe('saveProfile and coming-soon trades', () => {
  beforeEach(() => void (h.upserts.length = 0));

  it('has at least one live trade to test with', () => expect(live.length).toBeGreaterThan(0));

  it.skipIf(soon.length === 0)('drops coming-soon trades and saves the rest', async () => {
    const res = await saveProfile('u1', form([live[0], soon[0]]));
    expect(res.ok).toBe(true);
    expect(h.upserts[0].categories).toEqual([live[0]]);
  });

  it.skipIf(soon.length === 0)('rejects a submission that has only coming-soon trades', async () => {
    const res = await saveProfile('u1', form([soon[0]]));
    expect(res.ok).toBeUndefined();
    expect(res.fieldErrors?.categories).toBeTruthy();
    expect(h.upserts).toHaveLength(0);
  });

  it('keeps live trades unchanged', async () => {
    const res = await saveProfile('u1', form([live[0]]));
    expect(res.ok).toBe(true);
    expect(h.upserts[0].categories).toEqual([live[0]]);
  });
});
