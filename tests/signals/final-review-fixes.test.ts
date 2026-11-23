// Round 20 final review (review-FINAL.md): P2-1 (311 points rounded), P3-1 (mobile building line), P3-2 (strict block form), P3-3 (who
// acted), P3-4 (stored "<STATE> LLC"), P3-5 (title on the card's signal), P3-7 (Philadelphia MIXED USE), P3-8 (builder name wraps).
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { FakeDb } from '../ops/fakedb';
import { bootDb, hasPglite } from '../moat/pg';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { CARTO_DATASETS } from '@/lib/signals/adapters/carto-datasets';
import { parseSocrataReport, privatePosition } from '@/lib/signals/adapters/socrata';
import { parseArcgisReport, resetArcgisFieldCache } from '@/lib/signals/adapters/arcgis';
import { buildingRefOf, onPrivacyGrid } from '@/lib/signals/building-ref';
import { withHeatMark } from '@/lib/signals/carry';
import { buildingKeyOf, HEAT_SOURCE, markRepeats } from '@/lib/signals/repeat-marks';
import { COARSE_POSITION_SUBTYPES, recordKey, type SignalRowInput } from '@/lib/signals/store';
import { matchOne, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { haversineMi } from '@/lib/geo';
import { areaContactParts, buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { isBlockForm, sanitizeContact } from '@/lib/contacts/sanitize';
import { contactsAllowedFor } from '@/lib/contacts/extract';
import { nycBlockAddress } from '@/lib/signals/adapters/nyc-address';
import { stripActor } from '@/lib/signals/adapters/permit-privacy';
import { cleanContractorName } from '@/lib/contacts/trade-name';
import { contactNameFor } from '@/lib/contacts/names';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { outreachPlan } from '@/lib/outreach/plan';
import { WhoToContact, type ContactSignal } from '@/components/feed/who-to-contact';
import { phlClassOf } from '@/lib/signals/adapters/sales-datasets';
import type { ContactRecord } from '@/lib/contacts/types';

const NOW = new Date('2026-11-22T12:00:00Z');
const NYC311 = SOCRATA_DATASETS.find((d) => d.id === HEAT_SOURCE)! as SocrataDataset;
const SECRET = 'test-building-ref-secret';
let n = 0;
const nycRow = (descriptor: string, lat: string, lon: string, over: Record<string, unknown> = {}) => ({
  unique_key: String(77000000 + ++n), created_date: '2026-11-21T03:12:00.000', agency: 'HPD', complaint_type: 'HEAT/HOT WATER', descriptor,
  incident_zip: '11220', borough: 'BROOKLYN', status: 'Open', latitude: lat, longitude: lon, incident_address: '2318 WEST 52 STREET', ...over,
});
const r3 = (x: number) => Math.round(x * 1000) / 1000;

afterEach(() => vi.unstubAllEnvs());

/** A fake Supabase client: every query answers `answer(callIndex)`; the chain calls are recorded (as in rules-review-fixes.test.ts). */
function recordingDb(answer: (n: number) => { data: unknown[] | null; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  let k = 0;
  return {
    calls,
    from: (table: string) => {
      const mine: unknown[] = [['from', table]];
      calls.push(mine);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'in', 'order', 'range']) q[m] = (...a: unknown[]) => (mine.push([m, ...a]), q);
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer(k++)).then(res);
      return q;
    },
  };
}

