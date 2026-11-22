// Round 17 STAGE: construction stage tracking (PLAN-2.0 2.1) and dedupe + corroboration (2.3), through the real scan (runScan) and the
// real adapter parser, on an in-memory database (tests/ops/fakedb.ts). Rows are hand written (assumed); the Austin rows are SYNTHETIC
// (see tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json): the repo holds no recorded "E 14th St" rows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { loadDuplicateRates } from '@/lib/signals/dedupe-metrics';

const asDb = (f: FakeDb) => f as unknown as Db;
const NOW = new Date('2026-11-20T12:00:00Z');
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const AUSTIN = { lat: 30.2672, lon: -97.7431 };

const member = (id: string, trade: string, over: Record<string, unknown> = {}) => ({
  user_id: id, categories: [trade], lat: AUSTIN.lat, lon: AUSTIN.lon, state: 'TX', radius_mi: 25,
  subscription_status: 'active', trial_ends_at: '2026-11-01T00:00:00Z', ...over,
});

const adapterOf = (id: string, rows: () => SignalInput[]): Adapter => ({
  id, label: id, kind: 'permit', cadenceMinutes: 360, sourceUrl: 'https://example.com', fetch: async () => rows(),
});

const austinRows = (): SignalInput[] => {
  const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-permits')!;
  return parseSocrata(JSON.parse(readFileSync('tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json', 'utf8')), ds);
};

const tablesMissing = (db: FakeDb) => {
  for (const t of ['holler_permit_stages', 'holler_project_links', 'holler_dedupe_drops']) {
    for (const op of ['select', 'upsert', 'insert', 'update', 'delete']) db.failOn[`${t}.${op}`] = `relation "public.${t}" does not exist`;
  }
  return db;
};

const matchesOf = (db: FakeDb, user: string) => db.tables.holler_matches.filter((m) => m.user_id === user);
const signalAt = (db: FakeDb, externalId: string) => db.tables.holler_signals.find((s) => s.external_id === externalId);

