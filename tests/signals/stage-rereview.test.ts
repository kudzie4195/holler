/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 17 fix re-review (review-FIX17.md) P1-A, P2-B and P2-C, kept as regression tests. Probe: logs/REFIX17-probe-tests/p11.test.ts
// (tests N, O and P), rewritten to assert the required behaviour. Own adapter (no Socrata fake): every project is built by real scans,
// roots by one scan, followers (a second permit number at the same address) by a later one. No portal was called.
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';
import { digestSubject } from '@/lib/email/templates';
import { isStageUpdate } from '@/lib/signals/stage';

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
/** The real column defaults of holler_matches, which the fake does not apply. */
function defaults(db: FakeDb) {
  for (const m of db.tables.holler_matches ?? []) {
    if (m.status === undefined) m.status = 'new';
    if (m.notified === undefined) m.notified = false;
    if (m.pushed_at === undefined) m.pushed_at = null;
  }
}
function markSent(db: FakeDb) {
  defaults(db);
  for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: 'sent' });
}
/** Stage updates per member waiting to be sent: unsent cards in New on records that carry the stage UPDATE mark. */
function pending(db: FakeDb): Record<string, number> {
  defaults(db);
  const upd = new Set(db.tables.holler_signals.filter((s) => s.data?.permitStageUpdate === true).map((s) => s.id));
  const out: Record<string, number> = {};
  for (const m of db.tables.holler_matches) if (m.notified === false && m.status === 'new' && upd.has(m.signal_id)) out[m.user_id] = (out[m.user_id] ?? 0) + 1;
  return out;
}
async function scan(db: FakeDb, rows: SignalInput[], when: Date) {
  const rep = await runScan({ now: when, adapters: [adapter(() => rows)], source: SRC, stageUpdates: true } as any, db as unknown as Db);
  for (const s of rep.sources) expect(s.status, `${s.id}: ${s.error}`).not.toBe('error');
  return rep;
}
const probesOf = (p: string, a: number, n: number, stage: any = 'finaled') => Array.from({ length: n }, (_, k) => row(`${p}-${a + k}`, a + k, { permitStage: stage, stageProbe: true }));

/** N projects built by real scans: roots on day 0 at 09:00, followers at the same addresses on day 0 at 12:00. All cards sent. */
async function world(N: number, members = [member('land', ['landscaping'])]) {
  const db = new FakeDb({ holler_profiles: members, holler_signals: [], holler_matches: [], holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [], holler_scan_runs: [] });
  if (N > 0) {
    await scan(db, Array.from({ length: N }, (_, i) => row(`R-${i}`, i)), day(0, 9));
    await scan(db, Array.from({ length: N }, (_, i) => row(`F-${i}`, i, { occurredAt: new Date(D0 + 3_600_000).toISOString() })), day(0, 12));
  }
  markSent(db);
  return db;
}

describe('re-review P1-A: a brand-new project whose second listing is already final in the same scan is a NEW card, not an update', () => {
  it('8 new projects (first permit Issued, second Final, one scan): 8 plain new cards with a stage line, none worded as an update', async () => {
    const db = await world(0, [member('land', ['landscaping']), member('roof', ['roofing'])]);
    const N = 8;
    await scan(db, [
      ...Array.from({ length: N }, (_, i) => row(`R-${i}`, i, { occurredAt: day(2, 1).toISOString() })),
      ...Array.from({ length: N }, (_, i) => row(`F-${i}`, i, { permitStage: 'finaled', occurredAt: day(2, 2).toISOString() })),
    ], day(2, 3));
    const roots = db.tables.holler_signals.filter((s) => String(s.external_id).startsWith('R-'));
    expect(roots).toHaveLength(N);
    // Before the fix: {"land":8}, 8 roots flagged, digest subject "8 permit updates near you".
    expect(pending(db)).toEqual({});
    expect(roots.filter((s) => s.data?.permitStageUpdate === true)).toHaveLength(0);
    // The card still carries the stage line (the project is finished), and the stage is recorded once per permit.
    expect(roots.every((s) => s.data?.permitStage === 'finaled')).toBe(true);
    const mine = new Set(db.tables.holler_matches.filter((m) => m.user_id === 'land').map((m) => m.signal_id));
    expect(mine.size).toBe(N);
    const items = db.tables.holler_signals.filter((s) => mine.has(s.id)).map((s) => ({ kind: s.kind, title: s.title, occurredAt: s.occurred_at, permitStage: s.data?.permitStage, permitStageAt: s.data?.permitStageAt, permitStageUpdate: s.data?.permitStageUpdate }));
    expect(items.filter((i) => isStageUpdate(i as any))).toHaveLength(0);
    // Round 23: the subject names the strongest card and counts the rest. No address or place on these rows, so the title carries it.
    expect(digestSubject(items as any, items.length)).toBe('New construction permit in Norfolk (+7 more)');
    // Nothing of it counts as an update sent today (P2-C): no emitted history row.
    expect(db.tables.holler_permit_stages.filter((h) => h.emitted)).toHaveLength(0);
  });
});