// ---- P2-1 ---------------------------------------------------------------------------------------------------------------------------
describe('P2-1: every 311 point is stored rounded to 3 decimals; the heat count keys a building by a keyed hash, never the rounded point', () => {
  it('privatePosition rounds 311 like violations and inspections; business stays at 2 decimals; permits keep their point', () => {
    const p = { lat: 40.643187, lon: -74.010466 };
    expect(privatePosition(p, '311')).toEqual({ lat: 40.643, lon: -74.01 });
    expect(privatePosition(p, 'violation')).toEqual({ lat: 40.643, lon: -74.01 });
    expect(privatePosition(p, 'inspection')).toEqual({ lat: 40.643, lon: -74.01 });
    expect(privatePosition(p, 'business')).toEqual({ lat: 40.64, lon: -74.01 });
    expect(privatePosition(p, 'permit')).toEqual(p);
    expect(COARSE_POSITION_SUBTYPES.has('311')).toBe(true);
    expect(recordKey({ source: 'socrata-nyc-311', title: 't', occurredAt: NOW.toISOString(), lat: 40.643, lon: -74.01, data: { subtype: '311' } }, new Set(['socrata-nyc-311']))).toBeNull();
  });

  it('NYC parse: the public row holds the rounded point and, for whole-building heat only, a keyed building reference', () => {
    vi.stubEnv('HOLLER_BUILDING_REF_SECRET', SECRET);
    const items = parseSocrataReport([nycRow('ENTIRE BUILDING', '40.643187', '-74.010466'), nycRow('APARTMENT ONLY', '40.643187', '-74.010466')], NYC311, { now: NOW }).items;
    expect(items).toHaveLength(2);
    for (const it0 of items) expect([it0.lat, it0.lon]).toEqual([40.643, -74.01]);
    expect(items[0].data?.bref).toBe(buildingRefOf(40.643187, -74.010466, SECRET));
    expect(items[0].data?.bref).toMatch(/^[0-9a-f]{20}$/);
    expect(items[1].data?.bref).toBeUndefined();
    const pub = JSON.stringify(items.map((i) => ({ title: i.title, summary: i.summary, data: i.data, lat: i.lat, lon: i.lon })));
    expect(pub).not.toMatch(/40\.6431|74\.0104|2318/);
    // the reference cannot be rebuilt without the secret
    expect(buildingRefOf(40.643187, -74.010466, 'another secret')).not.toBe(items[0].data?.bref);
  });

  it('every other 311 source is rounded too (Socrata fixtures of six cities, ArcGIS DC 311)', async () => {
    for (const id of ['socrata-chicago-311', 'socrata-dallas-311', 'socrata-cambridge-311', 'socrata-kansascity-311', 'socrata-oakland-311', 'socrata-nyc-311']) {
      const ds = SOCRATA_DATASETS.find((d) => d.id === id)! as SocrataDataset;
      const fixture = JSON.parse(readFileSync(`tests/fixtures/${id}.json`, 'utf8')) as unknown[];
      const items = parseSocrataReport(fixture, ds).items.filter((i) => typeof i.lat === 'number');
      expect(items.length, id).toBeGreaterThan(0);
      for (const it0 of items) expect([it0.lat, it0.lon], id).toEqual([r3(it0.lat!), r3(it0.lon!)]);
    }
    resetArcgisFieldCache();
    const DC = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dc-311')! as ArcgisDataset;
    const feat = { attributes: { SERVICEREQUESTID: '26-0099', ADDDATE: Date.parse('2026-11-22T08:00:00Z'), SERVICECODEDESCRIPTION: 'Rodent Inspection and Treatment', SERVICETYPECODEDESCRIPTION: 'SWMA', SERVICEORDERSTATUS: 'Open', ZIPCODE: 20001, LATITUDE: 38.910187, LONGITUDE: -77.014766 }, geometry: { x: -77.014766, y: 38.910187 } };
    const dc = parseArcgisReport({ features: [feat] }, DC).items;
    expect(dc.length).toBe(1);
    expect([dc[0].lat, dc[0].lon]).toEqual([38.91, -77.015]);
  });

  it('building key: the stored ref; an old exact point gets the SAME keyed hash (old and new complaints join); a rounded point alone is no building', () => {
    vi.stubEnv('HOLLER_BUILDING_REF_SECRET', SECRET);
    const [fresh] = parseSocrataReport([nycRow('ENTIRE BUILDING', '40.643187', '-74.010466')], NYC311, { now: NOW }).items;
    const oldStored = { lat: 40.643187, lon: -74.010466, data: {} };
    expect(buildingKeyOf(fresh)).toBe(buildingKeyOf(oldStored));
    expect(buildingKeyOf(fresh)).toMatch(/^ref:[0-9a-f]{20}$/);
    // a neighbour 30 m away rounds to the same 100 m cell but stays a different building
    const [neighbour] = parseSocrataReport([nycRow('ENTIRE BUILDING', '40.643412', '-74.010201')], NYC311, { now: NOW }).items;
    expect([neighbour.lat, neighbour.lon]).toEqual([fresh.lat, fresh.lon]);
    expect(buildingKeyOf(neighbour)).not.toBe(buildingKeyOf(fresh));
    expect(buildingKeyOf({ lat: 40.643, lon: -74.01, data: {} })).toBeNull();
    expect(onPrivacyGrid(40.643, -74.01)).toBe(true);
    expect(onPrivacyGrid(40.643187, -74.01)).toBe(false);
    // without any secret (offline replay): an exact point keys by itself at 4 decimals, as before
    vi.stubEnv('HOLLER_BUILDING_REF_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(buildingKeyOf(oldStored)).toBe('40.6432,-74.0105');
    const [noSecret] = parseSocrataReport([nycRow('ENTIRE BUILDING', '40.643187', '-74.010466')], NYC311, { now: NOW }).items;
    expect(noSecret.data?.bref).toBeUndefined();
    expect(buildingKeyOf(noSecret)).toBeNull(); // fails closed: never one heat card for a whole block
  });

  it('the scan count: two complaints stored before the deploy (exact points) and a third arriving rounded make the card; three in one cell at different buildings do not', async () => {
    vi.stubEnv('HOLLER_BUILDING_REF_SECRET', SECRET);
    const parse = (rows: unknown[]) => parseSocrataReport(rows, NYC311, { now: NOW }).items.map((s) => ({ ...s, placeSlug: null }) as unknown as SignalRowInput);
    const [third] = parse([nycRow('ENTIRE BUILDING', '40.643187', '-74.010466', { created_date: '2026-11-21T05:00:00.000' })]);
    const stored = [
      { external_id: 'a', lat: 40.643187, lon: -74.010466, occurred_at: '2026-11-21T01:00:00Z', summary: null, bref: null },
      { external_id: 'b', lat: 40.643187, lon: -74.010466, occurred_at: '2026-11-21T02:00:00Z', summary: null, bref: null },
    ];
    const db = recordingDb(() => ({ data: stored, error: null }));
    const out = await markRepeats(db as never, [third]);
    expect(out.heatMarked).toBe(1);
    const heatCall = db.calls.find((c) => c.some((x) => Array.isArray(x) && x[0] === 'ilike'))!;
    expect(heatCall).toContainEqual(['select', 'external_id, lat, lon, occurred_at, summary, bref:data->>bref']);
    // same 100 m cell, three different buildings (two stored after the deploy with their own refs): no card
    const others = [
      { external_id: 'c', lat: 40.643, lon: -74.01, occurred_at: '2026-11-21T01:00:00Z', summary: null, bref: buildingRefOf(40.643412, -74.010201, SECRET) },
      { external_id: 'd', lat: 40.643, lon: -74.01, occurred_at: '2026-11-21T02:00:00Z', summary: null, bref: buildingRefOf(40.642901, -74.009733, SECRET) },
    ];
    const out2 = await markRepeats(recordingDb(() => ({ data: others, error: null })) as never, [third]);
    expect(out2.heatMarked).toBe(0);
  });

  it('matching: the distance a member sees moves by at most the rounding (under 0.05 mi), and a match well inside the radius stays a match', () => {
    const member = { user_id: 'u1', categories: ['hvac', 'plumbing'], lat: 40.7128, lon: -74.006, state: 'NY', radius_mi: 25, plan: 'starter' } as unknown as MatchProfile;
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const lat = 40.5 + ((i * 7919) % 1000) / 2500 + 0.000137 * (i % 7);
      const lon = -74.25 + ((i * 104729) % 1000) / 1800 + 0.000211 * (i % 5);
      const shift = haversineMi(lat, lon, r3(lat), r3(lon));
      const d0 = haversineMi(member.lat!, member.lon!, lat, lon);
      const d1 = haversineMi(member.lat!, member.lon!, r3(lat), r3(lon));
      expect(Math.abs(d1 - d0)).toBeLessThanOrEqual(shift + 1e-9);
      expect(shift).toBeLessThan(0.05);
      worst = Math.max(worst, Math.abs(d1 - d0));
    }
    expect(worst).toBeGreaterThan(0);
    const sig = (lat: number, lon: number) => ({ id: 1, categories: ['hvac'], lat, lon, state: 'NY', severity: 2, occurred_at: NOW.toISOString(), subtype: '311', source: 'socrata-nyc-311', kind: 'civic', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', summary: 'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN', data: { subtype: '311' } }) as unknown as MatchSignal;
    const exact = matchOne(sig(40.643187, -74.010466), member, false, NOW.getTime());
    const rounded = matchOne(sig(40.643, -74.01), member, false, NOW.getTime());
    expect(!!exact).toBe(!!rounded);
    if (exact && rounded) expect(Math.abs((rounded.distance_mi ?? 0) - (exact.distance_mi ?? 0))).toBeLessThan(0.05);
  });

  const SQL = readFileSync('supabase/migrations/0037_holler_round_311_points.sql', 'utf8');
  it('0037 names exactly the 311 sources of the code, touches lat and lon only, holler_signals only', () => {
    const code = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS, ...CARTO_DATASETS].filter((d) => d.subtype === '311').map((d) => d.id).sort();
    const body = SQL.split('do $$')[1];
    const listed = [...body.matchAll(/'([a-z0-9-]+-311)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(code);
    const sql = SQL.replace(/--[^\n]*/g, '');
    expect(sql).toMatch(/update public\.holler_signals s\s+set lat = [^\n]*,\s+lon = [^\n]*\s+where/);
    expect(sql.match(/\bset\b[\s\S]*?\bwhere\b/)![0]).not.toMatch(/\b(?:title|summary|data|source|city|zip|categories|occurred_at)\s*=/);
    expect(sql).not.toMatch(/\b(?:create|alter|drop|grant|revoke|delete|insert|truncate)\b/i);
    expect([...sql.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]).every((t) => t.startsWith('holler_'))).toBe(true);
  });

  it.skipIf(!hasPglite)('0037 on a real database: rounds 311 rows like the app, leaves every other row and column alone, and a second run changes nothing', async () => {
    const db = await bootDb('0001_holler.sql');
    const ins = (id: number, source: string, subtype: string, lat: number | null, lon: number | null) =>
      db.query(`insert into public.holler_signals (id, source, external_id, kind, title, summary, lat, lon, occurred_at, data) values ($1, $2, $3, 'civic', 't', 's', $4, $5, now(), $6)`, [id, source, `x${id}`, lat, lon, JSON.stringify({ subtype })]);
    const pts: Array<[number, number]> = [[40.643187, -74.010466], [41.8781136, -87.6297982], [40.6435, -74.0105], [40.0005, -73.9995], [38.910187, -77.014766]];
    await ins(1, 'socrata-nyc-311', '311', ...pts[0]);
    await ins(2, 'socrata-chicago-311', '311', ...pts[1]);
    await ins(3, 'socrata-nyc-311', '311', ...pts[2]);
    await ins(4, 'socrata-nyc-311', '311', ...pts[3]);
    await ins(5, 'arcgis-dc-311', '311', ...pts[4]);
    await ins(6, 'socrata-chicago-permits', 'permit', ...pts[1]);
    await ins(7, 'socrata-nyc-311', '311', null, null);
    await ins(8, 'socrata-nyc-311', 'permit', ...pts[0]);
    const before = (await db.query('select * from public.holler_signals order by id')).rows;
    await db.exec(SQL);
    const after = (await db.query('select * from public.holler_signals order by id')).rows;
    for (const [i, [lat, lon]] of [[0, pts[0]], [1, pts[1]], [2, pts[2]], [3, pts[3]], [4, pts[4]]] as Array<[number, [number, number]]>) {
      expect([after[i].lat, after[i].lon], `row ${i + 1}`).toEqual([r3(lat), r3(lon)]);
      expect({ ...after[i], lat: 0, lon: 0 }).toEqual({ ...before[i], lat: 0, lon: 0 });
    }
    expect(after.slice(5)).toEqual(before.slice(5));
    await db.exec(SQL);
    expect((await db.query('select * from public.holler_signals order by id')).rows).toEqual(after);
  }, 60_000);
});

// ---- P3-1 ---------------------------------------------------------------------------------------------------------------------------
describe('P3-1: the mobile API sends the NYC heat block as the web card words it, in English and Spanish, under "Who to contact"', () => {
  const block = { signalId: 11, role: 'site', name: '', address: '2300 block of WEST 52 STREET', city: 'New York City', state: 'NY', zip: '11220' } as unknown as ContactRecord;
  const heat = { source: 'socrata-nyc-311', kind: 'civic' };

  it('areaContactParts: no contact row, the building line in the member language', () => {
    expect(areaContactParts(heat, [block], 'en')).toEqual({ contacts: [], building: { heading: 'Who to contact', line: 'Building: the 2300 block of WEST 52 STREET (the exact address is not published)' } });
    expect(areaContactParts(heat, [block], 'es')).toEqual({ contacts: [], building: { heading: 'A quién contactar', line: 'Edificio: la cuadra 2300 de WEST 52 STREET (no se publica la dirección exacta)' } });
    // an exact address or another 311 source: nothing at all
    expect(areaContactParts(heat, [{ ...block, address: '2318 WEST 52 STREET' } as ContactRecord], 'en')).toEqual({ contacts: [], building: null });
    expect(areaContactParts({ source: 'socrata-chicago-311', kind: 'civic' }, [block], 'en')).toEqual({ contacts: [], building: null });
    // an organisation record keeps its contacts as before
    const biz = { signalId: 12, role: 'contractor', name: 'ACME ROOFING LLC', phone: '404-555-0100' } as unknown as ContactRecord;
    expect(areaContactParts({ source: 'socrata-chicago-permits', kind: 'permit' }, [biz], 'en').contacts).toEqual([{ role: 'contractor', name: 'ACME ROOFING LLC', phone: '404-555-0100' }]);
  });

  it('i18n: the heading exists in both languages', async () => {
    const { t } = await import('@/lib/i18n');
    expect(t('es', 'who.heading')).not.toBe(t('en', 'who.heading'));
  });

  it('buildAlerts end to end (fake database): building line, no "Site" row; locked members get neither', async () => {
    const m: MatchRow = {
      id: 1, status: 'new', distance_mi: 2, draft: null, created_at: NOW.toISOString(),
      signal: { id: 11, source: 'socrata-nyc-311', kind: 'civic', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', summary: withHeatMark('HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN'), url: null, city: 'New York City', state: 'NY', county: null, zip: '11220', occurred_at: NOW.toISOString(), expires_at: null, subtype: '311', categories: ['hvac'] },
    } as unknown as MatchRow;
    const admin = () => new FakeDb({
      holler_profiles: [{ user_id: 'u1', subscription_status: 'active', trial_ends_at: null }],
      holler_matches: [{ id: 1, user_id: 'u1', signal_id: 11 }],
      holler_signal_contacts: [{ id: 1, signal_id: 11, role: 'site', name: '', attn: null, address: '2300 block of WEST 52 STREET', city: 'New York City', state: 'NY', zip: '11220', phone: null, email: null, website: null }],
    });
    const memberDb = { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) }) } as never;
    for (const lang of ['en', 'es'] as const) {
      const out = await buildAlerts([m], { userId: 'u1', locked: false, db: memberDb, admin: admin() as never, siteUrl: 'https://holler.test', now: NOW.getTime(), trades: ['hvac'], lang });
      expect(out).toHaveLength(1);
      const [item] = await buildAlerts([m], { userId: 'u1', locked: false, db: memberDb, admin: admin() as never, siteUrl: 'https://holler.test', now: NOW.getTime(), trades: ['hvac'], lang });
      expect(item.contacts).toEqual([]);
      expect(item.building?.line).toBe(lang === 'en' ? 'Building: the 2300 block of WEST 52 STREET (the exact address is not published)' : 'Edificio: la cuadra 2300 de WEST 52 STREET (no se publica la dirección exacta)');
    }
    const [locked] = await buildAlerts([m], { userId: 'u1', locked: true, db: memberDb, admin: null, siteUrl: 'https://holler.test', now: NOW.getTime(), trades: ['hvac'] });
    expect(locked.building).toBeUndefined();
    expect(JSON.stringify(locked)).not.toMatch(/block of/);
  });

  it('the app renders the line under its own heading, never under "Organizations and public offices only"', () => {
    const src = readFileSync('mobile/src/screens/AlertParts.tsx', 'utf8');
    const fn = src.slice(src.indexOf('export function BuildingBlock'), src.indexOf('export function Contacts'));
    expect(fn).toContain('{building.heading}');
    expect(fn).toContain('{building.line}');
    expect(fn).not.toMatch(/Organizations and public offices only/);
    expect(readFileSync('mobile/src/screens/AlertDetail.tsx', 'utf8')).toContain('<BuildingBlock building={item.building} />');
    expect(readFileSync('app/api/m/feed/route.ts', 'utf8')).toContain('lang: langOfProfile(profile)');
    expect(readFileSync('app/api/m/alert/[signalId]/route.ts', 'utf8')).toContain('lang: langOfProfile(profile)');
  });
});