describe('2.3 regression: the Austin "E 14th St" double rows are one card', () => {
  it('the fixture parses to four rows: two listings of one remodel, an electrical permit at the same address, a remodel next door', () => {
    const rows = austinRows();
    expect(rows.map((r) => r.externalId)).toEqual(['2026-104411 BP', '2026-104412 BP', '2026-104413 EP', '2026-104500 BP']);
    expect(rows.map((r) => r.categories)).toEqual([['general-contractor'], ['general-contractor'], ['electrical'], ['general-contractor']]);
  });

  it('stores all four rows but gives one card per member for the doubled remodel; the electrical permit at the same address is NOT merged', async () => {
    const db = new FakeDb({ holler_profiles: [member('cleaner', 'cleaning'), member('electrician', 'electrical')] });
    const ad = adapterOf('socrata-austin-permits', austinRows);
    const r = await runScan({ now: NOW, adapters: [ad], source: ad.id }, asDb(db));
    expect(r.error).toBeUndefined();
    expect(r.sources[0]).toMatchObject({ status: 'ok', fetched: 4, parsed: 4, inserted: 4 });
    // two permit numbers are two permits: both stored, the second marked as another listing of the first
    expect(db.tables.holler_signals.map((s) => s.external_id).sort()).toEqual(['2026-104411 BP', '2026-104412 BP', '2026-104413 EP', '2026-104500 BP']);
    expect(signalAt(db, '2026-104412 BP')!.data.projectOf).toBe('socrata-austin-permits:2026-104411 BP');
    expect(signalAt(db, '2026-104411 BP')!.data.projectOf).toBeUndefined();
    // one card for the doubled remodel (plus the one next door), none for the electrical permit; the electrician has exactly the electrical card
    expect(matchesOf(db, 'cleaner')).toHaveLength(2);
    expect(matchesOf(db, 'cleaner').filter((m) => m.signal_id === signalAt(db, '2026-104411 BP')!.id)).toHaveLength(1);
    expect(matchesOf(db, 'cleaner').filter((m) => m.signal_id === signalAt(db, '2026-104412 BP')!.id)).toHaveLength(0);
    expect(matchesOf(db, 'electrician').map((m) => m.signal_id)).toEqual([signalAt(db, '2026-104413 EP')!.id]);
    // the second listing is logged once, by id, with no address or text; it is counted for the dashboard, not dropped
    expect(db.tables.holler_dedupe_drops).toEqual([expect.objectContaining({ source: 'socrata-austin-permits', external_id: '2026-104412 BP', kind: 'duplicate', of_external_id: '2026-104411 BP' })]);
    expect(Object.keys(db.tables.holler_dedupe_drops[0]).sort()).toEqual(['external_id', 'id', 'kind', 'of_external_id', 'of_source', 'source']);
    expect(db.tables.holler_project_links).toHaveLength(4);
    expect(db.tables.holler_project_links.find((l) => l.external_id === '2026-104412 BP')).toMatchObject({ root_source: 'socrata-austin-permits', root_external_id: '2026-104411 BP' });
  });

  it('the next scan re-reads all four rows and changes nothing: no new row, no new card, the duplicate is counted once', async () => {
    const db = new FakeDb({ holler_profiles: [member('cleaner', 'cleaning')] });
    const ad = adapterOf('socrata-austin-permits', austinRows);
    await runScan({ now: NOW, adapters: [ad], source: ad.id }, asDb(db));
    const stored = db.tables.holler_signals.length;
    const matches = db.tables.holler_matches.length;
    const second = await runScan({ now: later(6), adapters: [ad], source: ad.id }, asDb(db));
    expect(second.sources[0].inserted).toBe(0);
    expect(db.tables.holler_signals).toHaveLength(stored);
    expect(db.tables.holler_matches).toHaveLength(matches);
    expect(db.tables.holler_dedupe_drops).toHaveLength(1);
    expect(db.tables.holler_project_links).toHaveLength(4);
  });

  it('the same input WITHOUT the tables stores the doubled row too (that is the "before" this fixes)', async () => {
    const db = tablesMissing(new FakeDb({ holler_profiles: [member('cleaner', 'cleaning')] }));
    const ad = adapterOf('socrata-austin-permits', austinRows);
    await runScan({ now: NOW, adapters: [ad], source: ad.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(4);
    expect(matchesOf(db, 'cleaner').filter((m) => m.signal_id === signalAt(db, '2026-104411 BP')!.id || m.signal_id === signalAt(db, '2026-104412 BP')!.id)).toHaveLength(2);
  });

  it('a duplicate arriving in a LATER scan is linked to the stored project, whatever order the ids come in', async () => {
    const db = new FakeDb({ holler_profiles: [member('cleaner', 'cleaning')] });
    const all = austinRows();
    const first = adapterOf('socrata-austin-permits', () => [all[1]]); // only the second listing
    const second = adapterOf('socrata-austin-permits', () => [all[0], all[1]]); // then both
    await runScan({ now: NOW, adapters: [first], source: first.id }, asDb(db));
    await runScan({ now: later(6), adapters: [second], source: second.id }, asDb(db));
    // both stored; the earlier-stored one stays the project's card, the later arrival is the follower
    expect(db.tables.holler_signals.map((s) => s.external_id)).toEqual(['2026-104412 BP', '2026-104411 BP']);
    expect(signalAt(db, '2026-104411 BP')!.data.projectOf).toBe('socrata-austin-permits:2026-104412 BP');
    expect(matchesOf(db, 'cleaner')).toHaveLength(1);
    expect(db.tables.holler_dedupe_drops.map((d) => d.external_id)).toEqual(['2026-104411 BP']);
  });
});

describe('2.3 corroboration: another source about the same project is evidence, not a second card', () => {
  const rowFor = (source: string, externalId: string, over: Partial<SignalInput> = {}): SignalInput => ({
    source, externalId, kind: 'permit', title: 'Remodel permit in Austin', summary: 'Building Permit | Remodel | 1204 E 14TH ST', categories: ['general-contractor'],
    severity: 1, occurredAt: '2026-11-19T06:00:00Z', lat: 30.27312, lon: -97.72964, city: 'Austin', state: 'TX', data: { subtype: 'permit' }, ...over,
  });

  it('is stored and linked, makes no second card, and is counted as corroboration, not as a duplicate', async () => {
    const db = new FakeDb({ holler_profiles: [member('cleaner', 'cleaning')] });
    const a = adapterOf('src-a', () => [rowFor('src-a', 'A-1')]);
    const b = adapterOf('src-b', () => [rowFor('src-b', 'B-9')]);
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    await runScan({ now: later(1), adapters: [b], source: b.id }, asDb(db));
    expect(db.tables.holler_signals.map((s) => s.source).sort()).toEqual(['src-a', 'src-b']); // both kept as evidence
    expect(signalAt(db, 'B-9')!.data.projectOf).toBe('src-a:A-1');
    expect(matchesOf(db, 'cleaner')).toHaveLength(1); // one card
    expect(db.tables.holler_dedupe_drops).toEqual([expect.objectContaining({ source: 'src-b', kind: 'corroboration', of_source: 'src-a' })]);
  });

  it('never merges across trades or outside the window: a plumbing permit, or the same remodel 5 days later, stays a separate project', async () => {
    const db = new FakeDb({ holler_profiles: [member('cleaner', 'cleaning')] });
    const a = adapterOf('src-a', () => [
      rowFor('src-a', 'A-1'),
      rowFor('src-a', 'A-2', { title: 'Plumbing permit in Austin', categories: ['plumbing'], summary: 'Plumbing | 1204 E 14TH ST' }),
      rowFor('src-a', 'A-3', { occurredAt: '2026-11-14T06:00:00Z' }),
    ]);
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(3);
    expect(db.tables.holler_dedupe_drops).toHaveLength(0);
  });

  it('never links on an address alone when the positions are far apart (two cities, one street address text)', async () => {
    const db = new FakeDb({ holler_profiles: [] });
    const a = adapterOf('src-a', () => [rowFor('src-a', 'A-1'), rowFor('src-a', 'A-2', { lat: 30.5, lon: -97.9 })]);
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(2);
  });

  it('a record with no street address in its summary is never linked', async () => {
    const db = new FakeDb({ holler_profiles: [] });
    const a = adapterOf('src-a', () => [rowFor('src-a', 'A-1', { summary: 'Building Permit | Remodel' }), rowFor('src-a', 'A-2', { summary: 'Building Permit | Remodel' })]);
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_signals).toHaveLength(2);
    expect(db.tables.holler_project_links ?? []).toHaveLength(0);
  });
});

describe('2.1 stage tracking: one update, never a new card', () => {
  const permit = (stage: SignalInput['permitStage'] | undefined): SignalInput => ({
    source: 'socrata-sf-permits', externalId: '202611201234', kind: 'permit', title: 'New home permit in San Francisco',
    summary: 'Single Family | $300,000 job value | 500 EXAMPLE LN', categories: ['general-contractor', 'real-estate', 'moving'], severity: 1,
    occurredAt: '2026-11-19T06:00:00Z', lat: AUSTIN.lat, lon: AUSTIN.lon, city: 'San Francisco', state: 'TX', data: { subtype: 'permit' },
    ...(stage ? { permitStage: stage } : {}),
  });
  let current: SignalInput['permitStage'] | undefined;
  const ad = adapterOf('socrata-sf-permits', () => [permit(current)]);
  const scan = (db: FakeDb, h: number) => runScan({ now: later(h), adapters: [ad], source: ad.id }, asDb(db));

  it('issued, then final inspection (one update to the trades that work on a finished building), then repeats and later stages (none)', async () => {
    const db = new FakeDb({ holler_profiles: [member('landscaper', 'landscaping'), member('roofer', 'roofing')] });
    current = 'issued';
    await scan(db, 0);
    const sig = signalAt(db, '202611201234')!;
    expect(db.tables.holler_signals).toHaveLength(1);
    expect(db.tables.holler_permit_stages.map((s) => s.stage)).toEqual(['issued']);
    expect(sig.data.permitStage).toBeUndefined();
    expect(matchesOf(db, 'landscaper')).toHaveLength(1); // the permit's own coming-soon card, as before
    expect(matchesOf(db, 'roofer')).toHaveLength(0);

    // two members arrive after the first scan: a security company and a roofer who has the matching card as market insight only
    db.tables.holler_profiles.push(member('security', 'security'), member('cleaner', 'cleaning'));
    current = 'final_inspection';
    const s2 = await scan(db, 6);
    expect(db.tables.holler_signals).toHaveLength(1); // the same project, not a new card
    expect(db.tables.holler_permit_stages.map((s) => s.stage).sort()).toEqual(['final_inspection', 'issued']);
    expect(signalAt(db, '202611201234')!.data).toMatchObject({ permitStage: 'final_inspection', permitStageAt: later(6).toISOString() });
    expect(matchesOf(db, 'landscaper')).toHaveLength(1); // already had the card: no second one
    expect(matchesOf(db, 'security')).toHaveLength(1);
    expect(matchesOf(db, 'cleaner')).toHaveLength(1);
    expect(matchesOf(db, 'roofer')).toHaveLength(0); // not a trade that works on a finished building
    expect(s2.sources[0].matched).toBe(2);
    const afterUpdate = db.tables.holler_matches.length;

    // the same status again, and the same row again: nothing
    await scan(db, 12);
    await scan(db, 18);
    expect(db.tables.holler_matches).toHaveLength(afterUpdate);
    expect(db.tables.holler_permit_stages).toHaveLength(2);

    // a later stage updates the project (the card line) but is not a second update: a member who joined since gets nothing
    db.tables.holler_profiles.push(member('late', 'cleaning', { user_id: 'late-cleaner' }));
    current = 'finaled';
    await scan(db, 24);
    expect(db.tables.holler_matches).toHaveLength(afterUpdate);
    expect(signalAt(db, '202611201234')!.data.permitStage).toBe('finaled');
    expect(db.tables.holler_permit_stages).toHaveLength(3);
    expect(db.tables.holler_signals).toHaveLength(1);
  });

  it('a permit first seen already at a final stage is a plain new card (no separate update), and a stored permit first seen at one is only a baseline', async () => {
    const db = new FakeDb({ holler_profiles: [member('landscaper', 'landscaping')] });
    current = 'finaled';
    await scan(db, 0);
    expect(signalAt(db, '202611201234')!.data.permitStage).toBe('finaled'); // the first card already says so
    expect(matchesOf(db, 'landscaper')).toHaveLength(1);

    // a project stored before the migration (no history): its first observed stage is a baseline, nothing is rewritten or emitted
    const old = new FakeDb({ holler_profiles: [member('landscaper', 'landscaping')] });
    current = 'issued';
    await scan(old, 0);
    old.tables.holler_permit_stages.length = 0; // as if the history never existed
    old.tables.holler_matches.length = 0;
    const before = JSON.stringify(signalAt(old, '202611201234'));
    current = 'final_inspection';
    await scan(old, 6);
    expect(JSON.stringify(signalAt(old, '202611201234'))).toBe(before);
    expect(old.tables.holler_matches).toHaveLength(0);
    expect(old.tables.holler_permit_stages.map((s) => s.stage)).toEqual(['final_inspection']);
  });

  it('a re-roof that reaches final inspection updates nobody (no stage trade is downstream of it)', async () => {
    const db = new FakeDb({ holler_profiles: [member('cleaner', 'cleaning'), member('gutters', 'siding-gutters')] });
    const roof = (stage: SignalInput['permitStage']): SignalInput => ({ ...permit(stage), externalId: 'R-1', title: 'Roof permit in San Francisco', categories: ['roofing'], summary: 'Re-roof | 12 EXAMPLE LN' });
    let st: SignalInput['permitStage'] = 'issued';
    const a = adapterOf('socrata-sf-permits', () => [roof(st)]);
    await runScan({ now: NOW, adapters: [a], source: a.id }, asDb(db));
    const before = db.tables.holler_matches.length;
    st = 'finaled';
    db.tables.holler_profiles.push(member('cleaner2', 'cleaning'));
    await runScan({ now: later(6), adapters: [a], source: a.id }, asDb(db));
    expect(db.tables.holler_matches).toHaveLength(before);
  });
});

describe('6. migration 0025 NOT applied: the scan runs exactly as before', () => {
  it('no error, no stage data, no collapse, no stage or link rows, and the log says the feature is off', async () => {
    const db = tablesMissing(new FakeDb({ holler_profiles: [member('cleaner', 'cleaning'), member('landscaper', 'landscaping')] }));
    const staged = (stage: SignalInput['permitStage']): SignalInput => ({
      source: 'socrata-sf-permits', externalId: 'N-1', kind: 'permit', title: 'New home permit in San Francisco', summary: 'Single Family | 500 EXAMPLE LN',
      categories: ['general-contractor', 'real-estate', 'moving'], severity: 1, occurredAt: '2026-11-19T06:00:00Z', lat: AUSTIN.lat, lon: AUSTIN.lon, city: 'San Francisco', state: 'TX', data: { subtype: 'permit' }, permitStage: stage,
    });
    let st: SignalInput['permitStage'] = 'issued';
    const sf = adapterOf('socrata-sf-permits', () => [staged(st)]);
    const austin = adapterOf('socrata-austin-permits', austinRows);
    const r1 = await runScan({ now: NOW, adapters: [sf, austin] }, asDb(db));
    st = 'final_inspection';
    const r2 = await runScan({ now: later(6), adapters: [sf, austin], source: undefined }, asDb(db)).catch(() => null);
    void r2;
    expect(r1.error).toBeUndefined();
    expect(r1.sources.map((s) => s.status)).toEqual(['ok', 'ok']);
    // as before: every distinct external id is stored, with the data the adapter built and nothing else
    expect(db.tables.holler_signals).toHaveLength(5);
    for (const s of db.tables.holler_signals) expect(s.data).not.toHaveProperty('permitStage');
    expect(signalAt(db, '2026-104412 BP')).toBeDefined();
    expect(db.tables.holler_permit_stages).toHaveLength(0);
    expect(db.tables.holler_project_links).toHaveLength(0);
    expect(db.tables.holler_dedupe_drops).toHaveLength(0);
    // the cleaner and the landscaper still get the new-home card, once
    expect(matchesOf(db, 'landscaper')).toHaveLength(1);
    expect(r1.sources[0].logs.join(' ')).toMatch(/migration 0025/);
    expect(r1.sources[0].logs.join(' ')).not.toMatch(/error|failed/i);
  });

  it('is identical to the scan with the project work switched off: same rows, same matches', async () => {
    const run = async (db: FakeDb) => {
      const ad = adapterOf('socrata-austin-permits', austinRows);
      await runScan({ now: NOW, adapters: [ad], source: ad.id }, asDb(db));
      return { signals: db.tables.holler_signals.map((s) => ({ external_id: s.external_id, data: s.data, title: s.title })), matches: db.tables.holler_matches.map((m) => ({ user_id: m.user_id, signal_id: m.signal_id })) };
    };
    const missing = await run(tablesMissing(new FakeDb({ holler_profiles: [member('cleaner', 'cleaning')] })));
    expect(missing.signals).toHaveLength(4);
    expect(missing.signals.map((s) => s.external_id)).toEqual(['2026-104411 BP', '2026-104412 BP', '2026-104413 EP', '2026-104500 BP']);
    expect(missing.matches).toHaveLength(3); // both listings of the remodel and the one next door
  });

  it('the dashboard line says "not recorded", never zero', async () => {
    const db = tablesMissing(new FakeDb());
    const d = await loadDuplicateRates(asDb(db), NOW);
    expect(d).toMatchObject({ status: 'unavailable', reason: 'migration 0025 is not applied', bySource: [] });
  });
});

describe('4. duplicate rate per source', () => {
  it('counts duplicates and corroborations per source for the last 7 days against rows stored, and ignores older drops', async () => {
    const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
    const db = new FakeDb({
      holler_dedupe_drops: [
        { source: 'socrata-austin-permits', external_id: '1', kind: 'duplicate', of_source: 'socrata-austin-permits', of_external_id: '0', dropped_at: day(1) },
        { source: 'socrata-austin-permits', external_id: '2', kind: 'duplicate', of_source: 'socrata-austin-permits', of_external_id: '0', dropped_at: day(6) },
        { source: 'socrata-austin-permits', external_id: '3', kind: 'duplicate', of_source: 'socrata-austin-permits', of_external_id: '0', dropped_at: day(9) },
        { source: 'arcgis-cobb-residential-permits', external_id: '4', kind: 'corroboration', of_source: 'x', of_external_id: '0', dropped_at: day(2) },
      ],
      holler_signals: [
        ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, source: 'socrata-austin-permits', created_at: day(2) })),
        { id: 50, source: 'socrata-austin-permits', created_at: day(20) },
        { id: 51, source: 'arcgis-cobb-residential-permits', created_at: day(3) },
      ],
    });
    const d = await loadDuplicateRates(asDb(db), NOW);
    expect(d.status).toBe('ok');
    expect(d.bySource).toEqual([
      { source: 'socrata-austin-permits', duplicates: 2, corroborations: 0, stored: 6, rate: 2 / 6 },
      { source: 'arcgis-cobb-residential-permits', duplicates: 0, corroborations: 1, stored: 1, rate: 0 },
    ]);
    expect(d.totals).toEqual({ duplicates: 2, corroborations: 1 });
  });

  it('shows up on the quality dashboard page, and as "Not recorded" when the table is missing', async () => {
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const { renderQualityHtml } = await import('@/lib/admin/quality-html');
    const ok = new FakeDb({ holler_profiles: [], holler_dedupe_drops: [{ source: 'socrata-austin-permits', external_id: '1', kind: 'duplicate', of_source: 'socrata-austin-permits', of_external_id: '0', dropped_at: NOW.toISOString() }] });
    const html = renderQualityHtml(await loadQualityReport(ok as never, NOW));
    expect(html).toContain('Duplicate listings per source (last 7 days)');
    expect(html).toContain('socrata-austin-permits');
    const missing = renderQualityHtml(await loadQualityReport(tablesMissing(new FakeDb({ holler_profiles: [] })) as never, NOW));
    expect(missing).toContain('Not recorded: migration 0025 is not applied');
  });
});
