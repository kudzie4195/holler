/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 17 final review P1-1: the 5-a-day stage-update cap must hold when the stage change arrives on a FOLLOWER permit (the update goes
// to the project's first record). Before the fix the emitted history row named the follower, which has no matches, so a second scan of
// the same UTC day counted 0 updates already sent and sent 5 more. Probe: logs/FINAL-probe-tests/x2-cap.test.ts, kept here as a
// regression test. A Socrata fake applies the stage query's own `:updated_at >` and status like-list. No portal was called.
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import { buildSocrataAdapter } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY } from '@/lib/signals/stage';
import { MAX_MATCHES_PER_USER } from '@/lib/signals/match';

const NOW = new Date('2026-11-20T10:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-norfolk-permits')!;
const LOC = { lat: 36.85, lon: -76.28 };
const member = (id: string, categories: string[]) => ({ user_id: id, categories, lat: LOC.lat, lon: LOC.lon, state: 'VA', radius_mi: 25, subscription_status: 'active', trial_ends_at: '2026-11-01T00:00:00Z' });
const OLD = '2026-06-01T03:00:00.000Z';
const MORNING = '2026-11-20T03:00:00.000Z';
const AFTERNOON = '2026-11-20T11:00:00.000Z';
type PRow = Record<string, string>;
const permit = (id: string, over: PRow = {}): PRow => ({ permit_number: id, status: 'Issued', type: 'Building', work_type: 'New Construction', use_type: 'Single Family Dwelling', issue_date: '2026-06-01T00:00:00.000', address: '100 EXAMPLE AVE', latitude: String(LOC.lat), longitude: String(LOC.lon), ':created_at': OLD, ':updated_at': OLD, ...over });

/** `stage()` is what the stage query sees at fetch time; `main()` is what the normal (issue date) query returns. */
function portal(stage: () => PRow[], main: () => PRow[] = () => []) {
  return (async (url: string) => {
    const u = decodeURIComponent(String(url)).replace(/\+/g, ' ');
    const where = new URL(u.replace(/ /g, '%20')).searchParams.get('$where') ?? '';
    if (where.includes(':updated_at >')) {
      const after = /:updated_at > '([^']+)'/.exec(where)![1] + 'Z';
      const frags = [...where.matchAll(/like '%([^%]+)%'/g)].map((m) => m[1]);
      return new Response(JSON.stringify(stage().filter((r) => r[':updated_at'] > after && frags.some((f) => r.status.toUpperCase().includes(f)))), { status: 200 });
    }
    return new Response(JSON.stringify(main()), { status: 200 });
  }) as unknown as typeof fetch;
}
const sig = (id: number, ext: string, i: number, data: Record<string, unknown> = {}) => ({ id, source: ds.id, external_id: ext, kind: 'permit', title: 'New construction permit in Norfolk', summary: `New Construction | ${200 + i * 50} OTHER RD`, categories: ['general-contractor'], lat: LOC.lat + i * 0.02, lon: LOC.lon, state: 'VA', severity: 1, occurred_at: '2026-10-10T00:00:00Z', data: { subtype: 'permit', ...data } });
const hist = (s: { external_id: string; id: number }) => ({ source: ds.id, permit_id: s.external_id, stage: 'issued', signal_id: s.id, emitted: false, first_seen_at: '2026-10-10T00:00:00Z' });

