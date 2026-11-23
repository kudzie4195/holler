/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 17 STAGE, redo 2: regression tests for the independent re-review (review-STAGE-2.md) and the commander's decisions 1 to 9.
// The REV2 probes (R1 to R9, W1, M1) are copied from logs/REV2-STAGE-probe-tests and rewritten to the REQUIRED behaviour: where the
// probe printed what the old code did, these tests assert what it must do now. A realistic Socrata fake applies the stage query's own
// `:updated_at >` and status like-list, `$order` and `$limit`. No portal was called; rows are hand written (assumed shapes).
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { fakeTables } from '../match/fake-table';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import type { Adapter } from '@/lib/signals/types';
import { buildSocrataAdapter } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { backfillMatches } from '@/lib/signals/backfill';
import { renderDigest } from '@/lib/email/templates';
import { buildNotification, isNews, pushEntriesFromMatches } from '@/lib/push/notify';
import { planHealth, renderHealthEmail } from '@/lib/email/health';
import { computeSourceStates } from '@/lib/signals/source-state';
import { evaluateScan } from '@/lib/monitor/rules';
import { isStageNote, isStageUpdate, stageUpdateSubject, stageUpdatesEnabled, MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY } from '@/lib/signals/stage';
import { pushNewMatches } from '@/lib/push/notify';
import { memDb } from '../mobile/memdb';
import { profileRow, UA } from '../mobile/fakes';
import { ProjectStore, STAGE_HISTORY_DAYS } from '@/lib/signals/projects';

const asDb = (f: FakeDb) => f as unknown as Db;
const NOW = new Date('2026-11-20T18:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-norfolk-permits')!;
const LOC = { lat: 36.85, lon: -76.28 };
const member = (id: string, categories: string[]) => ({ user_id: id, categories, lat: LOC.lat, lon: LOC.lon, state: 'VA', radius_mi: 25, subscription_status: 'active', trial_ends_at: '2026-11-01T00:00:00Z' });
const OLD_CREATED = '2026-06-01T03:00:00.000Z';
const TODAY = '2026-11-20T03:00:00.000Z';

type PRow = Record<string, string>;
const permit = (i: number | string, over: PRow = {}): PRow => ({
  permit_number: `NF-${i}`, status: 'Complete', type: 'Building', work_type: 'New Construction', use_type: 'Single Family Dwelling',
  issue_date: '2026-06-01T00:00:00.000', address: `${100 + Number(String(i).replace(/\D/g, '') || 0)} EXAMPLE AVE`,
  latitude: String(LOC.lat), longitude: String(LOC.lon), ':created_at': OLD_CREATED, ':updated_at': OLD_CREATED, ...over,
});

/** A Socrata portal: `rows()` is the whole dataset at fetch time. The main query (issue date) finds nothing: these permits are months old. */
function portal(rows: () => PRow[], stageAnswer?: { status: number; body: string }) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    const u = decodeURIComponent(String(url)).replace(/\+/g, ' ');
    asked.push(u);
    const where = new URL(u.replace(/ /g, '%20')).searchParams.get('$where') ?? '';
    if (where.includes(':updated_at >')) {
      if (stageAnswer) return new Response(stageAnswer.body, { status: stageAnswer.status });
      const after = /:updated_at > '([^']+)'/.exec(where)![1] + 'Z';
      const frags = [...where.matchAll(/like '%([^%]+)%'/g)].map((m) => m[1]);
      const hit = rows()
        .filter((r) => r[':updated_at'] > after && frags.some((f) => r.status.toUpperCase().includes(f)))
        .sort((a, b) => (a[':updated_at'] < b[':updated_at'] ? 1 : -1))
        .slice(0, 500);
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}
const scan = (db: FakeDb, p: ReturnType<typeof portal>, h = 0, extra: Record<string, unknown> = {}) =>
  runScan({ now: at(h), adapters: [buildSocrataAdapter(ds)], source: ds.id, fetchImpl: p.fetchImpl, stageUpdates: true, ...extra } as any, asDb(db));
