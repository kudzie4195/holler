/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Round 33, review 3 of PR 19 (P2-1, P2-2, P3). New-business licence feed-only hold, switch HOLLER_BUSINESS_TAG_FIX_ENABLED:
 *  - P2-1: the 5-business-rows-per-member cap ranks rows that go out as alerts before feed-only ones (switch on only).
 *  - P2-2: the rematch "already handled" path and the missing-column retries belong to new-business licences only, switch on only.
 *  - P3: run.ts (a scan that carries a stage update while alert_hold is not a column) and quiet-matches.ts (the retry keeps the licence hold
 *    in the caller's rows) are guarded by tests that fail when either line is changed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import { rematchSignals } from '@/lib/signals/rematch';
import { pickHits, MAX_BUSINESS_PER_USER, type Hit, type MatchSignal } from '@/lib/signals/match';
import { insertMatches, type Db } from '@/lib/signals/store';
import { upsertMatchRows } from '@/lib/signals/quiet-matches';
import { buildSocrataAdapter } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import type { Adapter, SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));
const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 41.88, lon: -87.63 };
const member = { user_id: 'm1', categories: ['security'], lat: LOC.lat, lon: LOC.lon, state: 'IL', radius_mi: 25, subscription_status: 'active', trial_ends_at: null };
const TAGS = ['signs-printing', 'janitorial-commercial', 'security', 'pest-control'];
const lic = (externalId: string, dLat: number, over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'socrata-chicago-business', externalId, kind: 'civic', title: 'New business license in Chicago: Retail Food Establishment', summary: 'Retail Food Establishment',
  categories: TAGS as any, severity: 1, occurredAt: '2026-11-20T08:00:00Z', lat: LOC.lat + dLat, lon: LOC.lon, city: 'Chicago', state: 'IL', data: { subtype: 'business' }, ...over,
});
const named = { contacts: [{ role: 'business', name: 'Lakeview Pantry LLC' }] as any };
const adapterOf = (list: () => SignalInput[]): Adapter => ({ id: 'socrata-chicago-business', label: 'Chicago licences', kind: 'civic', cadenceMinutes: 60, sourceUrl: 'https://example.com', fetch: async () => list() } as Adapter);

