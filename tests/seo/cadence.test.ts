import { describe, expect, it } from 'vitest';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { CADENCE_LONG, CADENCE_SHORT } from '@/lib/seo/cadence';

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
  it('one to six hours: posts from people asking online', () => {
    expect(mins(['bluesky', 'websearch-brave', 'websearch-serper'].filter((id) => ALL_ADAPTERS.some((a) => a.id === id)))).toSatisfy(
      (m: (number | undefined)[]) => m.length > 0 && m.every((x) => x !== undefined && x >= 60 && x <= 360),
    );
    expect(CADENCE_LONG).toContain('every one to six hours');
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