// ---- P3-2 ---------------------------------------------------------------------------------------------------------------------------
describe('P3-2: a block string with anything after the street, or a name for a street, is not block form', () => {
  const BUILT = ['2318 WEST 52 STREET', '41-20 BOWNE STREET', '300 PARK AVENUE SOUTH', '1234 GRAND CONCOURSE', '12 EAST 130 STREET', '500 AVENUE J', '500 ST MARKS PLACE', '12 SAINT JOHNS PLACE', '1 BROADWAY', '55 CENTRAL PARK WEST', '87-10 37 AVENUE', '2318 W 52ND ST', '10 WEST STREET', '665 PELHAM PARKWAY NORTH', '1500 ADAM CLAYTON POWELL JR BOULEVARD', '33 UNION SQUARE WEST', '12 JOHN STREET', '100 BEACH 20 STREET', '2318 SMITH STREET'].map((x) => nycBlockAddress(x));

  it('every block the New York rule writes is still block form (19 of 19)', () => {
    expect(BUILT.filter(Boolean)).toHaveLength(19);
    for (const b of BUILT) expect(isBlockForm(b), b).toBe(true);
    expect(isBlockForm('200 block of W VAN BUREN ST')).toBe(true);
    expect(isBlockForm('1200 BLOCK OF MAIN ST')).toBe(true);
  });

  it.each(['2300 block of WEST 52 STREET JOHN SMITH', '200 block of JOHN SMITH', '200 block of MAIN ST JANE DOE', '0-99 block of ZELDA QUIXOTE'])('%s is refused everywhere', (bad) => {
    expect(isBlockForm(bad)).toBe(false);
    expect(contactsAllowedFor('311', [{ role: 'site', name: '', address: bad }])).toEqual([]);
    expect(sanitizeContact({ role: 'site', name: '', address: bad })?.address ?? null).not.toBe(bad);
    const plan = outreachPlan({ source: 'socrata-nyc-311', kind: 'civic', city: 'New York City', state: 'NY' }, [{ role: 'site', name: '', address: bad }], 'en');
    expect(plan && plan.type === 'area' ? plan.building : null).toBeNull();
  });
});