const failing = (error: unknown) => {
  const p: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res) : () => p) });
  return p;
};
const COL = { code: '42703', message: 'column holler_matches.alert_hold does not exist' };
const STALE = { code: 'PGRST204', message: "Could not find the 'alert_hold' column of 'holler_matches' in the schema cache" };
/** The live database today: holler_matches has no alert_hold (a select and a write that name it answer 42703). */
function pre0027(seed: Record<string, any[]>) {
  const db = new FakeDb(seed);
  const from = db.from.bind(db);
  (db as any).from = (table: string) => {
    const b: any = from(table);
    if (table !== 'holler_matches') return b;
    const upsert = b.upsert.bind(b);
    b.upsert = (r: any[], o: any) => (r.some((x) => 'alert_hold' in x) ? failing(COL) : upsert(r, o));
    const select = b.select.bind(b);
    b.select = (cols?: string, o?: any) => (typeof cols === 'string' && /alert_hold/.test(cols) ? failing(COL) : select(cols, o));
    return b;
  };
  return db;
}
/** The seconds after 0027 is applied: the column can be read, but PostgREST's schema cache still refuses a write that names it. */
function staleCache(seed: Record<string, any[]>) {
  const db = new FakeDb(seed);
  const from = db.from.bind(db);
  (db as any).from = (table: string) => {
    const b: any = from(table);
    if (table !== 'holler_matches') return b;
    const upsert = b.upsert.bind(b);
    b.upsert = (r: any[], o: any) => (r.some((x) => 'alert_hold' in x) ? failing(STALE) : upsert(r, o));
    return b;
  };
  return db;
}
/** The real API answers the select alias `subtype:data->>subtype` (lib/signals/store.ts); FakeDb ignores select columns, so add it at upsert. */
function withAlias<T extends FakeDb>(db: T): T {
  const from = (db as any).from.bind(db);
  (db as any).from = (table: string) => {
    const b: any = from(table);
    if (table !== 'holler_signals') return b;
    const upsert = b.upsert.bind(b);
    b.upsert = (r: any[], o: any) => upsert(r.map((x) => ({ ...x, subtype: x?.data?.subtype ?? null })), o);
    return b;
  };
  return db;
}
const out = (db: FakeDb) => {
  const ext = (id: number) => db.tables.holler_signals.find((s) => s.id === id)?.external_id;
  return Object.fromEntries((db.tables.holler_matches ?? []).map((m) => [ext(m.signal_id), `${m.alert_hold ?? 'ALERT'} notified=${m.notified ?? false} pushed=${m.pushed_at ? 'set' : 'null'}`]));
};
const logged = (db: FakeDb) => (db.tables.holler_alert_log ?? []).map((r) => db.tables.holler_signals.find((s) => s.id === r.signal_id)?.external_id).sort();
const sendable = (db: FakeDb) => (db.tables.holler_matches ?? []).filter((m) => m.notified !== true || !m.pushed_at).length;
const HELD = 'background notified=true pushed=set';
const ALERT = 'ALERT notified=false pushed=null';
const HANDLED_NO_COLUMN = 'ALERT notified=true pushed=set';
const quiet = () => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); };
const scan = (db: FakeDb, a: Adapter | Adapter[]) => runScan({ now: NOW, adapters: Array.isArray(a) ? a : [a], ...(Array.isArray(a) ? {} : { source: a.id }), indexNow: { config: null as never } } as any, db as unknown as Db);

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P2-1: the business cap puts rows that alert ahead of feed-only licences', () => {
  const biz = (id: number, dist: number, hold?: 'background'): Hit => ({
    s: { id, source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 't', summary: null, categories: ['security'], lat: 0, lon: 0, state: 'IL', severity: 1, occurred_at: '2026-11-20T08:00:00Z', data: { subtype: 'business' } } as MatchSignal,
    distance_mi: dist, label: 'coming_soon', trade: 'security', ...(hold ? { hold } : {}),
  });
  const five = () => [1, 2, 3, 4, 5].map((i) => biz(i, i * 0.1, 'background'));
  it('pickHits, switch on: 5 nearer held + 1 named keeps the named one (and 4 held)', () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    expect(MAX_BUSINESS_PER_USER).toBe(5);
    const ids = pickHits([...five(), biz(6, 9)], NOW.getTime()).map((h) => h.s.id);
    expect(ids).toHaveLength(5);
    expect(ids).toContain(6);
    expect([...ids].sort()).toEqual([1, 2, 3, 4, 6]);
  });
  it('pickHits, switch on: held rows keep their nearest-first order among themselves; un-held rows are nearest first too', () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const hits = [...five(), biz(6, 9), biz(7, 3), biz(8, 5)];
    expect(pickHits(hits, NOW.getTime()).map((h) => h.s.id).sort()).toEqual([1, 6, 7, 8, 2].sort());
  });
  it('pickHits, switch off: behaves as before (nearest first, the hold is not read)', () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    const ids = pickHits([...five(), biz(6, 9)], NOW.getTime()).map((h) => h.s.id);
    expect([...ids].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('pickHits: no business row is dropped when there are 5 or fewer, and non-business rows are untouched by the rule', () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const other: Hit = { ...biz(50, 0.5, 'background'), s: { ...biz(50, 0.5).s, subtype: 'permit', data: { subtype: 'permit' } } };
    expect(pickHits([biz(1, 1, 'background'), biz(2, 2), other], NOW.getTime()).map((h) => h.s.id).sort((a, b) => a - b)).toEqual([1, 2, 50]);
  });

  const rows = () => [...[1, 2, 3, 4, 5].map((i) => lic(`NEAR${i}`, i * 0.001)), lic('BIZ', 0.05, named)];
  for (const mig of ['0027 applied', '0027 NOT applied']) {
    it(`real scan, switch on, ${mig}: 5 nearer no-contact licences + 1 named: the named one alerts`, async () => {
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
      quiet();
      const seed = { holler_profiles: [member] };
      const db = withAlias(mig === '0027 applied' ? new FakeDb(seed) : pre0027(seed));
      const rep = await scan(db, adapterOf(rows));
      expect(rep.error).toBeUndefined();
      const got = out(db);
      expect(got.BIZ).toBe(ALERT);
      expect(Object.keys(got)).toHaveLength(5);
      for (const k of Object.keys(got)) if (k !== 'BIZ') expect(got[k], k).toBe(mig === '0027 applied' ? HELD : HANDLED_NO_COLUMN);
      expect(sendable(db)).toBe(1);
      expect(logged(db)).toEqual(['BIZ']);
    });
  }
  it('real scan, switch off: as before, the 5 nearest are alerts and the named one is not matched', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    quiet();
    const db = withAlias(new FakeDb({ holler_profiles: [member] }));
    await scan(db, adapterOf(() => [...[1, 2, 3, 4, 5].map((i) => lic(`NEAR${i}`, i * 0.001)), lic('BIZ', 0.05, named)]));
    const got = out(db);
    expect(Object.keys(got).sort()).toEqual(['NEAR1', 'NEAR2', 'NEAR3', 'NEAR4', 'NEAR5']);
    expect(Object.values(got).every((v) => v === ALERT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P2-2: the rematch and the retries touch new-business licences only', () => {
  const base = { source: 'socrata-chicago-business', kind: 'civic', severity: 1, occurred_at: '2026-11-20T08:00:00Z', expires_at: null, lat: LOC.lat + 0.01, lon: LOC.lon, city: 'Chicago', state: 'IL' };
  const licence = { id: 7, ...base, external_id: 'LIC', title: 'New business license in Chicago: Retail Food Establishment', summary: 'Retail Food Establishment', categories: TAGS, data: { subtype: 'business' } };
  const permit = { id: 8, ...base, source: 'arcgis-dekalb-permits', kind: 'permit', external_id: 'PERMIT', title: 'New home permit in Chicago', summary: 'New Construction | Single Family Dwelling | Issued', categories: ['general-contractor', 'real-estate', 'moving'], data: { subtype: 'permit' } };
  const seed = () => ({ holler_profiles: [{ ...member, categories: ['security', 'landscaping'] }], holler_signals: [licence, permit], holler_matches: [], holler_signal_contacts: [] });

  for (const sw of ['1', '']) {
    it(`switch ${sw ? 'on' : 'off'}, alert_hold absent: a permit with no contact is untouched (a plain alert, not handled)`, async () => {
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', sw);
      quiet();
      const db = pre0027(seed());
      const r = await rematchSignals(db as unknown as Db, [8], { now: NOW });
      expect(r.created).toBe(1);
      expect(out(db).PERMIT).toBe(ALERT);
      expect(logged(db)).toEqual(['PERMIT']);
    });
  }
  it('switch on, 0027 applied: a held permit is stored held but NOT handled (as main: the email run stamps it later); the licence is handled', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    quiet();
    const db = new FakeDb(seed());
    await rematchSignals(db as unknown as Db, [7, 8], { now: NOW });
    expect(out(db).PERMIT).toBe('background notified=false pushed=null');
    expect(out(db).LIC).toBe(HELD);
    expect(logged(db)).toEqual([]);
  });
  it('switch off, 0027 applied: a held permit and the licence are stored as on main (notified = quiet only)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    quiet();
    const db = new FakeDb(seed());
    await rematchSignals(db as unknown as Db, [7, 8], { now: NOW });
    expect(out(db).PERMIT).toBe('background notified=false pushed=null');
    expect(out(db).LIC).toBe(ALERT);
  });
  for (const sw of ['1', '']) {
    it(`stale schema cache (write naming alert_hold fails), switch ${sw ? 'on' : 'off'}: the permit is a plain alert and logged; only the licence stays handled (switch on)`, async () => {
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', sw);
      quiet();
      const db = staleCache(seed());
      await rematchSignals(db as unknown as Db, [7, 8], { now: NOW });
      const got = out(db);
      expect(got.PERMIT).toBe(ALERT);
      expect(got.LIC).toBe(sw ? HANDLED_NO_COLUMN : ALERT);
      expect(logged(db)).toEqual(sw ? ['PERMIT'] : ['LIC', 'PERMIT']);
    });
  }

  // insertMatches and upsertMatchRows with a mixed held group: a licence and a permit.
  const ERR = STALE;
  function client() {
    const sent: Record<string, unknown>[][] = [];
    const db = {
      from: () => {
        let rows: Record<string, unknown>[] = [];
        const q: Record<string, unknown> = {};
        q.upsert = (r: Record<string, unknown>[]) => ((rows = r), sent.push(r), q);
        q.select = () => q;
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(rows.some((r) => 'alert_hold' in r) ? { data: null, error: ERR } : { data: rows.map((_, i) => ({ id: i + 1 })), error: null }).then(res);
        return q;
      },
    };
    return { db: db as unknown as Db, sent };
  }
  const stamp = '2026-11-20T12:00:00.000Z';
  const heldRows = () => [
    { user_id: 'm1', signal_id: 7, distance_mi: 1, alert_hold: 'background' as const, notified: true, pushed_at: stamp },
    { user_id: 'm1', signal_id: 8, distance_mi: 1, alert_hold: 'background' as const, notified: true, pushed_at: stamp },
  ];
  it('insertMatches, switch on: the retry keeps notified and pushed_at only on the licence row; the permit row is retried as a plain alert; separate upserts', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const c = client();
    const rows = heldRows();
    const n = await insertMatches(c.db, rows as any, { licenceIds: new Set([7]) });
    expect(n).toBe(2);
    // first the failed send with both, then the licence alone (handled, no hold key), then the permit alone (plain).
    expect(c.sent[1]).toEqual([{ user_id: 'm1', signal_id: 7, distance_mi: 1, notified: true, pushed_at: stamp }]);
    expect(c.sent[2]).toEqual([{ user_id: 'm1', signal_id: 8, distance_mi: 1 }]);
    // the caller's rows: the licence keeps its hold (not logged as an alert), the permit loses it (logged as the alert it is)
    expect(rows[0]).toHaveProperty('alert_hold', 'background');
    expect(rows[1]).not.toHaveProperty('alert_hold');
  });
  it('insertMatches, switch on, only licences held: one retry, handled, caller rows keep the hold', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const c = client();
    const rows = heldRows().slice(0, 1);
    await insertMatches(c.db, rows as any, { licenceIds: new Set([7]) });
    expect(c.sent).toHaveLength(2);
    expect(c.sent[1]).toEqual([{ user_id: 'm1', signal_id: 7, distance_mi: 1, notified: true, pushed_at: stamp }]);
    expect(rows[0]).toHaveProperty('alert_hold', 'background');
  });
  it('insertMatches, switch on, no licence ids given: every held row is retried as a plain alert (as before round 33)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const c = client();
    const rows = heldRows();
    await insertMatches(c.db, rows as any);
    expect(c.sent[1]).toEqual([{ user_id: 'm1', signal_id: 7, distance_mi: 1 }, { user_id: 'm1', signal_id: 8, distance_mi: 1 }]);
    expect(rows.some((r) => 'alert_hold' in r)).toBe(false);
  });
  it('insertMatches, switch off: licence ids are ignored; one plain retry of the whole held group, as before round 33', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    const c = client();
    const rows = heldRows();
    await insertMatches(c.db, rows as any, { licenceIds: new Set([7]) });
    expect(c.sent).toHaveLength(2);
    expect(c.sent[1]).toEqual([{ user_id: 'm1', signal_id: 7, distance_mi: 1 }, { user_id: 'm1', signal_id: 8, distance_mi: 1 }]);
    expect(rows.some((r) => 'alert_hold' in r || 'notified' in r || 'pushed_at' in r)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P3: lib/signals/quiet-matches.ts (the retry keeps the licence hold in the caller rows)', () => {
  function client() {
    const sent: Record<string, unknown>[][] = [];
    const db = {
      from: () => {
        let rows: Record<string, unknown>[] = [];
        const q: Record<string, unknown> = {};
        q.upsert = (r: Record<string, unknown>[]) => ((rows = r), sent.push(r), q);
        q.select = () => q;
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(rows.some((r) => 'alert_hold' in r) ? { data: null, error: STALE } : { data: rows.map((_, i) => ({ id: i + 1 })), error: null }).then(res);
        return q;
      },
    };
    return { db: db as unknown as Db, sent };
  }
  const mk = () => [
    { user_id: 'm1', signal_id: 7, distance_mi: null, notified: true, pushed_at: 'x', alert_hold: 'background' as const },
    { user_id: 'm1', signal_id: 8, distance_mi: null, notified: false, pushed_at: null, alert_hold: 'background' as const },
  ];
  it('switch on: the stored rows lose the hold key and keep notified and pushed_at; the caller keeps the hold on the licence only (so it is not logged as an alert)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const c = client();
    const rows = mk();
    await upsertMatchRows(c.db, rows, { count: true, licenceIds: new Set([7]) });
    expect(c.sent[1]).toEqual([
      { user_id: 'm1', signal_id: 7, distance_mi: null, notified: true, pushed_at: 'x' },
      { user_id: 'm1', signal_id: 8, distance_mi: null, notified: false, pushed_at: null },
    ]);
    expect(rows[0].alert_hold).toBe('background');
    expect('alert_hold' in rows[1]).toBe(false);
  });
  it('switch off: the caller rows lose the hold too, whatever licence ids are passed (as before round 33)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    const c = client();
    const rows = mk();
    await upsertMatchRows(c.db, rows, { count: true, licenceIds: new Set([7]) });
    expect(rows.some((r) => 'alert_hold' in r)).toBe(false);
  });
  it('switch on, no licence ids (backfill, others): the caller rows lose the hold', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const c = client();
    const rows = mk();
    await upsertMatchRows(c.db, rows, { count: true });
    expect(rows.some((r) => 'alert_hold' in r)).toBe(false);
  });
  it('the rematch of a held licence without the column is not logged as an alert (the line a slip would break)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    quiet();
    const stored = (id: number, ext: string) => ({ id, source: 'socrata-chicago-business', kind: 'civic', external_id: ext, title: 'New business license in Chicago: Retail Food Establishment', summary: 'Retail Food Establishment', categories: TAGS, severity: 1, occurred_at: '2026-11-20T08:00:00Z', expires_at: null, lat: LOC.lat + 0.01, lon: LOC.lon, city: 'Chicago', state: 'IL', data: { subtype: 'business' } });
    const db = pre0027({ holler_profiles: [member], holler_signals: [stored(7, 'NONE'), stored(9, 'BIZ')], holler_matches: [], holler_signal_contacts: [{ signal_id: 9, role: 'business', name: 'Lakeview Pantry LLC', address: null }] });
    await rematchSignals(db as unknown as Db, [7, 9], { now: NOW });
    expect(out(db).NONE).toBe(HANDLED_NO_COLUMN);
    expect(out(db).BIZ).toBe(ALERT);
    expect(logged(db)).toEqual(['BIZ']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P3: lib/signals/run.ts (a scan that carries a stage update while alert_hold is not a column)', () => {
  const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-norfolk-permits')!;
  const NORFOLK = { lat: 36.85, lon: -76.28 };
  const OLD = '2026-06-01T03:00:00.000Z';
  const MORNING = '2026-11-20T03:00:00.000Z';
  const norfolkMember = { user_id: 'm1', categories: ['landscaping', 'security'], lat: NORFOLK.lat, lon: NORFOLK.lon, state: 'VA', radius_mi: 25, subscription_status: 'active', trial_ends_at: '2026-11-01T00:00:00Z' };
  const permitRow = { permit_number: 'R-0', status: 'Final', type: 'Building', work_type: 'New Construction', use_type: 'Single Family Dwelling', issue_date: '2026-06-01T00:00:00.000', address: '100 EXAMPLE AVE', latitude: String(NORFOLK.lat), longitude: String(NORFOLK.lon), ':created_at': OLD, ':updated_at': MORNING };
  const portal = (async (url: string) => {
    const u = decodeURIComponent(String(url)).replace(/\+/g, ' ');
    const where = new URL(u.replace(/ /g, '%20')).searchParams.get('$where') ?? '';
    return new Response(JSON.stringify(where.includes(':updated_at >') ? [permitRow] : []), { status: 200 });
  }) as unknown as typeof fetch;
  const root = { id: 1, source: ds.id, external_id: 'R-0', kind: 'permit', title: 'New construction permit in Norfolk', summary: 'New Construction | 100 OTHER RD', categories: ['general-contractor'], lat: NORFOLK.lat, lon: NORFOLK.lon, state: 'VA', severity: 1, occurred_at: '2026-10-10T00:00:00Z', data: { subtype: 'permit' } };
  const seed = () => ({
    holler_profiles: [norfolkMember],
    holler_signals: [root],
    holler_permit_stages: [{ source: ds.id, permit_id: 'R-0', stage: 'issued', signal_id: 1, emitted: false, first_seen_at: '2026-10-10T00:00:00Z' }],
    holler_project_links: [{ id: 1, project_key: 'k0', source: ds.id, external_id: 'R-0', signal_id: 1, occurred_at: root.occurred_at, root_source: null, root_external_id: null }],
    holler_dedupe_drops: [],
    holler_matches: [{ id: 1, user_id: 'm1', signal_id: 1, notified: true, pushed_at: 'sent', status: 'new' }],
  });
  const licences = () => [lic('NONE', 0.01, { lat: NORFOLK.lat + 0.01, lon: NORFOLK.lon, state: 'VA' }), lic('BIZ', 0.02, { lat: NORFOLK.lat + 0.02, lon: NORFOLK.lon, state: 'VA', ...named })];
  const run = (db: FakeDb) => runScan({ now: NOW, adapters: [buildSocrataAdapter(ds), adapterOf(licences)], fetchImpl: portal, stageUpdates: true, indexNow: { config: null as never } } as any, db as unknown as Db);

  it('control: the stage update is really in the scan (the root card is re-armed for the member)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    quiet();
    const db = withAlias(new FakeDb(seed()));
    const rep = await run(db);
    expect(rep.error).toBeUndefined();
    expect(db.tables.holler_signals.find((s) => s.id === 1)!.data).toMatchObject({ permitStage: 'finaled', permitStageUpdate: true });
  });
  it('switch on, alert_hold not a column, a stage update in the scan: the licence with no business is still stored handled; the named one alerts', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    quiet();
    const db = withAlias(pre0027(seed()));
    const rep = await run(db);
    expect(rep.error).toBeUndefined();
    expect(db.tables.holler_signals.find((s) => s.id === 1)!.data).toMatchObject({ permitStage: 'finaled' });
    const got = out(db);
    expect(got.NONE).toBe(HANDLED_NO_COLUMN);
    expect(got.BIZ).toBe(ALERT);
    expect(logged(db)).toEqual(['BIZ']);
  });
  it('switch off, alert_hold not a column, a stage update in the scan: both licences are plain alerts, as before', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    quiet();
    const db = withAlias(pre0027(seed()));
    await run(db);
    const got = out(db);
    expect(got.NONE).toBe(ALERT);
    expect(got.BIZ).toBe(ALERT);
  });
});

