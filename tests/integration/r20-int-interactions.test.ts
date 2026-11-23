// Round 20 integration (INT20): the four round 20 branches (SCORE, VIOL, SALES, LIC) merged together. Each unit tested its own work on
// its own branch; these tests check what only the merge can break:
//   1. probation holds for EVERY new source id of every branch at once (samples only; samples table present, and missing with both codes);
//   2. the NYC whole-building heat block contact (VIOL, live) never reaches a public row or page, with SALES' and LIC's store and page
//      changes in place;
//   3. a home sale (SALES) never stores a house number, even through LIC's licence attach step and VIOL's block-form contact rule, and even
//      if it were promoted;
//   4. the licence sync (LIC) stays off and every licence source unpromoted;
//   5. the merged route list, proposed labels and probation sets are the union of all branches.
// The private-person matrices (tests/review, tests/contacts, the 349-string contractor matrix in tests/builders/names-60.test.ts) are run
// unchanged by the full suite; they are not restated here.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { runScan } from '@/lib/signals/run';
import { sanitizeSample } from '@/lib/signals/samples';
import { PROBATION_SOURCE_IDS, SALE_SOURCE_IDS, VIOL_R20_SOURCES, COVERAGE_R19_SOURCES, LABEL_PENDING_INTEGRATION, NEXT_R20_SOURCES } from '@/lib/signals/probation';
import { NEXT_PROPOSED_LABELS, PROPOSED_LABELS, WATCH_PROPOSED_LABELS } from '@/lib/signals/proposed-labels';
import { SALES_PROPOSED_LABELS } from '@/lib/signals/proposed-labels-sales';
import { SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import { SALES_DATASETS } from '@/lib/signals/adapters/sales-datasets';
import { parseSaleRows } from '@/lib/signals/adapters/sales';
import { parseSocrataReport } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { sectionFor } from '@/lib/seo/sections';
import { mayHaveContacts, outreachPlan } from '@/lib/outreach/plan';
import { contactPathOf } from '@/lib/signals/alert-gate';
import { LICENSE_SOURCES, isPromoted } from '@/lib/licenses/sources';
import { runLicenseSync } from '@/lib/licenses/sync';
import { licenseSyncEnabled } from '@/lib/licenses/switch';
import { callPathOfRow } from '@/lib/signals/trade-coverage';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const asDb = (f: FakeDb) => f as unknown as Db;
const adapterOf = (id: string) => ALL_ADAPTERS.find((a) => a.id === id);
const NEW_IDS = [...VIOL_R20_SOURCES.map((s) => s.id), ...SALE_SOURCE_IDS];
const PUBLIC_TABLES = ['holler_signals', 'holler_signal_contacts', 'holler_matches', 'holler_alert_log', 'holler_notifications'];
const PROFILES = [
  { user_id: 'u000001', categories: ['hvac', 'plumbing', 'pest-control', 'moving', 'cleaning', 'security', 'lawn-care', 'windows-doors'], lat: 40.71, lon: -74.0, state: 'NY', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-30T00:00:00Z' },
  { user_id: 'u000002', categories: ['security', 'janitorial-commercial', 'lawn-care', 'handyman'], lat: 33.45, lon: -112.07, state: 'AZ', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-30T00:00:00Z' },
];

/** A record a probation source could produce, with an exact house number and a planted business in a contact. */
const planted = (id: string, i: number): SignalInput => ({
  source: id,
  externalId: `int20-${i}`,
  kind: 'civic',
  title: `Probation record ${i}`,
  summary: 'OPEN | 2300 block of WEST 52 STREET',
  categories: ['hvac', 'plumbing', 'security', 'lawn-care'],
  severity: 2,
  occurredAt: '2026-11-21T10:00:00Z',
  lat: 40.765,
  lon: -73.989,
  state: 'NY',
  url: null,
  data: { subtype: id.endsWith('-sales') ? 'sale' : 'violation' },
});

describe('1. probation holds for every new id of every round 20 branch', () => {
  it('every new id is a registered adapter with probation: true, in PROBATION_SOURCE_IDS, with no SOURCE_DEFAULTS label', () => {
    expect(NEW_IDS).toHaveLength(9);
    for (const id of NEW_IDS) {
      expect(adapterOf(id)?.probation, id).toBe(true);
      expect(PROBATION_SOURCE_IDS.has(id), id).toBe(true);
      expect(SOURCE_DEFAULTS[id], id).toBeUndefined();
    }
    // The union, exactly: round 19's eleven, VIOL's five, SALES' four; round 21 adds NEXT's ten and WATCH's twelve registered pages
    // (tests/integration/r21-int-interactions.test.ts).
    const pw = Object.keys(WATCH_PROPOSED_LABELS);
    expect(PROBATION_SOURCE_IDS.size).toBe(11 + VIOL_R20_SOURCES.length + SALE_SOURCE_IDS.length + NEXT_R20_SOURCES.length + pw.length);
    expect(new Set(LABEL_PENDING_INTEGRATION)).toEqual(new Set([...[...COVERAGE_R19_SOURCES, ...VIOL_R20_SOURCES, ...NEXT_R20_SOURCES].map((s) => s.id), ...pw]));
  });

  it('samples table present: one scan of all nine writes samples only (real ids and probation flags, records with an address and a business)', async () => {
    const f = new FakeDb({ holler_profiles: PROFILES, holler_source_samples: [] });
    const adapters: Adapter[] = NEW_IDS.map((id, i) => ({
      ...adapterOf(id)!,
      fetch: async () => [{ ...planted(id, i), contacts: [{ role: 'contractor', name: 'ACME HEATING LLC', phone: '2125550100' }] } as SignalInput],
    }));
    const r = await runScan({ now: NOW, adapters, fetchImpl: (async () => new Response('[]')) as typeof fetch }, asDb(f));
    for (const id of NEW_IDS) expect(r.sources.find((s) => s.id === id)?.status, id).toBe('ok');
    expect(new Set(f.tables.holler_source_samples.map((s) => s.source))).toEqual(new Set(NEW_IDS));
    for (const t of PUBLIC_TABLES) expect(f.tables[t] ?? [], t).toEqual([]);
  });

  it.each([
    ['PGRST205', "Could not find the table 'public.holler_source_samples' in the schema cache"],
    ['42P01', 'relation "public.holler_source_samples" does not exist'],
  ])('samples table missing (%s): all nine real adapters are skipped, no portal request, no write', async (code, message) => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    for (const op of ['select', 'upsert', 'insert', 'delete']) {
      f.failOn[`holler_source_samples.${op}`] = message;
      f.failCode[`holler_source_samples.${op}`] = code;
    }
    const urls: string[] = [];
    const doFetch = (async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response('[]');
    }) as typeof fetch;
    const r = await runScan({ now: NOW, adapters: NEW_IDS.map((id) => adapterOf(id)!), fetchImpl: doFetch }, asDb(f));
    expect(urls).toEqual([]);
    expect(r.error).toBeUndefined();
    for (const id of NEW_IDS) expect(r.sources.find((s) => s.id === id), id).toMatchObject({ status: 'skipped(env)', inserted: 0 });
    for (const t of PUBLIC_TABLES) expect(f.tables[t] ?? [], t).toEqual([]);
  });

  it('no new id is in the public capabilities feed list or the sources a city page counts', async () => {
    const { enabledDatasets } = await import('@/lib/signals/capabilities');
    const listed = JSON.stringify(enabledDatasets());
    for (const id of NEW_IDS) expect(listed, id).not.toContain(id);
  });
});

describe('2. the NYC whole-building heat block contact never reaches a public row or page (VIOL live change, with SALES and LIC merged)', () => {
  const NYC311 = SOCRATA_DATASETS.find((d) => d.id === 'socrata-nyc-311')!;
  let n = 0;
  const row = (complaint_type: string, descriptor: string, incident_address?: string) => ({
    unique_key: String(77000000 + ++n), created_date: '2026-11-21T03:12:00.000', agency: 'HPD', complaint_type, descriptor, incident_zip: '11220',
    borough: 'BROOKLYN', status: 'Open', latitude: '40.6430', longitude: '-74.0100', ...(incident_address ? { incident_address } : {}),
  });

  it('a full live scan (VIOL parser, LIC store attach step, SALES page rule): public rows hold no house number and no block', async () => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const body = [row('HEAT/HOT WATER', 'ENTIRE BUILDING', '2318 WEST 52 STREET APT 4B'), row('Non-Residential Heat', 'Inadequate or No Heat', '451 WEST 52 STREET')];
    const doFetch = (async (u: string | URL | Request) => new Response(JSON.stringify(String(u).includes('erm2-nwe9') ? body : []), { status: 200 })) as typeof fetch;
    await runScan({ now: NOW, adapters: [adapterOf('socrata-nyc-311')!], fetchImpl: doFetch }, asDb(f));
    const signals = f.tables.holler_signals ?? [];
    expect(signals).toHaveLength(2);
    expect(JSON.stringify(signals)).not.toMatch(/2318|451|block of|APT|4B/);
    // The block is in the service-role table only, never with a licence number (the attach step is permit-only).
    // Round 21 (one 311 rule, the stricter of both): the "APT 4B" address names a unit, so that whole-building row keeps no block at all.
    expect((f.tables.holler_signal_contacts ?? []).map((c) => [c.role, c.address, c.license ?? null])).toEqual([
      ['site', '400 block of WEST 52 STREET', null],
    ]);
    for (const s of signals) expect(sectionFor(s.kind, s.source, s.title, s.data?.subtype ?? null), s.title).not.toBeNull();
    expect(f.tables.holler_contractor_licenses ?? []).toEqual([]);
  });

  it('every public loader and public page reads holler_signals only; the files that read contacts are member, admin or service paths', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    for (const d of ['app', 'lib', 'components']) if (existsSync(d)) walk(d);
    const readers = files.filter((p) => /from\(\s*['"]holler_signal_contacts['"]/.test(readFileSync(p, 'utf8'))).sort();
    // A new reader of the contacts table must be added here by review.
    const ALLOWED = ['lib/admin/', 'lib/builders/load.ts', 'lib/contacts/load.ts', 'lib/signals/store.ts'];
    for (const p of readers) expect(ALLOWED.some((a) => p.startsWith(a)), p).toBe(true);
    for (const p of files.filter((x) => /^app\/(local|guides|faq|data|\(public\)|es)\b/.test(x) || /^lib\/(seo|preview)\//.test(x))) {
      expect(readFileSync(p, 'utf8'), p).not.toMatch(/from\(\s*['"]holler_signal_contacts/);
    }
  });

  it('the member plan still shows the block line after the SALES merge of plan.ts; sales and heat do not cross', () => {
    const sig = { source: 'socrata-nyc-311', kind: 'civic', city: 'New York City', state: 'NY', zip: '11220', summary: 'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN' };
    const block = [{ role: 'site' as const, name: '', address: '6800 block of 4 AVENUE', city: 'New York City', state: 'NY', zip: '11220' }];
    const en = outreachPlan(sig, block, 'en');
    expect(en && en.type === 'area' ? en.building : null).toBe('Building: the 6800 block of 4 AVENUE (the exact address is not published)');
    expect(mayHaveContacts('socrata-nyc-311', 'civic')).toBe(true);
    for (const id of SALE_SOURCE_IDS) expect(mayHaveContacts(id, 'civic'), id).toBe(true);
    // A home sale never gets a block line, an address or a door kit, even with a block site row passed in.
    const home = outreachPlan({ source: 'socrata-nyc-acris-sales', kind: 'civic', title: 'Home sold in Brooklyn, NY', city: 'New York City', state: 'NY', summary: 'Price band: $500k–$1M | Single-family home | 200 block of Prospect Pl' }, block, 'en');
    expect(JSON.stringify(home)).not.toMatch(/6800|Building:/);
  });

  it('the scorecard reads a stored heat block contact as the block tier, never strict', () => {
    expect(callPathOfRow({ source: 'socrata-nyc-311', summary: 'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN', contacts: [{ role: 'site', name: '', address: '6800 block of 4 AVENUE' }] }, () => false)).toBe('block');
    expect(contactPathOf([{ role: 'site', name: '', address: '6800 block of 4 AVENUE' }], null)).toBe('site');
  });

  it('the parser itself: an apartment-only heat request still gets nothing', () => {
    const items = parseSocrataReport([row('HEAT/HOT WATER', 'APARTMENT ONLY', '2318 WEST 52 STREET')], NYC311).items;
    expect(items[0].contacts ?? []).toEqual([]);
  });
});

describe('3. a home sale never stores a house number (SALES, through LIC\'s store step and VIOL\'s block-form rule)', () => {
  const NYC = SALES_DATASETS.find((d) => d.id === 'socrata-nyc-acris-sales')!;
  const home = { document_id: '2026111000123001', doc_type: 'DEED', recorded_datetime: '2026-11-10T00:00:00.000', document_amt: '850000', borough: '3', property_type: 'D1', street_number: '245', street_name: 'PROSPECT PL', unit: '4B' };

  it('parsed and sampled: block only, no house number, no unit, no contact', () => {
    const [s] = parseSaleRows([home], NYC, NOW).items;
    expect(s.summary).toBe('Price band: $500k–$1M | Single-family home | 200 block of Prospect Pl');
    expect(s.contacts).toBeUndefined();
    expect(JSON.stringify([s, sanitizeSample(s)])).not.toMatch(/\b245\b|4B|850000/);
  });

  it('even if promoted by mistake (probation off): holler_signals has the block only and no contact or licence row is written', async () => {
    const [s] = parseSaleRows([home], NYC, NOW).items;
    const f = new FakeDb({ holler_profiles: PROFILES });
    const promoted: Adapter = { ...adapterOf('socrata-nyc-acris-sales')!, probation: false, fetch: async () => [{ ...s, contacts: [{ role: 'site', name: '', address: '245 PROSPECT PL' }] }] };
    await runScan({ now: NOW, adapters: [promoted], fetchImpl: (async () => new Response('[]')) as typeof fetch }, asDb(f));
    expect(JSON.stringify(f.tables.holler_signals ?? [])).not.toMatch(/\b245\b|4B/);
    // A stale exact site row on a home sale is dropped at the write (integration guard: lib/contacts/extract.ts isResidentialSaleRecord).
    expect(f.tables.holler_signal_contacts ?? []).toEqual([]);
    expect(sanitizeSample({ ...s, contacts: [{ role: 'site', name: '', address: '245 PROSPECT PL' }] }).contacts).toEqual([]);
    expect(f.tables.holler_contractor_licenses ?? []).toEqual([]);
  });

  it('a commercial sale keeps its nameless site through the same guard', async () => {
    const { isResidentialSaleRecord } = await import('@/lib/contacts/extract');
    expect(isResidentialSaleRecord('sale', 'Commercial property sold in Philadelphia, PA')).toBe(false);
    expect(isResidentialSaleRecord('sale', 'Home sold in Brooklyn, NY')).toBe(true);
    expect(isResidentialSaleRecord('sale', 'Condo sold in Miami, FL')).toBe(true);
    expect(isResidentialSaleRecord('sale', null)).toBe(true);
    expect(isResidentialSaleRecord('permit', 'Home sold in Brooklyn, NY')).toBe(false);
    const site = { role: 'site' as const, name: '', address: '1520 SPRUCE ST' };
    const com = { source: 'carto-phl-sales', externalId: 'x', kind: 'civic', title: 'Commercial property sold in Philadelphia, PA', summary: 's', categories: [], severity: 1, occurredAt: '2026-11-18T00:00:00Z', lat: null, lon: null, state: 'PA', url: null, data: { subtype: 'sale' }, contacts: [site] } as unknown as SignalInput;
    expect(sanitizeSample(com).contacts?.map((c) => c.address)).toEqual(['1520 SPRUCE ST']);
  });

  it('projected: a home sale is block-only, a commercial sale exact', () => {
    for (const id of SALE_SOURCE_IDS) {
      expect(SALES_PROPOSED_LABELS[id]).toMatchObject({ callPath: false, blockPath: true });
      expect(SALES_PROPOSED_LABELS[`${id}:commercial`]).toMatchObject({ callPath: true });
      expect(PROPOSED_LABELS[id]).toBe(SALES_PROPOSED_LABELS[id]);
    }
  });
});

describe('4. the licence sync stays off and every licence source unpromoted', () => {
  it('the switch is off by default and every source is on probation, schema-unverified and not promoted', () => {
    expect(licenseSyncEnabled(undefined)).toBe(false);
    expect(licenseSyncEnabled('')).toBe(false);
    expect(LICENSE_SOURCES.length).toBe(5);
    for (const s of LICENSE_SOURCES) {
      expect(s.probation, s.id).toBe(true);
      expect(s.schemaUnverified, s.id).toBe(true);
      expect(isPromoted(s), s.id).toBe(false);
    }
  });

  it('switch on: every state answers not_promoted with no portal request and no write', async () => {
    for (const s of LICENSE_SOURCES) {
      const db = new FakeDb();
      const calls: string[] = [];
      const r = await runLicenseSync({ db: asDb(db), state: s.state, fetch: (async (u: string | URL | Request) => { calls.push(String(u)); return new Response(''); }) as typeof fetch, enabled: true });
      expect(r.status, s.id).toBe('not_promoted');
      expect(calls, s.id).toEqual([]);
      expect(db.calls, s.id).toEqual([]);
    }
  });

  it('no live adapter spec sets a licence state, so no live card looks a licence up', () => {
    const specs = [...SOCRATA_DATASETS].map((d) => JSON.stringify((d as { contacts?: unknown }).contacts ?? {}));
    for (const s of specs) expect(s).not.toMatch(/licenseState/);
  });
});

describe('5. the merged lists are the union of every branch', () => {
  it('the Bearer-only route list equals every cron and admin route on disk', () => {
    const list = readFileSync('tests/security/cron-bearer-only.test.ts', 'utf8');
    const routes = [...list.slice(list.indexOf('const ROUTES = ['), list.indexOf('] as const;')).matchAll(/'([a-z-]+\/[a-z-]+)'/g)].map((m) => m[1]).sort();
    const disk = ['cron', 'admin'].flatMap((d) => readdirSync(`app/api/${d}`, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(`app/api/${d}/${e.name}/route.ts`)).map((e) => `${d}/${e.name}`)).sort();
    expect(routes).toEqual(disk);
    for (const r of ['admin/license-probe', 'cron/license-sync', 'admin/coverage-probe']) expect(routes).toContain(r);
  });

  it('PROPOSED_LABELS holds every VIOL entry, every round 19 violation projection and both parts of every SALES source', () => {
    for (const s of VIOL_R20_SOURCES) expect(PROPOSED_LABELS[s.id], s.id).toBeDefined();
    for (const id of ['carto-phl-violations', 'arcgis-miamidade-violations', 'arcgis-miamidade-building-violations']) expect(PROPOSED_LABELS[id], id).toBeDefined();
    for (const id of SALE_SOURCE_IDS) for (const k of [id, `${id}:commercial`]) expect(PROPOSED_LABELS[k], k).toBeDefined();
    // Round 21: plus NEXT's eleven (its ten sources and the live Chicago address change) and WATCH's twelve registered pages.
    expect(Object.keys(PROPOSED_LABELS)).toHaveLength(VIOL_R20_SOURCES.length + 3 + 2 * SALE_SOURCE_IDS.length + Object.keys(NEXT_PROPOSED_LABELS).length + Object.keys(WATCH_PROPOSED_LABELS).length);
  });

  it('the scorecard reads a sale as property-sale (SALES\' line in SCORE\'s trade-needs table)', async () => {
    const { recordTypeOf } = await import('@/lib/signals/trade-needs');
    expect(recordTypeOf({ source: 'socrata-nyc-acris-sales', kind: 'civic', data: { subtype: 'sale' } })).toBe('property-sale');
  });
});

describe('6. LAUNCH.md: one NEEDS KUDZI list and one ordered "Round 20 order" block that keeps every item of the four units', () => {
  const md = readFileSync('LAUNCH.md', 'utf8');
  it('exactly one bold NEEDS KUDZI header and one Round 20 order block, steps 1 to 11 each with a reason', () => {
    expect(md.split('**NEEDS KUDZI').length - 1).toBe(1);
    expect(md.split('**Round 20 order**').length - 1).toBe(1);
    // Round 21: the Round 21 order block follows the Round 20 one (tests/integration/r21-int-interactions.test.ts).
    const block = md.slice(md.indexOf('**Round 20 order**'), md.indexOf('**Round 21 order**'));
    const steps = [...block.matchAll(/^(\d+)\. (.*)$/gm)];
    // Final review fixes added step 10 (0037, optional) and step 11 (promotion prerequisites).
    expect(steps.map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const m of steps) expect(m[2], `step ${m[1]}`).toMatch(/ Why: /);
    for (const id of NEW_IDS) expect(block, id).toContain(`\`${id}\``);
    expect(block).toMatch(/0033, 0034 and 0035 are unused/);
  });
  it('every round 20 owner item is inside the one NEEDS KUDZI list', () => {
    const kudzi = md.slice(md.indexOf('**NEEDS KUDZI'), md.indexOf('- [ ] Run `supabase/migrations/0001_holler.sql`'));
    for (const s of [
      'Round 20 sales: right after the deploy, probe each source once',
      'Round 20 sales: PRIVACY SIGN-OFF',
      'Round 20 sales: to promote one (only after the sign-off above)',
      'Round 20 violations: right after the deploy, probe each once',
      'Round 20 violations: to promote one',
      'Round 20 NYC 311 (LIVE source',
      'Migration 0036',
      'Probe each state once after the deploy',
      'Round 20 known companies',
      'Round 20 scorecard: your decision is applied',
      'PREREQUISITE before promotion',
    ]) expect(kudzi, s).toContain(s);
  });
});
