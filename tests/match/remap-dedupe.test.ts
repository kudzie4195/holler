// Round 7 MATCH items 4 and 5: data.cat_v, the scan-time re-map of stored rows (skipping AI rows, in batches inside the time budget),
// rematchSignals, and insert-time de-duplication of one record under two external ids.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { fakeTables } from './fake-table';
import { remapRow, remapStoredSignals, REMAP_BATCH, type StoredRuleRow } from '@/lib/signals/mapping/remap';
import { CAT_V } from '@/lib/signals/mapping/version';
import { rematchSignals, REMATCH_QUIET_AFTER_MS } from '@/lib/signals/rematch';
import { dropDuplicateRecords, insertNewSignals, recordKey, REISSUED_ID_SOURCES, type SignalRowInput } from '@/lib/signals/store';
import type { MatchProfile } from '@/lib/signals/match';

const NOW = new Date('2026-11-19T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const SMYRNA_ROOFER: MatchProfile = { user_id: 'roofer', categories: ['roofing'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
const PLUMBER: MatchProfile = { user_id: 'plumber', categories: ['plumbing'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
const HVAC: MatchProfile = { user_id: 'hvac', categories: ['hvac'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };

const stored = (over: Partial<StoredRuleRow> & { id: number }): StoredRuleRow => ({
  source: 'arcgis-dekalb-permits',
  title: 'HVAC permit in DeKalb County',
  summary: 'Residential Water Heater | Single Family Dwelling | Issued | 1200 block of Example Rd',
  city: 'DeKalb County',
  categories: ['plumbing', 'hvac'],
  data: { layer: 'x', subtype: 'permit' },
  ...over,
});

describe('remapRow: stored rows get the round 7 mapping from what they still hold', () => {
  it('the mislabelled DeKalb water heater row becomes plumbing only, titled for what it is', () => {
    const r = remapRow(stored({ id: 1 }))!;
    expect(r.categories).toEqual(['plumbing']);
    expect(r.title).toBe('Water heater permit in DeKalb County');
    expect(r.data.cat_v).toBe(CAT_V);
    expect(r.changed).toBe(true);
  });

  it('the "Building permit" fan-out (general-contractor, landscaping, cleaning) becomes general-contractor only', () => {
    const r = remapRow(stored({ id: 2, title: 'Building permit in DeKalb County', summary: 'New Construction | Single Family Dwelling | Issued | 12 Example Ln', categories: ['general-contractor', 'landscaping', 'cleaning'] }))!;
    expect(r.categories).toEqual(['general-contractor']);
    expect(r.title).toBe('New construction permit in DeKalb County');
    // and with no summary left at all, the old fan-out is still trimmed
    const bare = remapRow(stored({ id: 3, title: 'Building permit in DeKalb County', summary: null, categories: ['general-contractor', 'landscaping', 'cleaning'] }))!;
    expect(bare.categories).toEqual(['general-contractor']);
    expect(bare.title).toBe('Building permit in DeKalb County');
  });

  it('a stored re-roof keeps roofing even when the trade came from a description that was never stored', () => {
    const r = remapRow(stored({ id: 4, source: 'socrata-chicago-permits', city: 'Chicago', title: 'Roof permit in Chicago', summary: 'PERMIT - EASY PERMIT PROCESS | $5,000 job value | 100 N STATE', categories: ['roofing', 'general-contractor'] }))!;
    expect(r.categories).toEqual(['roofing']);
    expect(r.title).toBe('Roof permit in Chicago');
  });

  it('a structured re-roof in the summary is roofing', () => {
    const r = remapRow(stored({ id: 5, title: 'Permit in DeKalb County', summary: 'Residential Re-Roof | Single Family Dwelling | Issued', categories: ['general-contractor'] }))!;
    expect(r.categories).toEqual(['roofing']);
    expect(r.title).toBe('Roof permit in DeKalb County');
  });

  it('an address in the summary never picks a trade', () => {
    const r = remapRow(stored({ id: 6, title: 'Electrical permit in DeKalb County', summary: 'Residential Electrical | Issued | 100 Pool Rd', categories: ['electrical'] }))!;
    expect(r.categories).toEqual(['electrical']);
    expect(r.changed).toBe(false);
  });

  it('a code violation for a roof leak no longer carries plumbing', () => {
    const r = remapRow(stored({ id: 7, source: 'socrata-chicago-violations', city: 'Chicago', title: 'Code violation in Chicago: ROOF LEAKS', summary: 'ROOF LEAKS | OPEN', categories: ['roofing', 'general-contractor', 'plumbing'], data: { subtype: 'violation' } }))!;
    expect(r.categories).not.toContain('plumbing');
    expect(r.categories).toContain('roofing');
    expect(r.title).toBe('Code violation in Chicago: ROOF LEAKS');
  });

  it('skips AI rows, rows already at this version, and subtypes this version does not re-map', () => {
    expect(remapRow(stored({ id: 8, data: { subtype: 'permit', cat_src: 'ai' } }))).toBeNull();
    expect(remapRow(stored({ id: 9, data: { subtype: 'permit', cat_v: CAT_V } }))).toBeNull();
    expect(remapRow(stored({ id: 10, data: { subtype: '311' } }))).toBeNull();
  });
});

function signalsTable() {
  const rows: any[] = [];
  for (let i = 1; i <= 230; i++) {
    rows.push({
      id: i,
      source: 'arcgis-dekalb-permits',
      external_id: `E${i}`,
      kind: 'permit',
      title: 'HVAC permit in DeKalb County',
      summary: 'Residential Water Heater | Single Family Dwelling | Issued',
      city: 'DeKalb County',
      state: 'GA',
      lat: 33.85,
      lon: -84.35,
      severity: 1,
      categories: ['plumbing', 'hvac'],
      occurred_at: ago(i <= 220 ? 2 : 20), // ids 221..230 are older than 14 days
      expires_at: null,
      data: { subtype: 'permit' },
    });
  }
  rows.push({ ...rows[0], id: 300, external_id: 'AI1', data: { subtype: 'permit', cat_src: 'ai' } });
  rows.push({ ...rows[0], id: 301, external_id: 'N1', source: 'nws', data: {} });
  return rows;
}

describe('remapStoredSignals: scan-time pass', () => {
  it('re-maps the last 14 days in batches, skips AI rows and old rows, stamps cat_v, rematches only what changed', async () => {
    const db = fakeTables({ holler_signals: signalsTable(), holler_matches: [] });
    const rematched: number[][] = [];
    const pruned: number[][] = [];
    const rep = await remapStoredSignals(db, {
      now: NOW,
      rematch: async (ids) => (rematched.push(ids), { created: ids.length }),
      prune: async (ids) => (pruned.push(ids), { removed: 0 }),
    });
    expect(rep.batches).toBe(3); // 100 + 100 + 20 (short batch ends the pass)
    expect(rep.updated).toBe(220);
    expect(rep.changed).toBe(220);
    expect(rep.done).toBe(true);
    // Round 7 fix-a (review r1 P1): [plumbing, hvac] -> [plumbing] gains no trade, so nothing is rematched; it lost hvac, so the
    // un-notified hvac matches are checked again instead.
    expect(rematched).toEqual([]);
    expect(pruned.map((x) => x.length)).toEqual([100, 100, 20]);
    const t = db.tables.holler_signals;
    expect(t.find((r: any) => r.id === 1)).toMatchObject({ categories: ['plumbing'], title: 'Water heater permit in DeKalb County', data: { subtype: 'permit', cat_v: CAT_V } });
    expect(t.find((r: any) => r.id === 225).data.cat_v).toBeUndefined(); // older than 14 days
    expect(t.find((r: any) => r.id === 300)).toMatchObject({ categories: ['plumbing', 'hvac'], data: { cat_src: 'ai' } }); // AI row untouched
    expect(t.find((r: any) => r.id === 301).data.cat_v).toBeUndefined();
    // the query carries every guard
    const sel = db.log.find((l: string) => l.startsWith('holler_signals:select'))!;
    expect(sel).toContain('or:data->>cat_src.is.null,data->>cat_src.neq.ai');
    // version 3 re-reads: no version, version 1 (full re-map), and version 2 only where the v3 delta can apply (a violation or a no-trade work type)
    expect(sel).toContain('or:data->>cat_v.is.null,data->>cat_v.eq.1,and(data->>cat_v.eq.2,or(data->>subtype.eq.violation,summary.ilike.*sidewalk shed*');
    expect(sel).toContain('in:data->>subtype=permit|violation');
    expect(sel).toContain('or:source.like.socrata-*,source.like.arcgis-*');
    // a second pass finds nothing left
    const again = await remapStoredSignals(db, { now: NOW, rematch: async () => ({ created: 0 }), prune: async () => ({ removed: 0 }) });
    expect(again.updated).toBe(0);
    expect(again.done).toBe(true);
  });

  it('stops before a batch once the time budget says so, so it can never push the scan past its limit', async () => {
    const db = fakeTables({ holler_signals: signalsTable(), holler_matches: [] });
    let calls = 0;
    const rep = await remapStoredSignals(db, { now: NOW, shouldContinue: () => ++calls <= 1, rematch: async () => ({ created: 0 }), prune: async () => ({ removed: 0 }) });
    expect(rep.batches).toBe(1);
    expect(rep.updated).toBe(REMAP_BATCH);
    const none = await remapStoredSignals(db, { now: NOW, shouldContinue: () => false });
    expect(none.batches).toBe(0);
  });

  it('never throws: a failed read is reported', async () => {
    const db = fakeTables({ holler_signals: signalsTable() }, { failSelect: 'holler_signals' });
    const rep = await remapStoredSignals(db, { now: NOW });
    expect(rep.error).toBe('down');
  });

  it('the scan runs the pass with the time guard (run.ts)', async () => {
    const { runScan, REMAP_RESERVE_MS, SCAN_DEADLINE_MS } = await import('@/lib/signals/run');
    expect(REMAP_RESERVE_MS).toBeGreaterThanOrEqual(5_000);
    expect(REMAP_RESERVE_MS).toBeLessThan(SCAN_DEADLINE_MS);
    const db = fakeTables({ holler_signals: signalsTable(), holler_matches: [], holler_profiles: [], holler_scan_runs: [], holler_source_health: [] });
    let t = 0;
    const late = await runScan({ adapters: [], now: NOW, clock: () => (t += 0), deadlineMs: 5_000 }, db);
    expect(late.remap).toBeUndefined(); // 5 s budget minus the 10 s reserve: no room, the pass does not start
    const ok = await runScan({ adapters: [], now: NOW, clock: () => 0 }, db);
    expect(ok.remap?.updated).toBe(220);
  });
});

describe('rematchSignals', () => {
  const sig = (id: number, cats: string[], daysAgo: number) => ({ id, source: 'arcgis-dekalb-permits', categories: cats, lat: 33.85, lon: -84.35, state: 'GA', severity: 1, occurred_at: ago(daysAgo), expires_at: null, title: 't', summary: null, data: { subtype: 'permit' } });

  it('creates the missing matches with the scan rules, skips existing pairs, quiet for old records', async () => {
    const db = fakeTables({
      holler_signals: [sig(1, ['plumbing'], 1), sig(2, ['plumbing'], 6), sig(3, ['roofing'], 1), { ...sig(4, ['plumbing'], 1), expires_at: ago(0.5) }],
      holler_matches: [{ id: 1, user_id: 'plumber', signal_id: 1 }],
    });
    const r = await rematchSignals(db, [1, 2, 3, 4, 4, -1], { now: NOW, profiles: [SMYRNA_ROOFER, PLUMBER, HVAC] });
    expect(r.error).toBeUndefined();
    const m = db.tables.holler_matches.map((x: any) => `${x.user_id}:${x.signal_id}:${x.notified ?? '-'}`).sort();
    expect(m).toEqual(['plumber:1:-', 'plumber:2:true', 'roofer:3:false']);
    expect(r.created).toBe(2);
    expect(REMATCH_QUIET_AFTER_MS).toBe(3 * 86_400_000);
    // idempotent
    const again = await rematchSignals(db, [1, 2, 3], { now: NOW, profiles: [SMYRNA_ROOFER, PLUMBER, HVAC] });
    expect(again.created).toBe(0);
  });

  it('never throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = fakeTables({ holler_signals: [] }, { failSelect: 'holler_signals' });
    expect(await rematchSignals(db, [1], { now: NOW, profiles: [] })).toEqual({ created: 0, error: 'signals read failed: down' });
    expect(await rematchSignals(db, [], { now: NOW })).toEqual({ created: 0 });
    spy.mockRestore();
  });
});

describe('insert-time de-duplication (round 7 fix-a: only identical records from a source known to re-issue ids)', () => {
  const row = (ext: string, over: Partial<SignalRowInput> = {}): SignalRowInput => ({
    source: 'arcgis-dekalb-permits',
    externalId: ext,
    kind: 'permit',
    title: 'HVAC permit in DeKalb County',
    summary: 'Residential Air Conditioning | Single Family Dwelling',
    url: 'https://example.test/layer',
    lat: 33.771234,
    lon: -84.294561,
    categories: ['hvac'],
    severity: 1,
    occurredAt: '2026-11-12T15:00:00.000Z',
    data: { subtype: 'permit' },
    placeSlug: null,
    ...over,
  });
  const REISSUES = new Set(['arcgis-dekalb-permits']);

  it('no source is known to re-issue ids, so recordKey is null for every real source', () => {
    expect(REISSUED_ID_SOURCES.size).toBe(0);
    expect(recordKey({ source: 'arcgis-dekalb-permits', title: 'T', occurredAt: '2026-11-12T01:00:00Z', lat: 1, lon: 2, data: { subtype: 'permit' } })).toBeNull();
  });

  it('for a re-issuing source the key holds every public field and stays conservative', () => {
    const base = { source: 'arcgis-dekalb-permits', title: 'T', summary: 'S', url: 'U', occurredAt: '2026-11-12T01:00:00Z', lat: 33.771234, lon: -84.294561, data: { subtype: 'permit' } };
    expect(recordKey(base, REISSUES)).toBe(['arcgis-dekalb-permits', 'permit', '2026-11-12T01:00:00.000Z', 'p:33.77123,-84.29456', 'T', 'S', 'U'].join('\u0000'));
    expect(recordKey({ ...base, data: { subtype: 'permit', address: ' 12 Main  St ' } }, REISSUES)).toContain('a:12 main st');
    expect(recordKey({ ...base, source: 'nws', data: {} }, new Set(['nws']))).toBeNull();
    expect(recordKey({ ...base, lat: null, lon: null }, REISSUES)).toBeNull();
    expect(recordKey({ ...base, data: { subtype: 'permit', approxLocation: true } }, REISSUES)).toBeNull();
    for (const sub of ['business', 'violation', 'inspection']) expect(recordKey({ ...base, data: { subtype: sub } }, REISSUES)).toBeNull();
    // any public field that differs makes it another record
    expect(recordKey({ ...base, summary: 'S2' }, REISSUES)).not.toBe(recordKey(base, REISSUES));
    expect(recordKey({ ...base, url: 'U2' }, REISSUES)).not.toBe(recordKey(base, REISSUES));
    expect(recordKey({ ...base, occurredAt: '2026-11-12T02:00:00Z' }, REISSUES)).not.toBe(recordKey(base, REISSUES));
  });

  it('a re-issuing source: drops only a fully identical record under a second id, in the batch and against stored rows', async () => {
    const db = fakeTables({
      holler_signals: [
        { id: 1, source: 'arcgis-dekalb-permits', external_id: 'OLD-1', title: 'Roof permit in DeKalb County', summary: 'Residential Re-Roof', url: 'https://example.test/layer', lat: 33.5, lon: -84.1, occurred_at: '2026-11-12T09:00:00.000Z', data: { subtype: 'permit' } },
      ],
    });
    const log: string[] = [];
    const out = await dropDuplicateRecords(
      db,
      [
        row('A'),
        row('B'), // every public field identical, second id: dropped
        row('A'), // same id: left to the upsert
        row('C', { occurredAt: '2026-11-12T16:00:00.000Z' }), // another hour: kept
        row('D', { summary: 'Residential Air Conditioning | APT 214' }), // another unit: kept
        row('E', { title: 'Roof permit in DeKalb County', summary: 'Residential Re-Roof', lat: 33.5, lon: -84.1, occurredAt: '2026-11-12T09:00:00.000Z' }), // the stored OLD-1: dropped
        row('F', { data: { subtype: 'business' } }),
        row('G', { data: { subtype: 'business' } }),
      ],
      (m) => log.push(m),
      REISSUES,
    );
    expect(out.map((r) => r.externalId)).toEqual(['A', 'A', 'C', 'D', 'F', 'G']);
    expect(log.join(' ')).toMatch(/2 rows were the same record/);
  });

  it('a failed stored-row read lets the batch through (fail soft); insertNewSignals with the real list never merges', async () => {
    const bad = fakeTables({ holler_signals: [] }, { failSelect: 'holler_signals' });
    const log: string[] = [];
    expect((await dropDuplicateRecords(bad, [row('A'), row('B')], (m) => log.push(m), REISSUES)).map((r) => r.externalId)).toEqual(['A']);
    expect(log.join(' ')).toMatch(/stored-row check skipped/);
    const db = fakeTables({ holler_signals: [] }, { conflict: { holler_signals: ['source', 'external_id'] } });
    const ins = await insertNewSignals(db, [row('A'), row('B')], { log: () => {}, dedupe: true });
    expect(ins.map((r: any) => r.external_id)).toEqual(['A', 'B']);
    expect(db.log.filter((l: string) => l.startsWith('holler_signals:select'))).toEqual([]); // no read for a source not on the list
  });

  it('the scan turns de-duplication on for every source write', async () => {
    const src = (await import('node:fs')).readFileSync('lib/signals/run.ts', 'utf8');
    expect(src).toMatch(/insertNewSignals\(db, plan\.rows, \{[^}]*dedupe: true/);
  });
});
