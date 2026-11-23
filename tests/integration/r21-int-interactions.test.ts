// Round 21 integration (INT21): r20-ship (SCORE, VIOL, SALES, LIC, final review fixes) merged with r20-next (NEXT) and r20-watch (WATCH).
// Each unit tested its own work on its own branch; these tests check what only the merge can break:
//   1. probation holds for EVERY new source id of both units at once (samples only; samples table present, and missing with both codes);
//   2. no terms-gated source sends a single request until its gates are on, counted through the REAL scan (the whole registry):
//      a page-watch page needs its access record AND HOLLER_PAGE_WATCH_ENABLED; the Houston permit page needs its own access record
//      (the page-watch switch does not touch it); both share one access-record rule, the fail-closed robots checker with Holler's own
//      agent token, and the one user agent;
//   3. one 311 block rule (NEXT's site-311.ts and r20-ship's NYC whole-building heat path), the strictest of both, and one block-form test;
//   4. one keyed-hash helper for the NYC heat building reference and the Texas keyed id (values unchanged);
//   5. the merged lists are the union (proposed labels, probation sets) and LAUNCH.md keeps one NEEDS KUDZI list and one "Round 21 order".
// The private-person matrices (tests/review, tests/contacts, tests/builders/names-60) run unchanged in the full suite.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { runScan } from '@/lib/signals/run';
import { LABEL_PENDING_INTEGRATION, NEXT_R20_SOURCES, PROBATION_SOURCE_IDS, SALE_SOURCE_IDS, VIOL_R20_SOURCES } from '@/lib/signals/probation';
import { NEXT_PROPOSED_LABELS, PROPOSED_LABELS, WATCH_PROPOSED_LABELS } from '@/lib/signals/proposed-labels';
import { SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import { PAGE_WATCH_DATASETS, accessCleared, type PageWatchDataset } from '@/lib/signals/adapters/page-watch-datasets';
import { PAGE_WATCH_FLAG, buildPageWatchAdapter } from '@/lib/signals/adapters/page-watch';
import { HOUSTON_ACCESS, HOUSTON_PERMITS_ID, HOUSTON_REPORT_URL, buildHoustonPermitsAdapter, houstonAccessCleared } from '@/lib/signals/adapters/houston-permits';
import { probeHoustonReport } from '@/lib/signals/coverage-probe';
import { accessRecordCleared, type AccessRecord } from '@/lib/signals/access-record';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { HOLLER_UA } from '@/lib/user-agent';
import { blockSiteAddress, isBlockForm, sanitizeContact } from '@/lib/contacts/sanitize';
import { contactsAllowedFor, isBlockSite, isBlockSiteContact } from '@/lib/contacts/extract';
import { NEVER_SITE_311_RE, PROPERTY_CONDITION_311_RE, blockOfAddress, nycWholeBuildingContact, site311Contact } from '@/lib/signals/site-311';
import { nycBlockAddress } from '@/lib/signals/adapters/nyc-address';
import { isWholeBuildingNyc311, SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseSocrataReport } from '@/lib/signals/adapters/socrata';
import { buildingRefOf, buildingRefSecret } from '@/lib/signals/building-ref';
import { idKeySecret, keyedId } from '@/lib/signals/id-key';
import { serverKeySecret } from '@/lib/signals/server-key';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';
import { cleared } from '../signals/page-watch/helpers';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const asDb = (f: FakeDb) => f as unknown as Db;
const adapterOf = (id: string) => ALL_ADAPTERS.find((a) => a.id === id);
const NEXT_IDS = NEXT_R20_SOURCES.map((s) => s.id);
const PW_IDS = PAGE_WATCH_DATASETS.filter((d) => d.verified).map((d) => d.id);
const NEW_IDS = [...NEXT_IDS, ...PW_IDS];
const PUBLIC_TABLES = ['holler_signals', 'holler_signal_contacts', 'holler_matches', 'holler_alert_log', 'holler_notifications'];
const PROFILES = [
  { user_id: 'u000001', categories: ['security', 'janitorial-commercial', 'signs-printing', 'general-contractor', 'concrete-paving', 'landscaping', 'cleaning', 'moving'], lat: 29.76, lon: -95.36, state: 'TX', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-30T00:00:00Z' },
  { user_id: 'u000002', categories: ['security', 'janitorial-commercial', 'general-contractor'], lat: 41.88, lon: -87.63, state: 'IL', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-30T00:00:00Z' },
];
/** Houston's access record as it would look once the owner has recorded it. */
const HOUSTON_CLEARED: AccessRecord = { termsChecked: true, robotsUrl: 'https://www.houstontx.gov/robots.txt', termsUrl: 'https://www.houstontx.gov/terms.html', checkedOn: '2026-11-23' };

/** Every host a terms-gated source may be read from: each page-watch page (registered or not), its public page, Houston's report page. */
const GATED_HOSTS = new Set([
  ...PAGE_WATCH_DATASETS.flatMap((d) => [new URL(d.url).hostname, new URL(d.pageUrl).hostname]),
  new URL(HOUSTON_REPORT_URL).hostname,
]);
const FIRECRAWL_HOST = 'api.firecrawl.dev';

/** A record a probation source could produce, with an exact house number and a planted business in a contact. */
const planted = (id: string, i: number): SignalInput => ({
  source: id,
  externalId: `int21-${i}`,
  kind: 'civic',
  title: `Probation record ${i}`,
  summary: 'OPEN | 2318 W 47TH ST',
  categories: ['security', 'janitorial-commercial', 'general-contractor'],
  severity: 2,
  occurredAt: '2026-11-21T10:00:00Z',
  lat: 29.76,
  lon: -95.36,
  state: 'TX',
  url: null,
  data: { subtype: 'business' },
  contacts: [{ role: 'contractor', name: 'ACME SECURITY LLC', phone: '7135550100' }],
} as SignalInput);

/** The registry with every page-watch page swapped for its cleared copy and Houston for an adapter with a complete record. */
function registryWithRecords(): Adapter[] {
  return ALL_ADAPTERS.map((a) => {
    if (a.id === HOUSTON_PERMITS_ID) return buildHoustonPermitsAdapter(HOUSTON_CLEARED);
    const d = PAGE_WATCH_DATASETS.find((x) => x.id === a.id);
    return d ? buildPageWatchAdapter(cleared(d.id)) : a;
  });
}

/** Counts every request of a real scan; answers robots.txt with 404 (no robots.txt: allowed) and anything else with an empty list. */
function countingFetch() {
  const urls: string[] = [];
  const agents: Record<string, string> = {};
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    const h = (init?.headers ?? {}) as Record<string, string>;
    agents[url] = h['User-Agent'] ?? h['user-agent'] ?? '';
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (GATED_HOSTS.has(new URL(url).hostname)) return new Response('<html><body><p>No open solicitations.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const gated = () => urls.filter((u) => GATED_HOSTS.has(new URL(u).hostname));
  const firecrawl = () => urls.filter((u) => new URL(u).hostname === FIRECRAWL_HOST);
  return { f, urls, agents, gated, firecrawl };
}

beforeEach(() => resetRobotsCache());
afterEach(() => vi.unstubAllEnvs());

// ---- 1 ------------------------------------------------------------------------------------------------------------------------------------
describe('1. probation holds for every new id of both round 21 units (NEXT 10, WATCH 12 registered pages)', () => {
  it('every new id is a registered adapter with probation: true, in PROBATION_SOURCE_IDS and LABEL_PENDING_INTEGRATION, with no SOURCE_DEFAULTS label', () => {
    expect(NEXT_IDS).toHaveLength(10);
    expect(PW_IDS).toHaveLength(12);
    for (const id of NEW_IDS) {
      expect(adapterOf(id)?.probation, id).toBe(true);
      expect(PROBATION_SOURCE_IDS.has(id), id).toBe(true);
      expect(LABEL_PENDING_INTEGRATION, id).toContain(id);
      expect(SOURCE_DEFAULTS[id], id).toBeUndefined();
      expect(PROPOSED_LABELS[id], id).toBeDefined();
    }
    // The union, exactly: round 19's eleven, VIOL five, SALES four, NEXT ten, WATCH twelve.
    expect(PROBATION_SOURCE_IDS.size).toBe(11 + VIOL_R20_SOURCES.length + SALE_SOURCE_IDS.length + 10 + 12);
    // The unregistered page-watch entries (vendor portals) are not in the probation set: they are not registered at all.
    for (const d of PAGE_WATCH_DATASETS.filter((x) => !x.verified)) {
      expect(adapterOf(d.id), d.id).toBeUndefined();
      expect(PROBATION_SOURCE_IDS.has(d.id), d.id).toBe(false);
    }
  });

  it('samples table present: one scan of all 22 writes samples only (gates on, records with an address and a business)', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    const f = new FakeDb({ holler_profiles: PROFILES, holler_source_samples: [] });
    const reg = registryWithRecords();
    const adapters: Adapter[] = NEW_IDS.map((id, i) => ({ ...reg.find((a) => a.id === id)!, fetch: async () => [planted(id, i)] }));
    const r = await runScan({ now: NOW, adapters, fetchImpl: (async () => new Response('[]')) as typeof fetch }, asDb(f));
    for (const id of NEW_IDS) expect(r.sources.find((s) => s.id === id)?.status, id).toBe('ok');
    expect(new Set(f.tables.holler_source_samples.map((s) => s.source))).toEqual(new Set(NEW_IDS));
    for (const t of PUBLIC_TABLES) expect(f.tables[t] ?? [], t).toEqual([]);
  });

  it.each([
    ['PGRST205', "Could not find the table 'public.holler_source_samples' in the schema cache"],
    ['42P01', 'relation "public.holler_source_samples" does not exist'],
  ])('samples table missing (%s): all 22 real adapters are skipped even with every gate on, no request, no write', async (code, message) => {
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    const f = new FakeDb({ holler_profiles: PROFILES });
    for (const op of ['select', 'upsert', 'insert', 'delete']) {
      f.failOn[`holler_source_samples.${op}`] = message;
      f.failCode[`holler_source_samples.${op}`] = code;
    }
    const c = countingFetch();
    const reg = registryWithRecords();
    const r = await runScan({ now: NOW, adapters: NEW_IDS.map((id) => reg.find((a) => a.id === id)!), fetchImpl: c.f }, asDb(f));
    expect(c.urls).toEqual([]);
    expect(r.error).toBeUndefined();
    for (const id of NEW_IDS) expect(r.sources.find((s) => s.id === id), id).toMatchObject({ status: 'skipped(env)', inserted: 0 });
    for (const t of PUBLIC_TABLES) expect(f.tables[t] ?? [], t).toEqual([]);
  });
});

// ---- 2 ------------------------------------------------------------------------------------------------------------------------------------
describe('2. zero requests from any terms-gated source until its gates are on, counted through the real scan (whole registry)', () => {
  const scan = async (adapters: Adapter[]) => {
    const c = countingFetch();
    const f = new FakeDb({ holler_profiles: PROFILES, holler_source_samples: [] });
    const r = await runScan({ now: NOW, adapters, fetchImpl: c.f }, asDb(f));
    return { c, r };
  };

  it('as shipped (no record anywhere, switch off): the real scan sends nothing to any gated host and nothing to Firecrawl', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '');
    const { c, r } = await scan(ALL_ADAPTERS);
    expect(c.urls.length).toBeGreaterThan(0); // the live portal adapters did run
    expect(c.gated()).toEqual([]);
    expect(c.firecrawl()).toEqual([]);
    for (const id of [...PW_IDS, HOUSTON_PERMITS_ID]) expect(r.sources.find((s) => s.id === id), id).toBeDefined();
  });

  it('switch ON, records not made (the shipped entries): still nothing', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    const { c } = await scan(ALL_ADAPTERS);
    expect(c.gated()).toEqual([]);
    expect(c.firecrawl()).toEqual([]);
  });

  it('records made, switch OFF: no page-watch request; Houston (its own gate, not the page-watch switch) asks robots.txt first, then its page', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '');
    const { c } = await scan(registryWithRecords());
    const houston = new URL(HOUSTON_REPORT_URL).hostname;
    expect(c.gated().filter((u) => new URL(u).hostname !== houston)).toEqual([]);
    expect(c.gated()).toEqual(['https://www.houstontx.gov/robots.txt', HOUSTON_REPORT_URL]);
    expect(c.agents[HOUSTON_REPORT_URL]).toBe(HOLLER_UA);
    expect(c.firecrawl()).toEqual([]);
  });

  it('both gates on: every recorded page asks its robots.txt before anything else, with the one user agent', async () => {
    vi.stubEnv(PAGE_WATCH_FLAG, '1');
    const { c } = await scan(registryWithRecords());
    const gated = c.gated();
    expect(gated.length).toBeGreaterThan(0);
    const firstByHost = new Map<string, string>();
    for (const u of gated) if (!firstByHost.has(new URL(u).hostname)) firstByHost.set(new URL(u).hostname, u);
    for (const [host, first] of firstByHost) expect(first, host).toBe(`https://${host}/robots.txt`);
    for (const d of PAGE_WATCH_DATASETS.filter((x) => x.verified)) expect(gated.some((u) => new URL(u).hostname === new URL(d.url).hostname), d.id).toBe(true);
    for (const u of gated) expect(c.agents[u], u).toBe(HOLLER_UA);
    expect(c.firecrawl()).toEqual([]);
  });

  it('Houston: an incomplete record (any one field missing or malformed) sends nothing, switch on or off; the probe too', async () => {
    const bad: AccessRecord[] = [
      HOUSTON_ACCESS,
      { ...HOUSTON_CLEARED, termsChecked: false },
      { ...HOUSTON_CLEARED, robotsUrl: undefined },
      { ...HOUSTON_CLEARED, robotsUrl: 'https://www.houstontx.gov/terms.html' },
      { ...HOUSTON_CLEARED, termsUrl: 'not a url' },
      { ...HOUSTON_CLEARED, checkedOn: 'yesterday' },
    ];
    for (const sw of ['', '1']) {
      vi.stubEnv(PAGE_WATCH_FLAG, sw);
      for (const rec of bad) {
        resetRobotsCache();
        const c = countingFetch();
        const logs: string[] = [];
        expect(await buildHoustonPermitsAdapter(rec).fetch({ since: NOW, now: NOW, fetch: c.f, env: {}, log: (m) => logs.push(m) })).toEqual([]);
        expect(c.urls, JSON.stringify(rec)).toEqual([]);
        expect((await probeHoustonReport(c.f, NOW, rec)).schema).toBe('unreachable');
        expect(c.urls).toEqual([]);
      }
    }
  });
});

