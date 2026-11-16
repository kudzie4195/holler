import { describe, expect, it } from 'vitest';
import { matchOne, matchSignals, MAX_MATCHES_PER_USER, type MatchProfile, type MatchSignal } from '@/lib/signals/match';

// Atlanta is roughly 33.749, -84.388; Marietta 33.953, -84.550 (about 14 mi); Athens GA about 70 mi away.
const profile = (over: Partial<MatchProfile> = {}): MatchProfile => ({
  user_id: 'u1',
  categories: ['roofing'],
  lat: 33.749,
  lon: -84.388,
  state: 'GA',
  radius_mi: 25,
  ...over,
});
const signal = (over: Partial<MatchSignal> = {}): MatchSignal => ({
  id: 1,
  categories: ['roofing', 'insurance'],
  lat: 33.953,
  lon: -84.55,
  state: 'GA',
  severity: 2,
  occurred_at: '2026-11-16T12:00:00Z',
  ...over,
});

describe('matchOne: radius', () => {
  it('matches within radius and reports distance', () => {
    const m = matchOne(signal(), profile());
    expect(m).not.toBeNull();
    expect(m!.distance_mi).toBeGreaterThan(10);
    expect(m!.distance_mi).toBeLessThan(20);
  });
  it('does not match outside radius', () => {
    expect(matchOne(signal({ lat: 33.96, lon: -83.38 }), profile())).toBeNull(); // Athens, ~58 mi
    expect(matchOne(signal({ lat: 33.96, lon: -83.38 }), profile({ radius_mi: 100 }))).not.toBeNull();
  });
  it('requires category overlap', () => {
    expect(matchOne(signal({ categories: ['plumbing'] }), profile())).toBeNull();
    expect(matchOne(signal({ categories: [] }), profile())).toBeNull();
    expect(matchOne(signal(), profile({ categories: [] }))).toBeNull();
  });
  it('coordinate signal needs a geocoded profile', () => {
    expect(matchOne(signal(), profile({ lat: null, lon: null }))).toBeNull();
  });
});

describe('matchOne: state-level rule', () => {
  const stateSig = (over: Partial<MatchSignal> = {}) => signal({ lat: null, lon: null, ...over });
  it('matches same-state profiles when severity >= 2 and categories overlap', () => {
    const m = matchOne(stateSig({ severity: 2 }), profile());
    expect(m).toEqual({ distance_mi: null });
    expect(matchOne(stateSig({ severity: 3 }), profile({ lat: null, lon: null }))).toEqual({ distance_mi: null });
  });
  it('does not match at severity 1', () => {
    expect(matchOne(stateSig({ severity: 1 }), profile())).toBeNull();
  });
  it('does not match another state or a signal with no state', () => {
    expect(matchOne(stateSig(), profile({ state: 'FL' }))).toBeNull();
    expect(matchOne(stateSig({ state: null }), profile())).toBeNull();
    expect(matchOne(stateSig(), profile({ state: null }))).toBeNull();
  });
  it('is case-insensitive on state', () => {
    expect(matchOne(stateSig({ state: 'ga' }), profile())).not.toBeNull();
  });
  it('still needs category overlap', () => {
    expect(matchOne(stateSig({ categories: ['solar'] }), profile())).toBeNull();
  });
});

describe('matchSignals: cap and ordering', () => {
  it('caps at 25 per user, most severe then newest first', () => {
    const sigs: MatchSignal[] = [];
    for (let i = 1; i <= 40; i++) {
      sigs.push(signal({ id: i, severity: i <= 5 ? 3 : 1, occurred_at: new Date(Date.UTC(2026, 10, 16, 0, i)).toISOString() }));
    }
    const rows = matchSignals(sigs, [profile()]);
    expect(rows).toHaveLength(MAX_MATCHES_PER_USER);
    expect(MAX_MATCHES_PER_USER).toBe(25);
    const ids = rows.map((r) => r.signal_id);
    // all five severity-3 first (newest first among them), then newest severity-1
    expect(ids.slice(0, 5)).toEqual([5, 4, 3, 2, 1]);
    expect(ids[5]).toBe(40);
    expect(ids).not.toContain(15); // older severity-1 dropped
  });
  it('applies the cap per user independently', () => {
    const sigs = Array.from({ length: 30 }, (_, i) => signal({ id: i + 1 }));
    const rows = matchSignals(sigs, [profile({ user_id: 'a' }), profile({ user_id: 'b' }), profile({ user_id: 'c', categories: ['solar'] })]);
    expect(rows.filter((r) => r.user_id === 'a')).toHaveLength(25);
    expect(rows.filter((r) => r.user_id === 'b')).toHaveLength(25);
    expect(rows.filter((r) => r.user_id === 'c')).toHaveLength(0);
  });
  it('returns nothing for no signals or no profiles', () => {
    expect(matchSignals([], [profile()])).toEqual([]);
    expect(matchSignals([signal()], [])).toEqual([]);
  });
});
