/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 18 ROUTES review 2 probe (logs/REV2-ROUTES-probe-tests), kept as a permanent regression test (redo 2).
// REV2-ROUTES probe K: migration 0027 NOT applied, stage updates on (0025 applied, HOLLER_STAGE_UPDATES_ENABLED=1). A permit with no
// contact path is stored and sent as a plain alert, as before round 18. Does it still get its stage update, as on the base commit?
// Runs on 8bee203, 3d01b54 and d93f95d. Copy to tests/_rev2/; npx vitest run tests/_rev2/k-stage-before-0027.test.ts --reporter=verbose
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const SRC = 'socrata-norfolk-permits';
const LOC = { lat: 36.85, lon: -76.28 };
const day = (d: number, h: number) => new Date(Date.parse('2026-11-18T00:00:00Z') + d * 86_400_000 + h * 3_600_000);
const member = (id: string) => ({ user_id: id, categories: ['landscaping'], lat: LOC.lat, lon: LOC.lon, state: 'VA', radius_mi: 50, subscription_status: 'active', trial_ends_at: null });
const row = (ext: string, summary: string, over: Partial<SignalInput> = {}): SignalInput => ({ source: SRC, externalId: ext, kind: 'permit', title: 'New construction permit in Norfolk', summary, categories: ['general-contractor'] as any, lat: LOC.lat + 0.001, lon: LOC.lon, city: 'Norfolk', state: 'VA', severity: 1, occurredAt: day(0, 8).toISOString(), data: { subtype: 'permit' }, permitStage: 'issued', ...over });
const adapter = (rows: SignalInput[]): Adapter => ({ id: SRC, label: SRC, kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.org', stageQuery: true, fetch: async () => rows }) as Adapter;
const FAMILIES = [
  { name: 'PostgREST', column: { code: 'PGRST204', message: "Could not find the 'alert_hold' column of 'holler_matches' in the schema cache" }, table: { code: 'PGRST205', message: "Could not find the table 'public.holler_work_profiles' in the schema cache" } },
  { name: 'Postgres', column: { code: '42703', message: 'column holler_matches.alert_hold does not exist' }, table: { code: '42P01', message: 'relation "public.holler_work_profiles" does not exist' } },
];
const failing = (error: unknown) => { const p: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res) : () => p) }); return p; };
function pre0027(seed: Record<string, any[]>, fam: (typeof FAMILIES)[number]) {
  const db = new FakeDb(seed);
  const from = db.from.bind(db);
  (db as any).from = (table: string) => {
    if (table === 'holler_work_profiles') { delete db.tables[table]; return failing(fam.table); }
    const b: any = from(table);
    if (table !== 'holler_matches') return b;
    const upsert = b.upsert.bind(b); b.upsert = (rows: any[], o: any) => (rows.some((r) => 'alert_hold' in r) ? failing(fam.column) : upsert(rows, o));
    const select = b.select.bind(b); b.select = (cols?: string, o?: any) => (typeof cols === 'string' && /alert_hold/.test(cols) ? failing(fam.column) : select(cols, o));
    return b;
  };
  return db;
}
function defaults(db: FakeDb) { for (const m of db.tables.holler_matches ?? []) { if (m.status === undefined) m.status = 'new'; if (m.notified === undefined) m.notified = false; if (m.pushed_at === undefined) m.pushed_at = null; } }
async function scan(db: FakeDb, rows: SignalInput[], when: Date) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const rep = await runScan({ now: when, adapters: [adapter(rows)], source: SRC, stageUpdates: true } as any, db as unknown as Db);
  for (const s of rep.sources) expect(s.status, `${s.id}: ${s.error}`).not.toBe('error');
  defaults(db);
}
const of = (db: FakeDb, ext: string, user: string) => { const s = db.tables.holler_signals.find((x) => x.external_id === ext); return db.tables.holler_matches.find((m) => m.signal_id === s?.id && m.user_id === user); };

for (const fam of FAMILIES) {
  describe(`REV2-ROUTES K: 0027 not applied (${fam.name} codes), stage updates on`, () => {
    it('a permit with no contact path was sent as a plain alert; at Final its holder gets the stage update and a new member gets a card', async () => {
      const rows = [row('NOPATH', 'New Construction | Single Family Dwelling | Issued'), row('ADDR', 'New Construction | 200 OTHER RD', { lat: LOC.lat + 0.002 })];
      const db = pre0027({ holler_profiles: [member('m1')], holler_signals: [], holler_matches: [], holler_signal_contacts: [], holler_alert_log: [], holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [], holler_scan_runs: [] }, fam);
      await scan(db, rows, day(0, 9));
      expect(db.tables.holler_matches.map((m) => m.alert_hold ?? null)).toEqual([null, null]); // both stored as plain alerts
      for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: 'sent' });
      db.tables.holler_profiles.push(member('late'));
      await scan(db, rows.map((r) => ({ ...r, permitStage: 'finaled' as any, stageProbe: true })), day(2, 9));
      const res = { addrRearmed: of(db, 'ADDR', 'm1')?.notified === false, nopathRearmed: of(db, 'NOPATH', 'm1')?.notified === false, lateAddr: !!of(db, 'ADDR', 'late'), lateNopath: !!of(db, 'NOPATH', 'late') };
      console.log(`${fam.name}: ${JSON.stringify(res)}`);
      expect(res.addrRearmed).toBe(true);
      expect(res.lateAddr).toBe(true);
      expect(res.nopathRearmed).toBe(true); // REQUIRED: with 0027 not applied every card goes out as before round 18
      expect(res.lateNopath).toBe(true); // REQUIRED: same
    });
  });
}
