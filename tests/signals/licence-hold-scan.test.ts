/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Round 33, review 2 (P1-1, P1-2): the new-business licence feed-only hold, through the REAL scan (runScan) and the REAL rematch, with
 * holler_matches.alert_hold present (migration 0027) and absent (the live database on 2026-11-25: Postgres 42703). With the switch on, no
 * licence without a named business is ever emailed or pushed: it is stored already handled (notified, pushed_at).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import { rematchSignals } from '@/lib/signals/rematch';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));
const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 41.88, lon: -87.63 };
const member = { user_id: 'm1', categories: ['security'], lat: LOC.lat, lon: LOC.lon, state: 'IL', radius_mi: 25, subscription_status: 'active', trial_ends_at: null };
const TAGS = ['signs-printing', 'janitorial-commercial', 'security', 'pest-control'];
const lic = (externalId: string, over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'socrata-chicago-business', externalId, kind: 'civic', title: 'New business license in Chicago: Retail Food Establishment', summary: 'Retail Food Establishment',
  categories: TAGS as any, severity: 1, occurredAt: '2026-11-20T08:00:00Z', lat: LOC.lat + 0.01, lon: LOC.lon, city: 'Chicago', state: 'IL', data: { subtype: 'business' }, ...over,
});
const rows = () => [
  lic('NONE'),
  lic('BIZ', { contacts: [{ role: 'business', name: 'Lakeview Pantry LLC' }] as any }),
  lic('SITE', { contacts: [{ role: 'site', name: '', address: '2150 N DAMEN' }] as any }),
  lic('PERSON', { contacts: [{ role: 'business', name: 'John Smith' }] as any }),
];
const ad = (): Adapter => ({ id: 'socrata-chicago-business', label: 'Chicago licences', kind: 'civic', cadenceMinutes: 60, sourceUrl: 'https://example.com', fetch: async () => rows() } as Adapter);
const failing = (error: unknown) => {
  const p: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res) : () => p) });
  return p;
};
const COL = { code: '42703', message: 'column holler_matches.alert_hold does not exist' };
/** FakeDb as the LIVE database is today (read-only information_schema, 2026-11-25): holler_matches has no alert_hold column. */
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
    const update = b.update.bind(b);
    b.update = (patch: any) => ('alert_hold' in patch ? failing(COL) : update(patch));
    return b;
  };
  return db;
}
/** The real API answers the select alias `subtype:data->>subtype` (lib/signals/store.ts:166); FakeDb ignores select columns, so add it at upsert. */
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

afterEach(() => vi.unstubAllEnvs());
const quiet = () => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); };
const HELD = 'background notified=true pushed=set';
const ALERT = 'ALERT notified=false pushed=null';
/** Without the column the hold reason cannot be stored; the match is still already handled, so it is never emailed or pushed. */
const HANDLED_NO_COLUMN = 'ALERT notified=true pushed=set';
/** What an email or push run would read: a match not yet notified, or never pushed. */
const sendable = (db: FakeDb) => (db.tables.holler_matches ?? []).filter((m) => m.notified !== true || !m.pushed_at).length;

describe('licence hold through the real scan', () => {
  for (const mig of ['0027 applied', '0027 NOT applied']) {
    it(`switch on, ${mig}: only the row with a named business is an alert; nothing else can be emailed or pushed`, async () => {
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
      quiet();
      const db = withAlias(mig === '0027 applied' ? new FakeDb({ holler_profiles: [member] }) : pre0027({ holler_profiles: [member] }));
      const a = ad();
      const rep = await runScan({ now: NOW, adapters: [a], source: a.id, indexNow: { config: null as never } } as any, db as unknown as Db);
      expect(rep.error).toBeUndefined();
      const got = out(db);
      expect(got.BIZ).toBe(ALERT);
      for (const k of ['NONE', 'SITE', 'PERSON']) expect(got[k], k).toBe(mig === '0027 applied' ? HELD : HANDLED_NO_COLUMN);
      expect(sendable(db)).toBe(1);
      // The hold column is written only when it exists.
      const hasCol = (db.tables.holler_matches ?? []).some((m) => 'alert_hold' in m);
      expect(hasCol).toBe(mig === '0027 applied');
    });
    it(`switch off, ${mig}: every licence is a plain alert, as before`, async () => {
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
      quiet();
      const db = withAlias(mig === '0027 applied' ? new FakeDb({ holler_profiles: [member] }) : pre0027({ holler_profiles: [member] }));
      const a = ad();
      const rep = await runScan({ now: NOW, adapters: [a], source: a.id, indexNow: { config: null as never } } as any, db as unknown as Db);
      expect(rep.error).toBeUndefined();
      expect(Object.values(out(db))).toEqual([ALERT, ALERT, ALERT, ALERT]);
    });
  }
});

describe('licence hold through the rematch (the AI step\'s path)', () => {
  const stored = (name: string) => ({ id: 7, source: 'socrata-chicago-business', kind: 'civic', external_id: name, title: 'New business license in Chicago: Retail Food Establishment', summary: 'Retail Food Establishment', categories: TAGS, severity: 1, occurred_at: '2026-11-20T08:00:00Z', expires_at: null, lat: LOC.lat + 0.01, lon: LOC.lon, city: 'Chicago', state: 'IL', data: { subtype: 'business' } });
  for (const mig of ['0027 applied', '0027 NOT applied']) {
    it(`switch on, ${mig}: a stored licence with no contact is matched already handled (no email, no push)`, async () => {
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
      quiet();
      const seed = { holler_profiles: [member], holler_signals: [stored('NONE')], holler_matches: [], holler_signal_contacts: [] };
      const db = mig === '0027 applied' ? new FakeDb(seed) : pre0027(seed);
      const r = await rematchSignals(db as unknown as Db, [7], { now: NOW });
      expect(r.error).toBeUndefined();
      expect(r.created).toBe(1);
      expect(out(db).NONE).toBe(mig === '0027 applied' ? HELD : HANDLED_NO_COLUMN);
      expect(sendable(db)).toBe(0);
    });
    it(`switch on, ${mig}: a stored licence with a named business is still an alert`, async () => {
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
      quiet();
      const seed = { holler_profiles: [member], holler_signals: [stored('BIZ')], holler_matches: [], holler_signal_contacts: [{ signal_id: 7, role: 'business', name: 'Lakeview Pantry LLC', address: null }] };
      const db = mig === '0027 applied' ? new FakeDb(seed) : pre0027(seed);
      await rematchSignals(db as unknown as Db, [7], { now: NOW });
      expect(out(db).BIZ).toBe(ALERT);
    });
  }
  it('switch on: a failed contacts read holds the licence (never unknown)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    quiet();
    const db = new FakeDb({ holler_profiles: [member], holler_signals: [stored('NONE')], holler_matches: [], holler_signal_contacts: [{ signal_id: 7, role: 'business', name: 'Lakeview Pantry LLC', address: null }] });
    const from = db.from.bind(db);
    (db as any).from = (t: string) => (t === 'holler_signal_contacts' ? failing({ message: 'boom' }) : from(t));
    await rematchSignals(db as unknown as Db, [7], { now: NOW });
    expect(out(db).NONE).toBe(HELD);
  });
  it('switch off: the rematch sends the licence as before (plain alert)', async () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    quiet();
    const db = new FakeDb({ holler_profiles: [member], holler_signals: [stored('NONE')], holler_matches: [], holler_signal_contacts: [] });
    await rematchSignals(db as unknown as Db, [7], { now: NOW });
    expect(out(db).NONE).toBe(ALERT);
  });
});
