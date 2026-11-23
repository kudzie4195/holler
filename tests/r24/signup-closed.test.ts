// Round 24 (decision d): a trade the measurement found live nowhere and with no storm cells cannot be picked at sign-up, in the picker
// AND on the server; a member who already saved one keeps it. Fakes are hand-written (assumed); lookupZip is mocked with one ZIP.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signupClosedTrades, tradeSignupClosed } from '@/lib/check/cells';

const h = vi.hoisted(() => ({ upserts: [] as any[], saved: null as any }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/geo', async (orig) => ({
  ...(await orig<typeof import('@/lib/geo')>()),
  lookupZip: (zip: string) => (zip === '30303' ? { zip: '30303', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39 } : null),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.saved, error: null }) }) }),
      upsert: async (row: any) => (h.upserts.push(row), { error: null }),
    }),
  }),
}));

import { saveProfile } from '@/lib/auth/profile';
import { applySignupClosed, profileCategories } from '@/lib/plan/profile-categories';
import { COMING_SOON_GROUP_KEY, groupCategories } from '@/components/profile-form-groups';

const form = (cats: string[]) => {
  const f = new FormData();
  f.set('business_name', 'Acme');
  f.set('zip', '30303');
  f.set('radius', '25');
  for (const c of cats) f.append('categories', c);
  return f;
};

beforeEach(() => {
  h.upserts.length = 0;
  h.saved = null;
});

describe('sign-up cannot submit a coming-soon trade (server side)', () => {
  it('a new profile (onboarding, nothing saved): every closed trade is dropped, and a closed trade alone is refused', async () => {
    for (const t of signupClosedTrades()) {
      h.upserts.length = 0;
      h.saved = null;
      const alone = await saveProfile('new', form([t]));
      expect(alone.ok, t).not.toBe(true);
      expect(alone.fieldErrors?.categories).toBe('Pick at least one thing you do.');
      expect(h.upserts).toHaveLength(0);
      const mixed = await saveProfile('new', form([t, 'landscaping']));
      expect(mixed.ok).toBe(true);
      expect(h.upserts[0].categories).toEqual(['landscaping']);
    }
  });

  it('the Spanish answer says the same', async () => {
    const f = form(['plumbing']);
    f.set('ui_lang', 'es');
    const r = await saveProfile('new', f, { lang: 'es' });
    expect(r.ok).not.toBe(true);
    expect(r.fieldErrors?.categories).toBeTruthy();
    expect(h.upserts).toHaveLength(0);
  });

  it('an existing member who already has one keeps it: unchanged saves, edits beside it, and the plan count are as before', async () => {
    h.saved = { plan: 'starter', subscription_status: 'active', categories: ['plumbing', 'landscaping'] };
    expect((await saveProfile('m1', form(['plumbing', 'landscaping']))).ok).toBe(true);
    expect(h.upserts[0].categories).toEqual(['plumbing', 'landscaping']);
    expect((await saveProfile('m1', form(['plumbing', 'landscaping', 'fencing']))).ok).toBe(true);
    expect(h.upserts[1].categories).toEqual(['plumbing', 'landscaping', 'fencing']);
    // A different closed trade is still not addable, even for an existing member.
    expect((await saveProfile('m1', form(['plumbing', 'hvac']))).ok).toBe(true);
    expect(h.upserts[2].categories).toEqual(['plumbing']);
  });
});

describe('the picker: closed trades are a separate, disabled "Coming soon" group', () => {
  it('onboarding (nothing saved): every closed trade is coming soon, in its own group, and nothing pickable is closed', () => {
    for (const lang of ['en', 'es'] as const) {
      const chips = profileCategories(lang);
      for (const c of chips.filter((x) => x.id !== 'pressure-washing')) {
        if (tradeSignupClosed(c.id)) expect(c, c.id).toMatchObject({ comingSoon: true, closed: true, group: COMING_SOON_GROUP_KEY });
        else expect(c.closed, c.id).toBeFalsy();
      }
      const groups = groupCategories(chips, lang);
      const soon = groups.find((g) => g.key === COMING_SOON_GROUP_KEY)!;
      expect(soon.label).toBe(lang === 'en' ? 'Coming soon' : 'Próximamente');
      expect(soon.items.map((c) => c.id).sort()).toEqual([...signupClosedTrades()].sort());
      expect(soon.items.every((c) => c.comingSoon)).toBe(true);
      expect(groups[groups.length - 1].key).toBe(COMING_SOON_GROUP_KEY);
    }
  });

  it('settings (saved plumbing): plumbing stays a normal chip where it was; the other closed trades are coming soon', () => {
    const chips = profileCategories('en', ['plumbing']);
    expect(chips.find((c) => c.id === 'plumbing')).toMatchObject({ group: 'home' });
    expect(chips.find((c) => c.id === 'plumbing')!.comingSoon).toBeFalsy();
    expect(chips.find((c) => c.id === 'hvac')).toMatchObject({ comingSoon: true, closed: true });
    const raw = [{ id: 'plumbing', label: 'Plumbing', group: 'home' }];
    expect(applySignupClosed(raw, ['plumbing'])).toEqual(raw);
    expect(applySignupClosed(raw)[0]).toMatchObject({ comingSoon: true, closed: true, group: COMING_SOON_GROUP_KEY });
  });
});