// ---- P3-3 ---------------------------------------------------------------------------------------------------------------------------
describe('P3-3: "who acted" is cut only before a name or an officer or inspector title', () => {
  it.each([
    ['Initial by OFFICER KRUPKE', 'Initial'], ['Open by OFFICER KRUPKE', 'Open'], ['Open by Zelda Fitzgerald', 'Open'], ['Closed - per Inspector Smith', 'Closed'],
    ['Compliance, Inspector J. Doe', 'Compliance'], ['Assigned to Pat Kelly', ''], ['BLOCKED BY JOHN SMITH', 'BLOCKED'], ['Closed (by J. Doe)', 'Closed'],
    ['Closed by Inspector', 'Closed'], ['Officer KRUPKE', ''], ['Open by Zelda', 'Open'],
  ])('cut: %s', (raw, want) => expect(stripActor(raw)).toBe(want));

  it.each([
    'Sidewalk Blocked by Construction', 'SIDEWALK BLOCKED BY CONSTRUCTION', 'per code', 'Closed per code', 'Closed by owner request', 'Stand By', 'Agent Orange',
    'Blocked By Vehicle', 'Closed per Department of Buildings', 'Closed by Police', 'Resolved by DOB', 'Referred to Inspector', 'Det Garage', 'NOV SENT OUT', 'Initial',
  ])('kept whole: %s', (raw) => expect(stripActor(raw)).toBe(raw));
});