const cards = (db: FakeDb, u: string) => (db.tables.holler_matches ?? []).filter((m) => m.user_id === u).length;
const markSent = (db: FakeDb) => { for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: 'sent', status: 'new' }); };
const people = () => [member('landscaper', ['landscaping']), member('cleaner', ['cleaning']), member('mover', ['moving']), member('roofer', ['roofing'])];
const storedPermit = (id: number, ext: string, over: Record<string, unknown> = {}) => ({ id, source: ds.id, external_id: ext, kind: 'permit', title: 'New construction permit in Norfolk', summary: 'New Construction | 100 EXAMPLE AVE', categories: ['general-contractor'], lat: LOC.lat, lon: LOC.lon, state: 'VA', severity: 1, occurred_at: '2026-10-10T00:00:00Z', data: { subtype: 'permit' }, ...over });
const hist = (permitId: string, stage: string, signalId: number | null, emitted = false) => ({ source: ds.id, permit_id: permitId, stage, signal_id: signalId, emitted });
const emptyTables = () => ({ holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [] });

describe('REV2 reload simulation: a portal that touches old rows changes nothing for permits Holler never tracked (decision 1)', () => {
  it('R1: full upsert reload of 2000 old finished permits (today\'s :updated_at): nothing stored, no card, no history row', async () => {
    const all = Array.from({ length: 2000 }, (_, i) => permit(i, { ':updated_at': TODAY }));
    const db = new FakeDb({ holler_profiles: people(), ...emptyTables() });
    const r = await scan(db, portal(() => all));
    expect(db.tables.holler_signals ?? []).toHaveLength(0);
    expect(db.tables.holler_matches ?? []).toHaveLength(0);
    expect(db.tables.holler_permit_stages).toHaveLength(0);
    expect(r.sources[0].status).toBe('ok');
  });

  it('R2: a reload that touches 499 old finished permits (status unchanged): 0 cards for every member, no per-member flood', async () => {
    const all = Array.from({ length: 499 }, (_, i) => permit(i, { ':updated_at': TODAY }));
    const db = new FakeDb({ holler_profiles: people(), ...emptyTables() });
    await scan(db, portal(() => all));
    expect(db.tables.holler_signals ?? []).toHaveLength(0);
    for (const u of ['landscaper', 'cleaner', 'mover', 'roofer']) expect(cards(db, u)).toBe(0);
    expect(db.tables.holler_permit_stages).toHaveLength(0);
  });

  it('R3: the next day the same 499 are re-normalized (" COMPLETE "): still nothing, nothing re-armed', async () => {
    let all = Array.from({ length: 499 }, (_, i) => permit(i, { ':updated_at': TODAY }));
    const db = new FakeDb({ holler_profiles: people(), ...emptyTables() });
    const p = portal(() => all);
    await scan(db, p);
    all = all.map((r) => ({ ...r, status: ' COMPLETE ', ':updated_at': '2026-11-21T03:00:00.000Z' }));
    await scan(db, p, 24);
    expect(db.tables.holler_matches ?? []).toHaveLength(0);
    expect((db.tables.holler_matches ?? []).filter((m) => m.notified === false)).toHaveLength(0);
  });

  it('R3b: a re-normalized reload of 300 permits Holler already TRACKS at "finaled": nothing is re-armed', async () => {
    const stored = Array.from({ length: 300 }, (_, i) => storedPermit(i + 1, `NF-${i}`, { data: { subtype: 'permit', permitStage: 'finaled' } }));
    const h = stored.map((s) => hist(s.external_id, 'finaled', s.id, true));
    const db = new FakeDb({ holler_profiles: people(), holler_signals: stored, holler_permit_stages: h, holler_project_links: [], holler_dedupe_drops: [], holler_matches: stored.map((s, i) => ({ id: i + 1, user_id: 'landscaper', signal_id: s.id, notified: true, pushed_at: 'sent', status: 'new' })) });
    await scan(db, portal(() => Array.from({ length: 300 }, (_, i) => permit(i, { status: 'complete  ', ':updated_at': TODAY }))));
    expect(db.tables.holler_matches).toHaveLength(300);
    expect(db.tables.holler_matches.filter((m) => m.notified === false)).toHaveLength(0);
  });

  it('R4: a replace-style reload where a stored permit with no history shows "Final": the probe changes nothing and the run says nothing about it', async () => {
    const rows = [permit('X', { ':created_at': TODAY, ':updated_at': TODAY, status: 'Final' }), ...Array.from({ length: 50 }, (_, i) => permit(i, { ':created_at': TODAY, ':updated_at': TODAY, status: 'Issued' }))];
    const db = new FakeDb({ holler_profiles: people(), ...emptyTables(), holler_signals: [storedPermit(1, 'NF-X')], holler_matches: [{ id: 1, user_id: 'landscaper', signal_id: 1, notified: true, pushed_at: 'sent', status: 'new' }] });
    const r = await scan(db, portal(() => rows));
    expect(db.tables.holler_matches.filter((m) => m.notified === false)).toHaveLength(0);
    expect(r.sources[0].logs.join(' ')).not.toMatch(/stage/);
  });
});

