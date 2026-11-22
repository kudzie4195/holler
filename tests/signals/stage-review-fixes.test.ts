/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 17 STAGE, redo 1: regression tests for the independent review (review-STAGE.md). Each describe names the defect it covers.
// Rows are hand written (assumed shapes) or built from this repo's adapter fixtures; no portal was called.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { fakeTables } from '../match/fake-table';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';
import { parseArcgis, buildArcgisQuery } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { parseJohnsCreek } from '@/lib/signals/adapters/arcgis-johnscreek';
import { parseSocrata, buildSocrataAdapter, buildSocrataStageQuery, parseSocrataStageRows, mergeStageRows, STAGE_QUERY_DAYS } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { backfillMatches } from '@/lib/signals/backfill';
import { isFollower, matchOne, matchSignals, type MatchProfile } from '@/lib/signals/match';
import { loadDuplicateRates } from '@/lib/signals/dedupe-metrics';
import { permitStageOf } from '@/lib/signals/stage';

const asDb = (f: FakeDb) => f as unknown as Db;
const NOW = new Date('2026-11-20T18:00:00Z');
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const SF = { lat: 37.77, lon: -122.42 };
const ad = (id: string, rows: () => SignalInput[], extra: Partial<Adapter> = {}): Adapter => ({ id, label: id, kind: 'permit', cadenceMinutes: 360, sourceUrl: 'https://example.com', fetch: async () => rows(), ...extra });
const sfMember = (id: string, categories: string[], over: Record<string, unknown> = {}) => ({
  user_id: id, categories, lat: SF.lat, lon: SF.lon, state: 'CA', radius_mi: 25, subscription_status: 'active', trial_ends_at: '2026-11-01T00:00:00Z', ...over,
});
const matchesOf = (db: FakeDb, user: string) => db.tables.holler_matches.filter((m) => m.user_id === user);
const signalAt = (db: FakeDb, externalId: string) => db.tables.holler_signals.find((s) => s.external_id === externalId);
const tablesMissing = (db: FakeDb) => {
  for (const t of ['holler_permit_stages', 'holler_project_links', 'holler_dedupe_drops']) for (const op of ['select', 'upsert', 'insert', 'update', 'delete']) db.failOn[`${t}.${op}`] = `relation "public.${t}" does not exist`;
  return db;
};
/** The member's card is "sent" (emailed and pushed), as it would be some hours after the scan. */
const markSent = (db: FakeDb) => { for (const m of db.tables.holler_matches) Object.assign(m, { notified: true, pushed_at: '2026-11-20T00:00:00Z', status: 'new' }); };

