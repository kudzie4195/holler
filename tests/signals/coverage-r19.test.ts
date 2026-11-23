// Round 19 COVERAGE: Dallas-Fort Worth, Houston, Miami and Phoenix feeds, all ON PROBATION. Every row below is HAND-WRITTEN from the column
// names in /home/claude/gates/r19/COVERAGE-research.md (tags [O], [3P], [A]); no row was ever pulled from a portal, so these prove the
// fail-safe behaviour of the code, not the live schemas. The in-memory database is tests/ops/fakedb.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeDb } from '../ops/fakedb';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { runScan } from '@/lib/signals/run';
import { SAMPLES_MISSING } from '@/lib/signals/samples';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { buildSocrataAdapter, buildSocrataQuery, mdyToFloating, parseSocrataReport, recordDateIso } from '@/lib/signals/adapters/socrata';
import { buildArcgisAdapter, buildArcgisQuery, isConfidential, layerSchemaCheck, parseArcgisReport, requestTimeoutMs, resetArcgisFieldCache } from '@/lib/signals/adapters/arcgis';
import { COVERAGE_R19_SOURCES, LABEL_PENDING_INTEGRATION, monitoredSourceIds, probationCheck, probationOverview } from '@/lib/signals/probation';
import { isProbationNote, isRunNote } from '@/lib/signals/probation-note';
import { computeSourceStates } from '@/lib/signals/source-state';
import { PROBATION_TIMEOUT_MS } from '@/lib/signals/run';
import { UNVERIFIED_REQUEST_TIMEOUT_MS } from '@/lib/signals/schema-check';
import { socrataSelectColumns } from '@/lib/signals/adapters/socrata';
import { columnsSeen, isSchemaMismatch, schemaProblem } from '@/lib/signals/schema-check';
import { expectedColumns, runCoverageProbe, coverageProbeSourceIds } from '@/lib/signals/coverage-probe';
import { enabledDatasets, CITY_FEEDS } from '@/lib/signals/capabilities';
import { feedCount } from '@/lib/seo/home-live';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { buildMetroReport, sourcePlaces } from '@/lib/admin/metros';
import { METROS } from '@/lib/geo/metros';
import type { Db } from '@/lib/signals/store';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { PAGE_WATCH_DATASETS } from '@/lib/signals/adapters/page-watch-datasets';
/** Round 20 page watch: its registered pages are on probation too. Exempted by exact id (never by prefix), and pinned below. */
const PW_REGISTERED: ReadonlySet<string> = new Set(PAGE_WATCH_DATASETS.filter((d) => d.verified).map((d) => d.id));


vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const MS = (iso: string) => Date.parse(iso);
const asDb = (f: FakeDb) => f as unknown as Db;
const IDS = COVERAGE_R19_SOURCES.map((s) => s.id);
const adapterOf = (id: string) => ALL_ADAPTERS.find((a) => a.id === id)!;
const arc = (id: string) => ARCGIS_DATASETS.find((d) => d.id === id)!;
const dallas = SOCRATA_DATASETS.find((d) => d.id === 'socrata-dallas-permits')!;

// Members in every new metro, with every trade a row below can carry: if probation leaked, they would be matched.
const TRADES = ['roofing', 'plumbing', 'landscaping', 'general-contractor', 'hvac', 'electrical', 'cleaning', 'handyman', 'pest-control', 'siding-gutters'];
const member = (n: number, lat: number, lon: number, state: string) => ({
  user_id: `u00000${n}`, categories: TRADES, lat, lon, state, radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-10T00:00:00Z',
});
const PROFILES = [member(1, 32.78, -96.8, 'TX'), member(2, 29.76, -95.36, 'TX'), member(3, 25.77, -80.19, 'FL'), member(4, 33.45, -112.07, 'AZ')];

// ---- hand-written rows (assumed values, research column names) -----------------------------------------------------------------------

const ISSUED = MS('2026-11-20T15:00:00Z');
const ROWS: Record<string, Record<string, unknown>> = {
  'arcgis-arlington-permits': {
    FOLDERTYPE: 'RB', FOLDERYEAR: '26', FOLDERSEQUENCE: '104233', ISSUEDATE: ISSUED, WORKDESC: 'Roof replacement, tear off and reroof', SUBDESC: 'Residential Roofing',
    STATUSDESC: 'Issued', FOLDERNAME: '1200 W ABRAM ST', ConstructionValuationDeclared: 18500, NameofBusiness: 'Lone Star Roofing LLC',
  },
  'arcgis-miamidade-permits': {
    ID: 'BP2026-000123', ISSUDATE: ISSUED, DESC1: 'REROOF SHINGLE', APPTYPE: 'REPAIR', TYPE: 'BLDG', PROPUSE: 'SINGLE FAMILY', BPSTATUS: 'ISSUED',
    ADDRESS: '1450 NW 7 ST', CONTRNAME: 'SUNSHINE ROOFING INC', ESTVALUE: '$24,000',
  },
  'arcgis-miamidade-violations': { CASE_NUM: 'CC2026-000001', CASE_DATE: ISSUED, PROBLEM_DESC: 'OVERGROWN LOT', STAT_DESC: 'OPEN', ADDRESS: '1450 NW 7 ST', CONF_FLAG: 'N' },
  'arcgis-miamidade-building-violations': { CASE_NUM: 'BV2026-000001', OPEN_DATE: ISSUED, CASE_TYPE: 'ROOF IN DISREPAIR', PROP_ADDR: '2200 SW 8 ST' },
  'arcgis-phoenix-permits': {
    PERMIT_NUMBER: 'PR26-001234', PERMIT_ISSUE_DATE: ISSUED, PERMIT_TYPE: 'RESR', PERMIT_TYPE_DESC: 'Residential Reroof', SCOPE: 'Reroof tile roof', STATUS: 'Issued',
    ADDRESS: '200 W WASHINGTON ST',
  },
  'arcgis-tempe-permits': {
    PermitNum: 'BP261234', IssuedDate: ISSUED, Description: 'Replace water heater', PermitClass: 'Residential', PermitType: 'Plumbing', PermitTypeDesc: 'Plumbing',
    WorkClass: 'Alteration', StatusCurrent: 'Issued', OriginalAddress1: '31 E 5TH ST', OriginalZip: '85281', Latitude: 33.4255, Longitude: -111.9400,
    ContractorCompanyName: 'Valley Plumbing LLC', EstProjectCost: 1800,
  },
  'arcgis-houston-311': {
    CaseNumber: '26-00012345', CreatedDate: MS('2026-11-22T09:00:00Z'), CaseType: 'Water Leak', Title: 'Water leak in street', Department: 'Houston Public Works',
    Division: 'Water', Status: 'Open', Latitude: 29.7604, Longitude: -95.3698,
  },
};
const GEOM: Record<string, { x: number; y: number }> = {
  'arcgis-arlington-permits': { x: -97.12, y: 32.73 },
  'arcgis-miamidade-permits': { x: -80.21, y: 25.78 },
  'arcgis-miamidade-violations': { x: -80.21, y: 25.78 },
  'arcgis-miamidade-building-violations': { x: -80.23, y: 25.76 },
  'arcgis-phoenix-permits': { x: -112.075, y: 33.449 },
  'arcgis-tempe-permits': { x: -111.94, y: 33.4255 },
  'arcgis-houston-311': { x: -95.3698, y: 29.7604 },
};
// Private columns a layer may carry. The adapter never asks for them; a server that sends them anyway must not get them stored.
const PRIVATE_EXTRAS = { OWNER_NAME: 'JANE OWNERSON', CONTACT: 'BOB CONTACTMAN', VIOL_NAME: 'PAT VIOLATOR', CONF_BY: 'OFFICER SAM', ResolutionNotes: 'Called Mr Example at 713-555-0199', LGLDESC1: 'LOT 4 BLK 9' };
const PRIVATE_VALUES = Object.values(PRIVATE_EXTRAS);

const DALLAS_ROW = {
  permit_number: 'BLD-26-000153', issued_date: '11/16/26', permit_type: 'Residential Alteration Permit', work_description: 'Re-roof composition shingles',
  land_use: 'SINGLE FAMILY', street_address: '1500 MARILLA ST', zip_code: '75201', value: '$12,000',
  contractor: 'MILESTONE ELECTRIC 7501 US HWY 287, Suite C4, ARLINGTON, TX 76001 (817) 969-5050', // the shape seen in the 2018 CSV
};