describe('REV2 the real case and repeats (decision 1: history gates every update)', () => {
  for (const status of ['Final', 'CO Issued']) {
    it(`R5: one tracked permit moves to "${status}" among 200 untouched rows: exactly one update, never repeated`, async () => {
      let rows = [permit('S', { status: 'Issued' }), ...Array.from({ length: 200 }, (_, i) => permit(i, { status: 'Issued' }))];
      const db = new FakeDb({ holler_profiles: people(), holler_signals: [storedPermit(1, 'NF-S')], holler_permit_stages: [hist('NF-S', 'issued', 1)], holler_project_links: [], holler_dedupe_drops: [], holler_matches: [{ id: 1, user_id: 'landscaper', signal_id: 1, notified: true, pushed_at: 'sent', status: 'new' }] });
      const p = portal(() => rows);
      await scan(db, p);
      expect(db.tables.holler_matches.filter((m) => m.notified === false)).toHaveLength(0);
      rows = rows.map((r) => (r.permit_number === 'NF-S' ? { ...r, status, ':updated_at': TODAY } : r));
      await scan(db, p, 6);
      const rearmed = db.tables.holler_matches.filter((m) => m.notified === false && m.id === 1).map((m) => m.user_id);
      const fresh = db.tables.holler_matches.filter((m) => m.id !== 1).map((m) => m.user_id).sort();
      expect(rearmed).toEqual(['landscaper']);
      expect(fresh).toEqual(['cleaner']);
      expect(db.tables.holler_signals[0].data).toMatchObject({ permitStageUpdate: true });
      markSent(db);
      await scan(db, p, 12);
      await scan(db, p, 18);
      expect(db.tables.holler_matches.filter((m) => m.notified !== true)).toHaveLength(0);
      expect(db.tables.holler_matches).toHaveLength(2);
    });
  }

  it('R6: flapping Final, Issued, Final, "Final Approved", "Final Inspection", "CO Issued", Final: ONE re-send, and the card line never goes back down (P3-C)', async () => {
    let status = 'Final';
    let upd = TODAY;
    const db = new FakeDb({ holler_profiles: [member('landscaper', ['landscaping'])], holler_signals: [storedPermit(1, 'NF-F')], holler_permit_stages: [hist('NF-F', 'issued', 1)], holler_project_links: [], holler_dedupe_drops: [], holler_matches: [{ id: 1, user_id: 'landscaper', signal_id: 1, notified: true, pushed_at: 'sent', status: 'new' }] });
    const p = portal(() => [permit('F', { status, ':updated_at': upd })]);
    let resends = 0;
    const seq = ['Final', 'Issued', 'Final', 'Final Approved', 'Final Inspection', 'CO Issued', 'Final'];
    const stages: unknown[] = [];
    for (let i = 0; i < seq.length; i++) {
      status = seq[i];
      upd = new Date(NOW.getTime() + i * 6 * 3_600_000 - 3_600_000).toISOString();
      await scan(db, p, i * 6);
      if (db.tables.holler_matches[0].notified === false) resends++;
      stages.push(db.tables.holler_signals[0].data.permitStage);
      markSent(db);
    }
    expect(resends).toBe(1);
    // finaled, then "Final Inspection" (lower: line stays), then "CO Issued" (higher: line moves up), then "Final" (lower: stays)
    expect(stages[4]).toBe('finaled');
    expect(stages[5]).toBe('certificate_of_occupancy');
    expect(stages[6]).toBe('certificate_of_occupancy');
  });

  it('R7 / P1-B: a permit announced earlier (history finaled, emitted, signal_id null after the prune) and touched again: no row, no card', async () => {
    const db = new FakeDb({ holler_profiles: people(), holler_permit_stages: [hist('NF-P', 'finaled', null, true)], holler_project_links: [], holler_dedupe_drops: [] });
    await scan(db, portal(() => [permit('P', { ':updated_at': TODAY })]));
    expect(cards(db, 'landscaper') + cards(db, 'cleaner')).toBe(0);
    expect(db.tables.holler_signals ?? []).toHaveLength(0);
    expect(db.tables.holler_permit_stages).toHaveLength(1);
  });

  it('P1-B: a later stage already announced (certificate of occupancy, signal_id null) blocks an announcement of an earlier one on a re-stored row', async () => {
    const db = new FakeDb({
      holler_profiles: people(), holler_signals: [storedPermit(5, 'NF-Q')], holler_project_links: [], holler_dedupe_drops: [],
      holler_permit_stages: [hist('NF-Q', 'certificate_of_occupancy', null, true), hist('NF-Q', 'issued', null)],
      holler_matches: [{ id: 1, user_id: 'landscaper', signal_id: 5, notified: true, pushed_at: 'sent', status: 'new' }],
    });
    await scan(db, portal(() => [permit('Q', { status: 'Final', ':updated_at': TODAY })]));
    expect(db.tables.holler_matches.filter((m) => m.notified === false)).toHaveLength(0);
    expect(cards(db, 'cleaner')).toBe(0);
  });

  it('R8: no stage-only row exists any more, so no trade can reach one through the signup backfill', async () => {
    const db = new FakeDb({ holler_profiles: people(), ...emptyTables() });
    await scan(db, portal(() => [permit('B', { ':updated_at': TODAY })]));
    expect(db.tables.holler_signals ?? []).toHaveLength(0);
    const d: any = fakeTables({ holler_signals: db.tables.holler_signals ?? [], holler_matches: [] });
    d.rpc = () => ({ select: () => Promise.resolve({ data: db.tables.holler_signals ?? [], error: null }) });
    await backfillMatches(d, { user_id: 'new-mover', categories: ['moving'], lat: LOC.lat, lon: LOC.lon, state: null, radius_mi: 25 } as any, at(1));
    expect(d.tables.holler_matches).toEqual([]);
  });
});

