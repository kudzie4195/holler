import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  client: null as unknown,
  calls: [] as { table: string; ops: [string, unknown[]][] }[],
  result: { data: [] as unknown[], error: null as { message: string } | null, count: 0 as number | null },
  throwIt: false,
}));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife, cacheTag: h.cacheTag }));
vi.mock('@/lib/seo/client', () => ({
  publicClient: () => h.client,
}));

import { groupWeekRows, loadWeekData, WEEK_ITEM_LIMIT, WEEK_ROW_CAP } from '@/lib/seo/week-data';
import { SECTIONS } from '@/lib/seo/sections';
import { summarize, type SignalRowDb } from '@/lib/seo/summarize';

function recorder() {
  return {
    from(table: string) {
      const call = { table, ops: [] as [string, unknown[]][] };
      h.calls.push(call);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'lt', 'or', 'order', 'limit', 'abortSignal']) {
        q[m] = (...args: unknown[]) => {
          call.ops.push([m, args]);
          return q;
        };
      }
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (h.throwIt) return Promise.reject(new Error('network down')).then(res, rej);
        return Promise.resolve(h.result).then(res, rej);
      };
      return q;
    },
  };
}

const REAL_NOW = Date.parse('2026-11-17T12:00:00Z'); // Tuesday
let id = 0;
const row = (kind: string, subtype: string | null, iso: string, extra: Partial<SignalRowDb> = {}): SignalRowDb => ({
  id: ++id, source: 'socrata-test', kind, title: `${kind} ${id}`, summary: null, url: 'https://example.gov/r', categories: ['roofing'], severity: 1,
  occurred_at: iso, expires_at: null, subtype, ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(REAL_NOW);
  h.cacheLife.mockClear();
  h.calls.length = 0;
  h.client = recorder();
  h.result = { data: [], error: null, count: 0 };
  h.throwIt = false;
});

const opsOf = (i = 0) => Object.fromEntries(h.calls[i].ops.map(([m, a]) => [m, a]));

describe('loadWeekData: the one query', () => {
  it('reads holler_signals once, by place_slug and the week range, newest first, with a hard limit', async () => {
    h.result = { data: [row('permit', 'permit', '2026-11-10T10:00:00Z')], error: null, count: 1 };
    const d = await loadWeekData('raleigh-nc', '2026-11-09');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].table).toBe('holler_signals');
    const o = opsOf();
    expect(o.eq).toEqual(['place_slug', 'raleigh-nc']);
    expect(o.gte).toEqual(['occurred_at', '2026-11-09T00:00:00.000Z']);
    expect(o.lte).toEqual(['occurred_at', '2026-11-15T23:59:59.999Z']);
    expect(o.order).toEqual(['occurred_at', { ascending: false }]);
    expect(o.limit).toEqual([WEEK_ROW_CAP]);
    expect(o.abortSignal).toBeDefined();
    expect(d.valid && d.ok).toBe(true);
    expect(d.counts.permits).toBe(1);
    expect(d.prev).toBe('2026-11-02');
    expect(d.next).toBe('2026-11-16');
  });
  it('the current week never reads past now', async () => {
    await loadWeekData('raleigh-nc', '2026-11-16');
    expect(opsOf().lte).toEqual(['occurred_at', '2026-11-17T12:00:00.000Z']);
  });
  it('a finished week is cached for a day, the current week for 6 hours', async () => {
    await loadWeekData('raleigh-nc', '2026-11-09');
    expect(h.cacheLife).toHaveBeenLastCalledWith({ stale: 3600, revalidate: 86400, expire: 172800 });
    await loadWeekData('raleigh-nc', '2026-11-16');
    expect(h.cacheLife).toHaveBeenLastCalledWith({ stale: 300, revalidate: 21600, expire: 86400 });
  });
  it('the current week has no next link', async () => {
    const d = await loadWeekData('raleigh-nc', '2026-11-16');
    expect(d.current).toBe(true);
    expect(d.next).toBeNull();
    expect(d.prev).toBe('2026-11-09');
  });
  it('flags a truncated read', async () => {
    h.result = { data: [row('permit', 'permit', '2026-11-10T10:00:00Z')], error: null, count: 4000 };
    expect((await loadWeekData('raleigh-nc', '2026-11-09')).truncated).toBe(true);
  });
});

