import { describe, expect, it } from 'vitest';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { CADENCE_LONG, CADENCE_SHORT, cadenceLong } from '@/lib/seo/cadence';
import { flagsFor } from '@/lib/seo/public-copy';
import { buildFaq } from '@/lib/seo/view';
import { emptyPlaceData } from '@/lib/seo/summarize';

const mins = (ids: string[]) => ids.map((id) => ALL_ADAPTERS.find((a) => a.id === id)?.cadenceMinutes);

describe('public cadence wording matches the adapters', () => {
  it('15 minutes: weather alerts and airport delays', () => {
    expect(mins(['nws', 'faa'])).toEqual([15, 15]);
    expect(CADENCE_SHORT).toContain('every 15 minutes');
  });
  it('30 minutes: storm and earthquake reports', () => {
    expect(mins(['spc', 'usgs'])).toEqual([30, 30]);
    expect(CADENCE_LONG).toContain('every 30 minutes');
  });
  it('six hours: posts from people asking online, named only when that source is switched on', () => {
    expect(mins(['bluesky', 'websearch-brave', 'websearch-serper'].filter((id) => ALL_ADAPTERS.some((a) => a.id === id)))).toSatisfy(
      (m: (number | undefined)[]) => m.length > 0 && m.every((x) => x === 360),
    );
    expect(cadenceLong({ ask: true })).toContain('every six hours');
    expect(cadenceLong({ ask: true })).toContain('people asking online');
  });
  it('a few times a day: every city, contract and event source runs between every 3 and 12 hours', () => {
    const slow = ALL_ADAPTERS.filter((a) => a.id.startsWith('socrata-') || ['usaspending', 'sam-gov', 'ticketmaster', 'fema'].includes(a.id));
    expect(slow.length).toBeGreaterThan(20);
    for (const a of slow) {
      expect(a.cadenceMinutes, a.id).toBeGreaterThanOrEqual(180);
      expect(a.cadenceMinutes, a.id).toBeLessThanOrEqual(720);
    }
    expect(CADENCE_SHORT).toContain('a few times a day');
  });
  it('no copy says 15 to 60 minutes', () => {
    expect(CADENCE_SHORT + CADENCE_LONG).not.toMatch(/15 to 60/);
  });
});

describe('the long cadence text on every city page only describes sources that work with no optional key', () => {
  it('with no optional source on, CADENCE_LONG names no online posts, no events and no six-hour cycle', () => {
    expect(CADENCE_LONG).toBe(cadenceLong({}));
    expect(CADENCE_LONG).not.toMatch(/people asking|online|six hours|events|Bluesky|search/i);
    expect(CADENCE_LONG).toContain('storm and earthquake reports every 30 minutes');
    expect(CADENCE_LONG).toContain('City records and federal contracts are checked a few times a day');
    expect(CADENCE_LONG).toContain('Requests that residents post on Holler');
  });
  it('keeps the key-gated wording for when those sources are switched on', () => {
    expect(cadenceLong({ ask: true, event: true })).toContain('posts from people asking online every six hours');
    expect(cadenceLong({ event: true })).toContain('City records, federal contracts and events');
    expect(cadenceLong({ event: true })).not.toContain('people asking');
  });
  it('the city FAQ follows the keys: keyless claim by default, the gated claim only when flags say so', () => {
    const city = { name: 'Austin', state: 'TX', slug: 'austin-tx' } as Parameters<typeof buildFaq>[0];
    const data = emptyPlaceData('austin-tx', '2026-11-17T12:00:00Z', true);
    const none = flagsFor(() => false);
    const all = flagsFor(() => true);
    const a = buildFaq(city, data, none).find((f) => /how often/i.test(f.q))!.a;
    expect(a).not.toMatch(/people asking|online|six hours/i);
    expect(a).toContain('every 15 minutes');
    const b = buildFaq(city, data, all).find((f) => /how often/i.test(f.q))!.a;
    expect(b).toContain('people asking online every six hours');
  });
});