// ---- P3-4 ---------------------------------------------------------------------------------------------------------------------------
describe('P3-4: a name stored as only "<STATE> LLC" (the tail of "X HOMES OF <STATE> LLC") is not shown', () => {
  it('the rule and the member loader both drop it; whole subsidiary names still show', async () => {
    for (const x of ['TEXAS LLC', 'CALIFORNIA LLC', 'Georgia, LLC', 'North Texas, Inc.', 'DFW LLC']) {
      expect(cleanContractorName(x), x).toBeNull();
      expect(contactNameFor('contractor', x), x).toBeNull();
    }
    expect(cleanContractorName('LENNAR HOMES OF CALIFORNIA LLC')).toBe('LENNAR HOMES OF CALIFORNIA LLC');
    expect(cleanContractorName('ACME ROOFING LLC')).toBe('ACME ROOFING LLC');
    const loader = async () => new Map([[5, [{ signalId: 5, role: 'contractor', name: 'TEXAS LLC' }, { signalId: 5, role: 'contractor', name: 'LENNAR HOMES OF CALIFORNIA LLC' }] as unknown as ContactRecord[]]]);
    const got = await loadMemberContacts({ db: {} as never, userId: 'u1', signalIds: [5], loader });
    expect((got.get(5) ?? []).map((c) => c.name)).toEqual(['LENNAR HOMES OF CALIFORNIA LLC']);
  });
});

