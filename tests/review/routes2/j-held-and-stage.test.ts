/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 18 ROUTES review 2 probe (logs/REV2-ROUTES-probe-tests), kept as a permanent regression test (redo 2).
// REV2-ROUTES probe J: held cards and stage updates, through the real runScan on a fake database.
// Copy to tests/_rev2/ in a clone at d93f95d; npx vitest run tests/_rev2/j-held-and-stage.test.ts --reporter=verbose
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { holdOf, shownHold } from '@/lib/signals/alert-gate';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const dekalb = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;
const LOC = { x: -84.23, y: 33.79 };
const day = (d: number, h: number) => new Date(Date.parse('2026-11-18T00:00:00Z') + d * 86_400_000 + h * 3_600_000);
const feature = (id: string, attrs: Record<string, unknown>) => ({ attributes: { applicationNumber: id, issuedDateTime: day(0, 8).getTime(), workType: 'D-NEW', WorkTypeDescription: 'New Construction', OccupancyTypeDescription: 'Single Family Dwelling', statusDescription: 'Issued', ...attrs }, geometry: LOC });
const parse = (...f: any[]) => parseArcgis({ features: f }, dekalb).map((s) => ({ ...s, permitStage: 'issued' as any }));
const member = (id: string, over: any = {}) => ({ user_id: id, categories: ['landscaping'], lat: LOC.y, lon: LOC.x, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: null, ...over });
const adapter = (rows: SignalInput[]): Adapter => ({ id: dekalb.id, label: 'x', kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.org', stageQuery: true, fetch: async () => rows }) as Adapter;
const fresh = (members: any[], extra: Record<string, any[]> = {}) => new FakeDb({ holler_profiles: members, holler_signals: [], holler_matches: [], holler_signal_contacts: [], holler_alert_log: [], holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [], holler_scan_runs: [], ...extra });
function defaults(db: FakeDb) { for (const m of db.tables.holler_matches ?? []) { if (m.status === undefined) m.status = 'new'; if (m.notified === undefined) m.notified = false; if (m.pushed_at === undefined) m.pushed_at = null; } }
async function scan(db: FakeDb, rows: SignalInput[], when: Date) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const rep = await runScan({ now: when, adapters: [adapter(rows)], source: dekalb.id, stageUpdates: true } as any, db as unknown as Db);
  for (const s of rep.sources) expect(s.status, `${s.id}: ${s.error}`).not.toBe('error');
  defaults(db);
}
const sent = (db: FakeDb) => { for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: 'sent' }); };
const finaled = (rows: SignalInput[]) => rows.map((r) => ({ ...r, permitStage: 'finaled' as any, stageProbe: true }));
const rowOf = (db: FakeDb, ext: string, user = 'm1') => { const s = db.tables.holler_signals.find((x) => x.external_id === ext); return db.tables.holler_matches.find((m) => m.signal_id === s?.id && m.user_id === user); };

describe('REV2-ROUTES J', () => {
  it('1. redo 2 (decision 2): a site the card cannot show is no contact path; the card is held on every path, and an alerted card gets its stage update', async () => {
    // GATE: DeKalb's locationLine1 holds a street the stored-contact cleaner refuses, so no site row is stored and the card shows none.
    // SITE: a street the cleaner keeps: a site row is stored and shown on the card.
    const rows = parse(feature('GATE', { locationLine1: '2300 NANCY CREEK NW' }), feature('SITE', { locationLine1: '4415 CANDLER RD' }));
    const db = fresh([member('m1')]);
    await scan(db, rows, day(0, 9));
    expect(holdOf(rowOf(db, 'GATE'))).toBe('background');
    expect(holdOf(rowOf(db, 'SITE'))).toBeNull();
    expect(db.tables.holler_signal_contacts.map((c: any) => c.address)).toEqual(['4415 CANDLER RD']);
    sent(db);
    await scan(db, finaled(rows), day(2, 9));
    expect(rowOf(db, 'SITE')?.notified).toBe(false); // the alerted card gets its stage update
    expect(rowOf(db, 'GATE')?.notified).toBe(true); // the held card never takes a place and is never sent
  });

  it('2. a held card whose permit gets a business contact later: what happens', async () => {
    const rows = parse(feature('LATE', {}));
    const db = fresh([member('m1')]);
    await scan(db, rows, day(0, 9));
    const m = rowOf(db, 'LATE')!;
    expect(m.alert_hold).toBe('background');
    sent(db); // the notify cron marks a held row notified without an email
    // a contact is attached one hour later (no code in the repo does this today; contacts are written once, at insert)
    db.tables.holler_signal_contacts.push({ signal_id: m.signal_id, role: 'contractor', name: 'Peach Builders LLC', address: '' });
    await scan(db, parse(feature('LATE', {})), day(0, 10)); // a later scan of the same record
    const after = rowOf(db, 'LATE')!;
    const feed = shownHold(holdOf(after), db.tables.holler_signal_contacts as any, db.tables.holler_signals[0].summary);
    console.log(`one hour later, same record scanned again: stored hold=${after.alert_hold}, notified=${after.notified}, pushed_at=${after.pushed_at}; chip the feed shows: ${feed ?? 'none (reads as a normal Coming soon card)'}`);
    await scan(db, finaled(rows), day(2, 9));
    const fin = rowOf(db, 'LATE')!;
    console.log(`two days later the permit reaches Final: stored hold=${fin.alert_hold}, re-armed=${fin.notified === false}; alert log rows for it: ${(db.tables.holler_alert_log ?? []).filter((a) => a.signal_id === m.signal_id).length}`);
    expect(fin.alert_hold).toBe('background'); // never released
    expect(fin.notified).toBe(true); // never re-armed, never sent
  });

  it('3. a below-minimum card, the member then clears the minimum, the permit reaches Final: not re-armed', async () => {
    const rows = parse(feature('MIN', { locationLine1: '4415 CANDLER RD' })).map((r) => ({ ...r, data: { ...(r.data ?? {}), jobValue: 1200 } }));
    const db = fresh([member('m1')], { holler_work_profiles: [{ user_id: 'm1', work_property: 'both', work_min_value: 5000, work_type: 'both' }] });
    await scan(db, rows, day(0, 9));
    console.log(`first scan: hold=${rowOf(db, 'MIN')?.alert_hold ?? null}`);
    expect(rowOf(db, 'MIN')?.alert_hold).toBe('below_min');
    sent(db);
    db.tables.holler_work_profiles[0].work_min_value = null;
    await scan(db, finaled(rows), day(2, 9));
    console.log(`after the minimum is cleared and the permit reaches Final: hold=${rowOf(db, 'MIN')?.alert_hold}, re-armed=${rowOf(db, 'MIN')?.notified === false}`);
    expect(rowOf(db, 'MIN')?.notified).toBe(true);
  });
});