describe('R35: the licence id set the scan hands to insertMatches (lib/signals/run.ts, the insertMatches call)', () => {
  // Review of PR 22, P3-2. The set must hold new-business licences ONLY. If it held every stored signal, a permit with no contact path would be
  // kept "already handled" on a database that refuses the alert_hold write (0027 applied, PostgREST schema cache not reloaded yet): stored
  // with notified = true, never emailed, and not logged as an alert. On main the permit is a plain alert.
  const permitSig = (externalId: string, over: Partial<SignalInput> = {}): SignalInput => ({
    source: 'arcgis-dekalb-permits', externalId, kind: 'permit', title: 'New home permit in Chicago', summary: 'New Construction | Single Family Dwelling | Issued',
    categories: ['general-contractor', 'real-estate', 'moving'] as any, severity: 1, occurredAt: '2026-11-20T08:00:00Z', lat: LOC.lat + 0.01, lon: LOC.lon, city: 'Chicago', state: 'IL', data: { subtype: 'permit' }, ...over,
  });
  const permitAdapter = (list: () => SignalInput[]): Adapter => ({ ...adapterOf(list), id: 'arcgis-dekalb-permits', label: 'Permits', kind: 'permit' } as Adapter);
  const both = () => [permitSig('PERMIT'), lic('LIC', 0.02)];
  const seed = () => ({ holler_profiles: [{ ...member, categories: ['security', 'landscaping'] }], holler_signal_contacts: [] });
  const run = (db: FakeDb) => scan(db, [adapterOf(both), permitAdapter(both)]);

  it('switch on, schema cache stale: the no-contact permit is stored and logged as a plain alert; only the licence stays handled', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    quiet();
    const db = withAlias(staleCache(seed()));
    const rep = await run(db);
    expect(rep.error).toBeUndefined();
    const got = out(db);
    expect(got.PERMIT).toBe(ALERT);
    expect(got.LIC).toBe(HANDLED_NO_COLUMN);
    expect(logged(db)).toEqual(['PERMIT']);
  });
  it('switch off, schema cache stale: both are plain alerts (as before round 33)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    quiet();
    const db = withAlias(staleCache(seed()));
    await run(db);
    const got = out(db);
    expect(got.PERMIT).toBe(ALERT);
    expect(got.LIC).toBe(ALERT);
  });
});
