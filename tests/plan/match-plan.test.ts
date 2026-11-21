// Plan limits applied at match time (lib/signals/match.ts with lib/plan). All profiles and records are hand-written; coordinates are
// real places: Atlanta 33.749,-84.388; Athens GA 33.96,-83.38 (~58 mi east); Macon GA 32.84,-83.63 (~75 mi SE of Atlanta).
import { describe, expect, it } from 'vitest';
import { matchOne, matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { containsPhrase, effectiveTier, keywordHit, matchScope, parseExtraAreas, PLAN_LIMITS } from '@/lib/plan';

const ATHENS = { zip: '30601', city: 'Athens', state: 'GA', lat: 33.96, lon: -83.38 };
const MACON = { zip: '31201', city: 'Macon', state: 'GA', lat: 32.84, lon: -83.63 };
const CHARLOTTE = { zip: '28202', city: 'Charlotte', state: 'NC', lat: 35.227, lon: -80.843 };

const base = (over: Partial<MatchProfile> = {}): MatchProfile => ({
  user_id: 'u1',
  categories: ['roofing'],
  lat: 33.749,
  lon: -84.388,
  state: 'GA',
  radius_mi: 25,
  ...over,
});
const pro = (over: Partial<MatchProfile> = {}) => base({ plan: 'pro', subscription_status: 'active', ...over });
const sig = (over: Partial<MatchSignal> = {}): MatchSignal => ({
  id: 1,
  categories: ['roofing'],
  lat: 33.95,
  lon: -83.39, // next to Athens
  state: 'GA',
  severity: 1,
  occurred_at: '2026-11-17T10:00:00Z',
  ...over,
});

describe('effectiveTier', () => {
  it('Pro only while plan is pro and the subscription is paid', () => {
    expect(effectiveTier({ plan: 'pro', subscription_status: 'active' })).toBe('pro');
    expect(effectiveTier({ plan: 'pro', subscription_status: 'past_due' })).toBe('pro');
    expect(effectiveTier({ plan: 'pro', subscription_status: 'trialing' })).toBe('starter');
    expect(effectiveTier({ plan: 'pro', subscription_status: 'canceled' })).toBe('starter');
    expect(effectiveTier({ plan: 'pro', subscription_status: null })).toBe('starter');
    expect(effectiveTier({ plan: 'starter', subscription_status: 'active' })).toBe('starter');
    expect(effectiveTier({ plan: null })).toBe('starter');
    expect(effectiveTier(null)).toBe('starter');
    expect(effectiveTier({ plan: 'pro' })).toBe('pro'); // caller passed no status: the plan decides
  });
});

describe('matchScope', () => {
  const extras = [ATHENS, MACON, CHARLOTTE];
  const cats = Array.from({ length: 12 }, (_, i) => `t${i}`);
  it('starter (and trial, canceled) with saved extras: main area, first 5 trades, no keywords', () => {
    for (const p of [base(), base({ plan: 'pro', subscription_status: 'trialing' }), base({ plan: 'pro', subscription_status: 'canceled' })]) {
      const s = matchScope({ ...p, categories: cats, extra_areas: extras, keywords: ['tree removal'] });
      expect(s.tier).toBe('starter');
      expect(s.areas).toHaveLength(1);
      expect(s.categories).toEqual(cats.slice(0, 5));
      expect(s.keywords).toEqual([]);
    }
  });
  it('pro: main area plus at most 2 extras, first 15 trades, at most 5 keywords', () => {
    const s = matchScope({ ...pro(), categories: [...cats, ...cats.map((c) => c + 'x')], extra_areas: extras, keywords: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] });
    expect(s.areas).toHaveLength(1 + PLAN_LIMITS.pro.extraAreas);
    expect(s.areas[1]).toMatchObject({ lat: ATHENS.lat, state: 'GA' });
    expect(s.categories).toHaveLength(15);
    expect(s.keywords).toEqual(['a1', 'b2', 'c3', 'd4', 'e5']);
  });
  it('ignores malformed extra areas', () => {
    expect(parseExtraAreas([{ zip: '123', lat: 1, lon: 1 }, { zip: '30601', lat: 'x', lon: 1 }, null, 'x', { zip: '30601', lat: 99, lon: 0 }, ATHENS])).toEqual([ATHENS]);
    expect(parseExtraAreas({ zip: '30601' })).toEqual([]);
  });
});

describe('keyword phrases', () => {
  it('case-insensitive whole-phrase containment', () => {
    expect(containsPhrase('Tree removal needed at 12 Oak St', 'tree removal')).toBe(true);
    expect(containsPhrase('TREE-REMOVAL permit', 'tree removal')).toBe(true);
    expect(containsPhrase('Fallen tree, removal of debris', 'tree removal')).toBe(true); // punctuation counts as a space
    expect(containsPhrase('Street removal', 'tree removal')).toBe(false);
    expect(containsPhrase('Removal of a tree', 'tree removal')).toBe(false); // words must be together and in order
    expect(containsPhrase('Roofing permit', 'roof')).toBe(false); // whole words
    expect(containsPhrase('New roof permit', 'Roof')).toBe(true);
    expect(containsPhrase(null, 'roof')).toBe(false);
  });
  it('checks title and summary', () => {
    expect(keywordHit({ title: 'Permit', summary: 'Pool fence install' }, ['pool fence'])).toBe('pool fence');
    expect(keywordHit({ title: 'Permit', summary: null }, ['pool fence'])).toBeNull();
  });
});