describe('REV2 R9 and decision 7: the re-sent alert is a stage update, in the email and in the push', () => {
  const item = { kind: 'permit', source: ds.id, subtype: 'permit', title: 'New construction permit in Norfolk', summary: 'New Construction | 100 EXAMPLE AVE', place: 'Norfolk, VA', occurredAt: '2026-10-10T00:00:00Z', sourceUrl: null, label: 'coming_soon' as const, trade: 'landscaping', permitStage: 'final_inspection', permitStageAt: NOW.toISOString(), permitStageUpdate: true };
  const mail = renderDigest({ businessName: 'Green Lawn Co', appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, items: [item] });

  it('the subject reads "Update: final inspection on a permit near you"; the body says "Stage update", the stage and the date; never "new" or "N days ago"', () => {
    expect(mail.subject).toBe('Update: final inspection on a permit near you');
    expect(stageUpdateSubject('finaled')).toBe('Update: finished on a permit near you');
    expect(stageUpdateSubject('certificate_of_occupancy')).toBe('Update: certificate of occupancy on a permit near you');
    expect(mail.text).toContain('Stage update: final inspection, listed by the public source on Nov 20, 2026.');
    expect(mail.text).toContain('Stage update, Nov 20, 2026');
    expect(mail.subject).not.toMatch(/\bnew\b/i);
    expect(mail.text).not.toMatch(/\bnew (thing|alert|listing)/i);
    expect(mail.text).not.toMatch(/\d+ days? ago/i);
    expect(mail.html).toContain('Stage update: final inspection');
    expect(mail.text).not.toMatch(/official record|\bleads?\b|guaranteed|they need you/i);
  });

  it('a normal alert names its place (round 23), and a mix still says how many are updates and lists updates first', () => {
    const plain = { ...item, permitStageUpdate: undefined, permitStage: null, permitStageAt: null, title: 'Roof permit in Norfolk' };
    expect(renderDigest({ businessName: 'X', appUrl: 'https://a.test', unsubscribeUrl: 'https://u.test', now: NOW, items: [plain] }).subject).toBe('Permit at 100 EXAMPLE AVE');
    const mixed = renderDigest({ businessName: 'X', appUrl: 'https://a.test', unsubscribeUrl: 'https://u.test', now: NOW, items: [plain, item] });
    expect(mixed.subject).toBe('2 things near you, 1 of them a stage update');
    expect(mixed.text.indexOf('Stage update: final inspection')).toBeLessThan(mixed.text.indexOf('Roof permit in Norfolk'));
  });

  it('isStageUpdate needs the marker, a trigger stage and a real date', () => {
    expect(isStageUpdate({ permitStage: 'finaled', permitStageAt: NOW.toISOString(), permitStageUpdate: 'true' })).toBe(true);
    expect(isStageUpdate({ permitStage: 'finaled', permitStageAt: NOW.toISOString() })).toBe(false);
    expect(isStageUpdate({ permitStage: 'issued', permitStageAt: NOW.toISOString(), permitStageUpdate: true })).toBe(false);
    expect(isStageUpdate({ permitStage: 'finaled', permitStageAt: 'soon', permitStageUpdate: true })).toBe(false);
  });

  it('push: an OLD match for an OLD permit is refused by isNews, but a stage update bypasses it (only that path); text is "Update near Norfolk"', () => {
    expect(isNews('2026-10-10T00:00:00Z', '2026-10-10T06:00:00Z', NOW.getTime())).toBe(false);
    const sig = (extra: Record<string, unknown>) => ({ id: 9, title: 'New construction permit in Norfolk', city: 'Norfolk', source: ds.id, occurred_at: '2026-10-10T00:00:00Z', ...extra });
    const m = (signal: any) => ({ id: 1, user_id: 'u', created_at: '2026-10-10T06:00:00Z', signal });
    const upd = pushEntriesFromMatches([m(sig({ permitStage: 'final_inspection', permitStageAt: NOW.toISOString(), permitStageUpdate: 'true' }))], NOW.getTime());
    expect(upd.get('u')).toMatchObject({ count: 1, updates: 1 });
    expect(buildNotification(upd.get('u')!, null)).toMatchObject({ title: 'Update near Norfolk', body: 'Stage update, final inspection: New construction permit in Norfolk' });
    // the same old permit WITHOUT the marker, or with a stage date 30 days old, is still refused
    expect(pushEntriesFromMatches([m(sig({ permitStage: 'final_inspection', permitStageAt: NOW.toISOString() }))], NOW.getTime()).size).toBe(0);
    expect(pushEntriesFromMatches([m(sig({ permitStage: 'final_inspection', permitStageAt: '2026-10-20T00:00:00Z', permitStageUpdate: 'true' }))], NOW.getTime()).size).toBe(0);
  });
});