describe('re-review P2-C: records first seen already final do not use up the day\'s 5', () => {
  it('morning: 5 new permits already Final (5 plain new cards); afternoon: 3 held projects reach Final, all 3 updates go out', async () => {
    const db = await world(3);
    const fresh = Array.from({ length: 5 }, (_, i) => row(`NEW-${i}`, 100 + i, { summary: `New Construction | ${5000 + i * 10} FRESH ST`, lat: LOC.lat + 0.0005 * i, permitStage: 'finaled', occurredAt: day(2, 1).toISOString() }));
    await scan(db, fresh, day(2, 2));
    defaults(db);
    expect(db.tables.holler_matches.filter((m) => m.notified === false)).toHaveLength(5);
    expect(pending(db).land ?? 0).toBe(0);
    expect(db.tables.holler_permit_stages.filter((h) => h.emitted)).toHaveLength(0);
    markSent(db);
    await scan(db, probesOf('R', 0, 3), day(2, 9));
    // Before the fix: 0 (the 5 new cards were counted as the day's 5 updates).
    expect(pending(db).land ?? 0).toBe(3);
  });
});

describe('re-review P2-B: a card the member dismissed, saved or finished never takes one of the 5 places', () => {
  it('10 held projects reach Final, the 5 with the highest ids dismissed: the 5 cards in New get the update, the dismissed stay untouched', async () => {
    const db = await world(10);
    defaults(db);
    const rootIds = db.tables.holler_signals.filter((s) => String(s.external_id).startsWith('R-')).map((s) => s.id as number).sort((a, b) => b - a);
    for (const m of db.tables.holler_matches) if (rootIds.slice(0, 5).includes(m.signal_id)) m.status = 'dismissed';
    await scan(db, probesOf('R', 0, 10), day(2, 2));
    // Before the fix: 0 (the dismissed cards won the 5 places by score, and the re-arm then skipped them).
    expect(pending(db).land ?? 0).toBe(5);
    expect(db.tables.holler_matches.filter((m) => m.status === 'dismissed' && (m.notified !== true || m.pushed_at !== 'sent'))).toHaveLength(0);
    expect(db.tables.holler_matches).toHaveLength(10);
  });

  it('saved and done cards are skipped the same way, and no second card is made for them', async () => {
    const db = await world(10);
    defaults(db);
    const rootIds = db.tables.holler_signals.filter((s) => String(s.external_id).startsWith('R-')).map((s) => s.id as number).sort((a, b) => b - a);
    for (const m of db.tables.holler_matches) {
      const k = rootIds.indexOf(m.signal_id);
      if (k >= 0 && k < 3) m.status = 'saved';
      else if (k >= 3 && k < 6) m.status = 'done';
    }
    await scan(db, probesOf('R', 0, 10), day(2, 2));
    expect(pending(db).land ?? 0).toBe(4);
    expect(db.tables.holler_matches.filter((m) => m.status !== 'new' && (m.notified !== true || m.pushed_at !== 'sent'))).toHaveLength(0);
    expect(db.tables.holler_matches).toHaveLength(10);
  });
});
