/**
 * Round 18 ROUTES, items 3 and 6: contact-gated permit alerts. A permit card goes to email and push only when it names a business or a
 * job-site street address; one with neither is stored for the feed only (holler_matches.alert_hold = 'background', migration 0027), is not
 * logged as an alert, and ranks after the alerts inside the unchanged 25-per-scan cap. Bids, storm reports, violations, 311, inspections
 * and business licences are never gated. With 0027 missing the insert is retried without alert_hold (real PostgREST codes).
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { contactPathOf, missingHoldColumn, withoutHold, holdOf, alertHoldFor, PRECISION_HOLDS } from '@/lib/signals/alert-gate';
import { matchSignals, pickHits, MAX_MATCHES_PER_USER, type Hit, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { insertMatches, type Db, type StoredSignal } from '@/lib/signals/store';
import { upsertMatchRows } from '@/lib/signals/quiet-matches';
import { markContactPaths, runScan } from '@/lib/signals/run';
import { pushEntriesFromMatches } from '@/lib/push/notify';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 33.75, lon: -84.39 };
const landscaper: MatchProfile = { user_id: 'm1', categories: ['landscaping'], lat: LOC.lat, lon: LOC.lon, state: 'GA', radius_mi: 25 };
let nextId = 1;
const rec = (over: Partial<MatchSignal> = {}): MatchSignal => ({
  id: nextId++,
  source: 'arcgis-dekalb-permits',
  kind: 'permit',
  subtype: 'permit',
  title: 'New home permit in DeKalb County',
  summary: 'New Construction | Single Family Dwelling | Issued',
  categories: ['general-contractor', 'real-estate', 'moving'],
  lat: LOC.lat + 0.01,
  lon: LOC.lon,
  state: 'GA',
  severity: 1,
  occurred_at: '2026-11-19T00:00:00Z',
  data: { subtype: 'permit' },
  ...over,
});

describe('contactPathOf: "tells me who to call or where to go"', () => {
  it('a named business counts; a site contact counts only with a street address that has a house number', () => {
    expect(contactPathOf([{ role: 'contractor', name: 'Peach Builders LLC' }], null)).toBe('business');
    expect(contactPathOf([{ role: 'site', name: '', address: '1584 ABNER NW' }], null)).toBe('site');
    expect(contactPathOf([{ role: 'site', name: '', address: 'MAIN ST' }], null)).toBeNull();
    expect(contactPathOf([{ role: 'contractor', name: '  ' }], null)).toBeNull();
  });
  it('a street address in the public permit summary counts as a place to go; a bare street, a block or nothing does not', () => {
    expect(contactPathOf([], 'Building Permit | Roof | $15,000 job value | 123 E Jackson St')).toBe('site');
    expect(contactPathOf(null, 'Residential Air Conditioning | Single Family Detached | Issued Status Code')).toBeNull(); // DeKalb: no address
    expect(contactPathOf(null, 'HEATING | MAIN ST')).toBeNull(); // Buffalo: street with no house number
    expect(contactPathOf(null, null)).toBeNull();
  });
});

describe('matching: the gate holds permit cards with no contact path', () => {
  it('a permit with no contact path is feed-only (alert_hold background); with a business or a site it alerts', () => {
    const none = rec({ contactPath: null });
    const biz = rec({ contactPath: 'business' });
    const site = rec({ contactPath: 'site' });
    const rows = matchSignals([none, biz, site], [landscaper], undefined, NOW, false);
    expect(rows.find((r) => r.signal_id === none.id)).toMatchObject({ alert_hold: 'background' });
    expect(rows.find((r) => r.signal_id === biz.id)).not.toHaveProperty('alert_hold');
    expect(rows.find((r) => r.signal_id === site.id)).not.toHaveProperty('alert_hold');
  });
  it('an unknown contact state (a row read back without its contacts) is never gated', () => {
    const rows = matchSignals([rec()], [landscaper], undefined, NOW, false);
    expect(rows[0]).not.toHaveProperty('alert_hold');
  });
  it('a permit that is already feed-only (market insight, own trade) carries no hold', () => {
    const gc: MatchProfile = { ...landscaper, categories: ['general-contractor'] };
    const rows = matchSignals([rec({ contactPath: null })], [gc], undefined, NOW, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('alert_hold');
  });
  it('a bid with no contact still alerts; so do storm reports, violations, 311 requests, inspections and business licences', () => {
    const roofer: MatchProfile = { ...landscaper, categories: ['roofing', 'pest-control', 'plumbing', 'hvac'] };
    const others: MatchSignal[] = [
      rec({ source: 'bids-sf', kind: 'contract', subtype: 'bid', title: 'Roof replacement at a city library', summary: null, categories: ['roofing'], data: { subtype: 'bid' }, contactPath: null }),
      rec({ source: 'spc', kind: 'report', subtype: null, title: 'Hail damage reported near Decatur', summary: null, categories: ['roofing'], data: {}, contactPath: null }),
      rec({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: ROOF', summary: null, categories: ['roofing'], data: { subtype: 'violation' }, contactPath: null }),
      rec({ source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', summary: null, categories: ['plumbing'], data: { subtype: '311' }, contactPath: null }),
      rec({ source: 'socrata-chicago-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection', summary: null, categories: ['pest-control'], data: { subtype: 'inspection' }, contactPath: null }),
      rec({ source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Retail Food Establishment', summary: null, categories: ['hvac'], data: { subtype: 'business' }, contactPath: null }),
    ];
    const rows = matchSignals(others, [roofer], undefined, NOW, true);
    expect(rows).toHaveLength(others.length);
    for (const r of rows) expect(r).not.toHaveProperty('alert_hold');
  });
});

describe('the caps still hold, and a held card is not an alert', () => {
  const hit = (over: Partial<Hit> & { sev?: number; id: number }): Hit => ({
    s: rec({ id: over.id, severity: over.sev ?? 1 }),
    distance_mi: 1,
    label: 'coming_soon',
    ...over,
  });
  it('held cards rank with the market insights: after every alert, and a severe held card is not kept ahead of alerts', () => {
    const hits = [hit({ id: 1, hold: 'background', sev: 3, score: 99 }), hit({ id: 2 }), hit({ id: 3, label: 'market_insight' }), hit({ id: 4, label: 'act_now' })];
    expect(pickHits(hits, NOW.getTime()).map((h) => h.s.id)).toEqual([4, 2, 1, 3]);
    // At a cap of 2 the held card is the one cut, even with severity 3.
    expect(pickHits(hits, NOW.getTime(), 2).map((h) => h.s.id)).toEqual([4, 2]);
  });
  it('the 25-per-scan cap is unchanged: 30 held and 30 alerting permits give 25 rows, every alert first', () => {
    const sigs = [...Array.from({ length: 30 }, () => rec({ contactPath: null })), ...Array.from({ length: 30 }, () => rec({ contactPath: 'site' }))];
    const rows = matchSignals(sigs, [landscaper], undefined, NOW, false);
    expect(MAX_MATCHES_PER_USER).toBe(25);
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => !('alert_hold' in r))).toBe(true);
  });
});

describe('the hold column before migration 0027 (real PostgREST codes)', () => {
  const ERRORS = [
    { code: 'PGRST204', message: "Could not find the 'alert_hold' column of 'holler_matches' in the schema cache" },
    { code: '42703', message: 'column "alert_hold" of relation "holler_matches" does not exist' },
  ];
  /** holler_matches upsert fails with `err` while a row carries alert_hold. */
  function client(err: { code: string; message: string }) {
    const sent: Record<string, unknown>[][] = [];
    const db = {
      from: () => {
        let rows: Record<string, unknown>[] = [];
        const q: Record<string, unknown> = {};
        q.upsert = (r: Record<string, unknown>[]) => ((rows = r), sent.push(r), q);
        q.select = () => q;
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(rows.some((r) => 'alert_hold' in r) ? { data: null, error: err } : { data: rows.map((_, i) => ({ id: i + 1 })), error: null }).then(res);
        return q;
      },
    };
    return { db: db as unknown as Db, sent };
  }
  for (const err of ERRORS) {
    it(`${err.code}: the scan insert is retried without alert_hold and every card is stored as before`, async () => {
      expect(missingHoldColumn(err)).toBe(true);
      const c = client(err);
      const n = await insertMatches(c.db, [{ user_id: 'm1', signal_id: 1, distance_mi: 1, alert_hold: 'background' }, { user_id: 'm1', signal_id: 2, distance_mi: 1 }]);
      expect(n).toBe(2);
      expect(c.sent).toHaveLength(2);
      expect(c.sent[1]).toEqual([{ user_id: 'm1', signal_id: 1, distance_mi: 1 }, { user_id: 'm1', signal_id: 2, distance_mi: 1 }]);
    });
    it(`${err.code}: backfill and rematch rows (upsertMatchRows) are retried without it too`, async () => {
      const c = client(err);
      const n = await upsertMatchRows(c.db, [{ user_id: 'm1', signal_id: 1, distance_mi: null, notified: true, pushed_at: 'x', alert_hold: 'below_min' }], { count: true });
      expect(n).toBe(1);
      expect(c.sent[1]).toEqual([{ user_id: 'm1', signal_id: 1, distance_mi: null, notified: true, pushed_at: 'x' }]);
    });
  }
  it('rows without a hold are sent exactly as before (no extra key, no retry)', async () => {
    const c = client(ERRORS[0]);
    await insertMatches(c.db, [{ user_id: 'm1', signal_id: 2, distance_mi: 1 }]);
    expect(c.sent).toEqual([[{ user_id: 'm1', signal_id: 2, distance_mi: 1 }]]);
    expect(withoutHold([{ a: 1 }])).toEqual([{ a: 1 }]);
  });
  it('another error is not read as a missing hold column', () => {
    expect(missingHoldColumn({ code: '42703', message: 'column holler_matches.pushed_at does not exist' })).toBe(false);
    expect(missingHoldColumn({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(holdOf({ alert_hold: 'nonsense' })).toBeNull();
    expect(holdOf({ alert_hold: 'background' })).toBe('background');
  });
});

describe('push never counts a held match', () => {
  it('a background match is left out of the push; the other match is counted', () => {
    const now = NOW.getTime();
    const s = (id: number) => ({ id, title: `Permit ${id}`, city: 'Decatur', source: 'arcgis-dekalb-permits', occurred_at: new Date(now - 3_600_000).toISOString(), kind: 'permit', categories: ['real-estate'] });
    const m = pushEntriesFromMatches(
      [
        { id: 1, user_id: 'u', created_at: new Date(now - 60_000).toISOString(), alert_hold: 'background', signal: s(1) },
        { id: 2, user_id: 'u', created_at: new Date(now - 60_000).toISOString(), signal: s(2) },
      ],
      now,
    );
    expect(m.get('u')?.count).toBe(1);
    expect(m.get('u')?.matchIds).toEqual([2]);
  });
});

describe('the scan: contact paths are set for the permits it stores, and a held card is not logged as an alert', () => {
  it('markContactPaths uses the sanitised contacts and the public summary, and touches only permits', () => {
    const built: SignalInput[] = [
      { source: 's', externalId: 'a', kind: 'permit', title: 'Roof permit in X', categories: ['roofing'], severity: 1, occurredAt: NOW.toISOString(), contacts: [{ role: 'contractor', name: 'Peach Roofing LLC' }] },
      { source: 's', externalId: 'b', kind: 'permit', title: 'Roof permit in X', categories: ['roofing'], severity: 1, occurredAt: NOW.toISOString() },
      { source: 's', externalId: 'c', kind: 'permit', title: 'Roof permit in X', categories: ['roofing'], severity: 1, occurredAt: NOW.toISOString(), contacts: [{ role: 'contractor', name: 'John Smith' }] },
      { source: 's', externalId: 'd', kind: 'civic', title: 'Code violation', categories: ['roofing'], severity: 1, occurredAt: NOW.toISOString() },
    ];
    const stored = [
      { id: 1, source: 's', external_id: 'a', kind: 'permit', title: 't', summary: 'Roof', categories: [], lat: 0, lon: 0, state: null, severity: 1, occurred_at: '' },
      { id: 2, source: 's', external_id: 'b', kind: 'permit', title: 't', summary: 'Roof | 12 OAK ST', categories: [], lat: 0, lon: 0, state: null, severity: 1, occurred_at: '' },
      { id: 3, source: 's', external_id: 'c', kind: 'permit', title: 't', summary: 'Roof', categories: [], lat: 0, lon: 0, state: null, severity: 1, occurred_at: '' },
      { id: 4, source: 's', external_id: 'd', kind: 'civic', title: 't', summary: null, categories: [], lat: 0, lon: 0, state: null, severity: 1, occurred_at: '' },
    ] as StoredSignal[];
    markContactPaths(stored, built);
    expect(stored.map((s) => s.contactPath)).toEqual(['business', 'site', null, undefined]); // a private person's name is no contact
  });

  it('end to end: the no-contact permit is stored feed-only, the one with an address alerts, and only the alert is logged', async () => {
    const permitOf = (externalId: string, summary: string): SignalInput => ({
      source: 'fake-permits', externalId, kind: 'permit', title: 'New home permit in Decatur', summary, categories: ['general-contractor', 'real-estate', 'moving'],
      severity: 1, occurredAt: '2026-11-20T08:00:00Z', lat: LOC.lat + 0.01, lon: LOC.lon, state: 'GA', data: { subtype: 'permit' },
    });
    const ad: Adapter = {
      id: 'fake-permits', label: 'Fake permits', kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.com',
      fetch: async () => [permitOf('NOPATH', 'New Construction | Single Family Dwelling | Issued'), permitOf('ADDR', 'New Construction | 250 SYCAMORE ST')],
    };
    const db = new FakeDb({ holler_profiles: [{ ...landscaper, subscription_status: 'active', trial_ends_at: null }] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runScan({ now: NOW, adapters: [ad], source: ad.id, indexNow: { config: null as never } }, db as unknown as Db);
    const ext = (id: number) => db.tables.holler_signals.find((s) => s.id === id)?.external_id;
    const byExt = Object.fromEntries(db.tables.holler_matches.map((m) => [ext(m.signal_id), m]));
    expect(byExt.NOPATH).toMatchObject({ user_id: 'm1', alert_hold: 'background' });
    expect(byExt.ADDR).toBeDefined();
    expect(byExt.ADDR).not.toHaveProperty('alert_hold');
    const logged = (db.tables.holler_alert_log ?? []).map((r) => ext(r.signal_id));
    expect(logged).toEqual(['ADDR']);
  });
});

describe('precision holds', () => {
  it('start empty (the replay shows no clearly wrong family)', () => {
    expect(PRECISION_HOLDS).toEqual([]);
  });
  it('a held (trade, family) pair is feed-only for that trade only, and never for a card that is not an alert', () => {
    const holds = [{ trade: 'landscaping' as const, family: 'soon-permit-downstream:new-build', why: 'test' }];
    const s = { source: 'x-permits', kind: 'permit', subtype: 'permit', title: 'New home permit in X', contactPath: 'site' as const };
    expect(alertHoldFor(s, 'coming_soon', 'landscaping', null, holds)).toBe('held');
    expect(alertHoldFor(s, 'coming_soon', 'fencing', null, holds)).toBeNull();
    expect(alertHoldFor(s, 'market_insight', 'landscaping', null, holds)).toBeNull();
  });
});