describe('decision 7 end to end: pushNewMatches sends a re-armed OLD match as a stage update (and only that path bypasses the news check)', () => {
  const DAY = 86_400_000;
  const run = async (signal: Record<string, unknown>) => {
    const m = memDb({
      holler_profiles: [profileRow(UA)],
      holler_push_tokens: [{ id: 'a1', user_id: UA, token: 'tA1', platform: 'ios', disabled_at: null }],
      holler_signals: [{ id: 9, title: 'New construction permit in Norfolk', city: 'Norfolk', source: ds.id, kind: 'permit', summary: 'New Construction | 100 EXAMPLE AVE', categories: ['general-contractor'], expires_at: null, occurred_at: '2026-10-10T00:00:00Z', ...signal }],
      holler_matches: [{ id: 1, user_id: UA, signal_id: 9, status: 'new', notified: false, pushed_at: null, created_at: new Date(NOW.getTime() - 30 * DAY).toISOString() }],
    });
    const sent: Array<{ title: string; body: string }> = [];
    const r = await pushNewMatches(m.db as never, { now: NOW, configured: true, send: async (x: any) => (sent.push({ title: x.title, body: x.body }), { ok: true as const }) });
    return { r, sent, m };
  };
  it('a stage update on a match created 30 days ago: one push "Update near Norfolk", the match is stamped', async () => {
    const { r, sent, m } = await run({ permitStage: 'finaled', permitStageAt: NOW.toISOString(), permitStageUpdate: 'true' });
    expect(r.matches_pushed).toBe(1);
    expect(sent).toEqual([{ title: 'Update near Norfolk', body: 'Stage update, finished: New construction permit in Norfolk' }]);
    expect(m.tables.holler_matches[0].pushed_at).not.toBeNull();
  });
  it('the same old match without the stage marker is history, not news: nothing is sent', async () => {
    const { r, sent } = await run({});
    expect(sent).toEqual([]);
    expect(r.matches_pushed).toBe(0);
  });
});

