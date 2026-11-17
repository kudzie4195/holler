// P1-2 (review-billing.md): one scan must match a busy tick against many Pro profiles well inside the scan's time budget.
// Synthetic data, same generator as the review: records and areas spread over the lower 48, a 10-word title and a 45-word summary,
// Pro profiles with 15 trades, 3 areas and 5 keyword watches. The ceiling is generous on purpose (the review measured about 32 s here
// before the fix); the measured time is printed so a regression is visible long before it fails.
import { describe, expect, it } from 'vitest';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const WORDS =
  'permit issued for residential alteration at oak street unit replace water heater and repair roof deck building complaint noise heat hot water tree down sidewalk damage new business licence restaurant inspection violation'.split(
    ' ',
  );

function perfData(ns: number, np: number, seed = 42): { signals: MatchSignal[]; profiles: MatchProfile[] } {
  const rnd = rng(seed);
  const text = (n: number) => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ');
  const lat = () => 25 + rnd() * 23;
  const lon = () => -122 + rnd() * 50;
  const signals: MatchSignal[] = Array.from({ length: ns }, (_, i) => ({
    id: i,
    categories: ['cat' + Math.floor(rnd() * 40)],
    lat: lat(),
    lon: lon(),
    state: 'GA',
    severity: 1,
    occurred_at: new Date().toISOString(),
    title: text(10),
    summary: text(45),
  }));
  const profiles: MatchProfile[] = Array.from({ length: np }, (_, i) => ({
    user_id: 'u' + i,
    categories: Array.from({ length: 15 }, (_, j) => 'cat' + ((i + j) % 40)),
    lat: lat(),
    lon: lon(),
    state: 'GA',
    radius_mi: 50,
    plan: 'pro',
    subscription_status: 'active',
    extra_areas: [
      { zip: '30060', city: 'A', lat: lat(), lon: lon(), state: 'TX' },
      { zip: '30061', city: 'B', lat: lat(), lon: lon(), state: 'CA' },
    ],
    keywords: ['tree removal', 'water heater', 'roof deck', 'hail damage', 'grease trap'],
  }));
  return { signals, profiles };
}

describe('matchSignals speed with keyword watches (P1-2)', () => {
  it('3,000 records x 1,000 Pro profiles (3 areas, 5 keywords each) match in under 5 seconds', () => {
    const { signals, profiles } = perfData(3000, 1000);
    const t = performance.now();
    const rows = matchSignals(signals, profiles);
    const ms = performance.now() - t;
    console.log(`[perf] matchSignals 3000 records x 1000 Pro profiles: ${ms.toFixed(0)} ms, ${rows.length} matches`);
    expect(rows.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5000);
  }, 120_000);

  it('dense case: every record within reach of every profile, still under 5 seconds', () => {
    const { signals, profiles } = perfData(3000, 1000, 7);
    // Everything inside one metro, so the area test passes for every pair and the keyword test runs for all 3 million.
    for (const s of signals) {
      s.lat = 33.7 + ((s.id % 100) / 1000);
      s.lon = -84.4;
      s.categories = ['nope'];
    }
    for (const p of profiles) {
      p.lat = 33.75;
      p.lon = -84.39;
    }
    const t = performance.now();
    const rows = matchSignals(signals, profiles);
    const ms = performance.now() - t;
    console.log(`[perf] dense matchSignals 3000 x 1000: ${ms.toFixed(0)} ms, ${rows.length} matches`);
    expect(rows.length).toBe(1000 * 25); // every profile hits by keyword, capped at 25
    expect(ms).toBeLessThan(5000);
  }, 300_000);
});
