/**
 * Round 19 integration, step 2 (r19-coverage 6c0376d merged onto r19-ship): the interactions between the coverage unit's eight probation
 * feeds and the round 18 + step 1 code. Rows and fakes are hand-written; the in-memory db is tests/ops/fakedb.ts.
 *  1. the second wall (match, lists, builders, business lookup) covers all eight ids, read from the probation flag;
 *  2. samples of the new feeds follow the round 18 contact rule; the strict address rule holds;
 *  3. probation timing with round 18's scan (held cards, stage places): live cards are written and matched first, and the business lookup
 *     is not part of the scan at all;
 *  5. the new check states reach the owner views and never a member-facing or public line;
 *  6. a probation source never makes a stage query, stage update or stage place, with HOLLER_STAGE_UPDATES_ENABLED on and off;
 *  7. metros list every probation source of both sides; the label exemption still holds.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

vi.mock('server-only', () => ({}));

import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { runScan } from '@/lib/signals/run';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { CARTO_DATASETS } from '@/lib/signals/adapters/carto-datasets';
import { COVERAGE_R19_SOURCES, NEXT_R20_SOURCES, LABEL_PENDING_INTEGRATION, PROBATION_SOURCE_IDS, isProbationSource, monitoredSourceIds, probationCheck, probationOverview } from '@/lib/signals/probation';
import { matchArea, matchOne, matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { isListablePermit } from '@/lib/lists/core';
import { lookupForCards, lookupSettings, newBudget } from '@/lib/enrich/business-lookup';
import { sanitizeSample } from '@/lib/signals/samples';
import { contactsAllowedFor } from '@/lib/contacts/extract';
import { cleanAddress } from '@/lib/contacts/sanitize';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { enabledDatasets } from '@/lib/signals/capabilities';
import { sourcePlaces } from '@/lib/admin/metros';
import { SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import type { ContactRecord } from '@/lib/contacts/types';
import type { Db } from '@/lib/signals/store';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { ENV, fakeFetch, item, newDb, NOW as LNOW } from '../enrich/helpers';

const NOW = new Date('2026-11-22T12:00:00Z');
const IDS = COVERAGE_R19_SOURCES.map((s) => s.id);
const META = Object.fromEntries(COVERAGE_R19_SOURCES.map((s) => [s.id, s]));
const DS = new Map<string, { id: string; subtype: string; kind?: string; probation?: boolean }>([...SOCRATA_DATASETS, ...ARCGIS_DATASETS, ...CARTO_DATASETS].map((d) => [d.id, d as never]));
const CENTER: Record<string, [number, number, string]> = {
  'dallas-fort-worth': [32.78, -96.8, 'TX'],
  houston: [29.76, -95.36, 'TX'],
  miami: [25.77, -80.19, 'FL'],
  phoenix: [33.45, -112.07, 'AZ'],
};
const TRADES = ['roofing', 'plumbing', 'landscaping', 'general-contractor', 'hvac', 'electrical', 'cleaning', 'handyman', 'pest-control', 'siding-gutters'];
const memberAt = (id: string): MatchProfile => {
  const [lat, lon, state] = CENTER[META[id].metro];
  return { user_id: `m-${id}`, categories: TRADES, lat, lon, state, radius_mi: 50 };
};
const recOf = (id: string, over: Partial<MatchSignal> = {}): MatchSignal => {
  const [lat, lon, state] = CENTER[META[id].metro];
  const subtype = DS.get(id)!.subtype;
  return {
    id: Math.floor(Math.random() * 1e9),
    source: id,
    kind: subtype === 'permit' ? 'permit' : 'civic',
    subtype,
    title: subtype === 'permit' ? 'Roof permit in Dallas' : 'Code violation: overgrown yard',
    summary: 'Re-roof | 100 MAIN ST',
    categories: TRADES,
    lat: lat + 0.01,
    lon,
    state,
    severity: 2,
    occurred_at: '2026-11-21T00:00:00Z',
    data: { subtype },
    contactPath: 'business',
    ...over,
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('1. the second wall covers all eight coverage sources, read from the probation flag', () => {
  it('every coverage id is registered with probation on and is in PROBATION_SOURCE_IDS; the set is exactly the configs with probation: true', () => {
    expect(IDS).toHaveLength(8);
    for (const id of IDS) {
      expect(ALL_ADAPTERS.find((a) => a.id === id)?.probation, id).toBe(true);
      expect(isProbationSource(id), id).toBe(true);
    }
    for (const [id, d] of DS) expect(PROBATION_SOURCE_IDS.has(id), id).toBe(d.probation === true);
    expect(readFileSync('lib/signals/probation.ts', 'utf8')).toMatch(/\.filter\(\(d\) => d\.probation === true\)/);
  });

  it('no match, no builders area hit, no list line, with or without a contact path, gate on or off', () => {
    for (const id of IDS) {
      const p = memberAt(id);
      for (const contactPath of ['business', 'site', null] as const) {
        const s = recOf(id, { contactPath });
        expect(matchOne(s, p, true, NOW.getTime()), id).toBeNull();
        expect(matchArea(s, p, true), id).toBeNull();
        for (const gate of [true, false]) expect(matchSignals([s], [p], undefined, NOW, gate), id).toEqual([]);
        // the control: the same row from a live source in the same place is matched
        expect(matchOne({ ...s, source: 'socrata-chicago-permits' }, p, true, NOW.getTime()), id).not.toBeNull();
      }
      expect(isListablePermit({ source: id, kind: 'permit', subtype: 'permit', projectOf: null } as never), id).toBe(false);
    }
  });

  it('no paid business lookup for any of them', async () => {
    const c: ContactRecord = { signalId: 1, role: 'contractor', name: 'Peachtree Roofing LLC', city: null, state: null };
    for (const id of IDS) {
      const fetch = fakeFetch([item()]);
      await lookupForCards(new Map([[1, [c]]]), [{ signalId: 1, city: 'Atlanta', state: 'GA', contact: c, source: id }], newBudget(lookupSettings(ENV)), {
        db: newDb() as never, fetch: fetch as typeof globalThis.fetch, env: ENV, now: () => LNOW, sleep: async () => {},
      });
      expect(fetch, id).not.toHaveBeenCalled();
    }
  });
});

describe('2. samples of the new feeds: the round 18 contact rule, the strict address rule', () => {
  it('each feed\'s record kind decides with contactsAllowedFor (311: none; violation: owner only, and only with the switch on; permit: no owner)', () => {
    const owner = { role: 'owner', name: 'Philadelphia Housing Authority' };
    const contractor = { role: 'contractor', name: 'Acme Roofing LLC' };
    for (const on of ['', '1']) {
      vi.stubEnv('HOLLER_VIOLATION_OWNERS_ENABLED', on);
      for (const id of IDS) {
        const subtype = DS.get(id)!.subtype;
        const s = { source: id, externalId: 'x', kind: 'civic', title: 't', city: 'Miami', state: 'FL', occurredAt: '2026-11-21T00:00:00Z', categories: [], data: { subtype }, contacts: [owner, contractor] } as unknown as SignalInput;
        const want = contactsAllowedFor(subtype, [owner, contractor] as never).map((x: { role: string }) => x.role);
        expect((sanitizeSample(s).contacts ?? []).map((x) => x.role), `${id} owners=${on}`).toEqual(want);
        if (subtype === '311') expect(want).toEqual([]);
        if (subtype === 'permit') expect(want).toEqual(['contractor']);
      }
    }
  });

  it('the strict address rule holds: a name after a house number is never an address', () => {
    expect(cleanAddress('4521 MARIA LOPEZ FENCE')).toBeNull();
    expect(cleanAddress('2026 SMITH RESIDENCE REMODEL')).toBeNull();
    expect(cleanAddress('1203 OAK ST - JOHN SMITH RESIDENCE')).toBe('1203 OAK ST');
  });

  it('the coverage unit\'s planted-name and hanging-source tests are in the suite unchanged', () => {
    const src = readFileSync('tests/signals/coverage-r19.test.ts', 'utf8');
    expect(src).toContain("describe('review P2-E: a hanging probation portal never holds up live sources'");
    expect(src).toMatch(/a name planted in every summary column|planted/);
  });
});

// A FakeDb with one member in Dallas (gate on: holler_matches has alert_hold; stage table present).
function scanWorld() {
  return new FakeDb({
    holler_profiles: [{ user_id: 'u1', categories: TRADES, lat: 32.78, lon: -96.8, state: 'TX', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-10T00:00:00Z' }],
    holler_matches: [],
    holler_permit_stages: [],
    holler_source_samples: [],
  });
}
const livePermit = (contactless: boolean): Adapter => ({
  id: 'live-dallas', label: 'Live', kind: 'permit', cadenceMinutes: 15, sourceUrl: 'https://example.com',
  fetch: async () => [{
    source: 'live-dallas', externalId: 'L1', kind: 'permit', title: 'New home permit in Dallas', summary: contactless ? 'New Construction | Single Family Dwelling | Issued' : 'New Construction | 4521 ELM ST',
    url: 'https://example.com/1', categories: ['general-contractor', 'real-estate', 'moving'], severity: 1, occurredAt: '2026-11-22T10:00:00Z', lat: 32.78, lon: -96.8, state: 'TX', city: 'Dallas',
    data: { subtype: 'permit' },
    ...(contactless ? {} : { contacts: [{ role: 'contractor', name: 'Acme Roofing LLC' }] }),
  } as SignalInput],
});

describe('3. probation timing with round 18\'s scan (held cards, stage places)', () => {
  it('a hanging probation source: the live permit is stored and matched (held "background" by the contact gate) before the probation timeout', async () => {
    const f = scanWorld();
    const t0 = Date.now();
    const writes: Array<[string, number]> = [];
    const realFrom = f.from.bind(f);
    (f as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      writes.push([t, Date.now() - t0]);
      return realFrom(t);
    };
    const hanging = { ...ALL_ADAPTERS.find((a) => a.id === 'arcgis-houston-311')!, fetch: () => new Promise<SignalInput[]>(() => {}) };
    const r = await runScan({ now: NOW, adapters: [hanging, livePermit(true)], probationTimeoutMs: 400, stageUpdates: true }, f as unknown as Db);
    const firstMatch = writes.find(([t]) => t === 'holler_matches')![1];
    expect(firstMatch).toBeLessThan(300);
    expect(f.tables.holler_matches.map((m) => m.alert_hold)).toEqual(['background']);
    expect(r.sources.find((x) => x.id === 'arcgis-houston-311')).toMatchObject({ status: 'error', error: 'timeout' });
    expect(f.tables.holler_source_samples).toEqual([]);
  });

  it('the scan never runs the business lookup: run.ts does not import it (it lives in the notify route, after the scan)', () => {
    const run = readFileSync('lib/signals/run.ts', 'utf8');
    expect(run).not.toMatch(/business-lookup|lookupForCards|lookupBusiness/);
    expect(readFileSync('app/api/cron/scan/route.ts', 'utf8')).not.toMatch(/business-lookup|lookupForCards/);
  });
});

describe('6. a probation source never makes a stage query, a stage update or takes a stage place', () => {
  for (const flag of [true, false]) {
    it(`HOLLER_STAGE_UPDATES_ENABLED ${flag ? 'on' : 'off'}: the probation adapter is never asked for stages; nothing it returns reaches the stage table or a match`, async () => {
      const f = scanWorld();
      const seen: Record<string, boolean> = {};
      const probation: Adapter = {
        ...ALL_ADAPTERS.find((a) => a.id === 'socrata-dallas-permits')!,
        stageQuery: true,
        fetch: async (ctx: AdapterContext) => {
          seen.probation = !!ctx.stageTracking;
          return [{ source: 'socrata-dallas-permits', externalId: 'P1', kind: 'permit', title: 'Roof permit in Dallas', summary: 'Re-roof', url: 'https://example.com/p', categories: ['roofing'], severity: 1, occurredAt: '2026-11-22T10:00:00Z', lat: 32.78, lon: -96.8, state: 'TX', city: 'Dallas', data: { subtype: 'permit', permitStage: 'final', status: 'FINALED' } } as SignalInput];
        },
      };
      const live: Adapter = {
        ...livePermit(false),
        stageQuery: true,
        fetch: async (ctx: AdapterContext) => {
          seen.live = !!ctx.stageTracking;
          return livePermit(false).fetch(ctx);
        },
      };
      await runScan({ now: NOW, adapters: [probation, live], stageUpdates: flag }, f as unknown as Db);
      expect(seen.probation).toBe(false);
      expect(seen.live).toBe(flag); // the control: the live adapter gets the stage query exactly when the flag is on
      expect((f.tables.holler_permit_stages ?? []).filter((r) => String(r.source ?? '').startsWith('socrata-dallas'))).toEqual([]);
      expect((f.tables.holler_signals ?? []).map((s) => s.source)).toEqual(['live-dallas']);
      expect(f.tables.holler_source_samples.map((s) => s.source)).toEqual(['socrata-dallas-permits']);
    });
  }
});

describe('5. check states: owner views only, never a member-facing or public line', () => {
  const ERRORS: Array<[string, string | null, string | null, string]> = [
    ['schema_mismatch', 'schema mismatch: expected ISSUEDATE', null, 'arcgis-tempe-permits'],
    ['not_json', 'arcgis-miamidade-permits: response was not JSON (HTTP 200)', null, 'arcgis-miamidade-permits'],
    ['no_recent_rows', 'socrata-dallas-permits: no rows in the last 30 days: newest is 2018-03-15 (500 rows read)', null, 'socrata-dallas-permits'],
    ['error', 'timeout', null, 'arcgis-houston-311'],
    ['no_rows', null, null, 'arcgis-phoenix-permits'],
    ['row_cap', null, '2026-11-21T00:00:00Z', 'arcgis-arlington-permits'],
  ];
  const health = ERRORS.map(([, err, rec, id]) => ({ source: id, last_run_at: '2026-11-22T11:00:00Z', last_success_at: err ? null : '2026-11-22T11:00:00Z', last_error: err, last_record_at: rec }));
  const runs = [{ source: 'arcgis-arlington-permits', started_at: '2026-11-22T11:00:00Z', error: 'probation note: row cap reached: 500 rows read (limit 500); older rows in the window were not read' }];

  it('/api/admin/sources view: each state is named, with its note', () => {
    const view = probationOverview(ALL_ADAPTERS, health, (id) => sourcePlaces().get(id) ?? null, runs);
    for (const [check, , , id] of ERRORS) expect(view.find((r) => r.id === id)?.check, id).toBe(check);
    expect(view.find((r) => r.id === 'arcgis-arlington-permits')?.note).toMatch(/row cap reached/);
    expect(probationCheck(undefined)).toBe('not_run');
  });

  it('the monitor never judges a probation source (no owner alert), from either side', () => {
    const ids = monitoredSourceIds(ALL_ADAPTERS, () => []);
    for (const a of ALL_ADAPTERS.filter((x) => x.probation)) expect(ids.has(a.id), a.id).toBe(false);
  });

  it('member and public lines: the /app and /check coverage notice, enabled datasets and city lists never name a broken probation source', () => {
    const states: Record<string, { state: string; reason: string | null; lastRecordAt: string | null }> = {};
    for (const a of ALL_ADAPTERS) states[a.id] = { state: a.probation ? 'unavailable' : 'healthy', reason: a.probation ? 'error' : null, lastRecordAt: '2026-11-21T00:00:00Z' };
    for (const m of Object.values(CENTER)) {
      const n = coverageNotice({ lat: m[0], lon: m[1], trades: [], states, now: NOW.getTime() });
      expect(n, String(m)).toBeNull();
    }
    const enabled = new Set(enabledDatasets().map((d) => d.id));
    for (const id of PROBATION_SOURCE_IDS) expect(enabled.has(id), id).toBe(false);
  });

  it('the health route judges the monitor with monitoredSourceIds after the samples-table check (both sides kept)', () => {
    const src = readFileSync('app/api/cron/health/route.ts', 'utf8');
    expect(src).toMatch(/withProbationSetup\(admin/);
    expect(src).toMatch(/monitoredSourceIds\(ALL_ADAPTERS/);
    expect(src).toMatch(/loadHeldPermitReport/);
    expect(src).toMatch(/countShortTrials/);
  });
});

describe('7. metros and the label exemption', () => {
  it('every probation source of both sides sits under its metro in the scorecard', () => {
    const places = sourcePlaces();
    const want: Record<string, string> = {
      'carto-phl-permits': 'philadelphia', 'carto-phl-violations': 'philadelphia', 'carto-phl-business': 'philadelphia',
      'socrata-dallas-permits': 'dallas-fort-worth', 'arcgis-arlington-permits': 'dallas-fort-worth', 'arcgis-houston-311': 'houston',
      'arcgis-miamidade-permits': 'miami', 'arcgis-miamidade-violations': 'miami', 'arcgis-miamidade-building-violations': 'miami',
      'arcgis-phoenix-permits': 'phoenix', 'arcgis-tempe-permits': 'phoenix',
      // Round 20 NEXT (lib/signals/probation.ts NEXT_R20_SOURCES).
      ...Object.fromEntries(NEXT_R20_SOURCES.map((s) => [s.id, s.metro])),
    };
    for (const [id, metro] of Object.entries(want)) expect(places.get(id), id).toBe(metro);
    expect([...PROBATION_SOURCE_IDS].sort()).toEqual(Object.keys(want).sort());
  });

  it('the eight ids have no label yet and are exempt only while on probation', () => {
    // Round 20 NEXT adds its own probation sources to the same exemption.
    expect([...LABEL_PENDING_INTEGRATION].sort()).toEqual([...IDS, ...NEXT_R20_SOURCES.map((s) => s.id)].sort());
    for (const id of IDS) {
      expect(SOURCE_DEFAULTS[id], id).toBeUndefined();
      expect(isProbationSource(id), id).toBe(true);
    }
  });
});

describe('9. the coverage feeds\' real-shaped company strings under the merged round 18 name rules (measured, nothing loosened)', () => {
  it('contractor columns (Miami-Dade CONTRNAME, Tempe ContractorCompanyName, Dallas run-together contractor) and Arlington NameofBusiness (role business)', async () => {
    const { parseArcgisReport } = await import('@/lib/signals/adapters/arcgis');
    const { parseSocrataReport } = await import('@/lib/signals/adapters/socrata');
    const arc = (id: string) => ARCGIS_DATASETS.find((d) => d.id === id)!;
    const dallas = SOCRATA_DATASETS.find((d) => d.id === 'socrata-dallas-permits')!;
    const ISSUED = Date.parse('2026-11-20T15:00:00Z');
    const named = (id: string, attrs: Record<string, unknown>, geometry: { x: number; y: number }) =>
      (parseArcgisReport({ features: [{ attributes: attrs, geometry }] }, arc(id)).items[0]?.contacts ?? []).filter((c) => c.role !== 'site').map((c) => `${c.role}:${c.name}`);
    const miami = (name: string) => named('arcgis-miamidade-permits', { ID: 'BP1', ISSUDATE: ISSUED, DESC1: 'REROOF SHINGLE', APPTYPE: 'REPAIR', TYPE: 'BLDG', PROPUSE: 'SINGLE FAMILY', BPSTATUS: 'ISSUED', ADDRESS: '1450 NW 7 ST', CONTRNAME: name, ESTVALUE: '$24,000', CONF_FLAG: 'N' }, { x: -80.21, y: 25.78 });
    const tempe = (name: string) => named('arcgis-tempe-permits', { PermitNum: 'BP1', IssuedDate: ISSUED, Description: 'Replace water heater', PermitClass: 'Residential', PermitType: 'Plumbing', PermitTypeDesc: 'Plumbing', WorkClass: 'Alteration', StatusCurrent: 'Issued', OriginalAddress1: '31 E 5TH ST', OriginalZip: '85281', Latitude: 33.4255, Longitude: -111.94, ContractorCompanyName: name, EstProjectCost: 1800 }, { x: -111.94, y: 33.4255 });
    const arlington = (name: string) => named('arcgis-arlington-permits', { FOLDERTYPE: 'RB', FOLDERYEAR: '26', FOLDERSEQUENCE: '1', ISSUEDATE: ISSUED, WORKDESC: 'Roof replacement', SUBDESC: 'Residential Roofing', STATUSDESC: 'Issued', FOLDERNAME: '1200 W ABRAM ST', ConstructionValuationDeclared: 18500, NameofBusiness: name }, { x: -97.12, y: 32.73 });
    const dal = (contractor: string) => (parseSocrataReport([{ permit_number: 'D1', issued_date: '11/16/26', permit_type: 'Residential Alteration Permit', work_description: 'Re-roof', land_use: 'SINGLE FAMILY', street_address: '1500 MARILLA ST', zip_code: '75201', value: '$12,000', contractor }], dallas, { now: NOW }).items[0]?.contacts ?? []).filter((c) => c.role !== 'site').map((c) => `${c.role}:${c.name}`);

    // Contractor columns: the round 18 contractor rule keeps the place-word companies the old strict check dropped.
    expect(miami('SUNSHINE ROOFING INC')).toEqual(['contractor:SUNSHINE ROOFING INC']);
    expect(miami('SOUTH FLORIDA ROOFING INC')).toEqual(['contractor:SOUTH FLORIDA ROOFING INC']);
    expect(tempe('Valley Plumbing LLC')).toEqual(['contractor:Valley Plumbing LLC']);
    expect(tempe('Phoenix Plumbing LLC')).toEqual(['contractor:Phoenix Plumbing LLC']);
    expect(dal('NORTH TEXAS ROOFING LLC 7501 US HWY 287, ARLINGTON, TX 76001 (214) 555-0100')).toEqual(['contractor:NORTH TEXAS ROOFING LLC']);
    expect(dal('MILESTONE ELECTRIC 7501 US HWY 287, Suite C4, ARLINGTON, TX 76001 (817) 969-5050')).toEqual(['contractor:MILESTONE ELECTRIC']);
    // Arlington NameofBusiness is role business (licence rule): Texas with a legal form is kept now; "Dallas" is still refused.
    expect(arlington('North Texas Roofing LLC')).toEqual(['business:North Texas Roofing LLC']);
    // Round 20 NEXT review fix P1-4 / P2-6, decided explicitly: "Lone Star Roofing LLC" is a company (a Texas nickname, a trade word and a legal
    // form, no person named); the licence rule's second try (lib/contacts/trade-name.ts) accepts it.
    expect(arlington('Lone Star Roofing LLC')).toEqual(['business:Lone Star Roofing LLC']);
    expect(arlington('Dallas Roofing LLC')).toEqual([]);
    // never a person, in any of them
    for (const p of ['Maria Lopez', 'JOHN A SMITH', 'Smith, John', 'Florida Garcia Inc', 'TEXAS SMITH LLC']) {
      expect(arlington(p), p).toEqual([]);
    }
    for (const p of ['Maria Lopez', 'JOHN A SMITH', 'Smith, John']) {
      expect(miami(p), p).toEqual([]);
      expect(tempe(p), p).toEqual([]);
    }
  });
});

describe('4. /api/admin/coverage-probe', () => {
  it('Bearer-only, no ?key=, and in the cron-bearer-only list, which now names 16 routes (equal to the disk, checked there)', () => {
    const route = readFileSync('app/api/admin/coverage-probe/route.ts', 'utf8');
    expect(route).toMatch(/isCronAuthorized|isBearerAuthorized/);
    expect(route).not.toMatch(/searchParams\.get\(['"]key['"]\)/);
    const list = readFileSync('tests/security/cron-bearer-only.test.ts', 'utf8');
    const routes = [...list.slice(list.indexOf('const ROUTES = ['), list.indexOf('] as const;')).matchAll(/'([a-z-]+\/[a-z-]+)'/g)].map((m) => m[1]);
    expect(routes).toContain('admin/coverage-probe');
    expect(routes).toHaveLength(16);
  });
});

describe('5b. the health email with failing probation sources and the round 18 lines together', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/signals/registry');
    vi.doUnmock('@/lib/email');
  });

  it('GET /api/cron/health: the held-permit line is in Watch next to the probation row-cap note; the probation sources are not judged by the monitor', async () => {
    const T = new Date('2026-11-22T13:03:00.000Z');
    const ago = (d: number) => new Date(T.getTime() - d * 86_400_000).toISOString();
    const DEKALB = 'arcgis-dekalb-permits';
    const signals: Record<string, unknown>[] = [];
    const matches: Record<string, unknown>[] = [];
    for (let i = 0; i < 12; i++) {
      signals.push({ id: 100 + i, source: DEKALB, kind: 'permit', data: { subtype: 'permit' }, subtype: 'permit' });
      matches.push({ id: i + 1, user_id: 'u1', signal_id: 100 + i, alert_hold: i < 11 ? 'background' : null, created_at: ago(2) });
    }
    const log = [{ id: 99, user_id: 'u1', signal_id: 111, source: DEKALB, kind: 'permit', subtype: 'permit', created_at: ago(2) }];
    const probation = ALL_ADAPTERS.filter((a) => ['arcgis-arlington-permits', 'arcgis-tempe-permits', 'socrata-dallas-permits'].includes(a.id));
    const NOTE = 'probation note: row cap reached: 500 rows read (limit 500); older rows in the window were not read';
    const db = new FakeDb({
      holler_signals: signals, holler_matches: matches, holler_alert_log: log, holler_source_samples: [],
      holler_scan_runs: [
        { id: 1, source: 'arcgis-arlington-permits', started_at: ago(0.1), finished_at: ago(0.1), fetched: 500, inserted: 300, matched: 0, error: NOTE },
        { id: 2, source: 'arcgis-tempe-permits', started_at: ago(0.1), finished_at: ago(0.1), fetched: 0, inserted: 0, matched: 0, error: 'schema mismatch: expected IssuedDate' },
        { id: 3, source: 'socrata-dallas-permits', started_at: ago(0.1), finished_at: ago(0.1), fetched: 0, inserted: 0, matched: 0, error: 'socrata-dallas-permits: response was not JSON (HTTP 200)' },
      ],
    });
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T);
    const sendEmail = vi.fn(async () => ({ ok: true, id: 'em' }));
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('ADMIN_EMAIL', 'owner@x.test');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    vi.doMock('@/lib/signals/registry', async (orig) => ({ ...(await orig<typeof import('@/lib/signals/registry')>()), ALL_ADAPTERS: probation }));
    vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }));
    const { GET } = await import('@/app/api/cron/health/route');
    const res = await GET(new Request('http://x.test/api/cron/health', { headers: { authorization: 'Bearer s3cret' } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { watch: string[]; monitor?: { status?: string; alerts?: unknown[] } };
    expect(body.watch).toContain('DeKalb County permits: 92% held for no contact path, check the site-address field');
    const text = (sendEmail.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toContain('DeKalb County permits: 92% held');
    // the monitor judged none of the three (they are all on probation): no alert names them
    expect(body.monitor).toBeTruthy();
    expect(JSON.stringify(body.monitor)).not.toMatch(/arcgis-arlington-permits|arcgis-tempe-permits|socrata-dallas-permits/);
  });
});
