import { describe, expect, it } from 'vitest';
import { parseCheckParams } from '@/lib/check/params';
import { groupItems, safeUrl, MAX_ITEMS, MAX_PER_GROUP, type CheckItem } from '@/lib/check/group';
import { deriveScope, scopeKey, nearbySlugs } from '@/lib/check/scope';
import { tradeGroups } from '@/lib/check/trades';
import { lookupZip, cityBySlug } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';

describe('parseCheckParams', () => {
  it('is empty with no params', () => expect(parseCheckParams({})).toEqual({ status: 'empty' }));
  it('accepts a ZIP and a real trade', () => {
    expect(parseCheckParams({ zip: ' 30030 ', trade: 'roofing' })).toEqual({ status: 'ok', zip: '30030', trade: 'roofing' });
    expect(parseCheckParams({ zip: '30030-1234', trade: 'roofing' })).toMatchObject({ status: 'ok', zip: '30030' });
  });
  it('takes the first value of repeated params', () => {
    expect(parseCheckParams({ zip: ['30030', '1'], trade: ['hvac'] })).toMatchObject({ status: 'ok', zip: '30030', trade: 'hvac' });
  });
  it('flags a bad ZIP with a friendly message', () => {
    const r = parseCheckParams({ zip: '3003', trade: 'roofing' });
    expect(r).toMatchObject({ status: 'invalid' });
    if (r.status === 'invalid') expect(r.zipError).toMatch(/5-digit/);
  });
  it('flags a missing or unknown trade', () => {
    const a = parseCheckParams({ zip: '30030' });
    const b = parseCheckParams({ zip: '30030', trade: 'nope; drop table' });
    for (const r of [a, b]) {
      expect(r.status).toBe('invalid');
      if (r.status === 'invalid') expect(r.tradeError).toBeTruthy();
    }
  });
});

const NOW = Date.UTC(2026, 10, 17, 12, 0); // the fixtures are built relative to this time
const item = (id: number, kind: string, minsAgo: number): CheckItem => ({
  id,
  kind,
  source: 'nws',
  title: `t${id}`,
  url: null,
  place: null,
  occurredAt: new Date(Date.UTC(2026, 10, 17, 12, 0) - minsAgo * 60_000).toISOString(),
  severity: 2,
});

describe('groupItems', () => {
  it('groups kinds and orders groups by newest item', () => {
    const g = groupItems([item(1, 'permit', 50), item(2, 'report', 10), item(3, 'alert', 30), item(4, 'ask', 5)], NOW);
    expect(g.map((x) => x.id)).toEqual(['ask', 'weather', 'permit']);
    expect(g[1].items.map((i) => i.id)).toEqual([2, 3]);
  });
  it('caps per group and overall', () => {
    const many = Array.from({ length: 40 }, (_, i) => item(i, 'permit', i));
    const g = groupItems(many, NOW);
    expect(g).toHaveLength(1);
    expect(g[0].items).toHaveLength(MAX_PER_GROUP);
    const mixed = ['permit', 'civic', 'report', 'ask', 'event'].flatMap((k, ki) =>
      Array.from({ length: 10 }, (_, i) => item(ki * 100 + i, k, i + ki)),
    );
    expect(groupItems(mixed, NOW).reduce((n, x) => n + x.items.length, 0)).toBe(MAX_ITEMS);
  });
  it('puts unknown kinds in a fallback group and never loses them', () => {
    expect(groupItems([item(1, 'mystery', 1)], NOW)[0].title).toBe('Other records');
  });
  it('only links http(s)', () => {
    expect(safeUrl('https://x.gov/a')).toBe('https://x.gov/a');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe('cache scope', () => {
  it('two ZIPs in the same city share a key', () => {
    const a = lookupZip('30303')!;
    const b = lookupZip('30318')!;
    expect(a.zip).not.toBe(b.zip);
    const ka = scopeKey(deriveScope(a), 'roofing');
    const kb = scopeKey(deriveScope(b), 'roofing');
    expect(ka).toBe(kb);
    expect(ka).toBe('atlanta-ga|roofing');
  });
  it('the trade changes the key and the raw ZIP never appears in it', () => {
    const z = lookupZip('30303')!;
    expect(scopeKey(deriveScope(z), 'hvac')).not.toBe(scopeKey(deriveScope(z), 'roofing'));
    expect(scopeKey(deriveScope(z), 'hvac')).not.toContain('30303');
  });
  it('falls back to the state when no tracked city is within 40 miles', () => {
    expect(deriveScope({ lat: 47.0, lon: -109.0, state: 'mt' })).toEqual({ citySlug: null, state: 'MT' });
    expect(scopeKey({ citySlug: null, state: 'MT' }, 'hvac')).toBe('state:MT|hvac');
  });
  it('nearby slugs start with the city and stay within a sane count', () => {
    const slugs = nearbySlugs(cityBySlug('atlanta-ga')!);
    expect(slugs[0]).toBe('atlanta-ga');
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.length).toBeLessThan(80);
  });
});

describe('tradeGroups', () => {
  it('lists every category exactly once, read at runtime', () => {
    const ids = tradeGroups().flatMap((g) => g.options.map((o) => o.id));
    expect(ids.sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
  });
});
