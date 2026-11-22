// The coverage helper behind the waitlist card: which ZIPs Holler serves, measured to each local feed's own centre.
import { describe, expect, it, vi } from 'vitest';
import { isServedZip, localSourceCentres, localSourcesNear, unresolvedSources } from '@/lib/check/coverage';
import { enabledDatasets } from '@/lib/signals/capabilities';
import { lookupZip } from '@/lib/geo';

vi.mock('server-only', () => ({}));

const place = (zip: string) => {
  const p = lookupZip(zip);
  if (!p) throw new Error(`zip ${zip} not found`);
  return p;
};

describe('isServedZip', () => {
  it('a ZIP with no local feed within 25 miles is not served (59001 Absarokee MT)', () => {
    expect(isServedZip(place('59001'))).toBe(false);
    expect(localSourcesNear(place('59001').lat, place('59001').lon)).toEqual([]);
  });
  it('a ZIP next to a connected city feed is served (60614 Chicago, 30339 Atlanta, 10001 New York, 30030 Decatur)', () => {
    for (const z of ['60614', '30339', '10001', '30030']) expect(isServedZip(place(z)), z).toBe(true);
  });
  it('territories and military mail codes are never served, even if a feed were near', () => {
    for (const z of ['00901']) expect(isServedZip(place(z)), z).toBe(false);
    expect(isServedZip({ lat: 41.88, lon: -87.63, state: 'PR' })).toBe(false);
    expect(isServedZip({ lat: 41.88, lon: -87.63, state: 'AE' })).toBe(false);
  });
  it('a ZIP only reached by an airport feed is not served (airport status is not a record a trade can act on)', () => {
    expect(isServedZip(place('96860'))).toBe(false);
  });
  it('a bad point is not served', () => {
    expect(isServedZip({ lat: NaN, lon: 0, state: 'IL' })).toBe(false);
  });
});

describe('source centres', () => {
  it('every enabled dataset resolves to a centre, so none is silently dropped from coverage', () => {
    expect(unresolvedSources()).toEqual([]);
    expect(localSourceCentres()).toHaveLength(enabledDatasets().length);
  });
});