describe('REV2 W1 and decision 6: a stage query the portal refuses shows up for that source, in scan_runs and in the health email, as one line', () => {
  const sf = SOCRATA_DATASETS.find((d) => d.id === 'socrata-sf-permits')!;
  const main = [{ permit_number: 'M-1', permit_type_definition: 'new construction wood frame', description: 'new single family dwelling', status: 'issued', issued_date: '2026-11-19T00:00:00.000', street_number: '500', street_name: 'Example', street_suffix: 'Ln', zipcode: '94110', location: { type: 'Point', coordinates: [-122.42, 37.77] } }];
  const refuse = (async (url: string) => {
    const u = decodeURIComponent(String(url)).replace(/\+/g, ' ');
    if (u.includes('status_date >')) return new Response('{"code":"query.soql.no-such-column","error":true,"message":"No such column: status_date"}', { status: 400 });
    return new Response(JSON.stringify(main), { status: 200 });
  }) as unknown as typeof fetch;

  it('main rows are stored; scan_runs.error carries one "stage query:" line; the source status stays ok', async () => {
    const db = new FakeDb({ holler_profiles: [], ...emptyTables() });
    const r = await runScan({ now: NOW, adapters: [buildSocrataAdapter(sf)], source: sf.id, fetchImpl: refuse, stageUpdates: true } as any, asDb(db));
    expect(r.sources[0].inserted).toBe(1);
    expect(r.sources[0].status).toBe('ok');
    expect(r.sources[0].error).toBeUndefined();
    const run = db.tables.holler_scan_runs.find((x) => x.source === sf.id)!;
    expect(String(run.error)).toBe('stage query: date column status_date not accepted (code 400)');
    expect(isStageNote(run.error)).toBe(true);
    const health = (db.tables.holler_source_health ?? []).find((x: any) => x.source === sf.id);
    expect(health?.last_error ?? null).toBeNull();
  });

  it('the health email shows one Watch line for the source and does not call it errored; the source-state and monitor rules ignore the note', () => {
    const adapters = [{ id: 'socrata-sf-permits', label: 'SF permits', kind: 'permit', cadenceMinutes: 360 }];
    const runs = Array.from({ length: 13 }, (_, i) => ({ source: 'socrata-sf-permits', started_at: new Date(NOW.getTime() - (i * 6 * 3_600_000 + 120_000)).toISOString(), fetched: 5, inserted: 1, error: i === 0 ? 'stage query: date column status_date not accepted (code 400)' : null }));
    const rep = planHealth({ adapters, runs, counts: { newSignups24h: 0, activeSubscribers: 0, trialing: 0, usersEmailed24h: 0 }, now: NOW });
    expect(rep.ok).toBe(true);
    expect(rep.problems).toEqual([]);
    expect(rep.sources[0].status).toBe('ok');
    expect(rep.watch.filter((w) => w.startsWith('socrata-sf-permits:'))).toEqual(['socrata-sf-permits: stage query: date column status_date not accepted (code 400)']);
    expect(renderHealthEmail(rep).text).toContain('stage query: date column status_date not accepted');
    // source state: the note is not an error run
    const st = computeSourceStates({ adapters: adapters.map((a) => ({ ...a, missingEnv: [] })), health: [], runs: runs.map((r) => ({ source: r.source, started_at: r.started_at, fetched: r.fetched, error: r.error })), now: NOW });
    expect(JSON.stringify(st)).not.toMatch(/stage query/);
    // monitor: a single-source run that only has the note is not a scan error
    expect(evaluateScan([{ source: 'socrata-sf-permits', finished_at: new Date(NOW.getTime() - 60_000).toISOString(), error: 'stage query: no usable answer' }, { source: 'nws', finished_at: new Date(NOW.getTime() - 60_000).toISOString(), error: 'stage query: no usable answer' }], NOW)).toEqual([]);
  });
});

