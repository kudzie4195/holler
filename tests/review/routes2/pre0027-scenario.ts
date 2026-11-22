/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 18 ROUTES redo 2 (review 2, P1-1): one scan scenario run with migration 0027 NOT applied, for the base-equivalence test. The same
// file was run on the base commit 8bee203 to record base-8bee203.json (what was stored, sent and logged there). Not a test file itself.
import { vi } from 'vitest';
import { FakeDb } from '../../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const SRC = 'socrata-norfolk-permits';
const LOC = { lat: 36.85, lon: -76.28 };
const day = (d: number, h: number) => new Date(Date.parse('2026-11-18T00:00:00Z') + d * 86_400_000 + h * 3_600_000);
const member = (id: string, categories: string[]) => ({ user_id: id, categories, lat: LOC.lat, lon: LOC.lon, state: 'VA', radius_mi: 50, subscription_status: 'active', trial_ends_at: null });
const row = (ext: string, summary: string, i: number, over: Partial<SignalInput> = {}): SignalInput => ({
  source: SRC, externalId: ext, kind: 'permit', title: 'New construction permit in Norfolk', summary, categories: ['general-contractor'] as any,
  lat: LOC.lat + i * 0.0005, lon: LOC.lon, city: 'Norfolk', state: 'VA', severity: 1, occurredAt: day(0, 8).toISOString(), data: { subtype: 'permit' }, permitStage: 'issued', ...over,
});
const adapter = (rows: SignalInput[]): Adapter => ({ id: SRC, label: SRC, kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.org', stageQuery: true, fetch: async () => rows }) as Adapter;

export const FAMILIES = [
  { name: 'PostgREST', column: { code: 'PGRST204', message: "Could not find the 'alert_hold' column of 'holler_matches' in the schema cache" }, table: { code: 'PGRST205', message: "Could not find the table 'public.holler_work_profiles' in the schema cache" } },
  { name: 'Postgres', column: { code: '42703', message: 'column holler_matches.alert_hold does not exist' }, table: { code: '42P01', message: 'relation "public.holler_work_profiles" does not exist' } },
] as const;
type Family = (typeof FAMILIES)[number];

const failing = (error: unknown) => {
  const p: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res) : () => p) });
  return p;
};
/** A fake database without migration 0027: the work table and the alert_hold column answer with the family's real error codes. */
function pre0027(seed: Record<string, any[]>, fam: Family) {
  const db = new FakeDb(seed);
  const from = db.from.bind(db);
  (db as any).from = (table: string) => {
    if (table === 'holler_work_profiles') return failing(fam.table);
    const b: any = from(table);
    if (table !== 'holler_matches') return b;
    const upsert = b.upsert.bind(b);
    b.upsert = (rows: any[], o: any) => (rows.some((r) => 'alert_hold' in r) ? failing(fam.column) : upsert(rows, o));
    const select = b.select.bind(b);
    b.select = (cols?: string, o?: any) => (typeof cols === 'string' && /alert_hold/.test(cols) ? failing(fam.column) : select(cols, o));
    return b;
  };
  return db;
}
function defaults(db: FakeDb) {
  for (const m of db.tables.holler_matches ?? []) {
    if (m.status === undefined) m.status = 'new';
    if (m.notified === undefined) m.notified = false;
    if (m.pushed_at === undefined) m.pushed_at = null;
  }
}

/**
 * 30 permits for two members (20 print no address and name no business, 10 print an address; one names a contractor), more than the
 * 25-card cap, so a gate that ranked held cards lower would change WHICH 25 are kept. Then the notify and push runs are simulated, a third
 * member joins, and (with stage updates on) every permit reaches Final. Returns everything stored, re-armed and logged.
 */
export async function runPre0027Scenario(fam: Family, stageOn: boolean) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The no-path permits come last (highest ids), so on the base commit they win the 5 stage-update places of the day.
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row(`ADDR-${i}`, `New Construction | ${200 + i * 10} OTHER RD`, i)),
    ...Array.from({ length: 20 }, (_, i) => row(`NOPATH-${i}`, 'New Construction | Single Family Dwelling | Issued', 10 + i)),
  ];
  rows[5] = { ...rows[5], contacts: [{ role: 'contractor', name: 'Tidewater Builders LLC' }] };
  const db = pre0027(
    { holler_profiles: [member('m1', ['landscaping']), member('m2', ['moving', 'general-contractor'])], holler_signals: [], holler_matches: [], holler_signal_contacts: [], holler_alert_log: [], holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [], holler_scan_runs: [] },
    fam,
  );
  const scan = async (list: SignalInput[], when: Date) => {
    const rep = await runScan({ now: when, adapters: [adapter(list)], source: SRC, stageUpdates: stageOn } as any, db as unknown as Db);
    for (const s of rep.sources) if (s.status === 'error') throw new Error(`${s.id}: ${s.error}`);
    defaults(db);
  };
  await scan(rows, day(0, 9));
  const ext = (id: number) => String(db.tables.holler_signals.find((s) => s.id === id)?.external_id);
  const snap = () =>
    db.tables.holler_matches
      .map((m) => ({ user: m.user_id, ext: ext(m.signal_id), notified: m.notified ?? false, pushed: m.pushed_at ?? null, keys: Object.keys(m).filter((k) => !['id', 'created_at'].includes(k)).sort().join(',') }))
      .sort((a, b) => (a.user + a.ext < b.user + b.ext ? -1 : 1));
  const afterScan = snap();
  const logged1 = (db.tables.holler_alert_log ?? []).map((r) => `${r.user_id}|${ext(r.signal_id)}`).sort();
  // The notify and push runs send every unsent card.
  const sent = db.tables.holler_matches.filter((m) => m.notified === false).map((m) => `${m.user_id}|${ext(m.signal_id)}`).sort();
  for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: 'sent' });
  db.tables.holler_profiles.push(member('late', ['landscaping']));
  await scan(rows.map((r) => ({ ...r, permitStage: 'finaled' as any, stageProbe: true })), day(2, 9));
  const rearmed = db.tables.holler_matches.filter((m) => m.notified === false).map((m) => `${m.user_id}|${ext(m.signal_id)}`).sort();
  const logged = (db.tables.holler_alert_log ?? []).map((r) => `${r.user_id}|${ext(r.signal_id)}`).sort();
  vi.restoreAllMocks();
  return { afterScan, logged1, sent, rearmed, logged, contacts: (db.tables.holler_signal_contacts ?? []).length };
}