type LayerSpec = { fields?: Array<{ name: string; type: string }> | 'down'; features?: unknown[] | 'error' | 'html' | 'empty'; count?: number; extra?: Record<string, unknown> };
/** Layer fields of a dataset, built from its own expected columns (date column typed as a date). */
function fieldsOf(ds: ArcgisDataset, drop: string[] = [], dateType = 'esriFieldTypeDate'): Array<{ name: string; type: string }> {
  return expectedColumns({ platform: 'arcgis', ds })
    .filter((c) => !drop.includes(c))
    .map((name) => ({ name, type: name === ds.dateField ? dateType : 'esriFieldTypeString' }));
}
function feature(id: string, over: Record<string, unknown> = {}, extras = true) {
  return { attributes: { ...ROWS[id], ...(extras ? PRIVATE_EXTRAS : {}), ...over }, geometry: GEOM[id] };
}

/** A fake portal: ArcGIS layers by URL prefix, the Dallas Socrata dataset, and a log of every URL asked for. */
const HTML = '<!DOCTYPE html><html><body>Service temporarily unavailable</body></html>';
function portal(layers: Record<string, LayerSpec>, dallasRows: unknown[] | 'error' | 'html' | 'empty' = [DALLAS_ROW], dallasCount?: number) {
  const urls: string[] = [];
  const f = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('dallasopendata.com/api/views/')) return new Response(JSON.stringify({ columns: Object.keys(DALLAS_ROW).map((fieldName) => ({ fieldName })) }), { status: 200 });
    if (url.includes('dallasopendata.com/resource/')) {
      if (new URL(url).searchParams.get('$select')?.startsWith('count(')) return new Response(JSON.stringify([{ n: String(dallasCount ?? (Array.isArray(dallasRows) ? dallasRows.length : 0)) }]), { status: 200 });
      if (dallasRows === 'html') return new Response(HTML, { status: 200 });
      if (dallasRows === 'empty') return new Response('', { status: 200 });
      return dallasRows === 'error' ? new Response(JSON.stringify({ message: 'No such column: issued_date' }), { status: 400 }) : new Response(JSON.stringify(dallasRows), { status: 200 });
    }
    for (const ds of ARCGIS_DATASETS) {
      if (!url.startsWith(ds.layerUrl)) continue;
      const spec = layers[ds.id] ?? {};
      if (url.includes('/query?') && url.includes('returnCountOnly=true')) return new Response(JSON.stringify({ count: spec.count ?? 1 }), { status: 200 });
      if (url.includes('/query?')) {
        if (spec.features === 'error') return new Response(JSON.stringify({ error: { code: 400, message: 'Invalid field' } }), { status: 200 });
        if (spec.features === 'html') return new Response(HTML, { status: 200 });
        if (spec.features === 'empty') return new Response('', { status: 200 });
        return new Response(JSON.stringify({ features: spec.features ?? [feature(ds.id)], ...(spec.extra ?? {}) }), { status: 200 });
      }
      if (spec.fields === 'down') return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ fields: spec.fields ?? fieldsOf(ds) }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, urls };
}