describe('loadWeekData: the window and failures', () => {
  it('an invalid date makes no query and returns valid:false', async () => {
    for (const bad of ['2026-11-17', 'garbage', '2026-11-23', '2026-08-24']) {
      h.calls.length = 0;
      const d = await loadWeekData('raleigh-nc', bad);
      expect(d.valid, bad).toBe(false);
      expect(h.calls).toHaveLength(0);
    }
  });
  it('the 12th week back is valid and the 13th is not', async () => {
    expect((await loadWeekData('raleigh-nc', '2026-08-31')).valid).toBe(true);
    expect((await loadWeekData('raleigh-nc', '2026-08-24')).valid).toBe(false);
  });
  it('a database error gives an empty, valid page cached for a minute', async () => {
    h.result = { data: [], error: { message: 'boom' }, count: null };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = await loadWeekData('raleigh-nc', '2026-11-09');
    expect(d).toMatchObject({ valid: true, ok: false, total: 0 });
    expect(h.cacheLife).toHaveBeenLastCalledWith({ stale: 300, revalidate: 60, expire: 300 });
    spy.mockRestore();
  });
  it('a thrown error never escapes', async () => {
    h.throwIt = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = await loadWeekData('raleigh-nc', '2026-11-09');
    expect(d).toMatchObject({ valid: true, ok: false });
    expect(h.cacheLife).toHaveBeenLastCalledWith({ stale: 300, revalidate: 60, expire: 300 });
    spy.mockRestore();
  });
  it('no Supabase env (null client) gives the same empty state', async () => {
    h.client = null;
    const d = await loadWeekData('raleigh-nc', '2026-11-09');
    expect(d).toMatchObject({ valid: true, ok: false, total: 0 });
    expect(h.calls).toHaveLength(0);
    expect(h.cacheLife).toHaveBeenLastCalledWith({ stale: 300, revalidate: 60, expire: 300 });
  });
});

describe('groupWeekRows reuses the city page grouping', () => {
  const NOW = '2026-11-17T12:00:00.000Z';
  const rows = [
    row('permit', 'permit', '2026-11-16T09:00:00Z'),
    row('permit', 'permit', '2026-11-15T09:00:00Z'),
    row('report', null, '2026-11-16T08:00:00Z'),
    row('civic', '311', '2026-11-14T08:00:00Z'),
    row('civic', 'inspection', '2026-11-14T07:00:00Z'),
    row('civic', 'violation', '2026-11-13T07:00:00Z'),
    row('civic', 'business', '2026-11-13T06:00:00Z'),
    row('contract', null, '2026-11-12T06:00:00Z'),
    row('event', 'event-permit', '2026-11-12T05:00:00Z'),
    row('travel', null, '2026-11-12T04:00:00Z'),
    row('ask', null, '2026-11-12T03:00:00Z'),
    row('disaster', null, '2026-11-12T02:00:00Z'),
    row('mystery', null, '2026-11-12T01:00:00Z'),
  ];
  it('assigns every record to the same section as summarize() does, with the same counts and item order', () => {
    const week = groupWeekRows(rows);
    const city = summarize('raleigh-nc', rows, NOW, { limit: 100 });
    expect(Object.keys(week.sections)).toEqual(Object.keys(city.sections));
    for (const s of SECTIONS) {
      expect(week.counts[s.id], s.id).toBe(city.counts[s.id]);
      expect((week.sections[s.id] ?? []).map((i) => i.id), s.id).toEqual((city.sections[s.id] ?? []).map((i) => i.id));
    }
    expect(week.total).toBe(12); // the unknown kind is dropped, as on the city page
  });
  it('lists every alert of the week, expired or not (a finished week has no active ones)', () => {
    const a = [row('alert', null, '2026-11-10T01:00:00Z', { expires_at: '2026-11-10T09:00:00Z' }), row('alert', null, '2026-11-11T01:00:00Z', { expires_at: '2026-11-11T05:00:00Z', severity: 3 })];
    const g = groupWeekRows(a);
    expect(g.counts.alerts).toBe(2);
    expect(g.sections.alerts?.[0].severity).toBe(3);
  });
  it('limits items per section but counts them all, and drops unsafe urls', () => {
    const many = Array.from({ length: WEEK_ITEM_LIMIT + 5 }, (_, i) => row('permit', 'permit', new Date(Date.parse('2026-11-10T00:00:00Z') + i * 60_000).toISOString(), { url: i === 0 ? 'javascript:alert(1)' : 'https://example.gov/p' }));
    const g = groupWeekRows(many);
    expect(g.counts.permits).toBe(WEEK_ITEM_LIMIT + 5);
    expect(g.sections.permits).toHaveLength(WEEK_ITEM_LIMIT);
    expect(g.sections.permits?.every((i) => i.url !== 'javascript:alert(1)')).toBe(true);
    const first = g.sections.permits ?? [];
    expect(first[0].occurredAt > first[1].occurredAt).toBe(true);
  });
  it('an empty week is empty', () => {
    expect(groupWeekRows([])).toEqual({ sections: {}, counts: {}, sources: [], total: 0 });
  });
});