const newHome = (id: string, over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'socrata-sf-permits', externalId: id, kind: 'permit', title: 'New home permit in San Francisco', summary: 'new construction wood frame | 500 EXAMPLE LN',
  categories: ['general-contractor', 'real-estate', 'moving'], severity: 1, occurredAt: '2026-11-19T06:00:00Z', lat: SF.lat, lon: SF.lon, city: 'San Francisco', state: 'CA',
  data: { subtype: 'permit' }, ...over,
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe('P1-1 (review PROBE A): three DeKalb HVAC permits at one address are three stored permits and one card', () => {
  const ds = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;
  const feature = (id: string, hour: number) => ({
    attributes: { applicationNumber: id, issuedDateTime: Date.UTC(2026, 10, 18, 12 + hour), WorkTypeDescription: 'Residential Air Conditioning', OccupancyTypeDescription: 'Single Family Dwelling', statusDescription: 'Issued', location: '100 MAIN ST, DECATUR GA 30030' },
    geometry: { x: -84.2901, y: 33.7402 },
  });
  const rows = () => parseArcgis({ features: [feature('3190001', 0), feature('3190002', 1), feature('3190003', 2)] }, ds);
  const dekalb = () => ad('arcgis-dekalb-permits', rows);
  const hvac = { user_id: 'hvac', categories: ['hvac'], lat: 33.74, lon: -84.29, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: '2026-11-01T00:00:00Z' };

  it('through runScan with 0025 applied: all three stored, linked, tracked; one card per member; nothing logged as "not stored"', async () => {
    expect(rows()).toHaveLength(3);
    const db = new FakeDb({ holler_profiles: [hvac] });
    const a = dekalb();
    const r = await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals.map((s) => s.external_id)).toEqual(['3190001', '3190002', '3190003']);
    expect(r.sources[0].inserted).toBe(3);
    expect(signalAt(db, '3190002')!.data.projectOf).toBe('arcgis-dekalb-permits:3190001');
    expect(signalAt(db, '3190003')!.data.projectOf).toBe('arcgis-dekalb-permits:3190001');
    expect(signalAt(db, '3190001')!.data.projectOf).toBeUndefined();
    expect(matchesOf(db, 'hvac').map((m) => m.signal_id)).toEqual([signalAt(db, '3190001')!.id]);
    expect(db.tables.holler_project_links).toHaveLength(3);
    expect(db.tables.holler_permit_stages.map((s) => s.permit_id).sort()).toEqual(['3190001', '3190002', '3190003']); // each permit keeps its own history
    expect(db.tables.holler_dedupe_drops.map((d) => d.kind)).toEqual(['duplicate', 'duplicate']);
    expect(r.sources[0].logs.join(' ')).not.toMatch(/not stored/);
    // a second scan changes nothing
    const again = await runScan({ now: later(6), adapters: [a], source: a.id }, asDb(db));
    expect(again.sources[0].inserted).toBe(0);
    expect(db.tables.holler_signals).toHaveLength(3);
    expect(db.tables.holler_matches).toHaveLength(1);
  });

  it('with the tables missing the same three are stored and carded as before (the old behaviour, unchanged)', async () => {
    const db = tablesMissing(new FakeDb({ holler_profiles: [hvac] }));
    const a = dekalb();
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(3);
    expect(matchesOf(db, 'hvac')).toHaveLength(3);
  });

  it('Johns Creek STE 100 and STE 220 (review r1 repro B) are both stored and neither is a follower', async () => {
    const f = (id: string, addr: string) => ({ attributes: { JobID: id, JobTypeDescription: 'Electrical', JobAddress: addr, JobStatus: 'Issued', ISSUE_DATE: Date.UTC(2026, 10, 18) }, geometry: { x: -84.2, y: 34.03 } });
    const jc = parseJohnsCreek({ features: [f('ELCT-26-0101', '100 Main Street STE 100'), f('ELCT-26-0102', '100 Main Street STE 220')] });
    const db = new FakeDb({ holler_profiles: [] });
    const a = ad(jc[0].source, () => jc);
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(2);
    expect(db.tables.holler_dedupe_drops ?? []).toHaveLength(0);
  });
});

