// P1-2 / P2 hardening: keyword watches are whole-word, case-insensitive and accent-folded, and the faster scan (area test first,
// record text normalised once, per-scan phrase cache) gives exactly the rows the one-pair matcher gives.
import { describe, expect, it } from 'vitest';
import { containsPhrase, foldText, keywordHit, keywordProblem, searchText, storableExtraAreas } from '@/lib/plan';
import { matchOne, matchSignals, pickHits, type MatchProfile, type MatchSignal } from '@/lib/signals/match';

describe('keyword phrase matching', () => {
  it('folds accents on both sides', () => {
    expect(containsPhrase('Café remodel permit', 'cafe remodel')).toBe(true);
    expect(containsPhrase('Cafe remodel permit', 'café remodel')).toBe(true);
    expect(containsPhrase('Reparación de techo', 'reparacion')).toBe(true);
    expect(foldText('  Ñandú  ')).toBe(' nandu ');
  });
  it('is whole-word, not substring', () => {
    expect(containsPhrase('Roofing permit', 'roof')).toBe(false);
    expect(containsPhrase('Sidewalk repair', 'walk')).toBe(false);
    expect(containsPhrase('A/C repair at 5 Elm', 'a/c repair')).toBe(true);
    expect(containsPhrase('AC repair', 'a/c repair')).toBe(false);
  });
  it('never matches across the end of the title and the start of the summary', () => {
    const s = { title: 'Permit for a tree', summary: 'Removal of debris' };
    expect(searchText(s)).toBe(' permit for a tree  removal of debris ');
    expect(keywordHit(s, ['tree removal'])).toBeNull();
    expect(keywordHit(s, ['of debris'])).toBe('of debris');
  });
  it('keywordProblem mirrors the 0004 trigger', () => {
    expect(keywordProblem('ab')).toBe('length');
    expect(keywordProblem('x'.repeat(41))).toBe('length');
    expect(keywordProblem('abc')).toBeNull();
    expect(keywordProblem("o'brien & sons")).toBeNull();
    expect(keywordProblem('a/c-unit')).toBeNull();
    expect(keywordProblem('---')).toBe('chars');
    expect(keywordProblem('a",b).or(x')).toBe('chars');
    expect(keywordProblem('%%%')).toBe('chars');
    expect(keywordProblem('a_b')).toBe('chars');
  });
});

describe('storableExtraAreas mirrors the 0004 trigger', () => {
  const area = { zip: '30601', city: 'Athens', state: 'GA', lat: 33.96, lon: -83.38 };
  it('accepts up to 2 well-formed areas', () => {
    expect(storableExtraAreas([])).toBe(true);
    expect(storableExtraAreas([area, { ...area, zip: '31201' }])).toBe(true);
  });
  it('rejects everything else', () => {
    expect(storableExtraAreas([area, area, area])).toBe(false);
    expect(storableExtraAreas({ ...area })).toBe(false);
    expect(storableExtraAreas([{ ...area, extra: 1 }])).toBe(false);
    const { city: _city, ...noCity } = area;
    void _city;
    expect(storableExtraAreas([noCity])).toBe(false);
    expect(storableExtraAreas([{ ...area, zip: '3060' }])).toBe(false);
    expect(storableExtraAreas([{ ...area, city: 'x'.repeat(81) }])).toBe(false);
    expect(storableExtraAreas([{ ...area, state: 'GEO' }])).toBe(false);
    expect(storableExtraAreas([{ ...area, state: 7 }])).toBe(false);
    expect(storableExtraAreas([{ ...area, lat: 9999 }])).toBe(false);
    expect(storableExtraAreas([{ ...area, lon: -181 }])).toBe(false);
    expect(storableExtraAreas([{ ...area, lat: '33' }])).toBe(false);
    expect(storableExtraAreas([{ ...area, city: 'é'.repeat(80) }, { ...area, city: 'é'.repeat(80) }])).toBe(true);
  });
});

describe('matchSignals (fast path) agrees with matchOne', () => {
  const base: MatchProfile = { user_id: 'p', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25, plan: 'pro', subscription_status: 'active' };
  const sig = (id: number, o: Partial<MatchSignal> = {}): MatchSignal => ({
    id,
    categories: ['plumbing'],
    lat: 33.76,
    lon: -84.4,
    state: 'GA',
    severity: 1,
    occurred_at: '2026-11-10T00:00:00Z',
    title: 'Permit',
    summary: '',
    ...o,
  });
  it('same rows for trade hits, keyword hits, far records, state-level records and shared phrases', () => {
    const signals = [
      sig(1, { categories: ['roofing'] }),
      sig(2, { title: 'Tree removal at 12 Oak' }),
      sig(3, { title: 'Tree removal far away', lat: 40.7, lon: -74 }),
      sig(4, { title: 'Café remodel' }),
      sig(5, { title: 'Street removal' }),
      sig(6, { title: 'Hail damage', lat: null, lon: null, severity: 2 }),
      sig(7, { title: 'Hail damage', lat: null, lon: null, severity: 1 }),
      sig(8, { title: 'Tree removal', lat: 33.94, lon: -84.54 }), // Marietta: only in reach of the extra area
    ];
    const profiles: MatchProfile[] = [
      { ...base, user_id: 'a', keywords: ['tree removal', 'cafe remodel'] },
      { ...base, user_id: 'b', keywords: ['tree removal', 'hail damage'], extra_areas: [{ zip: '30060', city: 'Marietta', state: 'GA', lat: 33.95, lon: -84.55 }], lat: 32.84, lon: -83.63 },
      { ...base, user_id: 'c', plan: 'starter', keywords: ['tree removal'] }, // Solo (starter): keywords not used
      { ...base, user_id: 'd', subscription_status: 'canceled', keywords: ['tree removal'] },
    ];
    const now = new Date('2026-11-17T00:00:00Z');
    const fast = matchSignals(signals, profiles, 25, now);
    const slow = profiles.flatMap((p) =>
      pickHits(
        signals.flatMap((s) => {
          const m = matchOne(s, p);
          return m ? [{ s, distance_mi: m.distance_mi }] : [];
        }),
        now.getTime(),
      ).map((h) => ({ user_id: p.user_id, signal_id: h.s.id, distance_mi: h.distance_mi })),
    );
    expect(fast).toEqual(slow);
    const ids = (u: string) => fast.filter((r) => r.user_id === u).map((r) => r.signal_id).sort();
    expect(ids('a')).toEqual([1, 2, 4, 8]);
    expect(ids('b')).toEqual([1, 2, 6, 8]); // Atlanta records are in reach of the Marietta extra area
    expect(ids('c')).toEqual([1]);
    expect(ids('d')).toEqual([1]);
  });
});