/** The data request (not the count request). */
const rowsUrl = (urls: string[]) => urls.find((u) => (u.includes('/query?') && !u.includes('returnCountOnly')) || (u.includes('/resource/') && !/count%28|count\(/.test(u)))!;

function ctx(doFetch: typeof fetch) {
  const logs: string[] = [];
  const c: AdapterContext = { since: new Date(NOW.getTime() - 86_400_000), now: NOW, env: {}, log: (m) => logs.push(String(m)), fetch: doFetch, db: null, dry: true };
  return { c, logs };
}

beforeEach(() => resetArcgisFieldCache());

// ------------------------------------------------------------------------------------------------------------------------------------
describe('the new sources are declared on probation, like Philadelphia', () => {
  it('every coverage source is registered, on probation, labelled in SOURCE_META, and its dataset config says probation', () => {
    expect(IDS.sort()).toEqual([
      'arcgis-arlington-permits', 'arcgis-houston-311', 'arcgis-miamidade-building-violations', 'arcgis-miamidade-permits', 'arcgis-miamidade-violations',
      'arcgis-phoenix-permits', 'arcgis-tempe-permits', 'socrata-dallas-permits',
    ]);
    for (const id of IDS) {
      const a = adapterOf(id);
      expect(a, id).toBeDefined();
      expect(a.probation, id).toBe(true);
      expect(SOURCE_META[id]?.label, id).toBe(a.label);
      const d = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].find((x) => x.id === id)!;
      expect(d.probation, id).toBe(true);
      expect(d.schemaUnverified, id).toBe(true);
    }
    // Round 20 page watch adds its own probation ids to the exemption (tests/signals/page-watch); the coverage ids are all still there.
    expect([...LABEL_PENDING_INTEGRATION].filter((id) => !PW_REGISTERED.has(id)).sort()).toEqual(IDS);
  });

  it('no Fort Worth source and no Houston permit source was added (no usable endpoint without a page scraper)', () => {
    const ids = ALL_ADAPTERS.map((a) => a.id);
    expect(ids.some((id) => /fortworth|fort-worth/.test(id))).toBe(false);
    // Round 20 page watch adds Houston BID pages (PW_REGISTERED, exact ids), not permit sources.
    expect(ids.filter((id) => /houston/.test(id) && !PW_REGISTERED.has(id))).toEqual(['arcgis-houston-311']);
  });

  it('metros: every coverage source sits in its metro (Arlington in Dallas-Fort Worth, Tempe in Phoenix, Miami-Dade County in Miami)', () => {
    const p = sourcePlaces();
    for (const s of COVERAGE_R19_SOURCES) expect(p.get(s.id), s.id).toBe(s.metro);
    const cities = Object.fromEntries(METROS.map((m) => [m.id, m.cities]));
    expect(cities['dallas-fort-worth']).toEqual(expect.arrayContaining(['dallas-tx', 'fort-worth-tx', 'arlington-tx']));
    expect(cities.phoenix).toEqual(expect.arrayContaining(['phoenix-az', 'tempe-az']));
    expect(cities.miami).toContain('miami-fl');
    expect(cities.houston).toContain('houston-tx');
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('probation: nothing reaches a member, a public page or an email (samples table present)', () => {
  it.each(IDS)('%s: rows go to holler_source_samples only; no signal, contact, match, alert log row or notification', async (id) => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const { fetch: doFetch } = portal({});
    const r = await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
    const src = r.sources.find((s) => s.id === id)!;
    expect(src.status, JSON.stringify(src)).toBe('ok');
    expect(src.inserted).toBe(1);
    expect(f.tables.holler_source_samples.map((s) => s.source)).toEqual([id]);
    for (const t of ['holler_signals', 'holler_signal_contacts', 'holler_matches', 'holler_alert_log', 'holler_notifications', 'holler_push_log', 'holler_email_log', 'holler_permit_stages', 'holler_project_links']) {
      expect(f.tables[t] ?? [], `${id} ${t}`).toEqual([]);
    }
    expect(f.calls.filter((c) => /^holler_(signals|signal_contacts|matches|alert_log|permit_stages)\.(insert|upsert|update)/.test(c))).toEqual([]);
    expect(r.indexNow).toBeUndefined();
    // The sample holds the mapped record only: none of the private columns the fake layer sent.
    expect(JSON.stringify(f.tables.holler_source_samples)).not.toMatch(new RegExp(PRIVATE_VALUES.join('|')));
  });
});

describe('probation with the samples table missing (PGRST205 and 42P01)', () => {
  it.each([
    ['PGRST205', "Could not find the table 'public.holler_source_samples' in the schema cache"],
    ['42P01', 'relation "public.holler_source_samples" does not exist'],
  ])('%s: every coverage source is skipped with no fetch, no write anywhere and no error', async (code, message) => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    for (const op of ['select', 'upsert', 'delete']) {
      f.failOn[`holler_source_samples.${op}`] = message;
      f.failCode[`holler_source_samples.${op}`] = code;
    }
    const { fetch: doFetch, urls } = portal({});
    const r = await runScan({ now: NOW, adapters: IDS.map(adapterOf), fetchImpl: doFetch }, asDb(f));
    expect(urls).toEqual([]);
    expect(r.error).toBeUndefined();
    for (const id of IDS) expect(r.sources.find((s) => s.id === id), id).toMatchObject({ status: 'skipped(env)', inserted: 0, logs: [SAMPLES_MISSING] });
    for (const t of ['holler_signals', 'holler_signal_contacts', 'holler_matches', 'holler_alert_log', 'holler_scan_runs']) {
      expect((f.tables[t] ?? []).filter((x) => x.source !== '_prune'), t).toEqual([]);
    }
  });
});

describe('probation: no public page, count, guide or coverage claim', () => {
  it('enabledDatasets, CITY_FEEDS and feedCount leave every coverage source out', () => {
    const enabled = new Set(enabledDatasets().map((d) => d.id));
    for (const id of IDS) expect(enabled.has(id), id).toBe(false);
    // The city pages of the new metros claim no permit or violation feed from these sources (Dallas keeps its live 311 only).
    for (const slug of ['arlington-tx', 'miami-fl', 'phoenix-az', 'tempe-az', 'houston-tx']) {
      expect(CITY_FEEDS[slug] ?? [], slug).not.toContain('permit');
      expect(CITY_FEEDS[slug] ?? [], slug).not.toContain('violation');
    }
    expect(CITY_FEEDS['dallas-tx'] ?? []).not.toContain('permit');
    const live = ALL_ADAPTERS.filter((a) => !IDS.includes(a.id));
    expect(feedCount(ALL_ADAPTERS, {})).toBe(feedCount(live, {}));
  });

  it('the guide data sources leave every coverage source out', async () => {
    const { GUIDE_DATA_SPECS } = await import('@/lib/seo/guide-data');
    const all = Object.values(GUIDE_DATA_SPECS).flatMap((s) => s.sources);
    for (const id of IDS) expect(all, id).not.toContain(id);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('owner reports: /api/admin/metros and /api/admin/sources list them as on probation', () => {
  it('buildMetroReport lists each coverage source under its metro as probation, with its sample count (blank when the table is missing)', () => {
    const input = {
      now: NOW, alerts: [], signals: [], namedContactIds: new Set<number>(), adapters: ALL_ADAPTERS.map((a) => ({ id: a.id, probation: a.probation })),
      states: new Map(), samples: new Map(IDS.map((id, i) => [id, i + 1])),
    };
    const r = buildMetroReport(input);
    for (const s of COVERAGE_R19_SOURCES) {
      const m = r.metros.find((x) => x.id === s.metro)!;
      expect(m.probation.find((p) => p.id === s.id), s.id).toMatchObject({ samples: IDS.indexOf(s.id) + 1 });
    }
    const missing = buildMetroReport({ ...input, samples: 'missing' });
    for (const s of COVERAGE_R19_SOURCES) expect(missing.metros.find((x) => x.id === s.metro)!.probation.find((p) => p.id === s.id)!.samples).toBeNull();
    expect(missing.notes.join(' ')).toMatch(/holler_source_samples is missing/);
  });

  describe('routes', () => {
    const SECRET = 'right-secret-for-tests-0123456789';
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
      vi.doUnmock('@/lib/supabase/admin');
    });

    it.each([['present', null], ['PGRST205', 'PGRST205'], ['42P01', '42P01']])(
      'GET /api/admin/metros (samples table %s) lists every coverage source as probation under its metro',
      async (_label, code) => {
        vi.resetModules();
        vi.stubEnv('CRON_SECRET', SECRET);
        const db = new FakeDb({
          holler_alert_log: [], holler_source_health: [], holler_scan_runs: [], holler_area_waitlist: [], holler_zip_waitlist: [],
          holler_source_samples: IDS.map((id, i) => ({ id: i + 1, source: id, external_id: `x${i}`, fetched_at: '2026-11-21T00:00:00Z', row: {} })),
        });
        if (code) {
          db.failOn['holler_source_samples.select'] = 'relation "public.holler_source_samples" does not exist';
          db.failCode['holler_source_samples.select'] = code;
        }
        vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
        const { GET } = await import('@/app/api/admin/metros/route');
        const res = await GET(new NextRequest('https://localholler.com/api/admin/metros', { headers: { authorization: `Bearer ${SECRET}` } }));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { metros: { id: string; probation: { id: string; samples: number | null }[] }[] };
        for (const s of COVERAGE_R19_SOURCES) {
          const p = body.metros.find((m) => m.id === s.metro)!.probation.find((x) => x.id === s.id);
          expect(p, s.id).toBeDefined();
          expect(p!.samples, s.id).toBe(code ? null : 1);
        }
      },
    );

    it('GET /api/admin/sources lists every probation source with its check; a schema mismatch is named', async () => {
      vi.resetModules();
      vi.stubEnv('CRON_SECRET', SECRET);
      const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
      const db = new FakeDb({
        holler_scan_runs: [],
        holler_source_health: [
          { source: 'arcgis-tempe-permits', last_run_at: ago(1), last_success_at: null, last_error: 'error: schema mismatch: expected PermitNum, IssuedDate (arcgis-tempe-permits: from the layer\'s field list; no query sent)', last_record_at: null, rows_seen_last_run: 0, rows_new_last_run: 0, consecutive_failures: 1, status: 'degraded', updated_at: ago(1) },
          { source: 'arcgis-phoenix-permits', last_run_at: ago(1), last_success_at: ago(1), last_error: null, last_record_at: ago(30), rows_seen_last_run: 5, rows_new_last_run: 5, consecutive_failures: 0, status: 'healthy', updated_at: ago(1) },
        ],
      });
      vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
      const { GET } = await import('@/app/api/admin/sources/route');
      expect((await GET(new Request('https://x.test/api/admin/sources'))).status).toBe(401);
      const res = await GET(new Request('https://x.test/api/admin/sources', { headers: { authorization: `Bearer ${SECRET}` } }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { probation: Array<{ id: string; probation: boolean; metro: string; check: string; lastError: string | null; probe?: string }> };
      const by = Object.fromEntries(body.probation.map((p) => [p.id, p]));
      for (const s of COVERAGE_R19_SOURCES) expect(by[s.id], s.id).toMatchObject({ probation: true, metro: s.metro, probe: `/api/admin/coverage-probe?source=${s.id}` });
      expect(by['arcgis-tempe-permits'].check).toBe('schema_mismatch');
      expect(by['arcgis-tempe-permits'].lastError).toMatch(/schema mismatch: expected PermitNum, IssuedDate/);
      expect(by['arcgis-phoenix-permits'].check).toBe('ok');
      expect(by['socrata-dallas-permits'].check).toBe('not_run');
      expect(by['carto-phl-permits']).toMatchObject({ probation: true, metro: 'philadelphia' }); // the Philadelphia model is listed too
    });
  });

  it('probationOverview: only probation adapters, sorted, with promotion directions', () => {
    const rows = probationOverview([{ id: 'nws' }, { id: 'arcgis-houston-311', probation: true }, { id: 'carto-phl-permits', probation: true }], [], () => null);
    expect(rows.map((r) => r.id)).toEqual(['arcgis-houston-311', 'carto-phl-permits']);
    expect(rows[0].promote).toMatch(/coverage-datasets\.ts.*SOURCE_DEFAULTS/);
    expect(rows[1].promote).toMatch(/carto-datasets\.ts/);
    expect(rows[1].probe).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('Dallas permits (e7gq-4sah): issued_date is TEXT (MM/DD/YY)', () => {
  it('the text date is parsed in code, as a Dallas calendar day', () => {
    expect(mdyToFloating('11/16/26')).toBe('2026-11-16T00:00:00');
    expect(mdyToFloating('1/5/2026')).toBe('2026-01-05T00:00:00');
    expect(mdyToFloating('02/30/26')).toBeNull();
    expect(mdyToFloating('2026-11-16')).toBeNull();
    expect(recordDateIso('11/16/26', dallas)).toBe('2026-11-16T06:00:00.000Z'); // midnight in Dallas (CST)
    expect(recordDateIso('2026-11-12T00:00:00.000', dallas)).toBe('2026-11-12T06:00:00.000Z'); // an ISO value still reads
  });

  it('the query never compares issued_date: it filters and orders on the system column :updated_at', () => {
    const q = buildSocrataQuery(dallas, NOW);
    expect(q.get('$where')).toBe(":updated_at > '2026-11-15T12:00:00'");
    expect(q.get('$order')).toBe(':updated_at DESC');
    expect(`${q.get('$where')} ${q.get('$order')}`).not.toMatch(/issued_date/);
  });

  it('rows in the text format parse; a permit issued long ago (touched again) is dropped; ZIP centroid placement, flagged approx', async () => {
    const rows = [
      DALLAS_ROW,
      { ...DALLAS_ROW, permit_number: 'BLD-18-000001', issued_date: '01/05/18' },
      { ...DALLAS_ROW, permit_number: 'BLD-26-000154', zip_code: '' },
      { ...DALLAS_ROW, permit_number: 'BLD-26-000155', zip_code: '33101' }, // a Miami ZIP: not in Texas, so not placed
    ];
    const { fetch: doFetch } = portal({}, rows);
    const { c, logs } = ctx(doFetch);
    const items = await buildSocrataAdapter(dallas).fetch(c);
    expect(items.map((i) => i.externalId)).toEqual(['BLD-26-000153', 'BLD-26-000154', 'BLD-26-000155']);
    const [a, b, z] = items;
    expect(a.occurredAt).toBe('2026-11-16T06:00:00.000Z');
    expect(a.lat).toBeCloseTo(32.79, 1);
    expect(a.lon).toBeCloseTo(-96.8, 1);
    expect(a.data).toMatchObject({ approxLocation: true, jobValue: 12000 });
    expect(a.contacts?.find((x) => x.role === 'contractor')).toMatchObject({ name: 'MILESTONE ELECTRIC', phone: '817-969-5050', address: null });
    expect([b.lat, b.lon, z.lat, z.lon]).toEqual([null, null, null, null]); // unplaced, never a guessed point
    expect(logs.filter((l) => /error/.test(l))).toEqual([]);
  });

  it('missing contractor and value columns (blank on current permits): the row parses with no contact and no value, never a wrong one', () => {
    const { contractor: _c, value: _v, ...bare } = DALLAS_ROW;
    void _c; void _v;
    const r = parseSocrataReport([bare, { ...DALLAS_ROW, permit_number: 'X2', value: 'see plans', contractor: '' }], dallas);
    expect(r.items).toHaveLength(2);
    for (const it of r.items) {
      expect((it.contacts ?? []).filter((c) => c.role !== 'site')).toEqual([]); // the site address is the permit's own (public record)
      expect((it.data as Record<string, unknown>).jobValue).toBeUndefined();
    }
  });

  it('renamed id and date columns: a clear "schema mismatch: expected permit_number, issued_date" that reaches the scan error', async () => {
    const renamed = [{ permit_no: 'A1', issue_dt: '11/16/26', permit_type: 'Residential Alteration Permit', work_description: 'Re-roof' }];
    const { fetch: doFetch } = portal({}, renamed);
    const f = new FakeDb({ holler_profiles: PROFILES, holler_source_samples: [] });
    const r = await runScan({ now: NOW, adapters: [adapterOf('socrata-dallas-permits')], fetchImpl: doFetch }, asDb(f));
    const src = r.sources[0];
    expect(src.status).toBe('error');
    expect(src.error).toMatch(/^error: schema mismatch: expected permit_number, issued_date \(socrata-dallas-permits: 0 of 1 rows parsed; columns seen: issue_dt, permit_no, permit_type, work_description\)/);
    expect(f.tables.holler_scan_runs.find((x) => x.source === 'socrata-dallas-permits')!.error).toMatch(/schema mismatch: expected permit_number/);
    const health = f.tables.holler_source_health.find((x) => x.source === 'socrata-dallas-permits')!;
    expect(isSchemaMismatch(health.last_error)).toBe(true);
    expect(health.last_error).not.toMatch(/A1|11\/16\/26|Re-roof/); // column names only, never a value
  });

  it('an issued_date that is not a date at all is named too', () => {
    const rows = [{ ...DALLAS_ROW, issued_date: 'pending' }];
    expect(parseSocrataReport(rows, dallas).shapeOk).toBe(0);
    expect(schemaProblem(rows, { idFields: ['permit_number'], dateField: 'issued_date', readsAsDate: (v) => recordDateIso(v, dallas) !== null })).toBe('issued_date is not readable as a date');
  });

  it('person-like contractor values give no contact (existing organisation checks)', () => {
    const r = parseSocrataReport(
      [
        { ...DALLAS_ROW, permit_number: 'P1', contractor: 'JAMES CARTER 12 ELM ST, DALLAS, TX 75201 214-555-0101' },
        { ...DALLAS_ROW, permit_number: 'P2', contractor: 'Maria Lopez' },
      ],
      dallas,
    );
    expect(r.items).toHaveLength(2);
    for (const it of r.items) expect((it.contacts ?? []).filter((c) => c.role === 'contractor')).toEqual([]);
    expect(JSON.stringify(r.items)).not.toMatch(/JAMES CARTER|Maria Lopez|214-555-0101/);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
const ARC_IDS = IDS.filter((id) => id.startsWith('arcgis-'));

describe('ArcGIS coverage layers: unverified schemas fail safe', () => {
  it.each(ARC_IDS)('%s: WGS84 geometry (outSR=4326), never an owner, applicant or free-text column in outFields', (id) => {
    const q = buildArcgisQuery(arc(id), NOW);
    expect(q.get('outSR')).toBe('4326');
    expect(q.get('returnGeometry')).toBe('true');
    expect(q.get('outFields')).not.toMatch(/OWNER|APPLICANT|CONTACT\b|VIOL_NAME|CONF_BY|LGLDESC|CONTRNUM|ResolutionNotes|IncidentAddress|PROPX|PROPY|X_COORD|Y_COORD|PERMIT_NAME|PROJECT\b/i);
  });

  it.each(ARC_IDS)('%s: a good row parses into a record placed by its geometry', async (id) => {
    const { fetch: doFetch, urls } = portal({});
    const { c, logs } = ctx(doFetch);
    const items = await buildArcgisAdapter(arc(id)).fetch(c);
    expect(items, logs.join('\n')).toHaveLength(1);
    const it0 = items[0];
    expect(it0.source).toBe(id);
    expect(it0.categories.length).toBeGreaterThan(0);
    expect(it0.lat).not.toBeNull();
    expect(Math.abs(it0.lat! - GEOM[id].y)).toBeLessThan(0.01);
    expect(urls.filter((u) => u.endsWith('?f=json'))).toHaveLength(1); // the field list is read before the query
    expect(new URL(rowsUrl(urls)).searchParams.get('outSR')).toBe('4326');
    expect(JSON.stringify(items)).not.toMatch(new RegExp(PRIVATE_VALUES.join('|')));
  });

  it.each(ARC_IDS)('%s: the layer lacks the date column: "schema mismatch: expected <date>", no query sent, an error the sources report shows', async (id) => {
    const ds = arc(id);
    const { fetch: doFetch, urls } = portal({ [id]: { fields: fieldsOf(ds, [ds.dateField]) } });
    const f = new FakeDb({ holler_profiles: PROFILES, holler_source_samples: [] });
    const r = await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
    expect(urls.some((u) => u.includes('/query?'))).toBe(false);
    expect(r.sources[0].status).toBe('error');
    expect(r.sources[0].error).toContain(`schema mismatch: expected ${ds.dateField}`);
    expect(isSchemaMismatch(f.tables.holler_source_health.find((x) => x.source === id)!.last_error)).toBe(true);
    expect(f.tables.holler_source_samples).toEqual([]);
  });

  it.each(ARC_IDS)('%s: a date column that is text is named, not compared as a timestamp', async (id) => {
    const ds = arc(id);
    const { fetch: doFetch, urls } = portal({ [id]: { fields: fieldsOf(ds, [], 'esriFieldTypeString') } });
    const { c, logs } = ctx(doFetch);
    expect(await buildArcgisAdapter(ds).fetch(c)).toEqual([]);
    expect(logs.join(' ')).toContain(`schema mismatch: ${ds.dateField} is text, not a date field`);
    expect(urls.some((u) => u.includes('/query?'))).toBe(false);
  });

  it.each(ARC_IDS)('%s: the layer lists the columns but its rows lack the id or date: schema mismatch after the query', async (id) => {
    const ds = arc(id);
    const idCols = ds.idFields?.length ? ds.idFields : [ds.idField];
    const strip = Object.fromEntries([...idCols, ds.dateField].map((k) => [k, undefined]));
    const rows = [feature(id, strip, false), feature(id, strip, false)].map((x) => ({ ...x, attributes: JSON.parse(JSON.stringify(x.attributes)) }));
    const { fetch: doFetch } = portal({ [id]: { features: rows } });
    const { c, logs } = ctx(doFetch);
    expect(await buildArcgisAdapter(ds).fetch(c)).toEqual([]);
    const line = logs.find((l) => l.includes('schema mismatch'))!;
    expect(line).toMatch(new RegExp(`^error: schema mismatch: expected ${[...idCols, ds.dateField].join(', ')} \\(${id}: 0 of 2 rows parsed`));
  });

  it.each(ARC_IDS)('%s: a missing non-key column is left out of the query and the field stays empty (no crash, nothing in the wrong slot)', async (id) => {
    const ds = arc(id);
    const optional = expectedColumns({ platform: 'arcgis', ds }).filter((c) => c !== ds.dateField && !(ds.idFields ?? [ds.idField]).includes(c) && c !== ds.textFields[0] && c !== ds.confidentialField);
    const { fetch: doFetch, urls } = portal({ [id]: { fields: fieldsOf(ds, optional) } });
    const { c } = ctx(doFetch);
    const items = await buildArcgisAdapter(ds).fetch(c);
    const asked = new URL(rowsUrl(urls)).searchParams.get('outFields')!.split(',');
    for (const o of optional) expect(asked, o).not.toContain(o);
    // The fake server still sends every column; the record is built the same way and never crashes.
    expect(items.length).toBeLessThanOrEqual(1);
  });

  it('a layer whose date column is DateOnly is compared as a date, as its own field list says', () => {
    const ds = arc('arcgis-phoenix-permits');
    const check = layerSchemaCheck(ds, { names: new Set(fieldsOf(ds).map((f) => f.name)), types: new Map([[ds.dateField, 'esriFieldTypeDateOnly']]) })!;
    expect(check.problem).toBeNull();
    const q = buildArcgisQuery(ds, NOW, undefined, { present: check.present, dateType: check.dateType });
    expect(q.get('where')).toMatch(/^PERMIT_ISSUE_DATE >= date '2026-11-08'/);
  });

  it('Arlington: composite id; FOLDERNAME is an address only when it starts with a house number', () => {
    const ds = arc('arcgis-arlington-permits');
    const r = parseArcgisReport({ features: [feature(ds.id), feature(ds.id, { FOLDERSEQUENCE: '104234', FOLDERNAME: 'SMITH RESIDENCE' }), feature(ds.id, { FOLDERSEQUENCE: '' })] }, ds);
    expect(r.items.map((i) => i.externalId)).toEqual(['RB:26:104233', 'RB:26:104234']);
    expect(r.items[0].summary).toContain('1200 W ABRAM ST');
    expect(JSON.stringify(r.items[1])).not.toContain('SMITH');
  });

  it('Miami-Dade code violations: a confidential case (CONF_FLAG = Y) is dropped whole; the address is block level', () => {
    const ds = arc('arcgis-miamidade-violations');
    const r = parseArcgisReport({ features: [feature(ds.id), feature(ds.id, { CASE_NUM: 'CC2026-000002', CONF_FLAG: 'Y' })] }, ds);
    expect(r.items.map((i) => i.externalId)).toEqual(['CC2026-000001']);
    expect(r.items[0].summary).toContain('1400 block of NW 7 ST');
    expect(r.items[0].contacts ?? []).toEqual([]);
    expect(buildArcgisQuery(ds, NOW, new Set(['CONF_FLAG'])).get('outFields')).toContain('CONF_FLAG');
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('privacy: person-like values in the contractor and business-name fields', () => {
  const PERSONS = ['Maria Lopez', 'JOHN A SMITH', 'Smith, John'];
  const cases: Array<[string, string]> = [
    ['arcgis-arlington-permits', 'NameofBusiness'],
    ['arcgis-miamidade-permits', 'CONTRNAME'],
    ['arcgis-tempe-permits', 'ContractorCompanyName'],
  ];
  it.each(cases)('%s (%s): a person is never a contact, a company is kept', async (id, field) => {
    const ds = arc(id);
    const features = [...PERSONS.map((p, i) => feature(id, { [field]: p, [ds.idFields ? 'FOLDERSEQUENCE' : ds.idField]: `P${i}` })), feature(id, { [field]: 'Acme Building Services LLC', [ds.idFields ? 'FOLDERSEQUENCE' : ds.idField]: 'C1' })];
    const { fetch: doFetch } = portal({ [id]: { features } });
    const f = new FakeDb({ holler_profiles: PROFILES });
    await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
    const samples = f.tables.holler_source_samples.map((s) => s.row as SignalInput);
    expect(samples).toHaveLength(4);
    const names = samples.flatMap((s) => (s.contacts ?? []).map((c) => c.name));
    expect(names).toContain('Acme Building Services LLC');
    expect(JSON.stringify(f.tables.holler_source_samples)).not.toMatch(/Maria Lopez|JOHN A SMITH|Smith, John/);
  });

  it('Phoenix CONTACT and OWNER_NAME, Miami-Dade VIOL_NAME and CONF_BY, Houston ResolutionNotes: never asked for, never stored', async () => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const { fetch: doFetch, urls } = portal({});
    await runScan({ now: NOW, adapters: ARC_IDS.map(adapterOf), fetchImpl: doFetch }, asDb(f));
    const asked = urls.filter((u) => u.includes('/query?')).map((u) => new URL(u).searchParams.get('outFields')).join(',');
    expect(asked).not.toMatch(/OWNER_NAME|\bCONTACT\b|VIOL_NAME|CONF_BY|ResolutionNotes|LGLDESC|CONTRNUM/);
    expect(JSON.stringify(f.tables.holler_source_samples)).not.toMatch(new RegExp(PRIVATE_VALUES.join('|')));
    expect(f.tables.holler_source_samples.length).toBe(ARC_IDS.length);
  });

  it('a person-like value in a printed type column is withheld (existing name checks on titles and summaries)', () => {
    const ds = arc('arcgis-phoenix-permits');
    const r = parseArcgisReport({ features: [feature(ds.id, { PERMIT_TYPE_DESC: 'Reroof - John Doe' })] }, ds);
    expect(JSON.stringify(r.items)).not.toContain('John Doe');
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('GET /api/admin/coverage-probe', () => {
  it('lists the probation sources it can check', () => {
    expect(coverageProbeSourceIds()).toEqual(expect.arrayContaining(IDS));
    expect(coverageProbeSourceIds()).not.toContain('socrata-chicago-permits'); // a live source is not probed here
  });

  it('Dallas: status, row count, columns, missing expected columns, newest date, up to 3 mapped rows with person names removed', async () => {
    const rows = [
      DALLAS_ROW,
      { ...DALLAS_ROW, permit_number: 'B2', issued_date: '11/18/26', contractor: 'Maria Lopez' },
      { ...DALLAS_ROW, permit_number: 'B3', issued_date: '11/17/26' },
      { ...DALLAS_ROW, permit_number: 'B4', issued_date: '11/10/26' },
    ];
    const { fetch: doFetch, urls } = portal({}, rows);
    const out = await runCoverageProbe('socrata-dallas-permits', doFetch, NOW);
    expect(out).toMatchObject({ status: 'ok', platform: 'socrata', httpStatus: 200, rowCount: 4, schema: 'ok', columnsFrom: 'column list', wroteNothing: true });
    expect(out.endpoint).toBe('https://www.dallasopendata.com/resource/e7gq-4sah.json');
    expect(out.columns).toEqual(Object.keys(DALLAS_ROW).sort());
    expect(out.missingExpected).toEqual([]);
    expect(out.newestDate).toBe('2026-11-18T06:00:00.000Z');
    expect(out.mapped).toHaveLength(3);
    expect(JSON.stringify(out)).not.toContain('Maria Lopez');
    const rowUrl = new URL(rowsUrl(urls));
    expect(rowUrl.searchParams.get('$order')).toBe(':updated_at DESC');
    expect(rowUrl.searchParams.get('$limit')).toBe('5');
  });

  it('Dallas with renamed columns: schema mismatch with the missing columns named', async () => {
    const { fetch: doFetch } = portal({}, [{ permit_no: 'A1', issue_dt: '11/16/26', work_description: 'Re-roof' }]);
    const out = await runCoverageProbe('socrata-dallas-permits', doFetch, NOW);
    expect(out.schema).toBe('mismatch');
    expect(out.schemaProblem).toBe('expected permit_number, issued_date');
  });

  it.each(ARC_IDS)('%s: columns from the layer, mapped rows, nothing private in the output', async (id) => {
    const ds = arc(id);
    const extra = [{ name: 'OWNER_NAME', type: 'esriFieldTypeString' }];
    const { fetch: doFetch, urls } = portal({ [id]: { fields: [...fieldsOf(ds), ...extra], features: [feature(id), feature(id, ds.idFields ? { FOLDERSEQUENCE: '2' } : { [ds.idField]: 'second' })] } });
    const out = await runCoverageProbe(id, doFetch, NOW);
    expect(out).toMatchObject({ status: 'ok', platform: 'arcgis', httpStatus: 200, rowCount: 2, schema: 'ok', columnsFrom: 'column list', missingExpected: [] });
    expect(out.columns).toContain('OWNER_NAME'); // a column NAME is reported ...
    expect(JSON.stringify(out)).not.toMatch(new RegExp(PRIVATE_VALUES.join('|'))); // ... never its value
    expect(out.newestDate).toBe(new Date(ROWS[id][ds.dateField] as number).toISOString());
    expect(out.mapped.length).toBeGreaterThan(0);
    const q = new URL(rowsUrl(urls));
    expect(q.searchParams.get('outSR')).toBe('4326');
    expect(q.searchParams.get('resultRecordCount')).toBe('5');
    expect(q.searchParams.get('outFields')).not.toContain('OWNER_NAME');
  });

  it('a layer without the date column: mismatch named, no rows requested', async () => {
    const ds = arc('arcgis-tempe-permits');
    const { fetch: doFetch, urls } = portal({ [ds.id]: { fields: fieldsOf(ds, ['IssuedDate']) } });
    const out = await runCoverageProbe(ds.id, doFetch, NOW);
    expect(out).toMatchObject({ schema: 'mismatch', schemaProblem: 'expected IssuedDate' });
    expect(out.missingExpected).toContain('IssuedDate');
    expect(urls.some((u) => u.includes('/query?'))).toBe(false);
  });

  it('an ArcGIS error answer and an unreachable portal are reported, never thrown; unknown source is unknown', async () => {
    const { fetch: errFetch } = portal({ 'arcgis-phoenix-permits': { features: 'error' } });
    expect(await runCoverageProbe('arcgis-phoenix-permits', errFetch)).toMatchObject({ schema: 'unreachable', message: 'ArcGIS 400 Invalid field' });
    const down = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    expect(await runCoverageProbe('arcgis-houston-311', down)).toMatchObject({ schema: 'unreachable', rowCount: 0 });
    expect((await runCoverageProbe('socrata-chicago-permits', down)).status).toBe('unknown_source');
  });

  describe('route', () => {
    const SECRET = 'right-secret-for-tests-0123456789';
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });
    it('Bearer only: 401 without it and with ?key=; 400 with the source list when no source is given', async () => {
      vi.resetModules();
      vi.stubEnv('CRON_SECRET', SECRET);
      const { GET } = await import('@/app/api/admin/coverage-probe/route');
      expect((await GET(new Request('https://x.test/api/admin/coverage-probe?source=arcgis-tempe-permits'))).status).toBe(401);
      expect((await GET(new Request(`https://x.test/api/admin/coverage-probe?source=arcgis-tempe-permits&key=${SECRET}`))).status).toBe(401);
      const res = await GET(new Request('https://x.test/api/admin/coverage-probe', { headers: { authorization: `Bearer ${SECRET}` } }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { knownSources: string[] }).knownSources).toEqual(expect.arrayContaining(IDS));
      const unknown = await GET(new Request('https://x.test/api/admin/coverage-probe?source=nope', { headers: { authorization: `Bearer ${SECRET}` } }));
      expect(unknown.status).toBe(400);
    });
  });
});

describe('schema-check helpers', () => {
  it('columnsSeen and the mismatch log name columns only', () => {
    expect(columnsSeen([{ b: 1, a: null }, null, { c: 'x' }])).toEqual(['a', 'b', 'c']);
    expect(schemaProblem([], { idFields: ['ID'], dateField: 'D', readsAsDate: () => true })).toBeNull();
    expect(schemaProblem([{ ID: 1, D: 'x' }], { idFields: ['ID'], dateField: 'D', readsAsDate: () => true })).toBeNull();
  });
});

// ====================================================================================================================================
// REVIEW FIXES (review-COVERAGE.md, FIX FIRST). Each block reproduces the reviewer's case with the fixed expectation.
// ====================================================================================================================================

const viol = () => arc('arcgis-miamidade-violations');
const samplesOf = (f: FakeDb) => (f.tables.holler_source_samples ?? []).map((x) => x.row as SignalInput);

describe('review P1-A: a confidential Miami-Dade case is never stored', () => {
  it('reviewer reproduction: field list 503, the query would return CONF_FLAG Y: NO data query is sent, the source errors, nothing is stored', async () => {
    const ds = viol();
    const leaked = { attributes: { CASE_NUM: 'CONFIDENTIAL-1', CASE_DATE: ISSUED, PROBLEM_DESC: 'OVERGROWN LOT', STAT_DESC: 'OPEN', ADDRESS: '1450 NW 7 ST' }, geometry: GEOM[ds.id] };
    const { fetch: doFetch, urls } = portal({ [ds.id]: { fields: 'down', features: [leaked] } });
    const f = new FakeDb({ holler_profiles: PROFILES });
    const r = await runScan({ now: NOW, adapters: [adapterOf(ds.id)], fetchImpl: doFetch }, asDb(f));
    expect(urls.some((u) => u.includes('/query?'))).toBe(false);
    expect(r.sources[0].status).toBe('error');
    expect(r.sources[0].error).toMatch(/could not read the layer's field list; no query sent this run/);
    expect(f.tables.holler_source_samples ?? []).toEqual([]);
    expect(f.tables.holler_source_health.find((x) => x.source === ds.id)!.last_error).toMatch(/could not read the layer's field list/);
  });

  it('every coverage layer sends no data query when its field list cannot be read', async () => {
    for (const id of ARC_IDS) {
      resetArcgisFieldCache();
      const { fetch: doFetch, urls } = portal({ [id]: { fields: 'down' } });
      const { c, logs } = ctx(doFetch);
      expect(await buildArcgisAdapter(arc(id)).fetch(c), id).toEqual([]);
      expect(urls.some((u) => u.includes('/query?')), id).toBe(false);
      expect(logs.join(' '), id).toMatch(/^error: .*could not read the layer's field list/);
    }
  });

  it('CONF_FLAG is required: always in outFields; a layer without it is "schema mismatch: expected CONF_FLAG" with no query', async () => {
    const ds = viol();
    expect(buildArcgisQuery(ds, NOW).get('outFields')).toContain('CONF_FLAG');
    expect(buildArcgisQuery(ds, NOW, new Set()).get('outFields')).toContain('CONF_FLAG');
    const { fetch: doFetch, urls } = portal({ [ds.id]: { fields: fieldsOf(ds, ['CONF_FLAG']) } });
    const { c, logs } = ctx(doFetch);
    expect(await buildArcgisAdapter(ds).fetch(c)).toEqual([]);
    expect(logs.join(' ')).toContain('schema mismatch: expected CONF_FLAG');
    expect(urls.some((u) => u.includes('/query?'))).toBe(false);
  });

  it('a row without the flag column is dropped; any truthy value drops the row (Y, YES, Yes, 1, true, T, spaces)', () => {
    const ds = viol();
    const truthy: unknown[] = ['Y', 'y', 'YES', 'Yes', ' yes ', '1', 1, 'true', 'TRUE', true, 'T', ' Y '];
    const feats = [
      ...truthy.map((v, i) => feature(ds.id, { CASE_NUM: `T${i}`, CONF_FLAG: v })),
      feature(ds.id, { CASE_NUM: 'NOFLAG' }),
      feature(ds.id, { CASE_NUM: 'KEPT-N', CONF_FLAG: 'N' }),
      feature(ds.id, { CASE_NUM: 'KEPT-BLANK', CONF_FLAG: '' }),
    ];
    const noflag = feats.find((x) => (x.attributes as Record<string, unknown>).CASE_NUM === 'NOFLAG')!;
    delete (noflag.attributes as Record<string, unknown>).CONF_FLAG;
    const r = parseArcgisReport({ features: feats }, ds);
    expect(r.items.map((i) => i.externalId)).toEqual(['KEPT-N', 'KEPT-BLANK']);
    for (const v of truthy) expect(isConfidential(v), String(v)).toBe(true);
    for (const v of ['N', 'NO', '0', 0, false, '', null, undefined]) expect(isConfidential(v), String(v)).toBe(false);
  });
});

describe('review P1-B: an address column never carries a name into the summary', () => {
  const STRINGS = ['4521 MARIA LOPEZ FENCE', '2026 SMITH RESIDENCE REMODEL', '1203 OAK ST - JOHN SMITH RESIDENCE'];

  it('reviewer reproduction (Arlington FOLDERNAME, through runScan): only the shared site-address rule output is stored', async () => {
    const ds = arc('arcgis-arlington-permits');
    const feats = STRINGS.map((v, i) => feature(ds.id, { FOLDERSEQUENCE: `S${i}`, FOLDERNAME: v }));
    const { fetch: doFetch } = portal({ [ds.id]: { features: feats } });
    const f = new FakeDb({ holler_profiles: PROFILES });
    await runScan({ now: NOW, adapters: [adapterOf(ds.id)], fetchImpl: doFetch }, asDb(f));
    const by = Object.fromEntries(samplesOf(f).map((x) => [x.externalId, x]));
    expect(by['RB:26:S0'].summary).toBe('Residential Roofing | Issued');
    expect(by['RB:26:S1'].summary).toBe('Residential Roofing | Issued');
    expect(by['RB:26:S2'].summary).toBe('Residential Roofing | Issued | 1203 OAK ST');
    expect(JSON.stringify(f.tables.holler_source_samples)).not.toMatch(/MARIA|LOPEZ|SMITH|RESIDENCE|REMODEL|FENCE/);
  });

  it.each([...ARC_IDS.filter((id) => (arc(id).addressFields ?? []).length), 'socrata-dallas-permits'])(
    '%s: the same strings in its address column never reach a stored record',
    async (id) => {
      const isDallas = id === 'socrata-dallas-permits';
      const addrField = isDallas ? 'street_address' : arc(id).addressFields![0];
      const idField = isDallas ? 'permit_number' : arc(id).idFields ? 'FOLDERSEQUENCE' : arc(id).idField;
      const { fetch: doFetch } = isDallas
        ? portal({}, STRINGS.map((v, i) => ({ ...DALLAS_ROW, permit_number: `D${i}`, street_address: v })))
        : portal({ [id]: { features: STRINGS.map((v, i) => feature(id, { [idField]: `S${i}`, [addrField]: v })) } });
      const f = new FakeDb({ holler_profiles: PROFILES });
      await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
      expect(samplesOf(f).length, id).toBe(3);
      expect(JSON.stringify(f.tables.holler_source_samples), id).not.toMatch(/MARIA|LOPEZ|SMITH|RESIDENCE|REMODEL|FENCE/);
    },
  );

  it.each(IDS)('%s: a person-like value planted in each printed summary column is never stored', async (id) => {
    const isDallas = id === 'socrata-dallas-permits';
    const fields = isDallas ? dallas.summaryFields : arc(id).summaryFields;
    for (const field of fields) {
      resetArcgisFieldCache();
      const planted = 'Maria Lopez Gonzalez';
      const { fetch: doFetch } = isDallas
        ? portal({}, [{ ...DALLAS_ROW, [field]: planted }])
        : portal({ [id]: { features: [feature(id, { [field]: planted })] } });
      const f = new FakeDb({ holler_profiles: PROFILES });
      await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
      expect(JSON.stringify(f.tables.holler_source_samples ?? []), `${id} ${field}`).not.toMatch(/Maria|Lopez|Gonzalez/);
    }
  });
});

describe('review P2-C: an HTML page or an empty body (HTTP 200) is an error, never "ok"', () => {
  it.each([['html', 'response was not JSON'], ['empty', 'empty response body']] as const)('every coverage source, %s body: error "%s", check not_json', async (kind, text) => {
    const layers = Object.fromEntries(ARC_IDS.map((id) => [id, { features: kind } as LayerSpec]));
    const { fetch: doFetch } = portal(layers, kind);
    const f = new FakeDb({ holler_profiles: PROFILES });
    const r = await runScan({ now: NOW, adapters: IDS.map(adapterOf), fetchImpl: doFetch }, asDb(f));
    for (const id of IDS) {
      const src = r.sources.find((x) => x.id === id)!;
      expect(src.status, id).toBe('error');
      expect(src.error, id).toContain(text);
    }
    const health = f.tables.holler_source_health.map((h) => ({ ...h, last_record_at: null })) as unknown as Parameters<typeof probationOverview>[1];
    const rows = probationOverview(IDS.map((id) => ({ id, probation: true })), health, () => null);
    for (const row of rows) expect(row.check, row.id).toBe('not_json');
    expect(f.tables.holler_source_samples ?? []).toEqual([]);
  });

  it('the probe says why too', async () => {
    const { fetch: doFetch } = portal({ 'arcgis-tempe-permits': { features: 'html' } }, 'empty');
    expect(await runCoverageProbe('arcgis-tempe-permits', doFetch, NOW)).toMatchObject({ schema: 'unreachable', message: 'response was not JSON' });
    expect(await runCoverageProbe('socrata-dallas-permits', doFetch, NOW)).toMatchObject({ schema: 'unreachable', message: 'empty response body' });
  });

  it('check states: ok needs a record date; a run with no row ever is no_rows', () => {
    const at = '2026-11-22T10:00:00Z';
    const h = { source: 'x', last_run_at: at, last_success_at: at, last_error: null };
    expect(probationCheck(undefined)).toBe('not_run');
    expect(probationCheck({ ...h, last_record_at: null })).toBe('no_rows');
    expect(probationCheck({ ...h, last_record_at: at })).toBe('ok');
    expect(probationCheck({ ...h, last_error: 'error: x: no rows in the last 30 days: newest is 2018-03-15 (500 rows read)' })).toBe('no_recent_rows');
    expect(probationCheck({ ...h, last_error: 'error: x: HTTP 503' })).toBe('error');
  });
});

describe('review P2-D: Dallas rows that are all older than the window', () => {
  const OLD = Array.from({ length: 500 }, (_, i) => ({ ...DALLAS_ROW, permit_number: `OLD-${i}`, issued_date: '03/15/18' }));

  it('reviewer reproduction: 500 rows issued 03/15/18: error "no rows in the last 30 days: newest is 2018-03-15", check no_recent_rows, no samples', async () => {
    const { fetch: doFetch } = portal({}, OLD);
    const f = new FakeDb({ holler_profiles: PROFILES });
    const r = await runScan({ now: NOW, adapters: [adapterOf('socrata-dallas-permits')], fetchImpl: doFetch }, asDb(f));
    expect(r.sources[0].status).toBe('error');
    expect(r.sources[0].error).toContain('socrata-dallas-permits: no rows in the last 30 days: newest is 2018-03-15 (500 rows read)');
    expect(r.sources[0].logs.join(' ')).not.toMatch(/0 matched a trade/);
    expect(f.tables.holler_source_samples ?? []).toEqual([]);
    const h = f.tables.holler_source_health.find((x) => x.source === 'socrata-dallas-permits')!;
    expect(probationCheck(h as never)).toBe('no_recent_rows');
  });

  it('the probe uses the scan clock: freshness stale with the newest date, no mapped rows from 2018', async () => {
    const { fetch: doFetch } = portal({}, OLD.slice(0, 5), 397_000);
    const out = await runCoverageProbe('socrata-dallas-permits', doFetch, NOW);
    expect(out).toMatchObject({ freshness: 'stale', freshnessNote: 'no rows in the last 30 days: newest is 2018-03-15', parsedRows: 0, mapped: [] });
  });
});

describe('review P2-F: a full page is reported (row cap), never silent', () => {
  it('ArcGIS: 500 features or exceededTransferLimit: a probation note on the scan_runs row, samples still written, check row_cap, not a failure', async () => {
    const id = 'arcgis-phoenix-permits';
    const many = Array.from({ length: 500 }, (_, i) => feature(id, { PERMIT_NUMBER: `PR-${i}` }));
    for (const spec of [{ features: many }, { features: [feature(id)], extra: { exceededTransferLimit: true } }] as LayerSpec[]) {
      resetArcgisFieldCache();
      const { fetch: doFetch } = portal({ [id]: spec });
      const f = new FakeDb({ holler_profiles: PROFILES });
      const r = await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
      expect(r.sources[0].status).toBe('ok');
      expect(r.sources[0].note).toMatch(/^probation note: row cap reached: \d+ rows read \(limit 500\); older rows in the window were not read/);
      const run = f.tables.holler_scan_runs.find((x) => x.source === id)!;
      expect(isProbationNote(run.error)).toBe(true);
      expect((f.tables.holler_source_samples ?? []).length).toBeGreaterThan(0);
      const h = f.tables.holler_source_health.find((x) => x.source === id)!;
      expect(h.last_error).toBeNull();
      expect(probationCheck(h as never, run as never)).toBe('row_cap');
      // The source-state rules read the note as a note, not a failure.
      const st = computeSourceStates({ adapters: [{ id, kind: 'permit', cadenceMinutes: 360, missingEnv: [] }], health: [h as never], runs: [run as never, run as never, run as never], now: NOW });
      expect(st[0].state).toBe('healthy');
    }
  });

  it('Dallas: a full page of 500 is noted too', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ ...DALLAS_ROW, permit_number: `N-${i}` }));
    const { fetch: doFetch } = portal({}, rows);
    const f = new FakeDb({ holler_profiles: PROFILES });
    const r = await runScan({ now: NOW, adapters: [adapterOf('socrata-dallas-permits')], fetchImpl: doFetch }, asDb(f));
    expect(r.sources[0].note).toMatch(/row cap reached: 500 rows read \(limit 500\)/);
  });

  it('the probe counts the window against the row cap; the sources report shows the note', async () => {
    const { fetch: doFetch } = portal({ 'arcgis-tempe-permits': { count: 1200 } }, [DALLAS_ROW], 1500);
    expect(await runCoverageProbe('arcgis-tempe-permits', doFetch, NOW)).toMatchObject({ windowCount: 1200, rowCap: 500, rowCapNote: 'row cap reached: 1200 rows in the window, 700 would not be read per run' });
    expect(await runCoverageProbe('socrata-dallas-permits', doFetch, NOW)).toMatchObject({ windowCount: 1500, rowCap: 500 });
    const rows = probationOverview(
      [{ id: 'arcgis-tempe-permits', probation: true }],
      [{ source: 'arcgis-tempe-permits', last_run_at: NOW.toISOString(), last_success_at: NOW.toISOString(), last_error: null, last_record_at: NOW.toISOString() }],
      () => 'phoenix',
      [{ source: 'arcgis-tempe-permits', started_at: NOW.toISOString(), error: 'probation note: row cap reached: 500 rows read (limit 500); older rows in the window were not read' }],
    );
    expect(rows[0]).toMatchObject({ check: 'row_cap', note: expect.stringContaining('row cap reached') });
    expect(isRunNote(rows[0].note)).toBe(true);
  });
});

describe('review P2-E: a hanging probation portal never holds up live sources', () => {
  it('live rows are written and matched before the probation source is given up; it then errors with "timeout" and stores nothing', async () => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const t0 = Date.now();
    const writes: Array<[string, number]> = [];
    const realFrom = f.from.bind(f);
    (f as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === 'holler_signals' || t === 'holler_matches' || t === 'holler_source_samples') writes.push([t, Date.now() - t0]);
      return realFrom(t);
    };
    const live: Adapter = {
      id: 'live-dallas', label: 'Live', kind: 'permit', cadenceMinutes: 15, sourceUrl: 'https://example.com',
      fetch: async () => [{ source: 'live-dallas', externalId: 'L1', kind: 'permit', title: 'Roof permit in Dallas', summary: null, url: 'https://example.com/1', categories: ['roofing'], severity: 1, occurredAt: '2026-11-22T10:00:00Z', lat: 32.78, lon: -96.8, state: 'TX', city: 'Dallas' }],
    };
    const hanging = { ...adapterOf('arcgis-houston-311'), fetch: () => new Promise<SignalInput[]>(() => {}) };
    const r = await runScan({ now: NOW, adapters: [hanging, live], probationTimeoutMs: 400 }, asDb(f));
    const firstLive = writes.find(([t]) => t === 'holler_signals')![1];
    const firstMatch = writes.find(([t]) => t === 'holler_matches')![1];
    expect(firstLive).toBeLessThan(300);
    expect(firstMatch).toBeLessThan(300);
    expect(f.tables.holler_signals.map((x) => x.external_id)).toEqual(['L1']);
    expect(f.tables.holler_matches.length).toBeGreaterThan(0);
    expect(r.sources.map((x) => x.id)).toEqual(['arcgis-houston-311', 'live-dallas']); // registry order kept
    expect(r.sources[0]).toMatchObject({ status: 'error', error: 'timeout' });
    expect(f.tables.holler_source_samples ?? []).toEqual([]);
  });

  it('limits: a probation source gets at most 12 s in all and 8 s per request', () => {
    expect(PROBATION_TIMEOUT_MS).toBe(12_000);
    expect(UNVERIFIED_REQUEST_TIMEOUT_MS).toBe(8_000);
    for (const id of ARC_IDS) expect(requestTimeoutMs(arc(id))).toBe(8_000);
    expect(requestTimeoutMs(arc('arcgis-dc-permits'))).toBe(15_000);
  });
});

describe('review P3 items', () => {
  it('G: the Dallas date parser is strict: impossible days and free text are null, never a lenient guess', () => {
    for (const v of ['02/30/26', '02/29/26', '13/01/26', '2026-02-30', 'pending', 'Nov 16 2026', '11-16-26']) expect(recordDateIso(v, dallas), v).toBeNull();
    expect(recordDateIso('2026-11-12', dallas)).toBe('2026-11-12T06:00:00.000Z');
    expect(recordDateIso('2026-11-12T00:00:00.000', dallas)).toBe('2026-11-12T06:00:00.000Z');
    expect(recordDateIso('02/28/26', dallas)).toBe('2026-02-28T06:00:00.000Z');
  });

  it('H: a Texas ZIP far from Dallas (El Paso 79901) is not placed', () => {
    const r = parseSocrataReport([{ ...DALLAS_ROW, zip_code: '79901' }, { ...DALLAS_ROW, permit_number: 'FW', zip_code: '76102' }], dallas);
    expect([r.items[0].lat, r.items[0].lon]).toEqual([null, null]);
    expect(r.items[1].lat).toBeCloseTo(32.75, 1); // Fort Worth, inside 40 miles
  });

  it('I: the probe asks for dated rows only and uses 10 s requests', async () => {
    const { fetch: doFetch, urls } = portal({});
    await runCoverageProbe('arcgis-phoenix-permits', doFetch, NOW);
    expect(new URL(rowsUrl(urls)).searchParams.get('where')).toBe('PERMIT_ISSUE_DATE IS NOT NULL');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('lib/signals/coverage-probe.ts', 'utf8')).toMatch(/const TIMEOUT_MS = 10000;/);
    expect(readFileSync('app/api/admin/coverage-probe/route.ts', 'utf8')).toMatch(/maxDuration = 60/);
  });

  it('K: probation sources are never judged by an owner alert (monitor), only by the daily report and the sources list', async () => {
    const ids = monitoredSourceIds(ALL_ADAPTERS, () => []);
    for (const id of IDS) expect(ids.has(id), id).toBe(false);
    expect(ids.has('socrata-chicago-permits')).toBe(true);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('app/api/cron/health/route.ts', 'utf8')).toMatch(/monitoredSourceIds\(ALL_ADAPTERS/);
  });

  it('L: every schema-unverified dataset is on probation (removing the flag alone cannot make an unchecked source live)', () => {
    const unverified = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.schemaUnverified);
    expect(unverified.length).toBe(IDS.length);
    for (const d of unverified) expect(d.probation, d.id).toBe(true);
  });

  it('M: Dallas asks only for its configured columns ($select); a refused column is a named schema mismatch', async () => {
    const { fetch: doFetch, urls } = portal({});
    const { c } = ctx(doFetch);
    await buildSocrataAdapter(dallas).fetch(c);
    const sel = new URL(rowsUrl(urls)).searchParams.get('$select')!.split(',');
    expect(sel.sort()).toEqual(['contractor', 'issued_date', 'land_use', 'permit_number', 'permit_type', 'street_address', 'value', 'work_description', 'zip_code']);
    expect(socrataSelectColumns(dallas).sort()).toEqual(sel);
    const bad = portal({}, 'error');
    const x = ctx(bad.fetch);
    expect(await buildSocrataAdapter(dallas).fetch(x.c)).toEqual([]);
    expect(x.logs.join(' ')).toMatch(/^error: schema mismatch: the portal refused the column list \(socrata-dallas-permits: HTTP 400; No such column: issued_date\)/);
  });
});

// Keeps the Adapter type import used for readers of this file: every coverage adapter is a plain registered Adapter.
const _typed: Adapter[] = IDS.map(adapterOf);
void _typed;