/** N projects, each a root record (the card the member holds) plus a follower permit of the same project. */
function seed(N = 10) {
  const roots = Array.from({ length: N }, (_, i) => sig(i + 1, `R-${i}`, i));
  const fols = Array.from({ length: N }, (_, i) => sig(100 + i, `F-${i}`, i, { projectOf: `${ds.id}:R-${i}` }));
  const db = new FakeDb({
    holler_profiles: [member('landscaper', ['landscaping'])],
    holler_signals: [...roots, ...fols],
    holler_permit_stages: [...roots.map(hist), ...fols.map(hist)],
    holler_project_links: [
      ...roots.map((s, i) => ({ id: i + 1, project_key: `k${i}`, source: ds.id, external_id: s.external_id, signal_id: s.id, occurred_at: s.occurred_at, root_source: null, root_external_id: null })),
      ...fols.map((s, i) => ({ id: 50 + i, project_key: `k${i}`, source: ds.id, external_id: s.external_id, signal_id: s.id, occurred_at: s.occurred_at, root_source: ds.id, root_external_id: `R-${i}` })),
    ],
    holler_dedupe_drops: [],
    holler_matches: roots.map((s, i) => ({ id: i + 1, user_id: 'landscaper', signal_id: s.id, notified: true, pushed_at: 'sent', status: 'new' })),
  });
  return { db, roots, fols };
}
const scanAt = (db: FakeDb, f: typeof fetch, h: number) => runScan({ now: at(h), adapters: [buildSocrataAdapter(ds)], source: ds.id, fetchImpl: f, stageUpdates: true } as any, db as unknown as Db);
/** Stage updates sent by the last scan: matches re-armed (an existing card) plus new matches on a stage-updated record. */
const armed = (db: FakeDb) => db.tables.holler_matches.filter((m) => m.user_id === 'landscaper' && m.notified === false && Number(m.id) <= 10).length;
const markSent = (db: FakeDb) => { for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: 'sent' }); };
const finals = (from: number, n: number, prefix: string, when: string) => Array.from({ length: n }, (_, i) => permit(`${prefix}-${from + i}`, { status: 'Final', ':updated_at': when }));