describe('matchOne with plan limits', () => {
  it('a record near ANY allowed area matches, and the distance is to the nearest area', () => {
    const p = pro({ extra_areas: [MACON, ATHENS] });
    const m = matchOne(sig(), p);
    expect(m).not.toBeNull();
    expect(m!.distance_mi).toBeLessThan(2); // next to Athens, ~58 mi from Atlanta
    expect(matchOne(sig(), base({ extra_areas: [ATHENS] }))).toBeNull(); // same saved extra on Solo (starter): not used
  });

  it('pro uses only the first 2 extra areas', () => {
    const p = pro({ extra_areas: [MACON, CHARLOTTE, ATHENS] }); // Athens is third: never used
    expect(matchOne(sig(), p)).toBeNull();
  });

  it('state-level records match on any allowed area state', () => {
    const st = sig({ lat: null, lon: null, state: 'NC', severity: 2 });
    expect(matchOne(st, pro({ extra_areas: [CHARLOTTE] }))).toMatchObject({ distance_mi: null });
    expect(matchOne(st, base({ extra_areas: [CHARLOTTE] }))).toBeNull(); // starter: Charlotte not used
    expect(matchOne({ ...st, severity: 1 }, pro({ extra_areas: [CHARLOTTE] }))).toBeNull(); // severity rule still applies
  });

  it('keyword watches match outside the chosen trades, inside the areas, case-insensitive', () => {
    const p = pro({ keywords: ['Tree Removal'] });
    const s = sig({ categories: ['landscaping'], lat: 33.75, lon: -84.39, title: 'Permit: tree removal at 12 Oak St' });
    expect(matchOne(s, p)).not.toBeNull();
    expect(matchOne({ ...s, title: 'Permit', summary: 'TREE REMOVAL, 2 oaks' }, p)).not.toBeNull();
    expect(matchOne({ ...s, title: 'Street removal' }, p)).toBeNull();
    expect(matchOne({ ...s, lat: 32.84, lon: -83.63 }, p)).toBeNull(); // outside every area
    expect(matchOne({ ...s, categories: [] }, p)).not.toBeNull(); // no trade at all still matches the phrase
  });

  it('keyword on a state-level record needs an allowed area in that state and severity 2+', () => {
    const p = pro({ keywords: ['boil water'] });
    const s = sig({ categories: ['plumbing'], lat: null, lon: null, state: 'GA', severity: 2, title: 'Boil water notice' });
    expect(matchOne(s, p)).toMatchObject({ distance_mi: null });
    expect(matchOne({ ...s, state: 'FL' }, p)).toBeNull();
    expect(matchOne({ ...s, severity: 1 }, p)).toBeNull();
  });

  it('starter, trial and canceled-pro profiles never use saved keywords', () => {
    const s = sig({ categories: ['landscaping'], lat: 33.75, lon: -84.39, title: 'tree removal' });
    for (const p of [base({ keywords: ['tree removal'] }), pro({ subscription_status: 'trialing', keywords: ['tree removal'] }), pro({ subscription_status: 'canceled', keywords: ['tree removal'] })]) {
      expect(matchOne(s, p)).toBeNull();
    }
  });

  it('starter with more than 5 saved trades uses the first 5 only', () => {
    const cats = ['t0', 't1', 't2', 't3', 't4', 'roofing'];
    expect(matchOne(sig({ lat: 33.75, lon: -84.39 }), base({ categories: cats }))).toBeNull();
    expect(matchOne(sig({ lat: 33.75, lon: -84.39 }), pro({ categories: cats }))).not.toBeNull();
    expect(matchOne(sig({ lat: 33.75, lon: -84.39, categories: ['t4'] }), base({ categories: cats }))).not.toBeNull();
  });

  it('a profile without plan fields behaves as before for up to 5 trades (existing callers keep working)', () => {
    expect(matchOne(sig({ lat: 33.75, lon: -84.39 }), base())).toMatchObject({ distance_mi: expect.any(Number) });
  });
});

describe('matchSignals with plan limits', () => {
  it('applies each profile scope', () => {
    const signals = [sig({ id: 1 }), sig({ id: 2, lat: 33.75, lon: -84.39, categories: ['tree'], title: 'Tree removal' })];
    const rows = matchSignals(
      signals,
      [pro({ user_id: 'p', extra_areas: [ATHENS], keywords: ['tree removal'] }), base({ user_id: 's', extra_areas: [ATHENS], keywords: ['tree removal'] })],
      25,
      new Date('2026-11-17T12:00:00Z'),
    );
    expect(rows.filter((r) => r.user_id === 'p').map((r) => r.signal_id).sort()).toEqual([1, 2]);
    expect(rows.filter((r) => r.user_id === 's')).toEqual([]);
  });
});