describe('2b. one access-record rule, one robots rule, one user agent for page watch and the Houston page', () => {
  const pw = (rec: AccessRecord, parser: PageWatchDataset['parser'] = 'html-table'): PageWatchDataset => {
    const d = cleared('bids-pw-chicago');
    const { termsChecked, ...ev } = rec;
    return { ...d, parser, termsChecked, evidence: { ...d.evidence, robotsUrl: undefined, termsUrl: undefined, checkedOn: undefined, endpointAllowed: undefined, ...ev } };
  };
  const records: AccessRecord[] = [
    HOUSTON_CLEARED,
    { ...HOUSTON_CLEARED, termsChecked: false },
    { ...HOUSTON_CLEARED, robotsUrl: 'http://www.houstontx.gov/robots.txt' },
    { ...HOUSTON_CLEARED, robotsUrl: 'https://www.houstontx.gov/' },
    { ...HOUSTON_CLEARED, termsUrl: undefined },
    { ...HOUSTON_CLEARED, checkedOn: '2026-11' },
    { ...HOUSTON_CLEARED, checkedBy: 'owner' },
  ];

  it('the same record gets the same verdict from page watch (accessCleared) and Houston (houstonAccessCleared); a vendor endpoint also needs endpointAllowed', () => {
    for (const rec of records) {
      expect(accessCleared(pw(rec)), JSON.stringify(rec)).toBe(accessRecordCleared(rec));
      expect(houstonAccessCleared(rec), JSON.stringify(rec)).toBe(accessRecordCleared(rec));
    }
    expect(accessCleared(pw(HOUSTON_CLEARED, 'bonfire'))).toBe(false);
    expect(accessCleared(pw({ ...HOUSTON_CLEARED, endpointAllowed: true }, 'bonfire'))).toBe(true);
    expect(houstonAccessCleared(HOUSTON_ACCESS)).toBe(false);
  });

  it('Houston robots.txt is judged for Holler\'s own token: a FirecrawlAgent allow never grants the plain fetch; 401, 403, 429, 503 and HTML refuse', async () => {
    const cases: Array<[number, string, string]> = [
      [200, 'User-agent: FirecrawlAgent\nAllow: /\n\nUser-agent: *\nDisallow: /\n', 'text/plain'],
      [401, '', 'text/plain'], [403, '', 'text/plain'], [429, '', 'text/plain'], [503, '', 'text/plain'],
      [200, '<!doctype html><html><body>Login</body></html>', 'text/html'],
    ];
    for (const [status, body, type] of cases) {
      resetRobotsCache();
      const urls: string[] = [];
      const f = (async (u: string | URL | Request) => {
        urls.push(String(u));
        return String(u).endsWith('/robots.txt') ? new Response(body, { status, headers: { 'content-type': type } }) : new Response('<table></table>', { status: 200 });
      }) as typeof fetch;
      const logs: string[] = [];
      expect(await buildHoustonPermitsAdapter(HOUSTON_CLEARED).fetch({ since: NOW, now: NOW, fetch: f, env: {}, log: (m) => logs.push(m) })).toEqual([]);
      expect(urls, `${status} ${type}`).toEqual(['https://www.houstontx.gov/robots.txt']);
      expect(logs.join(' ')).toMatch(/robots_(disallowed|unreachable)/);
    }
  });

  it('Houston follows no redirect: a 301 is reported, the target is never fetched', async () => {
    const urls: string[] = [];
    const inits: RequestInit[] = [];
    const f = (async (u: string | URL | Request, init?: RequestInit) => {
      urls.push(String(u));
      inits.push(init ?? {});
      if (String(u).endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response('', { status: 301, headers: { location: 'https://elsewhere.example/report.html' } });
    }) as typeof fetch;
    const logs: string[] = [];
    expect(await buildHoustonPermitsAdapter(HOUSTON_CLEARED).fetch({ since: NOW, now: NOW, fetch: f, env: {}, log: (m) => logs.push(m) })).toEqual([]);
    expect(urls).toEqual(['https://www.houstontx.gov/robots.txt', HOUSTON_REPORT_URL]);
    expect(inits[1].redirect).toBe('manual');
    expect(logs.join(' ')).toMatch(/HTTP 301 \(redirect not followed\)/);
  });

  it('a Crawl-delay not yet met skips the Houston page this run (not an error)', async () => {
    const urls: string[] = [];
    const f = (async (u: string | URL | Request) => {
      urls.push(String(u));
      if (String(u).endsWith('/robots.txt')) return new Response('User-agent: *\nCrawl-delay: 3600\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      return new Response('<table></table>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const a = buildHoustonPermitsAdapter(HOUSTON_CLEARED);
    await a.fetch({ since: NOW, now: NOW, fetch: f, env: {}, log: () => {} });
    expect(urls).toEqual(['https://www.houstontx.gov/robots.txt', HOUSTON_REPORT_URL]);
    const logs: string[] = [];
    await a.fetch({ since: NOW, now: new Date(NOW.getTime() + 60_000), fetch: f, env: {}, log: (m) => logs.push(m) });
    expect(urls).toHaveLength(2);
    expect(logs.join(' ')).toMatch(/crawl_delay/);
    expect(logs.join(' ')).not.toMatch(/^error/);
  });
});

// ---- 3 ------------------------------------------------------------------------------------------------------------------------------------
describe('3. one 311 block rule, the strictest of NEXT\'s and r20-ship\'s', () => {
  const NYC_BUILT = ['2318 WEST 52 STREET', '41-20 BOWNE STREET', '300 PARK AVENUE SOUTH', '1234 GRAND CONCOURSE', '12 EAST 130 STREET', '500 AVENUE J', '500 ST MARKS PLACE', '12 SAINT JOHNS PLACE', '1 BROADWAY', '55 CENTRAL PARK WEST', '87-10 37 AVENUE', '2318 W 52ND ST', '10 WEST STREET', '665 PELHAM PARKWAY NORTH', '1500 ADAM CLAYTON POWELL JR BOULEVARD', '33 UNION SQUARE WEST', '12 JOHN STREET', '100 BEACH 20 STREET', '2318 SMITH STREET'].map((x) => nycBlockAddress(x));
  const SHARED_BUILT = ['2318 W 47TH ST', '12 MAIN ST', '1200 MAIN ST', '8701 S COTTAGE GROVE AVE', '12345 WESTHEIMER RD', '4500 N LINCOLN AVE', '100 W RANDOLPH ST'].map((x) => blockOfAddress(x));
  const BAD = [
    // r20-ship final review P3-2
    '2300 block of WEST 52 STREET JOHN SMITH', '200 block of JOHN SMITH', '200 block of MAIN ST JANE DOE', '0-99 block of ZELDA QUIXOTE',
    // NEXT
    '2318 W 47TH ST', '2350 block of MAIN ST', '2300 block of MAIN ST APT 4', '2300 block of MAIN ST #4', '2300 block of', 'block of MAIN ST', '2300 block of 214-555-0199 MAIN ST',
    // r20-ship isBlockForm word list (rear, front, c/o, attn, owner), kept by the union
    '2300 block of MAIN ST REAR', '200 block of FRONT ST', '200 block of MAIN ST ATTN', '200 block of OWNER ST',
  ];

  it('one block-form test: isBlockForm is blockSiteAddress; every block either writer builds passes; every bad string of either branch fails', () => {
    expect(NYC_BUILT.filter(Boolean)).toHaveLength(19);
    expect(SHARED_BUILT.filter(Boolean)).toHaveLength(7);
    for (const b of [...NYC_BUILT, ...SHARED_BUILT]) {
      expect(isBlockForm(b), b).toBe(true);
      expect(blockSiteAddress(b), b).toBe(b);
    }
    for (const b of BAD) {
      expect(isBlockForm(b), b).toBe(false);
      expect(blockSiteAddress(b), b).toBeNull();
      expect(contactsAllowedFor('311', [{ role: 'site', name: '', address: b }]), b).toEqual([]);
    }
    // r20-ship's sanitizeContact check (final review P3-2) for its four strings; a NEXT string that is no block at all ("2350 block of
    // MAIN ST") may still read as an exact site through cleanAddress, which the 311 gate above refuses.
    for (const b of BAD.slice(0, 4)) expect(sanitizeContact({ role: 'site', name: '', address: b })?.address ?? null, b).not.toBe(b);
  });

  it('both 311 paths share every step: an address naming a unit gives NO block on either (stricter than round 20\'s NYC path)', () => {
    const dallas = { addressFields: ['a'], typeFields: ['t'], propertyTypes: PROPERTY_CONDITION_311_RE };
    const heat = { fields: ['a'], when: (g: (f: string) => string) => isWholeBuildingNyc311(g('t'), g('d')) };
    const place = { city: 'X', state: 'TX', zip: '75201' };
    for (const unit of ['APT 4B', 'UNIT 2', '# 5', 'FL 3', 'REAR', 'BSMT']) {
      expect(site311Contact((f) => (f === 't' ? 'High Weeds' : `2318 W 47TH ST ${unit}`), dallas, place), unit).toBeNull();
      expect(nycWholeBuildingContact((f) => (f === 't' ? 'HEAT/HOT WATER' : f === 'd' ? 'ENTIRE BUILDING' : `2318 WEST 52 STREET ${unit}`), heat, place), unit).toBeNull();
    }
    const d = site311Contact((f) => (f === 't' ? 'High Weeds' : '2318 W 47TH ST'), dallas, place)!;
    const n = nycWholeBuildingContact((f) => (f === 't' ? 'HEAT/HOT WATER' : f === 'd' ? 'ENTIRE BUILDING' : '2318 WEST 52 STREET'), heat, { ...place, zip: '1022' })!;
    expect(d).toEqual({ role: 'site', name: '', address: '2300 block of W 47TH ST', city: 'X', state: 'TX', zip: '75201' });
    expect(n).toEqual({ role: 'site', name: '', address: '2300 block of WEST 52 STREET', city: 'X', state: 'TX', zip: null });
    for (const c of [d, n]) {
      expect(isBlockSiteContact(c)).toBe(true);
      expect(isBlockSite(c)).toBe(true);
      expect(contactsAllowedFor('311', [c])).toEqual([c]);
      // A name, a phone or an e-mail on the same block is dropped by the one gate.
      expect(contactsAllowedFor('311', [{ ...c, name: 'ACME LLC' }, { ...c, phone: '2125550100' }, { ...c, email: 'a@b.co' }])).toEqual([]);
    }
    // The type tests stay apart by design: the NYC path admits two exact whole-building values only; NEVER_SITE_311_RE refuses heat elsewhere.
    expect(nycWholeBuildingContact((f) => (f === 't' ? 'HEAT/HOT WATER' : f === 'd' ? 'APARTMENT ONLY' : '2318 WEST 52 STREET'), heat, place)).toBeNull();
    expect(NEVER_SITE_311_RE.test('HEAT/HOT WATER / ENTIRE BUILDING')).toBe(true);
    expect(site311Contact((f) => (f === 't' ? 'HEAT/HOT WATER / ENTIRE BUILDING' : '2318 W 47TH ST'), dallas, place)).toBeNull();
  });

  it('through the real parsers: NYC 311 (live) and Dallas 311 (live) public rows carry no block; the private site is the block only', () => {
    const nyc = SOCRATA_DATASETS.find((d) => d.id === 'socrata-nyc-311')!;
    const dal = SOCRATA_DATASETS.find((d) => d.id === 'socrata-dallas-311')!;
    expect(dal.site311).toBeDefined();
    const nycRows = [
      { unique_key: '1', created_date: '2026-11-21T03:12:00.000', agency: 'HPD', complaint_type: 'HEAT/HOT WATER', descriptor: 'ENTIRE BUILDING', incident_zip: '11220', borough: 'BROOKLYN', status: 'Open', latitude: '40.6430', longitude: '-74.0100', incident_address: '6801 4 AVENUE' },
      { unique_key: '2', created_date: '2026-11-21T03:12:00.000', agency: 'HPD', complaint_type: 'HEAT/HOT WATER', descriptor: 'ENTIRE BUILDING', incident_zip: '11220', borough: 'BROOKLYN', status: 'Open', latitude: '40.6430', longitude: '-74.0100', incident_address: '6801 4 AVENUE APT 4B' },
    ];
    const items = parseSocrataReport(nycRows, nyc).items;
    expect(items.map((i) => (i.contacts ?? []).map((c) => c.address))).toEqual([['6800 block of 4 AVENUE'], []]);
    for (const it0 of items) expect(JSON.stringify({ t: it0.title, s: it0.summary, d: it0.data })).not.toMatch(/6801|block of|APT/);
  });
});

// ---- 4 ------------------------------------------------------------------------------------------------------------------------------------
describe('4. one keyed-hash helper for the building reference and the keyed source id (values unchanged)', () => {
  it('both read the one secret and give exactly the round 20 values', () => {
    vi.stubEnv('HOLLER_BUILDING_REF_SECRET', 'int21-secret');
    expect(buildingRefSecret()).toBe('int21-secret');
    expect(idKeySecret()).toBe('int21-secret');
    expect(serverKeySecret()).toBe('int21-secret');
    expect(buildingRefOf(40.64301, -74.01)).toBe(createHmac('sha256', 'holler-building-ref|int21-secret').update('40.6430,-74.0100').digest('hex').slice(0, 20));
    expect(keyedId('32012345678:00001')).toBe(`k${createHmac('sha256', 'holler-source-id|int21-secret').update('32012345678:00001').digest('hex').slice(0, 24)}`);
    vi.stubEnv('HOLLER_BUILDING_REF_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(serverKeySecret()).toBeNull();
    expect(buildingRefOf(40.643, -74.01)).toBeNull();
    expect(keyedId('32012345678:00001')).toBe('');
  });
});

// ---- 5 ------------------------------------------------------------------------------------------------------------------------------------
describe('5. unions and the one owner list', () => {
  it('PROPOSED_LABELS holds every NEXT and WATCH entry unchanged, beside VIOL and SALES', () => {
    for (const [id, p] of Object.entries({ ...NEXT_PROPOSED_LABELS, ...WATCH_PROPOSED_LABELS })) expect(PROPOSED_LABELS[id], id).toBe(p);
    for (const s of VIOL_R20_SOURCES) expect(PROPOSED_LABELS[s.id], s.id).toBeDefined();
    for (const id of SALE_SOURCE_IDS) expect(PROPOSED_LABELS[id], id).toBeDefined();
    // A bid's call path is the agency and the bid number: business tier, never an address.
    for (const p of Object.values(WATCH_PROPOSED_LABELS)) expect(p.callPathTier).toBe('business');
  });

  it('LAUNCH.md: one bold NEEDS KUDZI header; one "Round 21 order" right after the Round 20 one, steps 1 to 10 each with a reason, every new id named', () => {
    const md = readFileSync('LAUNCH.md', 'utf8');
    expect(md.split('**NEEDS KUDZI').length - 1).toBe(1);
    expect(md.split('**Round 21 order**').length - 1).toBe(1);
    expect(md.indexOf('**Round 20 order**')).toBeLessThan(md.indexOf('**Round 21 order**'));
    expect(md.indexOf('**Round 21 order**')).toBeLessThan(md.indexOf('**Rounds 18 and 19 order**'));
    const block = md.slice(md.indexOf('**Round 21 order**'), md.indexOf('**Rounds 18 and 19 order**'));
    const steps = [...block.matchAll(/^(\d+)\. (.*)$/gm)];
    expect(steps.map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const m of steps) expect(m[2], `step ${m[1]}`).toMatch(/ Why: /);
    for (const id of NEW_IDS) expect(block, id).toContain(`\`${id}\``);
    expect(block).toMatch(/HOLLER_PAGE_WATCH_ENABLED/);
    const kudzi = md.slice(md.indexOf('**NEEDS KUDZI'), md.indexOf('- [ ] Run `supabase/migrations/0001_holler.sql`'));
    for (const s of ['Round 20 next sources: probe each once', 'Round 20 next sources, Houston permit page', 'Round 20 page watch, per source, in a browser', 'Round 20 page watch: to promote one', 'Round 20 NYC 311 (LIVE source']) expect(kudzi, s).toContain(s);
  });
});
