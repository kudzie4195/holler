// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REV-ROUTES probe 04: round-17 stage updates meet round-18 held cards. Harness copied from tests/signals/stage-rereview.test.ts.
 * A member holds 10 project cards: 5 alerted (the permit prints a street address), 5 stored feed-only (alert_hold = 'background',
 * no address). All 10 reach Final in one scan. The stage step re-reads the project rows from the database (contact state unknown),
 * so the held cards compete for the 5 places of the day. A re-armed held card is still alert_hold = 'background': the notify cron marks
 * it notified without an email and the push skips it. So every place a held card takes is a stage update nobody ever receives.
 */
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../../ops/fakedb';
import { runScan } from '@/lib/signals/run';
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
    categories: ['general-contractor'] as any, lat: LOC.lat + i * 0.01, lon: LOC.lon, city: 'Norfolk', state: 'VA', severity: 1,
    occurredAt: new Date(D0).toISOString(), data: { subtype: 'permit' }, permitStage: 'issued', ...over,
  };
}
const adapter = (rows: () => SignalInput[]): Adapter => ({ id: SRC, label: SRC, kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.org', stageQuery: true, fetch: async () => rows() } as Adapter);
function defaults(db: FakeDb) {
  for (const m of db.tables.holler_matches ?? []) {
    if (m.status === undefined) m.status = 'new';
    if (m.notified === undefined) m.notified = false;
    if (m.pushed_at === undefined) m.pushed_at = null;
  }
}
async function scan(db: FakeDb, rows: SignalInput[], when: Date) {
  const rep = await runScan({ now: when, adapters: [adapter(() => rows)], source: SRC, stageUpdates: true } as any, db as unknown as Db);
  for (const s of rep.sources) expect(s.status, `${s.id}: ${s.error}`).not.toBe('error');
  return rep;
}

describe('REV-ROUTES 04: a held card must not take a stage-update place', () => {
  it('5 alerted + 5 background cards all reach Final: the 5 alerted cards must get the update', async () => {
    const db = new FakeDb({ holler_profiles: [member('land', ['landscaping'])], holler_signals: [], holler_matches: [], holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [], holler_scan_runs: [] });
    // A-0..4: an address in the summary (alerted). B-0..4: no address, no contact (Background), stored after, so their ids are higher.
    const A = Array.from({ length: 5 }, (_, i) => row(`A-${i}`, i));
    const B = Array.from({ length: 5 }, (_, i) => row(`B-${i}`, 10 + i, { summary: 'New Construction | Single Family Dwelling | Issued' }));
    await scan(db, [...A, ...B], day(0, 9));
    defaults(db);
    const ext = (id: number) => String(db.tables.holler_signals.find((s) => s.id === id)?.external_id);
    const held0 = db.tables.holler_matches.filter((m) => m.alert_hold === 'background').map((m) => ext(m.signal_id)).sort();
    expect(held0).toEqual(['B-0', 'B-1', 'B-2', 'B-3', 'B-4']);
    // the notify and push crons ran: every card is marked as sent or skipped
    for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: m.alert_hold ? null : 'sent' });

    // two days later every permit is Final (status probes of permits already tracked)
    const probes = [...A, ...B].map((r) => ({ ...r, permitStage: 'finaled' as any, stageProbe: true }));
    await scan(db, probes, day(2, 9));
    const rearmed = db.tables.holler_matches.filter((m) => m.notified === false).map((m) => ({ ext: ext(m.signal_id), hold: m.alert_hold ?? null }));
    console.log('re-armed after the stage scan:', JSON.stringify(rearmed));
    const realUpdates = rearmed.filter((r) => !r.hold).length;
    const swallowed = rearmed.filter((r) => r.hold).length;
    console.log(`stage updates that can be sent: ${realUpdates}; places taken by held cards (never emailed, never pushed): ${swallowed}`);
    // REQUIRED: the 5 alertable cards get their update; no held card takes a place.
    expect({ realUpdates, swallowed }).toEqual({ realUpdates: 5, swallowed: 0 });
  });
});
