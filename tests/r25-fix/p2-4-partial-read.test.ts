// R25 check fix, review R25CHECK P2-4: one failed extra read used to give a confident count ("no alerts"), cached for an hour for the
// whole grid cell. Now any failed read marks the entry clipped (the count is a lower bound, so the verdict says "at least" or, at zero,
// prints the head only) and the entry is cached for a minute, like a failed main read.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null as unknown, life: [] as unknown[] }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ cacheLife: (v: unknown) => void h.life.push(v), cacheTag: () => {} }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.db }));

import { loadCheck } from '@/lib/check/load';
import { alertTotals, memberItems } from '@/lib/check/delivery';
import { checkVerdict } from '@/lib/check/verdict';
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { deriveScope } from '@/lib/check/scope';
import { lookupZip } from '@/lib/geo';
import { fakeSignalsDb, type Row } from '../fixtures/fake-signals-db';
import { EXPORT, EXPORT_NOW, HAVE_EXPORT, exportRows } from '../r25/export-reads';

const SHORT = { stale: 60, revalidate: 60, expire: 300 };
const HOUR = { stale: 300, revalidate: 3600, expire: 7200 };

/** The fake database, with the routed reads (categories other than the trade's own) or the state read answering an error. */
function failing(rows: Row[], what: 'routed' | 'state' | 'none', own: string[]) {
  const fake = fakeSignalsDb(rows, { now: EXPORT_NOW });
  const err = { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } };
  const q = (res: unknown): unknown => {
    const o: Record<string, unknown> = {};
    for (const m of ['select', 'abortSignal', 'is', 'eq', 'gte', 'lte', 'overlaps', 'or', 'order', 'limit']) o[m] = () => o;
    o.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad);
    return o;
  };
  return {
    ...fake,
    rpc(name: string, args: Record<string, unknown>) {
      const cats = (args.p_categories as string[]) ?? [];
      if (what === 'routed' && !cats.some((c) => own.includes(c))) return q(err);
      return fake.rpc(name, args as never);
    },
    from(table: string) {
      if (what === 'state') return q(err);
      return fake.from(table);
    },
  };
}

if (!HAVE_EXPORT) {
  describe('P2-4 on the 14-day export', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('P2-4: Raleigh 27601 landscaping, the review reproduction, through the real loadCheck', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EXPORT_NOW);
  });
  afterAll(() => vi.useRealTimers());
  beforeEach(() => {
    h.life.length = 0;
  });
  const zip = '27601';
  const trade = 'landscaping';
  const place = lookupZip(zip)!;
  const sc = deriveScope(place);
  const state = coverageFor(place, trade, isServedZip(place)).state;

  it('control: every read answers, the count is exact and the entry lives an hour', async () => {
    h.db = failing(exportRows() as Row[], 'none', [trade]);
    const r = await loadCheck(sc.cellLat, sc.cellLon, sc.state, trade);
    expect(r.ok).toBe(true);
    expect(r.clipped).toBe(false);
    expect(h.life).toEqual([HOUR]);
    const totals = alertTotals(memberItems(r.items, place, trade), r.clipped === true);
    expect(totals.count).toBeGreaterThan(0);
  });

  for (const what of ['routed', 'state'] as const) {
    it(`the ${what} read fails: the entry is marked clipped, cached a minute, and the page never says a flat count`, async () => {
      h.db = failing(exportRows() as Row[], what, [trade]);
      const r = await loadCheck(sc.cellLat, sc.cellLon, sc.state, trade);
      expect(r.ok).toBe(true);
      expect(r.clipped).toBe(true);
      expect(h.life).toEqual([SHORT]);
      const totals = alertTotals(memberItems(r.items, place, trade), r.clipped === true);
      expect(totals.atLeast).toBe(true);
      const v = checkVerdict(state, totals, { tradeLabel: 'Landscaping', zip, lang: 'en' })!;
      expect(v.count ?? '').not.toContain('no alerts');
      if (totals.count === 0) expect(v.count).toBeNull();
      else expect(v.count).toContain(`at least ${totals.count} record`);
    });
  }
});