describe('decision 3: at most 5 stage updates per member per day, counted with the normal 25', () => {
  const N = 8;
  const rowsFor = (status: string) => Array.from({ length: N }, (_, i) => permit(i, { status, ':updated_at': TODAY, address: `${200 + i * 50} OTHER RD` }));
  const seed = (extra: Record<string, unknown> = {}) => {
    const signals = Array.from({ length: N }, (_, i) => storedPermit(i + 1, `NF-${i}`, { summary: `New Construction | ${200 + i * 50} OTHER RD`, lat: LOC.lat + i * 0.02 }));
    return new FakeDb({ holler_profiles: [member('cleaner', ['cleaning'])], holler_signals: signals, holler_permit_stages: signals.map((s) => hist(s.external_id, 'issued', s.id)), holler_project_links: [], holler_dedupe_drops: [], ...extra });
  };

  it('8 tracked permits reach final the same day: the member gets 5 stage cards, the rest wait (not re-sent later, so the cap is a hard limit)', async () => {
    expect(MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY).toBe(5);
    const db = seed();
    await scan(db, portal(() => rowsFor('Final')));
    expect(cards(db, 'cleaner')).toBe(5);
  });

  it('stage updates already sent today count: with 3 already emitted today only 2 more go out', async () => {
    const signals = Array.from({ length: 3 }, (_, i) => storedPermit(100 + i, `OLD-${i}`));
    const db = seed({
      holler_signals: [...Array.from({ length: N }, (_, i) => storedPermit(i + 1, `NF-${i}`, { summary: `New Construction | ${200 + i * 50} OTHER RD`, lat: LOC.lat + i * 0.02 })), ...signals],
      holler_permit_stages: [...Array.from({ length: N }, (_, i) => hist(`NF-${i}`, 'issued', i + 1)), ...signals.map((s) => ({ ...hist(s.external_id, 'finaled', s.id, true), first_seen_at: NOW.toISOString() }))],
      holler_matches: signals.map((s, i) => ({ id: 900 + i, user_id: 'cleaner', signal_id: s.id, notified: true, pushed_at: 'sent', status: 'new' })),
    });
    await scan(db, portal(() => rowsFor('Final')));
    expect(db.tables.holler_matches.filter((m) => m.user_id === 'cleaner' && Number(m.id) > 902)).toHaveLength(2);
  });
});

describe('decision 4: the whole stage query sits behind HOLLER_STAGE_UPDATES_ENABLED (off by default)', () => {
  it('parses 1, true, on, yes only', () => {
    for (const v of ['1', 'true', 'on', 'yes', ' TRUE ']) expect(stageUpdatesEnabled(v), v).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'enabled']) expect(stageUpdatesEnabled(v), String(v)).toBe(false);
  });
  it('off: no stage query is sent, nothing changes, but the history of the normal scan is still recorded', async () => {
    const db = new FakeDb({ holler_profiles: people(), holler_signals: [storedPermit(1, 'NF-S')], holler_permit_stages: [hist('NF-S', 'issued', 1)], holler_project_links: [], holler_dedupe_drops: [] });
    const p = portal(() => [permit('S', { status: 'Final', ':updated_at': TODAY })]);
    await scan(db, p, 0, { stageUpdates: false });
    expect(p.asked).toHaveLength(1);
    expect(db.tables.holler_matches ?? []).toHaveLength(0);
  });
  it('the flag is documented in .env.example and LAUNCH.md', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('.env.example', 'utf8')).toMatch(/^HOLLER_STAGE_UPDATES_ENABLED=$/m);
    const launch = readFileSync('LAUNCH.md', 'utf8');
    expect(launch).toContain('HOLLER_STAGE_UPDATES_ENABLED');
    expect(launch).toContain('/api/admin/stage-probe');
  });
});