describe('P1-1 related (review PROBE E): two permits stored before 0025 are not logged as "not stored" after it is applied', () => {
  it('links both as they are, says nothing about them, and records each permit\'s own stage', async () => {
    const row = (id: string): SignalInput => newHome(id, { categories: ['general-contractor'], title: 'Remodel permit in San Francisco', summary: 'Remodel | 500 EXAMPLE LN', permitStage: 'issued' });
    const db = tablesMissing(new FakeDb({ holler_profiles: [] }));
    const a = ad('socrata-sf-permits', () => [row('P-1'), row('P-2')]);
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(2);
    db.failOn = {}; // migration applied
    const r = await runScan({ now: later(6), adapters: [a], source: a.id }, asDb(db));
    expect(r.sources[0].logs.join(' ')).not.toMatch(/not stored|another listing|corroborate/);
    expect(db.tables.holler_dedupe_drops).toHaveLength(0);
    expect(db.tables.holler_project_links.map((l) => [l.external_id, l.root_source])).toEqual([['P-1', null], ['P-2', null]]);
    expect(db.tables.holler_permit_stages.map((s) => s.permit_id).sort()).toEqual(['P-1', 'P-2']);
    expect(signalAt(db, 'P-2')!.data.projectOf).toBeUndefined(); // stored rows are never rewritten
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe('P2-2: a follower never makes a card, in any matching path', () => {
  const follower = { id: 2, source: 'socrata-sf-permits', kind: 'permit', title: 'New home permit in San Francisco', summary: 'new construction | 500 EXAMPLE LN', categories: ['general-contractor', 'real-estate', 'moving'], lat: SF.lat, lon: SF.lon, state: 'CA', severity: 1, occurred_at: '2026-11-19T06:00:00Z', data: { subtype: 'permit', projectOf: 'socrata-sf-permits:1' } };
  const root = { ...follower, id: 1, data: { subtype: 'permit' } };
  const mover: MatchProfile = { user_id: 'u-mover', categories: ['moving'], lat: SF.lat, lon: SF.lon, state: null, radius_mi: 25 };

  it('matchOne and matchSignals: the root matches, the follower does not', () => {
    expect(isFollower(follower as any)).toBe(true);
    expect(matchOne(root as any, mover, undefined, NOW.getTime())).not.toBeNull();
    expect(matchOne(follower as any, mover, undefined, NOW.getTime())).toBeNull();
    expect(matchSignals([root, follower] as any, [mover], undefined, NOW).map((m) => m.signal_id)).toEqual([1]);
  });

  it('the signup and settings backfill gives a new member ONE card for a project listed twice', async () => {
    const d = fakeTables({ holler_signals: [], holler_matches: [] }) as any;
    d.rpc = () => ({ select: () => Promise.resolve({ data: [root, follower], error: null }) });
    const r = await backfillMatches(d, mover, NOW);
    expect(r.error).toBeUndefined();
    expect(d.tables.holler_matches.map((m: { signal_id: number }) => m.signal_id)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe('P2-1 and P2-2: a stage change reaches the members who hold the card, once, and never makes a second card', () => {
  let stage: SignalInput['permitStage'] = 'issued';
  const a = ad('socrata-sf-permits', () => [newHome('N-1', { permitStage: stage })]);
  const scan = (db: FakeDb, h: number) => runScan({ now: later(h), adapters: [a], source: a.id, stageUpdates: true }, asDb(db));

  it('re-arms the existing card ONCE (email digest and push), gives a new card to members without one, and never repeats', async () => {
    const db = new FakeDb({ holler_profiles: [sfMember('landscaper', ['landscaping']), sfMember('roofer', ['roofing'])] });
    stage = 'issued';
    await scan(db, 0);
    markSent(db);
    const card = matchesOf(db, 'landscaper')[0];
    db.tables.holler_profiles.push(sfMember('security', ['security']), sfMember('mover-lawn', ['moving', 'landscaping']));
    stage = 'final_inspection';
    await scan(db, 6);
    // the holder: the same card, back to "not sent" for the digest and the push
    expect(matchesOf(db, 'landscaper')).toHaveLength(1);
    expect(matchesOf(db, 'landscaper')[0]).toMatchObject({ id: card.id, notified: false, pushed_at: null });
    // members without a card get one new card each (P3-1: the multi-trade member too), a roofer none
    expect(matchesOf(db, 'security')).toHaveLength(1);
    expect(matchesOf(db, 'mover-lawn')).toHaveLength(1);
    expect(matchesOf(db, 'roofer')).toHaveLength(0);
    expect(db.tables.holler_signals).toHaveLength(1);
    expect(signalAt(db, 'N-1')!.data).toMatchObject({ permitStage: 'final_inspection' });
    // the alert is sent, then the same status is read again, and later stages come: nothing is re-armed
    markSent(db);
    await scan(db, 12);
    await scan(db, 18);
    stage = 'finaled';
    await scan(db, 24);
    expect(db.tables.holler_matches.every((m) => m.notified === true && m.pushed_at === '2026-11-20T00:00:00Z')).toBe(true);
    expect(db.tables.holler_matches).toHaveLength(3);
    expect(signalAt(db, 'N-1')!.data.permitStage).toBe('finaled'); // the card line follows
  });

  it('a stage change on a FOLLOWER updates the project\'s first record: no second card, one update for the project', async () => {
    const rows = (s2: SignalInput['permitStage'], s1: SignalInput['permitStage']) => [
      newHome('A-1', { permitStage: s1 }),
      newHome('A-2', { permitStage: s2, occurredAt: '2026-11-19T09:00:00Z' }), // same address, same trade, three hours later: another listing
    ];
    let s1: SignalInput['permitStage'] = 'issued';
    let s2: SignalInput['permitStage'] = 'issued';
    const b = ad('socrata-sf-permits', () => rows(s2, s1));
    const db = new FakeDb({ holler_profiles: [sfMember('landscaper', ['landscaping'])] });
    await runScan({ now: NOW, adapters: [b], source: b.id, stageUpdates: true }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(2);
    expect(signalAt(db, 'A-2')!.data.projectOf).toBe('socrata-sf-permits:A-1');
    expect(db.tables.holler_matches.map((m) => m.signal_id)).toEqual([signalAt(db, 'A-1')!.id]);
    markSent(db);
    db.tables.holler_profiles.push(sfMember('security', ['security']));

    s2 = 'final_inspection'; // the follower's permit reaches final inspection first
    await runScan({ now: later(6), adapters: [b], source: b.id, stageUpdates: true }, asDb(db));
    expect(signalAt(db, 'A-1')!.data.permitStage).toBe('final_inspection'); // the project's card carries it
    expect(signalAt(db, 'A-2')!.data.permitStage).toBeUndefined();
    expect(matchesOf(db, 'security').map((m) => m.signal_id)).toEqual([signalAt(db, 'A-1')!.id]); // a card on the first record, none on the follower
    expect(db.tables.holler_matches.filter((m) => m.signal_id === signalAt(db, 'A-2')!.id)).toHaveLength(0);
    expect(matchesOf(db, 'landscaper')[0].notified).toBe(false);

    markSent(db);
    s1 = 'final_inspection'; // the first record's own permit follows: the project is not updated a second time
    await runScan({ now: later(12), adapters: [b], source: b.id, stageUpdates: true }, asDb(db));
    expect(db.tables.holler_matches).toHaveLength(2);
    expect(db.tables.holler_matches.every((m) => m.notified === true)).toBe(true);
    expect(db.tables.holler_permit_stages.filter((s) => s.stage === 'final_inspection')).toHaveLength(2); // each permit keeps its own history
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe('P3 items', () => {
  it('P3-2 (PROBE D): "Final Approved", "Final Passed" and "Certificate of Completion" are finished; failures and "Closed" are not', () => {
    for (const v of ['Final Approved', 'Final Passed', 'Certificate of Completion', 'final accepted']) expect(permitStageOf(v), v).toBe('finaled');
    for (const v of ['Final Inspection Failed', 'Not Final', 'Closed', 'Open']) expect(permitStageOf(v), v).not.toBe('finaled');
    expect(permitStageOf('Closed')).toBeNull();
  });

  it('P3-3: a failed stored-rows count is blank on the dashboard, never 100%', async () => {
    const db = new FakeDb({ holler_dedupe_drops: [{ source: 'socrata-sf-permits', external_id: '1', kind: 'duplicate', of_source: 'socrata-sf-permits', of_external_id: '0', dropped_at: NOW.toISOString() }] });
    db.failOn['holler_signals.select'] = 'count failed';
    const d = await loadDuplicateRates(asDb(db), NOW);
    expect(d.status).toBe('ok');
    expect(d.bySource).toEqual([{ source: 'socrata-sf-permits', duplicates: 1, corroborations: 0, stored: null, rate: null }]);
    const { renderQualityHtml } = await import('@/lib/admin/quality-html');
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const bad = new FakeDb({ holler_profiles: [], holler_dedupe_drops: db.tables.holler_dedupe_drops });
    bad.failOn['holler_signals.select'] = 'count failed';
    const html = renderQualityHtml(await loadQualityReport(bad as never, NOW));
    expect(html).toContain('<td>blank</td><td>blank</td>');
    expect(html).not.toMatch(/<td>100%<\/td>/);
  });

  it('P3-4: the ArcGIS query asks for the status column by name, even when summaryFields does not list it', () => {
    const ds = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;
    const bare = { ...ds, summaryFields: ds.summaryFields.filter((f) => f !== ds.statusField) };
    expect(buildArcgisQuery(bare, NOW).get('outFields')!.split(',')).toContain('statusDescription');
    const cobb = ARCGIS_DATASETS.find((d) => !d.statusField && d.subtype === 'permit')!;
    expect(buildArcgisQuery(cobb, NOW).get('outFields')!.split(',')).not.toContain('statusDescription');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe('P1-2 (redo 2): the stage query is a probe of permits Holler already tracks, never a source of cards', () => {
  const sf = SOCRATA_DATASETS.find((d) => d.id === 'socrata-sf-permits')!;
  const chicago = SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-permits')!;
  const austin = SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-permits')!;
  const sfRow = (id: string, over: Record<string, unknown> = {}) => ({
    permit_number: id, permit_type_definition: 'new construction wood frame', description: 'new 3 story single family dwelling', status: 'complete', status_date: '2026-11-20T08:00:00.000',
    issued_date: '2026-05-01T00:00:00.000', estimated_cost: '900000', street_number: '500', street_name: 'Example', street_suffix: 'Ln', zipcode: '94110',
    location: { type: 'Point', coordinates: [SF.lon, SF.lat] }, ...over,
  });

  it('builds one capped page on the status date (SF) or on the row-update time (Chicago); no created-before guard; none without a status column', () => {
    const q = buildSocrataStageQuery(sf, NOW)!;
    expect(q.get('$where')).toContain("status_date > '2026-11-17T10:00:00'"); // 3 days back, in the portal's own local clock (LA)
    expect(q.get('$where')).toContain("upper(status) like '%FINAL%'");
    expect(q.get('$where')).not.toContain(':created_at');
    expect(q.get('$order')).toBe('status_date DESC');
    expect(q.get('$limit')).toBe('500');
    expect(q.get('$select')).toBeNull();
    expect(STAGE_QUERY_DAYS).toBe(3);
    const c = buildSocrataStageQuery(chicago, NOW)!;
    expect(c.get('$where')).toContain(":updated_at > '2026-11-17T18:00:00'"); // a Socrata system column is UTC
    expect(c.get('$where')).not.toContain(':created_at');
    expect(c.get('$select')).toBeNull();
    expect(buildSocrataStageQuery(austin, NOW)).toBeNull();
    expect(buildSocrataStageQuery({ ...sf, statusField: undefined }, NOW)).toBeNull();
  });

  it('keeps only final-ish rows, each marked as a probe (never inserted); the date filter is the portal\'s job', () => {
    const out = parseSocrataStageRows([sfRow('S-1'), sfRow('S-2', { status: 'Final Inspection Failed' }), sfRow('S-3', { status: 'issued' })], sf);
    expect(out.map((r) => r.externalId)).toEqual(['S-1']);
    expect(out[0]).toMatchObject({ permitStage: 'finaled', stageProbe: true });
    expect(out[0]).not.toHaveProperty('stageAt');
  });

  it('merges: a permit in both reads keeps its main row; the others are added as probes', () => {
    const main = [newHome('M-1', { permitStage: 'issued' }), newHome('M-2')];
    const stage = [newHome('M-1', { permitStage: 'finaled', stageProbe: true }), newHome('M-3', { permitStage: 'finaled', stageProbe: true })];
    const merged = mergeStageRows(main, stage);
    expect(merged.map((r) => r.externalId)).toEqual(['M-1', 'M-2', 'M-3']);
    expect(merged[0].stageProbe).toBeUndefined();
    expect(merged[2].stageProbe).toBe(true);
  });

  /** A fetch that answers the main query with `main` rows and the stage query with `stage`, and records what was asked. */
  const portal = (main: unknown[], stage: unknown[] | number | Error) => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = decodeURIComponent(String(url)).replace(/\+/g, ' ');
      asked.push(u);
      if (u.includes('status_date >') || u.includes(':updated_at >')) {
        if (stage instanceof Error) throw stage;
        if (typeof stage === 'number') return new Response('{"error":true}', { status: stage });
        return new Response(JSON.stringify(stage), { status: 200 });
      }
      return new Response(JSON.stringify(main), { status: 200 });
    }) as unknown as typeof fetch;
    return { asked, fetchImpl };
  };
  const sfAdapter = buildSocrataAdapter(sf);
  const ctx = (fetchImpl: typeof fetch, stageTracking?: boolean) => {
    const logs: string[] = [];
    const outcomes: Array<{ state: string }> = [];
    return { logs, outcomes, c: { since: NOW, now: NOW, fetch: fetchImpl, env: {}, log: (m: string) => logs.push(m), stageOutcome: (o: { state: string }) => outcomes.push(o), ...(stageTracking !== undefined ? { stageTracking } : {}) } };
  };

  it('is made only while the flag is on and 0025 is applied: without it the adapter fetches exactly one page, as before', async () => {
    const p = portal([sfRow('S-9', { status: 'issued', issued_date: '2026-11-19T00:00:00.000' })], [sfRow('S-1')]);
    expect(sfAdapter.stageQuery).toBe(true);
    const off = ctx(p.fetchImpl);
    expect((await sfAdapter.fetch(off.c)).map((r) => r.externalId)).toEqual(['S-9']);
    expect(p.asked).toHaveLength(1);
    const on = ctx(p.fetchImpl, true);
    expect((await sfAdapter.fetch(on.c)).map((r) => r.externalId)).toEqual(['S-9', 'S-1']);
    expect(p.asked).toHaveLength(3);
  });

  it('a portal that rejects the date column, or fails, costs nothing: the main rows come back, the outcome is reported, the log has no error words', async () => {
    for (const stage of [400, 500, new Error('socket hang up')]) {
      const p = portal([sfRow('S-9', { status: 'issued', issued_date: '2026-11-19T00:00:00.000' })], stage);
      const { c, logs, outcomes } = ctx(p.fetchImpl, true);
      expect((await sfAdapter.fetch(c)).map((r) => r.externalId)).toEqual(['S-9']);
      expect(logs.join(' ')).toMatch(/stage query not used/);
      expect(logs.join(' ')).not.toMatch(/\b(error|failed|failure|timeout|http\s?[45]\d\d|status\s?[45]\d\d)\b/i);
      expect(outcomes).toHaveLength(1);
      expect(['rejected', 'failed']).toContain(outcomes[0].state);
    }
  });

  describe('through runScan', () => {
    const history = (id: string, stage: string, signalId: number | null = 7) => ({ source: 'socrata-sf-permits', permit_id: id, stage, signal_id: signalId, emitted: false });
    const stored = (id: number, ext: string, over: Record<string, unknown> = {}) => ({
      id, source: 'socrata-sf-permits', external_id: ext, kind: 'permit', title: 'New home permit in San Francisco', summary: 'new construction wood frame | 500 Example Ln',
      categories: ['general-contractor', 'real-estate', 'moving'], lat: SF.lat, lon: SF.lon, state: 'CA', severity: 1, occurred_at: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(), data: { subtype: 'permit' }, ...over,
    });
    const run = (fetchImpl: typeof fetch, h = 0, stageUpdates = true) => ({ now: later(h), adapters: [buildSocrataAdapter(sf)], source: 'socrata-sf-permits', fetchImpl, stageUpdates });

    it('DECISION 1: a recently touched permit Holler has never seen creates NOTHING: no row, no card, no history row, no alert', async () => {
      const p = portal([], [sfRow('OLD-1')]);
      const db = new FakeDb({ holler_profiles: [sfMember('landscaper', ['landscaping']), sfMember('cleaner', ['cleaning']), sfMember('mover', ['moving'])] });
      const r = await runScan(run(p.fetchImpl), asDb(db));
      expect(r.error).toBeUndefined();
      expect(r.sources[0].status).toBe('ok');
      expect(db.tables.holler_signals ?? []).toHaveLength(0);
      expect(db.tables.holler_matches ?? []).toHaveLength(0);
      expect(db.tables.holler_permit_stages ?? []).toHaveLength(0);
      expect(r.sources[0].fetched).toBe(0); // probe rows are not counted as rows the source returned
    });

    it('a stored permit with history whose status changed: updates the card, re-arms it once, new card for a member without one; the repeat does nothing', async () => {
      const p = portal([], [sfRow('OLD-2')]);
      const db = new FakeDb({
        holler_profiles: [sfMember('landscaper', ['landscaping']), sfMember('security', ['security'])],
        holler_signals: [stored(7, 'OLD-2')],
        holler_permit_stages: [history('OLD-2', 'issued')],
        holler_matches: [{ id: 1, user_id: 'landscaper', signal_id: 7, notified: true, pushed_at: 'earlier', status: 'new' }],
      });
      await runScan(run(p.fetchImpl), asDb(db));
      expect(db.tables.holler_signals).toHaveLength(1);
      expect(signalAt(db, 'OLD-2')!.data).toMatchObject({ permitStage: 'finaled', permitStageUpdate: true });
      expect(db.tables.holler_matches.find((m) => m.user_id === 'landscaper')).toMatchObject({ id: 1, notified: false, pushed_at: null });
      expect(matchesOf(db, 'security').map((m) => m.signal_id)).toEqual([7]);
      markSent(db);
      await runScan(run(p.fetchImpl, 6), asDb(db));
      await runScan(run(p.fetchImpl, 12), asDb(db));
      expect(db.tables.holler_matches).toHaveLength(2);
      expect(db.tables.holler_matches.every((m) => m.notified === true)).toBe(true);
    });

    it('a stored permit with NO history (stored before 0025) is not touched by a probe', async () => {
      const p = portal([], [sfRow('OLD-4')]);
      const db = new FakeDb({ holler_profiles: [sfMember('landscaper', ['landscaping'])], holler_signals: [stored(8, 'OLD-4')], holler_matches: [{ id: 1, user_id: 'landscaper', signal_id: 8, notified: true, pushed_at: 'earlier', status: 'new' }] });
      const before = JSON.stringify(db.tables.holler_signals);
      await runScan(run(p.fetchImpl), asDb(db));
      expect(JSON.stringify(db.tables.holler_signals)).toBe(before);
      expect(db.tables.holler_matches[0].notified).toBe(true);
    });

    it('with 0025 NOT applied: no stage query is made, no stage-only card is stored, and the log names the migration', async () => {
      const p = portal([sfRow('MAIN-1', { status: 'issued', issued_date: '2026-11-19T00:00:00.000', status_date: '2026-11-19T00:00:00.000' })], [sfRow('OLD-3')]);
      const db = tablesMissing(new FakeDb({ holler_profiles: [sfMember('landscaper', ['landscaping'])] }));
      const r = await runScan(run(p.fetchImpl), asDb(db));
      expect(r.error).toBeUndefined();
      expect(p.asked).toHaveLength(1);
      expect(db.tables.holler_signals.map((s) => s.external_id)).toEqual(['MAIN-1']);
      expect(db.tables.holler_signals[0].data).not.toHaveProperty('permitStage');
      expect(r.sources[0].logs.join(' ')).toMatch(/migration 0025/);
      expect(matchesOf(db, 'landscaper')).toHaveLength(1);
    });

    it('with the flag OFF: no stage query is made even with 0025 applied', async () => {
      const p = portal([], [sfRow('OLD-2')]);
      const db = new FakeDb({ holler_profiles: [], holler_signals: [stored(7, 'OLD-2')], holler_permit_stages: [history('OLD-2', 'issued')] });
      await runScan(run(p.fetchImpl, 0, false), asDb(db));
      expect(p.asked).toHaveLength(1);
      expect(db.tables.holler_permit_stages).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe('review PROBE F and units: the real PostgREST "table missing" shape, and units at one street address', () => {
  const austin = SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-permits')!;
  const fixture = () => JSON.parse(readFileSync('tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json', 'utf8')) as Array<Record<string, string>>;

  it('PGRST205 (code plus schema-cache message): rows stored as before, one log line naming migration 0025, dashboard "not applied"', async () => {
    const inner = new FakeDb({ holler_profiles: [] });
    const MISSING = new Set(['holler_permit_stages', 'holler_project_links', 'holler_dedupe_drops']);
    const err = (t: string) => ({ data: null, error: { code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${t}' in the schema cache` }, count: null, status: 404 });
    const chain = (t: string): any => new Proxy(function () {}, { get: (_o, p) => (p === 'then' ? (res: any) => res(err(t)) : () => chain(t)), apply: () => chain(t) });
    const db: any = { from: (t: string) => (MISSING.has(t) ? chain(t) : inner.from(t)) };
    const a = ad('socrata-austin-permits', () => parseSocrata(fixture(), austin));
    const r = await runScan({ now: NOW, adapters: [a], source: a.id }, db);
    expect(inner.tables.holler_signals).toHaveLength(4);
    expect(r.sources[0].status).toBe('ok');
    expect(r.sources[0].logs.join(' ')).toMatch(/migration 0025/);
    expect(inner.tables.holler_signals.every((s) => !('projectOf' in s.data))).toBe(true);
    const d = await loadDuplicateRates(db, NOW);
    expect(d).toMatchObject({ status: 'unavailable', reason: 'migration 0025 is not applied' });
  });

  it('four units at one street address (APT 101, APT 214, UNIT 305, # 7) are four stored permits, none a follower', async () => {
    const base = fixture()[0];
    const addrKey = Object.keys(base).find((k) => typeof base[k] === 'string' && /14TH/i.test(base[k]))!;
    const rows = ['APT 101', 'APT 214', 'UNIT 305', '# 7'].map((u, i) => ({ ...base, permit_number: `U-${i}`, permit_num: `U-${i}`, [addrKey]: `${base[addrKey]} ${u}` }));
    const db = new FakeDb({ holler_profiles: [] });
    const a = ad('socrata-austin-permits', () => parseSocrata(rows, austin));
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(4);
    expect(db.tables.holler_signals.filter((s) => s.data.projectOf)).toHaveLength(0);
  });
});
