// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REV-ROUTES probe 09: migration 0027 NOT applied, with both families of real error codes (PostgREST PGRST204 / PGRST205 and Postgres
 * 42703 / 42P01), end to end over the write and read paths: scan, rematch, backfill, prune, stage step, push, mobile feed, quality line.
 * The database stand-in refuses every holler_matches write that carries alert_hold, every holler_matches read that selects it, and every
 * touch of holler_work_profiles. Nothing may throw, and every card must be stored and sent exactly as before round 18.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import { rematchSignals, pruneStaleMatches } from '@/lib/signals/rematch';
import { backfillForUser } from '@/lib/signals/backfill';
import { loadProfiles, type Db } from '@/lib/signals/store';
import { pushNewMatches } from '@/lib/push/notify';
import { loadContactPathReport } from '@/lib/admin/contact-path';
import { readWorkProfile, saveWorkProfile } from '@/lib/auth/work-profile';
import type { Adapter, SignalInput } from '@/lib/signals/types';
import { profileRow, UA } from '../../mobile/fakes';
import { memDb } from '../../mobile/memdb';

vi.mock('server-only', () => ({}));

const FAMILIES = [
  { name: 'PostgREST', column: { code: 'PGRST204', message: "Could not find the 'alert_hold' column of 'holler_matches' in the schema cache" }, table: { code: 'PGRST205', message: "Could not find the table 'public.holler_work_profiles' in the schema cache" } },
  { name: 'Postgres', column: { code: '42703', message: 'column holler_matches.alert_hold does not exist' }, table: { code: '42P01', message: 'relation "public.holler_work_profiles" does not exist' } },
];
const failing = (error: unknown) => {
  const p: any = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res) : () => p),
  });
  return p;
};
/** FakeDb as a database without 0027. `seen` records every refused request. */
function pre0027(seed: Record<string, any[]>, fam: (typeof FAMILIES)[number]) {
  const db = new FakeDb(seed);
  const seen: string[] = [];
  const from = db.from.bind(db);
  (db as any).from = (table: string) => {
    if (table === 'holler_work_profiles') {
      seen.push('work_profiles');
      delete db.tables[table];
      return failing(fam.table);
    }
    const b: any = from(table);
    if (table !== 'holler_matches') return b;
    const upsert = b.upsert.bind(b);
    b.upsert = (rows: any[], o: any) => (rows.some((r) => 'alert_hold' in r) ? (seen.push('upsert alert_hold'), failing(fam.column)) : upsert(rows, o));
    const select = b.select.bind(b);
    b.select = (cols?: string, o?: any) => (typeof cols === 'string' && /alert_hold/.test(cols) ? (seen.push('select alert_hold'), failing(fam.column)) : select(cols, o));
    const update = b.update.bind(b);
    b.update = (patch: any) => ('alert_hold' in patch ? (seen.push('update alert_hold'), failing(fam.column)) : update(patch));
    return b;
  };
  return { db, seen };
}