describe('P3 items of review 2', () => {
  it('P3-B: the re-send log goes to the source of the signal, not the first source of the report', async () => {
    const other: Adapter = { id: 'a-first', label: 'first', kind: 'report', cadenceMinutes: 60, sourceUrl: 'https://example.com', fetch: async () => [] };
    const db = new FakeDb({ holler_profiles: people(), holler_signals: [storedPermit(1, 'NF-S')], holler_permit_stages: [hist('NF-S', 'issued', 1)], holler_project_links: [], holler_dedupe_drops: [], holler_matches: [{ id: 1, user_id: 'landscaper', signal_id: 1, notified: true, pushed_at: 'sent', status: 'new' }] });
    db.failOn['holler_matches.update'] = 'boom';
    const p = portal(() => [permit('S', { status: 'Final', ':updated_at': TODAY })]);
    const r = await runScan({ now: at(1), adapters: [other, buildSocrataAdapter(ds)], fetchImpl: p.fetchImpl, stageUpdates: true } as any, asDb(db));
    const logsOf = (id: string) => r.sources.find((s) => s.id === id)!.logs.join(' ');
    expect(logsOf('a-first')).not.toMatch(/re-send/);
    expect(logsOf(ds.id)).toMatch(/re-send skipped/);
  });

  it('P3-D: a follower whose first record is gone stands on its own: its stage update goes to it, and it stops being a follower', async () => {
    const follower = storedPermit(2, 'NF-FOL', { data: { subtype: 'permit', projectOf: `${ds.id}:NF-GONE` } });
    const db = new FakeDb({
      holler_profiles: [member('cleaner', ['cleaning'])], holler_signals: [follower], holler_permit_stages: [hist('NF-FOL', 'issued', 2)], holler_dedupe_drops: [],
      holler_project_links: [{ project_key: 'k', source: ds.id, external_id: 'NF-FOL', signal_id: 2, occurred_at: '2026-10-10T00:00:00Z', root_source: ds.id, root_external_id: 'NF-GONE' }],
    });
    await scan(db, portal(() => [permit('FOL', { status: 'Final', ':updated_at': TODAY })]));
    const sig = db.tables.holler_signals.find((s) => s.external_id === 'NF-FOL')!;
    expect(sig.data.projectOf).toBeUndefined();
    expect(sig.data).toMatchObject({ permitStage: 'finaled', permitStageUpdate: true });
    expect(cards(db, 'cleaner')).toBe(1);
  });

  it('P3-D: the status history keeps 400 days: older rows are deleted by the daily housekeeping, newer ones stay', async () => {
    expect(STAGE_HISTORY_DAYS).toBe(400);
    const old = new Date(NOW.getTime() - 401 * 86_400_000).toISOString();
    const recent = new Date(NOW.getTime() - 399 * 86_400_000).toISOString();
    const db = new FakeDb({ holler_permit_stages: [{ ...hist('A', 'issued', null), first_seen_at: old }, { ...hist('B', 'issued', null), first_seen_at: recent }], holler_dedupe_drops: [] });
    await new ProjectStore(asDb(db), () => undefined, NOW, true).pruneOld();
    expect(db.tables.holler_permit_stages.map((r) => r.permit_id)).toEqual(['B']);
  });
});

describe('decision 5: GET /api/admin/stage-probe is Bearer only, runs one stage query, and writes nothing', () => {
  const load = async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    const admin = vi.fn(() => { throw new Error('the probe must not create a database client'); });
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: admin }));
    const { GET } = await import('../../app/api/admin/stage-probe/route');
    return { GET, admin };
  };
  const req = (path: string, auth: string | null = 'Bearer s3cret') => new Request(`http://x.test${path}`, { headers: auth ? { authorization: auth } : {} });

  it('401 without the secret, with a wrong one and for ?key=; no portal call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { GET } = await load();
    expect((await GET(req('/api/admin/stage-probe?source=socrata-sf-permits', null))).status).toBe(401);
    expect((await GET(req('/api/admin/stage-probe?source=socrata-sf-permits', 'Bearer nope'))).status).toBe(401);
    expect((await GET(req('/api/admin/stage-probe?source=socrata-sf-permits&key=s3cret', null))).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('no source: 400 with the known ids; an unknown source: 400; neither calls the portal', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { GET } = await load();
    const list = await GET(req('/api/admin/stage-probe'));
    expect(list.status).toBe(400);
    expect((await list.json()).knownSources).toContain('socrata-sf-permits');
    expect((await GET(req('/api/admin/stage-probe?source=socrata-austin-permits'))).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('a source whose portal accepts the column: row count, sample statuses, accepted true; the database is never touched', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify([{ permit_number: 'A', status: 'complete', status_date: '2026-11-20T08:00:00.000', permit_type_definition: 'new construction', description: 'x' }, { permit_number: 'B', status: 'final inspection' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { GET, admin } = await load();
    const res = await GET(req('/api/admin/stage-probe?source=socrata-sf-permits'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', source: 'socrata-sf-permits', dateField: 'status_date', dateColumnAccepted: true, state: 'ok', rowCount: 2, sampleStatuses: ['complete', 'final inspection'], wroteNothing: true, flagEnabled: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(admin).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('a portal that refuses the column: accepted false with the portal message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"query.soql.no-such-column","message":"No such column: status_date"}', { status: 400 })));
    const { GET } = await load();
    const body = await (await GET(req('/api/admin/stage-probe?source=socrata-sf-permits'))).json();
    expect(body).toMatchObject({ dateColumnAccepted: false, state: 'rejected', httpStatus: 400, rowCount: 0 });
    expect(body.message).toMatch(/No such column/);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