describe('final review P1-1: the 5-a-day stage cap holds for updates that arrive on follower permits', () => {
  it('morning scan 5 follower-driven updates, afternoon scan of the same UTC day 0 more: at most 5 a day in total', async () => {
    expect(MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY).toBe(5);
    const { db } = seed();
    let rows = finals(0, 5, 'F', MORNING);
    const f = portal(() => rows);
    await scanAt(db, f, 0);
    const morning = armed(db);
    markSent(db);
    rows = finals(5, 5, 'F', AFTERNOON);
    await scanAt(db, f, 6);
    const afternoon = armed(db);
    expect(morning).toBe(5);
    expect(afternoon).toBe(0);
    expect(morning + afternoon).toBeLessThanOrEqual(MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY);
  });

  it('an emitted history row names the record that got the update (the root), a non-emitted row names the permit itself', async () => {
    const { db } = seed(2);
    const f = portal(() => finals(0, 1, 'F', MORNING));
    await scanAt(db, f, 0);
    const row = db.tables.holler_permit_stages.find((r) => r.permit_id === 'F-0' && r.stage === 'finaled')!;
    expect(row).toMatchObject({ emitted: true, signal_id: 1 });
    // The root record carries the update; the follower is untouched and gets no card.
    expect(db.tables.holler_signals.find((s) => s.id === 1)!.data).toMatchObject({ permitStage: 'finaled', permitStageUpdate: true });
    expect(db.tables.holler_matches.filter((m) => m.signal_id === 100)).toHaveLength(0);
    // The root's own later status change is not a second update of the project: its row is not emitted and names the root itself.
    await scanAt(db, portal(() => [permit('R-0', { status: 'Final', ':updated_at': AFTERNOON })]), 6);
    const own = db.tables.holler_permit_stages.find((r) => r.permit_id === 'R-0' && r.stage === 'finaled')!;
    expect(own).toMatchObject({ emitted: false, signal_id: 1 });
  });

  it('follower-driven and own-permit updates share one daily count: 3 in the morning leave room for 2 in the afternoon', async () => {
    const { db } = seed();
    let rows = finals(0, 3, 'F', MORNING);
    const f = portal(() => rows);
    await scanAt(db, f, 0);
    const morning = armed(db);
    markSent(db);
    rows = finals(5, 5, 'R', AFTERNOON);
    await scanAt(db, f, 6);
    const afternoon = armed(db);
    expect(morning).toBe(3);
    expect(afternoon).toBe(2);
  });

  it('the daily stage count sits inside the 25 cap: an afternoon scan with 21 new cards leaves room for 4, then the day cap allows only 3', async () => {
    expect(MAX_MATCHES_PER_USER).toBe(25);
    const { db } = seed();
    let stage = finals(0, 2, 'F', MORNING);
    let main: PRow[] = [];
    const f = portal(() => stage, () => main);
    await scanAt(db, f, 0);
    const morning = armed(db);
    markSent(db);
    const before = db.tables.holler_matches.length;
    // 21 brand-new construction permits issued today: 21 normal cards for the landscaper in the afternoon scan.
    main = Array.from({ length: 21 }, (_, i) => permit(`NEW-${i}`, { issue_date: '2026-11-20T00:00:00.000', ':created_at': AFTERNOON, ':updated_at': AFTERNOON, address: `${1000 + i * 10} FRESH ST`, latitude: String(LOC.lat + 0.001 * i) }));
    stage = finals(2, 8, 'F', AFTERNOON);
    await scanAt(db, f, 6);
    const afternoon = armed(db);
    const fresh = db.tables.holler_matches.length - before;
    expect(morning).toBe(2);
    expect(fresh).toBe(21);
    // Day cap left 3 (5 - 2), the scan cap left 4 (25 - 21): 3 go out, and the scan stays within 25 for the member.
    expect(afternoon).toBe(3);
    expect(morning + afternoon).toBeLessThanOrEqual(MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY);
    expect(fresh + afternoon).toBeLessThanOrEqual(MAX_MATCHES_PER_USER);
  });

  it('when the 25 cap binds first: 23 new cards leave room for 2 stage updates even with 5 left for the day', async () => {
    const { db } = seed();
    const main = Array.from({ length: 23 }, (_, i) => permit(`NEW-${i}`, { issue_date: '2026-11-20T00:00:00.000', ':created_at': MORNING, ':updated_at': MORNING, address: `${1000 + i * 10} FRESH ST`, latitude: String(LOC.lat + 0.001 * i) }));
    const f = portal(() => finals(0, 5, 'F', MORNING), () => main);
    await scanAt(db, f, 0);
    const fresh = db.tables.holler_matches.length - 10;
    expect(fresh).toBe(23);
    expect(armed(db)).toBe(2);
    expect(fresh + armed(db)).toBe(MAX_MATCHES_PER_USER);
  });
});

describe('final review P2-4: a stage update re-arms only a card still in New', () => {
  it('a saved, done or dismissed card keeps its sent marks; the card in New is re-armed once', async () => {
    const roots = Array.from({ length: 4 }, (_, i) => sig(i + 1, `R-${i}`, i));
    const statuses = ['new', 'saved', 'done', 'dismissed'];
    const db = new FakeDb({
      holler_profiles: [member('landscaper', ['landscaping'])],
      holler_signals: roots,
      holler_permit_stages: roots.map(hist),
      holler_project_links: [], holler_dedupe_drops: [],
      holler_matches: roots.map((s, i) => ({ id: i + 1, user_id: 'landscaper', signal_id: s.id, notified: true, pushed_at: 'sent', status: statuses[i] })),
    });
    await scanAt(db, portal(() => finals(0, 4, 'R', MORNING)), 0);
    const byStatus = Object.fromEntries(db.tables.holler_matches.map((m) => [m.status, { notified: m.notified, pushed_at: m.pushed_at }]));
    expect(byStatus.new).toEqual({ notified: false, pushed_at: null });
    for (const st of ['saved', 'done', 'dismissed']) expect(byStatus[st], st).toEqual({ notified: true, pushed_at: 'sent' });
    expect(db.tables.holler_matches).toHaveLength(4);
  });
});