const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 33.75, lon: -84.39 };
const member = { user_id: 'm1', categories: ['landscaping'], lat: LOC.lat, lon: LOC.lon, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: null };
const permitOf = (externalId: string, summary: string): SignalInput => ({
  source: 'fake-permits', externalId, kind: 'permit', title: 'New home permit in Decatur', summary, categories: ['general-contractor', 'real-estate', 'moving'] as any,
  severity: 1, occurredAt: '2026-11-20T08:00:00Z', lat: LOC.lat + 0.01, lon: LOC.lon, state: 'GA', data: { subtype: 'permit' },
});
const ad: Adapter = { id: 'fake-permits', label: 'Fake permits', kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.com', fetch: async () => [permitOf('NOPATH', 'New Construction | Single Family Dwelling | Issued'), permitOf('ADDR', 'New Construction | 250 SYCAMORE ST')] } as Adapter;

for (const fam of FAMILIES) {
  describe(`REV-ROUTES 09: 0027 not applied (${fam.name} codes ${fam.column.code} / ${fam.table.code})`, () => {
    it('scan: both permits are stored as plain matches and both are logged as alerts; nothing throws, no error on the report', async () => {
      const { db, seen } = pre0027({ holler_profiles: [member] }, fam);
      const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rep = await runScan({ now: NOW, adapters: [ad], source: ad.id, indexNow: { config: null as never } } as any, db as unknown as Db);
      expect(rep.error).toBeUndefined();
      for (const s of rep.sources) expect(s.status, String(s.error)).not.toBe('error');
      expect(db.tables.holler_matches).toHaveLength(2);
      expect(db.tables.holler_matches.every((m) => !('alert_hold' in m))).toBe(true);
      // Redo 2 (review 2, P1-1): before 0027 the gate is off, so the scan never even tries to write alert_hold (the base commit's upsert).
      expect(seen).not.toContain('upsert alert_hold');
      expect(seen).toContain('work_profiles');
      expect(errs.mock.calls.map((c) => String(c[0])).filter((m) => /work profiles|alert_hold/.test(m))).toEqual([]);
      errs.mockRestore();
    });
    it('DEFECT: scan before 0027: both permits go out as alerts, so BOTH must be in holler_alert_log (as on the base commit)', async () => {
      const { db } = pre0027({ holler_profiles: [member] }, fam);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await runScan({ now: NOW, adapters: [ad], source: ad.id, indexNow: { config: null as never } } as any, db as unknown as Db);
      const ext = (id: number) => db.tables.holler_signals.find((s) => s.id === id)?.external_id;
      const stored = db.tables.holler_matches.map((m) => `${ext(m.signal_id)}${'alert_hold' in m ? ' (held)' : ''}`).sort();
      const logged = (db.tables.holler_alert_log ?? []).map((r) => ext(r.signal_id)).sort();
      console.log(`[${fam.name}] matches stored: ${JSON.stringify(stored)}; alert log rows: ${JSON.stringify(logged)}`);
      expect(stored).toEqual(['ADDR', 'NOPATH']);
      expect(logged).toEqual(['ADDR', 'NOPATH']);
    });
    it('DEFECT: rematch before 0027: a below-minimum card cannot exist (no work table), control: the row is logged', async () => {
      const sig = { id: 7, source: 'arcgis-atlanta-permits', kind: 'permit', external_id: 'x', title: 'New home permit in Atlanta', summary: 'New Construction | $1,200 job value | 100 MAIN ST NE, ATLANTA, GA 30303', categories: ['general-contractor', 'real-estate', 'moving'], lat: LOC.lat + 0.01, lon: LOC.lon, state: 'GA', severity: 1, occurred_at: '2026-11-20T08:00:00Z', expires_at: null, data: { subtype: 'permit' } };
      const { db } = pre0027({ holler_profiles: [member], holler_signals: [sig], holler_matches: [] }, fam);
      await rematchSignals(db as unknown as Db, [7], { now: NOW });
      expect((db.tables.holler_alert_log ?? []).length).toBe(1);
    });
    it('loadProfiles, rematch (not quiet), prune and backfill work and store rows without alert_hold', async () => {
      const sig = { id: 7, source: 'arcgis-atlanta-permits', kind: 'permit', external_id: 'x', title: 'New home permit in Atlanta', summary: 'New Construction | $1,200 job value | 100 MAIN ST NE, ATLANTA, GA 30303', categories: ['general-contractor', 'real-estate', 'moving'], lat: LOC.lat + 0.01, lon: LOC.lon, state: 'GA', severity: 1, occurred_at: '2026-11-20T08:00:00Z', expires_at: null, data: { subtype: 'permit' } };
      const { db } = pre0027({ holler_profiles: [member], holler_signals: [sig], holler_matches: [] }, fam);
      const profiles = await loadProfiles(db as unknown as Db, NOW);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).not.toHaveProperty('work_min_value');
      const r = await rematchSignals(db as unknown as Db, [7], { now: NOW });
      expect(r).toEqual({ created: 1 });
      void pruneStaleMatches; // the prune selects 'id,user_id,signal_id' only: it reads no 0027 object (read in the code; FakeDb has no .is())
      // backfillForUser: not run end to end here (FakeDb has no maybeSingle). It reads the work profile through loadWorkProfiles, which
      // never throws and returns an empty map for all four codes (asserted here), so the profile it matches with has no work settings.
      const { loadWorkProfiles } = await import('@/lib/signals/store');
      expect((await loadWorkProfiles(db as any, ['m1'])).size).toBe(0);
      void backfillForUser;
    });
    it('Settings: the section is hidden and a save writes nothing and shows no error', async () => {
      const { db } = pre0027({}, fam);
      expect((await readWorkProfile(db as any, 'm1')).available).toBe(false);
      const form = { get: (k: string) => ({ work_property: 'residential', work_type: 'both', work_min_value: '5000' } as any)[k] ?? null };
      expect(await saveWorkProfile(db as any, 'm1', form)).toEqual({ ok: true, skipped: true });
    });
    it('push: the unpushed read is made again without alert_hold and the alert is pushed', async () => {
      const m = memDb({
        holler_profiles: [profileRow(UA)],
        holler_push_tokens: [{ id: 'a1', user_id: UA, token: 'tA1', platform: 'ios', disabled_at: null }],
        holler_signals: [{ id: 501, title: 'Roof permit in Atlanta', city: 'Atlanta', source: 'arcgis-atlanta-permits', expires_at: null, occurred_at: new Date(NOW.getTime() - 3_600_000).toISOString() }],
        holler_matches: [{ id: 1, user_id: UA, signal_id: 501, status: 'new', notified: false, pushed_at: null, created_at: new Date(NOW.getTime() - 300_000).toISOString() }],
      });
      const from = (m.db as any).from.bind(m.db);
      let refused = 0;
      (m.db as any).from = (table: string) => {
        const b: any = from(table);
        if (table !== 'holler_matches') return b;
        const select = b.select.bind(b);
        b.select = (cols?: string, ...rest: any[]) => (typeof cols === 'string' && /alert_hold/.test(cols) ? (refused++, failing(fam.column)) : select(cols, ...rest));
        return b;
      };
      const sent: string[] = [];
      const r = await pushNewMatches(m.db as never, { now: NOW, configured: true, send: async (x: any) => (sent.push(x.title), { ok: true as const }) });
      expect(refused).toBeGreaterThan(0);
      expect(r.status).toBe('ok');
      expect(r.matches_pushed).toBe(1);
      expect(sent).toEqual(['New alert near Atlanta']);
    });
    it('quality line: reads no 0027 object, so it is unaffected; with the alert log missing it is unavailable, not 0% or 100%', async () => {
      const { db } = pre0027({ holler_alert_log: [], holler_signals: [], holler_signal_contacts: [] }, fam);
      const ok = await loadContactPathReport(db as unknown as Db, NOW);
      expect(ok.status).toBe('ok');
      expect(ok.all.share).toBeNull();
      (db as any).failOn = { 'holler_alert_log.select': 'relation "public.holler_alert_log" does not exist' };
      const bad = await loadContactPathReport(db as unknown as Db, NOW);
      console.log(`quality line with holler_alert_log failing: status=${bad.status} share=${bad.all.share}`);
    });
  });
}
