// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REV-ROUTES probe 12: where the contact gate is not applied, and how held cards meet the caps.
 *  A. 25 Background cards in one scan leave no room for a real stage update of a card the member holds (room = 25 - this scan's rows).
 *  B. The hourly AI step calls rematchSignals (not quiet) for records whose trades it changed: rows are read back without contacts, so a
 *     permit with no contact path that was cut by the 25 cap as Background comes back as a plain alert (emailed and pushed).
 *  C. A member with no card yet gets a fresh, un-held card on a stage update of a permit with no contact path.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import { rematchSignals } from '@/lib/signals/rematch';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const SRC = 'socrata-norfolk-permits';
const LOC = { lat: 36.85, lon: -76.28 };
const D0 = Date.parse('2026-11-18T09:00:00Z');
const day = (d: number, h: number) => new Date(Date.parse('2026-11-18T00:00:00Z') + d * 86_400_000 + h * 3_600_000);
const member = (id: string, categories: string[]) => ({ user_id: id, categories, lat: LOC.lat, lon: LOC.lon, state: 'VA', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-11-01T00:00:00Z' });
function row(ext: string, i: number, over: Partial<SignalInput> = {}): SignalInput {
  return {
    source: SRC, externalId: ext, kind: 'permit', title: 'New construction permit in Norfolk', summary: `New Construction | ${200 + i * 50} OTHER RD`,
    categories: ['general-contractor'] as any, lat: LOC.lat + i * 0.001, lon: LOC.lon, city: 'Norfolk', state: 'VA', severity: 1,
    occurredAt: new Date(D0).toISOString(), data: { subtype: 'permit' }, permitStage: 'issued', ...over,
  };
}
const NOPATH = 'New Construction | Single Family Dwelling | Issued';
const adapter = (rows: () => SignalInput[]): Adapter => ({ id: SRC, label: SRC, kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.org', stageQuery: true, fetch: async () => rows() } as Adapter);
function defaults(db: FakeDb) {
  for (const m of db.tables.holler_matches ?? []) {
    if (m.status === undefined) m.status = 'new';
    if (m.notified === undefined) m.notified = false;
    if (m.pushed_at === undefined) m.pushed_at = null;
  }
}
async function scan(db: FakeDb, rows: SignalInput[], when: Date) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const rep = await runScan({ now: when, adapters: [adapter(() => rows)], source: SRC, stageUpdates: true } as any, db as unknown as Db);
  for (const s of rep.sources) expect(s.status, `${s.id}: ${s.error}`).not.toBe('error');
  return rep;
}
const fresh = (members: any[]) => new FakeDb({ holler_profiles: members, holler_signals: [], holler_matches: [], holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [], holler_scan_runs: [] });
const ext = (db: FakeDb, id: number) => String(db.tables.holler_signals.find((s) => s.id === id)?.external_id);

describe('REV-ROUTES 12', () => {
  it('A. 25 Background cards in a scan must not take the room of a real stage update', async () => {
    const db = fresh([member('land', ['landscaping'])]);
    await scan(db, [row('A-0', 0)], day(0, 9));
    defaults(db);
    for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: 'sent' });
    const flood = Array.from({ length: 25 }, (_, i) => row(`N-${i}`, 100 + i, { summary: NOPATH, occurredAt: day(2, 1).toISOString() }));
    await scan(db, [...flood, { ...row('A-0', 0), permitStage: 'finaled' as any, stageProbe: true }], day(2, 9));
    defaults(db);
    const mine = db.tables.holler_matches.filter((m) => m.user_id === 'land');
    const held = mine.filter((m) => m.alert_hold === 'background').length;
    const a0 = mine.find((m) => ext(db, m.signal_id) === 'A-0');
    console.log(`A: rows ${mine.length}, Background ${held}, A-0 re-armed for its stage update: ${a0?.notified === false}`);
    expect(held).toBe(25);
    expect(a0?.notified).toBe(false); // REQUIRED: the one real alert of the scan goes out
  });

  it('B. a Background permit cut by the cap comes back through the AI rematch as a plain alert', async () => {
    const db = fresh([member('land', ['landscaping'])]);
    const flood = Array.from({ length: 30 }, (_, i) => row(`N-${i}`, i, { summary: NOPATH }));
    await scan(db, flood, day(0, 10));
    defaults(db);
    expect(db.tables.holler_matches).toHaveLength(25);
    expect(db.tables.holler_matches.every((m) => m.alert_hold === 'background')).toBe(true);
    for (const m of db.tables.holler_matches) Object.assign(m, { notified: true });
    // the hourly AI step re-tagged these records and calls rematchSignals(db, ids) exactly like app/api/cron/ai/route.ts (not quiet)
    const ids = db.tables.holler_signals.map((s) => s.id as number);
    const r = await rematchSignals(db as unknown as Db, ids, { now: day(0, 11) });
    defaults(db);
    const added = db.tables.holler_matches.filter((m) => m.notified === false);
    console.log(`B: rematch created ${r.created}; un-held rows waiting for email and push: ${added.length} (alert_hold: ${JSON.stringify(added.map((m) => m.alert_hold ?? null))})`);
    expect(added.filter((m) => !m.alert_hold)).toHaveLength(0); // REQUIRED: no permit without a contact path is emailed or pushed
  });

  it('C. a member with no card gets a fresh un-held card on a stage update of a no-contact permit', async () => {
    const db = fresh([member('land', ['landscaping'])]);
    await scan(db, [row('B-0', 0, { summary: NOPATH })], day(0, 9));
    defaults(db);
    expect(db.tables.holler_matches[0].alert_hold).toBe('background');
    db.tables.holler_profiles.push(member('late', ['landscaping']));
    await scan(db, [{ ...row('B-0', 0, { summary: NOPATH }), permitStage: 'finaled' as any, stageProbe: true }], day(2, 9));
    defaults(db);
    const late = db.tables.holler_matches.filter((m) => m.user_id === 'late');
    console.log(`C: the late member's rows: ${JSON.stringify(late.map((m) => ({ ext: ext(db, m.signal_id), hold: m.alert_hold ?? null, notified: m.notified })))}`);
    expect(late.filter((m) => !m.alert_hold && m.notified === false)).toHaveLength(0); // REQUIRED by "a permit alert is sent only with a contact path"
  });
});
