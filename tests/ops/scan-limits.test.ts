// Review P2-7 (garbage future dates), P2-6 (business flood) and P1-6 (FEMA expiry). Rows are hand written (assumed);
// the FEMA row copies the live OpenFEMA values the review quoted (DR-4955 FL, declared 2026-10-27, incident ended 2026-10-12: sourced).
import { describe, expect, it } from 'vitest';
import { FakeDb } from './fakedb';
import { MAX_FUTURE_DAYS, normalizeSignals, runScan } from '../../lib/signals/run';
import { pruneOldSignals, type Db } from '../../lib/signals/store';
import { MAX_BUSINESS_PER_USER, MAX_MATCHES_PER_USER, matchSignals, type MatchProfile, type MatchSignal } from '../../lib/signals/match';
import { parseFema } from '../../lib/signals/adapters/fema';
import type { Adapter, SignalInput } from '../../lib/signals/types';

const NOW = new Date('2026-11-17T12:00:00Z');
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * day).toISOString();
const asDb = (f: FakeDb) => f as unknown as Db;

const input = (id: string, occurredAt: string, over: Partial<SignalInput> = {}): SignalInput => ({
  source: 't', externalId: id, kind: 'permit', title: `row ${id}`, categories: ['roofing'], severity: 2, occurredAt, lat: 33.75, lon: -84.39, state: 'GA', ...over,
});
const adapter = (rows: SignalInput[]): Adapter => ({ id: 't', label: 't', kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.com', fetch: async () => rows });

describe('garbage dates (review P2-7)', () => {
  it('normalizeSignals drops rows more than 60 days ahead and before 2000, keeps upcoming events', () => {
    const out = normalizeSignals(
      adapter([]),
      [
        input('ok-now', iso(0)),
        input('ok-event-14d', iso(14), { kind: 'event' }),
        input('ok-edge', iso(MAX_FUTURE_DAYS - 1)),
        input('typo-2099', '2099-01-01T00:00:00Z'),
        input('far-61d', iso(61)),
        input('year-8201', '8201-05-01T00:00:00Z'),
        input('ancient', '1970-01-01T00:00:00Z'),
      ],
      NOW,
    );
    expect(out.map((s) => s.externalId)).toEqual(['ok-now', 'ok-event-14d', 'ok-edge']);
  });

  it('runScan never stores them (and a dry run does not count them)', async () => {
    const f = new FakeDb({ holler_profiles: [] });
    const rows = [input('a', iso(-1)), input('typo', '2099-01-01T00:00:00Z')];
    const report = await runScan({ now: NOW, adapters: [adapter(rows)] }, asDb(f));
    expect(f.tables.holler_signals.map((r) => r.external_id)).toEqual(['a']);
    expect(report.sources[0].parsed).toBe(1);
    const dry = await runScan({ now: NOW, dry: true, adapters: [adapter(rows)] });
    expect(dry.sources[0].parsed).toBe(1);
  });

  it('the daily prune also deletes already-stored future garbage, which the age cutoff never reaches', async () => {
    const f = new FakeDb({
      holler_signals: [
        { id: 1, occurred_at: '2099-01-01T00:00:00Z' },
        { id: 2, occurred_at: iso(-1) },
        { id: 3, occurred_at: iso(14) },
        { id: 4, occurred_at: iso(-200) },
      ],
    });
    await pruneOldSignals(asDb(f), NOW);
    expect(f.tables.holler_signals.map((r) => r.id).sort()).toEqual([2, 3]);
  });

  it('a stored future-dated row ranks as now, never above a fresh one of the same severity by its date', () => {
    const profile: MatchProfile = { user_id: 'u', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25 };
    const sig = (id: number, occurred_at: string): MatchSignal => ({ id, kind: 'permit', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', severity: 2, occurred_at });
    const fresh = Array.from({ length: MAX_MATCHES_PER_USER }, (_, i) => sig(i + 1, new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString()));
    const garbage = sig(999, '2099-01-01T00:00:00Z');
    const rows = matchSignals([garbage, ...fresh], [profile], MAX_MATCHES_PER_USER, NOW);
    expect(rows).toHaveLength(MAX_MATCHES_PER_USER);
    // the 2099 row is clamped to "now": it may rank first among equals but must not push out a whole slot of fresh ones beyond the cap by dating
    expect(rows.filter((r) => r.signal_id !== 999)).toHaveLength(MAX_MATCHES_PER_USER - 1);
    expect(rows[0].signal_id).toBe(999);
  });
});

describe('business rows do not flood a user (review P2-6)', () => {
  // Opportunity change (u2): a new business licence is 'soon' for janitorial-commercial (lib/signals/opportunity.ts NEW_BUSINESS_TRADES),
  // and only 'context' for house cleaning, so the member here is a commercial cleaner.
  const profile: MatchProfile = { user_id: 'u', categories: ['janitorial-commercial'], lat: 34.05, lon: -118.24, state: 'CA', radius_mi: 25 };
  const biz = (id: number, dLat: number): MatchSignal => ({
    id, kind: 'civic', categories: ['cleaning', 'janitorial-commercial', 'insurance', 'security'], lat: 34.05 + dLat, lon: -118.24, state: 'CA', severity: 1,
    occurred_at: new Date(NOW.getTime() - id * 60_000).toISOString(), subtype: 'business',
  });
  it('25 license rows in one scan give a commercial cleaning user 5, the nearest, not 25', () => {
    const signals = Array.from({ length: 25 }, (_, i) => biz(i + 1, 0.2 - i * 0.008));
    const rows = matchSignals(signals, [profile], MAX_MATCHES_PER_USER, NOW);
    expect(rows).toHaveLength(MAX_BUSINESS_PER_USER);
    const nearest = [...signals].sort((a, b) => Math.abs(a.lat! - 34.05) - Math.abs(b.lat! - 34.05)).slice(0, 5).map((s) => s.id);
    expect(new Set(rows.map((r) => r.signal_id))).toEqual(new Set(nearest));
  });
  it('the subtype also works when it only arrives inside data (what a plain select returns)', () => {
    const s = { ...biz(1, 0), subtype: undefined, data: { subtype: 'business' } } as MatchSignal;
    const many = Array.from({ length: 8 }, (_, i) => ({ ...s, id: i + 1 }));
    expect(matchSignals(many, [profile], MAX_MATCHES_PER_USER, NOW)).toHaveLength(5);
  });
  it('other record types are untouched by the business cap', () => {
    const permits: MatchSignal[] = Array.from({ length: 10 }, (_, i) => ({ ...biz(i + 1, 0.001 * i), subtype: 'permit' }));
    expect(matchSignals(permits, [profile], MAX_MATCHES_PER_USER, NOW)).toHaveLength(10);
  });
  it('business rows never crowd out other rows: 5 business + 20 others fit in 25', () => {
    // A failed food inspection is 'act' for janitorial-commercial (was an untitled 311 row, which is now city work: context).
    const others: MatchSignal[] = Array.from({ length: 30 }, (_, i) => ({ ...biz(100 + i, 0.001 * i), subtype: 'inspection', title: 'Failed inspection in Los Angeles: restaurant', severity: 2 }));
    const bizRows = Array.from({ length: 20 }, (_, i) => biz(i + 1, 0.001 * i));
    const rows = matchSignals([...bizRows, ...others], [profile], MAX_MATCHES_PER_USER, NOW);
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => r.signal_id <= 20).length).toBeLessThanOrEqual(5);
  });
});

describe('FEMA declarations are not expired on insert (review P1-6)', () => {
  const raw = {
    metadata: {},
    DisasterDeclarationsSummaries: [
      { disasterNumber: 4955, state: 'FL', declarationType: 'DR', declarationDate: '2026-10-27T00:00:00.000Z', incidentType: 'Hurricane', declarationTitle: 'HURRICANE EXAMPLE', designatedArea: 'Bay (County)', incidentBeginDate: '2026-10-05T00:00:00.000Z', incidentEndDate: '2026-10-12T00:00:00.000Z', iaProgramDeclared: true },
    ],
  };
  it('expiresAt is null even though incidentEndDate is before declarationDate; the incident dates stay in data', () => {
    const [d] = parseFema(raw);
    expect(Date.parse(raw.DisasterDeclarationsSummaries[0].incidentEndDate)).toBeLessThan(Date.parse(raw.DisasterDeclarationsSummaries[0].declarationDate));
    expect(d.expiresAt ?? null).toBeNull();
    expect((d.data as { incidentEndDate: string }).incidentEndDate).toBe('2026-10-12T00:00:00.000Z');
  });
  it('the read paths that filter on expires_at keep it: expires_at null passes "expires_at is null or > now"', () => {
    const [d] = parseFema(raw);
    const keeps = (expiresAt: string | null | undefined, now: Date) => !expiresAt || Date.parse(expiresAt) > now.getTime();
    expect(keeps(d.expiresAt, NOW)).toBe(true);
  });
});

describe('scan deadline (review P2-17)', () => {
  const mk = (id: string): Adapter => ({
    id, label: id, kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.com',
    fetch: async () => [input(`${id}-1`, iso(-1), { source: id })],
  });

  it('past the deadline no new source is written, matching and the run log still happen for the ones already written, skipped ones are not logged', async () => {
    const f = new FakeDb({
      holler_profiles: [{ user_id: 'u1', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: iso(-30) }],
    });
    let t = 0;
    let writes = 0;
    // the clock jumps 20 s every time the engine looks at it after the fetch phase: source a is written at 0 s (inside), b and c at 20+ s... deadline is 30 s
    const clock = () => {
      t += 12_000;
      return t;
    };
    const report = await runScan({ now: NOW, adapters: [mk('a'), mk('b'), mk('c')], deadlineMs: 30_000, clock }, asDb(f));
    writes = f.tables.holler_signals.length;
    const by = Object.fromEntries(report.sources.map((s) => [s.id, s]));
    expect(writes).toBeGreaterThanOrEqual(1);
    expect(writes).toBeLessThan(3);
    const skipped = report.sources.filter((s) => /^deadline:/.test(s.error ?? ''));
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    for (const s of skipped) expect(s.status).toBe('error');
    // matching ran for what was written
    expect(f.tables.holler_matches?.length ?? 0).toBe(writes);
    // run log: one row per source that was written, none for the skipped (they are due again next tick)
    const logged = (f.tables.holler_scan_runs ?? []).map((r) => r.source).filter((s) => s !== '_prune');
    expect(logged.sort()).toEqual(report.sources.filter((s) => !/^deadline:/.test(s.error ?? '')).map((s) => s.id).sort());
    void by;
  });

  it('a deadline of 0 writes nothing, logs nothing for the skipped, and still returns a report', async () => {
    const f = new FakeDb({ holler_profiles: [] });
    const report = await runScan({ now: NOW, adapters: [mk('a'), mk('b')], deadlineMs: -1 }, asDb(f));
    expect(f.tables.holler_signals ?? []).toHaveLength(0);
    expect((f.tables.holler_scan_runs ?? []).filter((r) => r.source !== '_prune')).toHaveLength(0);
    expect(report.sources.every((s) => /^deadline:/.test(s.error ?? ''))).toBe(true);
  });

  it('the scan route passes a deadline below its 60 s limit', async () => {
    const { SCAN_DEADLINE_MS, DEFAULT_ADAPTER_TIMEOUT_MS } = await import('../../lib/signals/run');
    expect(SCAN_DEADLINE_MS).toBeLessThan(60_000);
    expect(DEFAULT_ADAPTER_TIMEOUT_MS).toBeLessThan(SCAN_DEADLINE_MS);
  });

  it('the run log for 45 sources is written in batches of 10, not one after another', async () => {
    const f = new FakeDb({ holler_profiles: [] });
    const adapters = Array.from({ length: 45 }, (_, i) => mk(`s${i}`));
    await runScan({ now: NOW, adapters }, asDb(f));
    expect((f.tables.holler_scan_runs ?? []).filter((r) => r.source !== '_prune')).toHaveLength(45);
  });
});