// ---- P3-5, P3-7, P3-8 ---------------------------------------------------------------------------------------------------------------
describe('P3-5, P3-7, P3-8', () => {
  it('P3-5: the web card passes the title, so a commercial sale shows its site (types and render)', () => {
    const item: ContactSignal = { source: 'carto-phl-sales', kind: 'civic', city: 'Philadelphia', state: 'PA', title: 'Commercial property sold in Philadelphia, PA' };
    const plan = outreachPlan(item, [{ role: 'site', name: '', address: '1500 MARKET ST', city: 'Philadelphia', state: 'PA', zip: '19102' }], 'en');
    expect(plan?.type).toBe('site');
    const html = renderToStaticMarkup(createElement(WhoToContact, { item, contacts: [{ role: 'site', name: '', address: '1500 MARKET ST', city: 'Philadelphia', state: 'PA', zip: '19102' }], lang: 'en' }));
    expect(html).toContain('1500 MARKET ST');
  });

  it('P3-7: Philadelphia MIXED USE is dropped, never read as commercial', () => {
    expect(['SINGLE FAMILY', 'MULTI FAMILY', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED USE', 'mixed use'].map(phlClassOf)).toEqual(['residential_single', 'multi_family', 'commercial', 'commercial', null, null]);
  });

  it('P3-8: a long builder name wraps', () => {
    expect(readFileSync('components/builders/active-builders.tsx', 'utf8')).toMatch(/className="break-words font-medium text-ink">\{b\.name\}/);
  });
});
