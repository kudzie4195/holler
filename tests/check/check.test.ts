import { describe, expect, it } from 'vitest';
import { parseCheckParams } from '@/lib/check/params';
import { groupItems, safeUrl, MAX_ITEMS, MAX_PER_GROUP, type CheckItem } from '@/lib/check/group';
import { tradeGroups } from '@/lib/check/trades';
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
  it('groups kinds; a group with an active severe alert comes first, the others by newest item', () => {
    const g = groupItems([item(1, 'permit', 50), item(2, 'report', 10), item(3, 'alert', 30), item(4, 'ask', 5)], NOW);
    expect(g.map((x) => x.id)).toEqual(['weather', 'ask', 'permit']);
    expect(g[0].items.map((i) => i.id)).toEqual([2, 3]);
    const mild = (id: number, kind: string, minsAgo: number): CheckItem => ({ ...item(id, kind, minsAgo), severity: 1 });
    expect(groupItems([mild(1, 'permit', 50), mild(2, 'report', 10), mild(4, 'ask', 5)], NOW).map((x) => x.id)).toEqual(['ask', 'weather', 'permit']);
  });
  it('shows active severe alerts first, then the closest records, then the rest newest first', () => {
    const origin = { lat: 40.8, lon: -74.48 };
    const at = (id: number, kind: string, severity: number, miles: number | null, minsAgo: number): CheckItem => ({
      ...item(id, kind, minsAgo),
      severity,
      lat: miles === null ? null : origin.lat + miles / 69.09,
      lon: miles === null ? null : origin.lon,
    });
    const items = [
      at(1, 'civic', 1, 35, 1), // far, newest
      at(2, 'civic', 1, 20, 500), // local, farther
      at(3, 'civic', 1, 2, 900), // local, closest
      at(4, 'civic', 1, 40, 30), // far, older
      at(5, 'alert', 3, null, 2000), // severe state-level alert, oldest of all
    ];
    const g = groupItems(items, NOW, origin);
    expect(g[0].id).toBe('weather');
    const civic = g.find((x) => x.id === 'civic')!;
    expect(civic.items.map((i) => i.id)).toEqual([3, 2, 1, 4]);
    // under a tight cap the severe and the local rows survive, not the newest far ones
    const dense = Array.from({ length: 30 }, (_, i) => at(100 + i, 'civic', 1, 30 + (i % 5), i));
    const kept = groupItems([...dense, items[2], items[4]], NOW, origin);
    const ids = kept.flatMap((x) => x.items.map((i) => i.id));
    expect(ids).toContain(3);
    expect(ids).toContain(5);
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

describe('tradeGroups', () => {
  it('lists every category exactly once, read at runtime', () => {
    const ids = tradeGroups().flatMap((g) => g.options.map((o) => o.id));
    expect(ids.sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
  });
});
