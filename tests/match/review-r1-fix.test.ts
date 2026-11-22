// Round 7 fix-a: regression tests for every P1 and P2 finding of /home/claude/gates/r7/review-r1.md, using the reviewer's own
// reproductions (the failing outputs on the earlier code are recorded in that report) plus the commander's decisions.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}) }));
vi.mock('@/components/feed/feedback-buttons', () => ({ FeedbackButtons: () => null }));

import { fakeTables } from './fake-table';
import { classifyPermit, type PermitFields } from '@/lib/signals/mapping/permit';
import { remapRow, remapStoredSignals, type StoredRuleRow } from '@/lib/signals/mapping/remap';
import { pruneStaleMatches, rematchSignals } from '@/lib/signals/rematch';
import { insertNewSignals, type SignalRowInput } from '@/lib/signals/store';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS, COBB_CENTER } from '@/lib/signals/adapters/arcgis-datasets';
import { parseJohnsCreek } from '@/lib/signals/adapters/arcgis-johnscreek';
import { parseCobb } from '@/lib/signals/adapters/arcgis-cobb';
import { categorize, parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { cutAfterStreetSuffix, looksLikeProse } from '@/lib/signals/adapters/permit-privacy';
import { parseNws } from '@/lib/signals/adapters/nws';
import { matchOne, matchSignals, type MatchProfile } from '@/lib/signals/match';
import { APPROX_MATCH_SLACK_MI, approxLocationNote } from '@/lib/signals/approx-location';
import { placeSlugFor } from '@/lib/signals/run';
import { CITY_FEEDS } from '@/lib/signals/capabilities';
import { placeLine } from '@/lib/check/group';
import { lookupZip } from '@/lib/geo';
import { Feed, type FeedItem } from '@/components/feed';
import type { CategoryId } from '@/lib/signals/categories';
import { feedReachMi, loadEmptyFeedData, type EmptyFeedProfile } from '@/lib/preview/empty-feed';
import { EmptyFeedView } from '@/components/feed/empty-feed';
import { fakeSignalsDb } from '../fixtures/fake-signals-db';

const NOW = new Date('2026-11-19T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const ds = (id: string) => ARCGIS_DATASETS.find((d) => d.id === id)!;
const sorted = (c: string[]) => [...c].sort();

// ---- P1 #1: different permits at one place and day are different records ------------------------------------------------------

describe('P1 dedupe: different permit or case numbers at one address on one day are all stored', () => {
  const dekalbFeature = (id: string, hour: number) => ({
    attributes: { applicationNumber: id, issuedDateTime: Date.UTC(2026, 10, 18, 12 + hour), WorkTypeDescription: 'Residential Air Conditioning', OccupancyTypeDescription: 'Single Family Dwelling', statusDescription: 'Issued', location: '100 MAIN ST, DECATUR GA 30030' },
    geometry: { x: -84.2901, y: 33.7402 },
  });

  it('repro A: three DeKalb HVAC permits (3190001..3) at one point one hour apart are all inserted', async () => {
    const rows = parseArcgis({ features: [dekalbFeature('3190001', 0), dekalbFeature('3190002', 1), dekalbFeature('3190003', 2)] }, ds('arcgis-dekalb-permits'));
    expect(rows).toHaveLength(3);
    const db = fakeTables({ holler_signals: [] }, { conflict: { holler_signals: ['source', 'external_id'] } });
    const log: string[] = [];
    const ins = await insertNewSignals(db, rows.map((r) => ({ ...r, placeSlug: null }) as SignalRowInput), { log: (m) => log.push(m), dedupe: true });
    expect(ins.map((r: any) => r.external_id).sort()).toEqual(['3190001', '3190002', '3190003']);
    expect(log.join(' ')).not.toMatch(/same record/);
  });

  it('repro B: two Johns Creek electrical permits in different suites at one point are both inserted', async () => {
    const f = (id: string, addr: string) => ({ attributes: { JobID: id, JobTypeDescription: 'Electrical', JobAddress: addr, JobStatus: 'Issued', ISSUE_DATE: Date.UTC(2026, 10, 18) }, geometry: { x: -84.2, y: 34.03 } });
    const rows = parseJohnsCreek({ features: [f('ELCT-26-0101', '100 Main Street STE 100'), f('ELCT-26-0102', '100 Main Street STE 220')] });
    expect(rows).toHaveLength(2);
    const db = fakeTables({ holler_signals: [] }, { conflict: { holler_signals: ['source', 'external_id'] } });
    const ins = await insertNewSignals(db, rows.map((r) => ({ ...r, placeSlug: null }) as SignalRowInput), { log: () => {}, dedupe: true });
    expect(ins.map((r: any) => r.external_id).sort()).toEqual(['ELCT-26-0101', 'ELCT-26-0102']);
  });

  it('migration 0013 deletes nothing (its PGlite test covers rows and matches)', () => {
    const sql = readFileSync('supabase/migrations/0013_holler_signal_dedupe.sql', 'utf8').replace(/^--.*$/gm, '');
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bupdate\s+\S+\s+set\b|\binsert\s+into\b|\btruncate\b/i);
  });
});

// ---- P1 #2: re-map creates matches only for a gained trade, and quietly --------------------------------------------------------

describe('P1 re-map: a title-only change never creates a match; a gained trade matches quietly', () => {
  const WINDOWS: MatchProfile = { user_id: 'win', categories: ['windows-doors'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
  const row = (over: Partial<StoredRuleRow> & { id: number; occurred_at?: string }) => ({
    source: 'arcgis-dekalb-permits', external_id: `E${over.id}`, kind: 'permit', title: 'Window and door permit in DeKalb County',
    summary: 'Residential Window Replacement | Single Family Dwelling | Issued', city: 'DeKalb County', state: 'GA', lat: 33.85, lon: -84.35,
    severity: 1, categories: ['windows-doors'], occurred_at: ago(2), expires_at: null, data: { subtype: 'permit' }, ...over,
  });

  it('repro: "Window and door permit" -> "Window permit" changes the title but gains nothing, so the scan pass matches nobody', async () => {
    const m = remapRow(row({ id: 1 }) as StoredRuleRow)!;
    expect(m.title).toBe('Window permit in DeKalb County');
    expect(m.changed).toBe(true);
    expect(m.gained).toEqual([]);
    const db = fakeTables({ holler_signals: [row({ id: 1 })], holler_matches: [], holler_profiles: [] });
    const rep = await remapStoredSignals(db, { now: NOW, rematch: (ids) => rematchSignals(db, ids, { now: NOW, profiles: [WINDOWS], quiet: true }), prune: async () => ({ removed: 0 }) });
    expect(rep.changed).toBe(1);
    expect(rep.rematched).toBe(0);
    expect(db.tables.holler_matches).toEqual([]);
    expect(db.tables.holler_signals[0].title).toBe('Window permit in DeKalb County');
  });

  it('a row that gains a trade is rematched with notified = true even when the record is new', async () => {
    // Summary names a re-roof, the stored categories said general-contractor only: roofing is gained.
    const r = row({ id: 2, title: 'Permit in DeKalb County', summary: 'Residential Re-Roof | Single Family Dwelling | Issued', categories: ['general-contractor'], occurred_at: ago(0.5) });
    const ROOFER: MatchProfile = { ...WINDOWS, user_id: 'roofer', categories: ['roofing'] };
    const db = fakeTables({ holler_signals: [r], holler_matches: [] });
    const rep = await remapStoredSignals(db, { now: NOW, rematch: (ids) => rematchSignals(db, ids, { now: NOW, profiles: [ROOFER], quiet: true }), prune: async () => ({ removed: 0 }) });
    expect(rep.rematched).toBe(1);
    expect(db.tables.holler_matches).toEqual([expect.objectContaining({ user_id: 'roofer', signal_id: 2, notified: true })]);
  });

  it('the default re-map pass asks rematchSignals for quiet matches', () => {
    const src = readFileSync('lib/signals/mapping/remap.ts', 'utf8');
    expect(src).toMatch(/rematchSignals\(db as never, ids, \{[^}]*quiet: true/);
  });
});

// ---- P1 #3: violation re-map reads only the classified text; stale un-notified matches go --------------------------------------

describe('P1 re-map: violations never classify the address; narrowed trades drop stale un-notified matches', () => {
  const austin = (address: string): StoredRuleRow => ({
    id: 1, source: 'socrata-austin-violations', city: 'Austin', title: 'Code violation in Austin: Trash and debris in yard',
    summary: `Trash and debris in yard | Open | ${address}`, categories: ['junk-removal'], data: { subtype: 'violation' },
  });
  for (const addr of ['3400 block of BALCONES DR', '1200 block of PINE TREE LN', '500 block of GRASS VALLEY RD', '0-99 block of BRICK ROW']) {
    it(`"${addr}" adds no trade`, () => {
      const r = remapRow(austin(addr))!;
      expect(r.categories).toEqual(['junk-removal']);
      expect(r.gained).toEqual([]);
      expect(r.changed).toBe(false);
    });
  }

  it('the stored water heater row titled "Plumbing permit" with no trade word in its summary stays plumbing only', () => {
    const r = remapRow({ id: 9, source: 'socrata-chicago-permits', city: 'Chicago', title: 'Plumbing permit in Chicago', summary: 'PERMIT - EASY PERMIT PROCESS | $3,000 job value', categories: ['plumbing', 'hvac'], data: { subtype: 'permit' } })!;
    expect(r.categories).toEqual(['plumbing']);
    expect(r.title).toBe('Plumbing permit in Chicago');
    expect(r.lost).toEqual(['hvac']);
  });

  it('a row re-mapped away from plumbing loses the plumber\'s un-notified match; notified matches stay', async () => {
    const PLUMBER: MatchProfile = { user_id: 'plumber', categories: ['plumbing'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
    const HVAC: MatchProfile = { ...PLUMBER, user_id: 'hvac', categories: ['hvac'] };
    const sig = { id: 5, source: 'arcgis-dekalb-permits', kind: 'permit', categories: ['hvac'], lat: 33.85, lon: -84.35, state: 'GA', severity: 1, occurred_at: ago(1), expires_at: null, title: 'HVAC permit in DeKalb County', summary: null, data: { subtype: 'permit' } };
    const db = fakeTables({
      holler_signals: [sig],
      holler_matches: [
        // status 'new' is the column default (0001); verify-v1 decision 3 deletes only untouched 'new' rows
        { id: 1, user_id: 'plumber', signal_id: 5, notified: false, status: 'new' },
        { id: 2, user_id: 'hvac', signal_id: 5, notified: false, status: 'new' },
        { id: 3, user_id: 'old-plumber', signal_id: 5, notified: true, status: 'new' },
      ],
    });
    const r = await pruneStaleMatches(db, [5], { now: NOW, profiles: [PLUMBER, HVAC, { ...PLUMBER, user_id: 'old-plumber' }] });
    expect(r).toEqual({ removed: 1 });
    expect(db.tables.holler_matches.map((m: any) => m.id).sort()).toEqual([2, 3]);
  });
});

// ---- P1 #4: water heater wordings are plumbing only -----------------------------------------------------------------------------

describe('P1 permit mapping: a water heater in any common wording is plumbing only', () => {
  const cases: [PermitFields, CategoryId[], string][] = [
    [{ structured: [], free: ['Replace 50 gal electric water heater'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['Water-heater replacement'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['REPLACE WATER  HEATER'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['Install heat pump water heater'] }, ['plumbing'], 'Water heater'],
    [{ structured: ['Mechanical'], free: ['Replace 50 gal water heater'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['new hot water heater'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['replace water heater (gas)'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['install 40 gallon natural gas water heater'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['Hybrid heat-pump water heater install'] }, ['plumbing'], 'Water heater'],
    [{ structured: [], free: ['WATERHEATER CHANGEOUT'] }, ['plumbing'], 'Water heater'],
    [{ structured: ['Water Heater'], free: [] }, ['plumbing'], 'Water heater'],
    [{ structured: ['Electrical'], free: ['replace water heater circuit'] }, ['electrical'], 'Electrical'],
    [{ structured: [], free: ['replace furnace and water heater'] }, ['plumbing', 'hvac'], 'Water heater and HVAC'],
    [{ structured: [], free: ['Replace HVAC unit and condensate drain line'] }, ['hvac'], 'HVAC'],
  ];
  for (const [f, cats, label] of cases) {
    it(`${JSON.stringify(f)} -> ${label}`, () => {
      const r = classifyPermit(f, 'Chicago');
      expect(sorted(r.categories)).toEqual(sorted(cats));
      expect(r.label).toBe(label);
    });
  }
});

// ---- P1 #5: street, business and surname nouns never pick a trade ---------------------------------------------------------------

describe('P1 permit mapping: Atlanta Name (address, description or name) gives a trade only for an unambiguous work phrase', () => {
  const atl = ds('arcgis-atlanta-permits');
  const feat = (name: string, type: string, i: number) => ({
    attributes: { RecordID: `BB-T${i}`, Opend: Date.UTC(2026, 10, 12), Name: name, TypeCombo: type, Subtype: '', Use_: '', Address: '1 MAIN ST NE' },
    geometry: { x: -84.39, y: 33.75 },
  });
  // [Name, TypeCombo, expected categories, expected title]
  const TRAPS: [string, string, CategoryId[], string][] = [
    // the reviewer's examples
    ['456 PINE TREE DR NE', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['DOLLAR TREE #4411 INTERIOR ALTERATION', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['LUXE NAIL SPA', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['POOL RESIDENCE', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    // 20+ more street, business and surname traps
    ['ROOFING SUPPLY CO STOREFRONT ALTERATION', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['POOLE RESIDENCE', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    ['12 BRICK ROW', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['88 GRASS VALLEY RD', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['40 PLUMB ST SW', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    ['GARDNER RESIDENCE', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['MASON RESIDENCE', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['GLASS RESIDENCE KITCHEN', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    ['PAYNTER ADDITION', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['300 FENCE RD', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['15 SOLAR DR', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    ['ROOFER RESIDENCE', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    ['WINDOW WORLD STOREFRONT', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['ATLANTA ELECTRIC SUPPLY BUILDOUT', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['SIGNS NOW TENANT SPACE', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['THE FLOOR STORE', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['HOT TUB TIME BAR', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['ORCHARD TREE APARTMENTS', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    ['PEACHTREE CENTER TOWER', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['CHIMNEY SWEEP CO OFFICE', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['DOOR DASH KITCHEN', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['SPA SIDNEY', 'Commercial Alteration', ['general-contractor'], 'Tenant fit-out permit in Atlanta'],
    ['GUTTERMAN RESIDENCE', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    ['STUMP RESIDENCE', 'Residential Addition', ['general-contractor'], 'Addition permit in Atlanta'],
    // unambiguous work phrases still count, and keep the general contractor the type column gave (verify-v1 decision 1)
    ['SMITH RESIDENCE REROOF', 'Residential Alteration', ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
    ['Roof Replacement (RES)', 'Residential Alteration', ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
    ['NEW SWIMMING POOL', 'Residential Addition', ['pool-spa', 'general-contractor'], 'Pool and addition permit in Atlanta'],
    ['TREE REMOVAL REAR YARD', 'Residential Alteration', ['tree-service', 'general-contractor'], 'Tree removal and remodel permit in Atlanta'],
    // a water heater is not one of the allowed Name-column phrases any more: the AI step refines it
    ['REPLACE WATER HEATER', 'Residential Alteration', ['general-contractor'], 'Remodel permit in Atlanta'],
    ['INSTALL 12 SOLAR PANELS', 'Residential Alteration', ['solar', 'general-contractor'], 'Solar and remodel permit in Atlanta'],
  ];
  it('has the reviewer examples plus at least 20 more traps', () => {
    expect(TRAPS.filter(([, , c]) => c.length === 1 && c[0] === 'general-contractor').length).toBeGreaterThanOrEqual(24);
  });
  TRAPS.forEach(([name, type, cats, title], i) => {
    it(`"${name}" / ${type} -> ${title}`, () => {
      const [r] = parseArcgis({ features: [feat(name, type, i)] }, atl);
      expect(r, name).toBeDefined();
      expect(sorted(r.categories)).toEqual(sorted(cats));
      expect(r.title).toBe(title);
    });
  });

  it('description text: solar panels on the roof are not roof work, and a business named Restoration is not damage repair', () => {
    expect(classifyPermit({ structured: [], free: ['Install 20 solar panels on existing roof'] }).categories).toEqual(['solar']);
    expect(classifyPermit({ structured: [], free: ['wall sign for Restoration Hardware'] }).categories).toEqual(['signs-printing']);
    expect(classifyPermit({ structured: [], free: ['Reroof house at 12 Pine Tree Dr'] }).categories).toEqual(['roofing']);
    expect(classifyPermit({ structured: [], free: ['tenant fit-out for Luxe Nail Spa'] }).categories).toEqual(['general-contractor']);
    expect(classifyPermit({ structured: [], free: ['Dollar Tree interior alteration'] }).categories).toEqual(['general-contractor']);
    expect(classifyPermit({ structured: [], free: ['ABC Roofing Supply Co storefront alteration'] }).categories).not.toContain('roofing');
  });
});

// ---- P1 #6: Cobb County rows -----------------------------------------------------------------------------------------------------

describe('P1 Cobb County: matched across the county, labelled as approximate, never on a city page', () => {
  const cobbRow = { id: 77, source: 'arcgis-cobb-residential-permits', categories: ['general-contractor'], lat: COBB_CENTER.lat, lon: COBB_CENTER.lon, state: 'GA', severity: 1, occurred_at: ago(1), data: { subtype: 'permit', loc: 'approx' } };
  const at = (zip: string, radius: number): MatchProfile => {
    const z = lookupZip(zip)!;
    return { user_id: zip, categories: ['general-contractor'], lat: z.lat, lon: z.lon, state: 'GA', radius_mi: radius };
  };

  it('Austell 30168 and Acworth 30101 at 10 miles get Cobb permits; no distance is kept', () => {
    for (const zip of ['30168', '30101', '30060']) {
      const m = matchOne(cobbRow, at(zip, 10));
      expect(m, zip).not.toBeNull();
      expect(m!.distance_mi).toBeNull();
    }
  });

  it('the slack is 15 miles past the radius, measured from the county-seat stand-in', () => {
    expect(APPROX_MATCH_SLACK_MI).toBe(15);
    const far: MatchProfile = { user_id: 'far', categories: ['general-contractor'], lat: COBB_CENTER.lat + 26 / 69, lon: COBB_CENTER.lon, state: 'GA', radius_mi: 10 };
    expect(matchOne(cobbRow, far)).toBeNull(); // 26 mi > 10 + 15
    expect(matchOne(cobbRow, { ...far, lat: COBB_CENTER.lat + 24 / 69 })).not.toBeNull();
    // the matcher used by the scan and rematch knows Cobb by source alone
    expect(matchSignals([{ ...cobbRow, data: { subtype: 'permit' } }], [at('30168', 10)])).toHaveLength(1);
  });

  it('a Cobb row gets no place slug and no city page claims the Cobb feeds', () => {
    const rows = parseCobb({ features: [{ attributes: { PermitNo: 'R1', DateIssued: Date.UTC(2026, 10, 12), PermitType: 'New Home', StreetNo: '1', StreetName: 'MAIN', StreetType: 'ST' } }] }, ds('arcgis-cobb-residential-permits'));
    expect(rows).toHaveLength(1);
    expect(placeSlugFor(rows[0])).toBeNull();
    const dekalbRow = { ...rows[0], source: 'arcgis-dekalb-permits', lat: 33.77, lon: -84.29, data: { subtype: 'permit' } };
    expect(placeSlugFor(dekalbRow)).not.toBeNull();
    expect(CITY_FEEDS['marietta-ga'] ?? []).not.toContain('permit');
  });

  it('the label is plain, has no distance, and shows on the web card, the check line and the app place line', () => {
    const note = approxLocationNote({ city: 'Cobb County' });
    // verify-v1 decision 4: the card prints the street address, so the note says what is missing (a map point)
    expect(note).toBe("In Cobb County. The county's feed has a street address but no map point, so no distance is shown.");
    expect(placeLine({ source: 'arcgis-cobb-commercial-permits', place: 'Cobb County, GA' })).toBe(note);
    expect(placeLine({ source: 'arcgis-dekalb-permits', place: 'DeKalb County, GA' })).toBe('DeKalb County, GA');
    const item: FeedItem = {
      id: 1, status: 'new', kind: 'permit', source: 'arcgis-cobb-residential-permits', title: 'New home permit in Cobb County', summary: 'New Home | Cobb County',
      url: null, distance: '2 mi', place: 'Cobb County, GA', ago: '1h', occurredAt: ago(0.1), draft: null, approxNote: note,
    };
    const html = renderToStaticMarkup(createElement(Feed, { items: [item], cityPage: null }));
    expect(html).toContain(note.replace(/'/g, '&#x27;')); // React escapes the apostrophe
    expect(html).not.toContain('2 mi');
    const page = readFileSync('app/app/page.tsx', 'utf8');
    expect(page).toMatch(/approxNote: hasApproxLocation\(s\) \? approxLocationNote\(s\) : null/);
    const mobile = readFileSync('lib/mobile/feed.ts', 'utf8');
    expect(mobile).toMatch(/place: hasApproxLocation\(s\) \? approxLocationNote\(s\)/);
  });
});

// ---- P2 #7: roof leaks in any wording are roof work ---------------------------------------------------------------------------

describe('P2 violations: a roof leak in any wording adds no plumbing', () => {
  const v = { subtype: 'violation' } as const;
  for (const t of ['roof leak', 'ROOF LEAKS', 'leaking roof', 'leaky roof', 'Roof is leaking into unit 2', 'leak in roof', 'roof/ceiling leak', 'roof  leak']) {
    it(`"${t}"`, () => expect(categorize(v, t).categories).not.toContain('plumbing'));
  }
  for (const t of ['PLUMBING LEAK', 'Water leak from ceiling', 'leaking pipe under sink', 'roof leak and leaking toilet supply line']) {
    it(`"${t}" is still plumbing`, () => expect(categorize(v, t).categories).toContain('plumbing'));
  }
});

// ---- P2 #8: paged reads ---------------------------------------------------------------------------------------------------------

describe('P2 rematch: the existing-pairs read is paged past the 1000-row response cap', () => {
  it('pairs past row 1000 still count as existing, so they cannot use up the 25 cap', async () => {
    const P: MatchProfile = { user_id: 'me', categories: ['plumbing'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
    const signals = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, source: 'arcgis-dekalb-permits', kind: 'permit', categories: ['plumbing'], lat: 33.85, lon: -84.35, state: 'GA', severity: 1, occurred_at: ago(i < 25 ? 0.5 : 1), expires_at: null, title: 't', summary: null, data: { subtype: 'permit' } }));
    const matches: any[] = [];
    let id = 1;
    for (let k = 0; k < 1100; k++) matches.push({ id: id++, user_id: `other${k}`, signal_id: 1 + (k % 25) });
    for (let s = 1; s <= 25; s++) matches.push({ id: id++, user_id: 'me', signal_id: s }); // the 25 newest are already mine, after row 1100
    const db = fakeTables({ holler_signals: signals, holler_matches: matches }, { maxRows: 1000 });
    const r = await rematchSignals(db, signals.map((s) => s.id), { now: NOW, profiles: [P] });
    expect(r.created).toBe(5); // the 5 I do not have yet
  });

  it('store.ts no longer reads with a fixed row limit for de-duplication', () => {
    expect(readFileSync('lib/signals/store.ts', 'utf8')).not.toMatch(/DEDUPE_READ_LIMIT/);
    expect(readFileSync('lib/signals/rematch.ts', 'utf8')).not.toMatch(/limit\(10_000\)/);
  });
});

// ---- P2 #10: violation and 311 public text ------------------------------------------------------------------------------------

describe('P2 public text: names in violation and 311 text and in address columns never reach a public row', () => {
  const sds = (id: string) => SOCRATA_DATASETS.find((d) => d.id === id)!;

  it('Austin violation description with names and a phone gives a fixed title', () => {
    const [r] = parseSocrata(
      [{ case_id: 'CV-1', opened_date: '2026-11-18T10:00:00.000', description: 'John Doe reports roof leak at rear unit, tenant Maria Lopez 512-555-1212', case_type: 'Structure Condition', status: 'Open', address: '1500 E 12TH ST', zip_code: '78702', latitude: '30.27', longitude: '-97.72' }],
      sds('socrata-austin-violations'),
    );
    expect(r).toBeDefined();
    const pub = `${r.title}\n${r.summary ?? ''}\n${JSON.stringify(r.data)}`;
    expect(pub).not.toMatch(/John|Doe|Maria|Lopez|512/);
    expect(r.title).toMatch(/^Code violation in Austin: /);
  });

  it('Oakland 311 description "reported by John Doe" is never printed', () => {
    const [r] = parseSocrata(
      [{ requestid: 'OAK-1', datetimeinit: '2026-11-18T10:00:00.000', reqcategory: 'ILLDUMP', description: 'Mattress on sidewalk reported by John Doe', status: 'Open', zipcode: '94607', reqaddress: { latitude: '37.80', longitude: '-122.27' } }],
      sds('socrata-oakland-311'),
    );
    expect(r).toBeDefined();
    expect(`${r.title}\n${r.summary ?? ''}`).not.toMatch(/John|Doe/);
  });

  it('addresses are cut after the street suffix', () => {
    expect(cutAfterStreetSuffix('123 MAIN ST NE - SMITH RESIDENCE')).toBe('123 MAIN ST NE');
    expect(cutAfterStreetSuffix('1200 block of MEMORIAL DR JOHN DOE')).toBe('1200 block of MEMORIAL DR');
    expect(cutAfterStreetSuffix('100 MAIN ST, DECATUR GA 30030')).toBe('100 MAIN ST, DECATUR GA 30030');
    expect(cutAfterStreetSuffix('100 Main Street STE 220')).toBe('100 Main Street STE 220');
    expect(cutAfterStreetSuffix('100 N STATE')).toBe('100 N STATE');
    const [atl] = parseArcgis(
      { features: [{ attributes: { RecordID: 'BB-1', Opend: Date.UTC(2026, 10, 12), Name: 'REROOF', TypeCombo: 'Residential Alteration', Address: '123 MAIN ST NE - SMITH RESIDENCE' }, geometry: { x: -84.39, y: 33.75 } }] },
      ds('arcgis-atlanta-permits'),
    );
    expect(atl.summary ?? '').not.toMatch(/SMITH/);
    const [dek] = parseArcgis(
      { features: [{ attributes: { applicationNumber: 'C-1', addedDateTime: Date.UTC(2026, 10, 18), codeViolations_0__description: 'Junk and debris', address_streetNumber: '1234', address_streetName: 'MEMORIAL DR JOHN DOE', address_suffix: '' }, geometry: { x: -84.29, y: 33.75 } }] },
      ds('arcgis-dekalb-violations'),
    );
    expect(dek.summary ?? '').not.toMatch(/JOHN|DOE/);
  });

  it('categorical values are still printed', () => {
    expect(looksLikeProse('Illegal Dumping Reports')).toBe(false);
    expect(looksLikeProse('RODENT HARBORAGE AND ACCUMULATION OF RUBBISH AT REAR YARD')).toBe(false);
    expect(looksLikeProse('60642')).toBe(false);
    expect(looksLikeProse('John Doe reports roof leak')).toBe(true);
    expect(looksLikeProse('call 404-555-1212')).toBe(true);
  });
});

// ---- P2 #11: Lake Wind Advisory -------------------------------------------------------------------------------------------------

describe('P2 NWS: a Lake Wind Advisory is a boating product and is skipped', () => {
  const alert = (geometry: unknown) => ({
    id: 'https://api.weather.gov/alerts/urn:oid:lw.1',
    geometry,
    properties: {
      id: 'urn:oid:lw.1', '@id': 'https://api.weather.gov/alerts/urn:oid:lw.1', event: 'Lake Wind Advisory', status: 'Actual', messageType: 'Alert',
      areaDesc: 'Lake area', geocode: { UGC: ['SCZ016', 'GAZ040'] }, sent: '2026-11-19T10:00:00-05:00', effective: '2026-11-19T10:00:00-05:00',
      expires: '2026-11-19T18:00:00-05:00', severity: 'Minor', headline: 'Lake Wind Advisory issued', description: 'Test.',
    },
  });
  it('with zones only and with a polygon', () => {
    expect(parseNws({ features: [alert(null)] })).toEqual([]);
    expect(parseNws({ features: [alert({ type: 'Polygon', coordinates: [[[-84, 34], [-83.9, 34], [-83.9, 34.1], [-84, 34]]] })] })).toEqual([]);
    expect(parseNws({ features: [{ ...alert(null), properties: { ...alert(null).properties, event: 'Wind Advisory' } }] }).length).toBeGreaterThan(0);
  });
});

// ---- item 5: AI notes and scores use the plan-limited trades ---------------------------------------------------------------------

describe('app page: AI notes and scores use the trades the plan covers', () => {
  it('passes matchScope(profile).categories, not profile.categories', () => {
    const src = readFileSync('app/app/page.tsx', 'utf8');
    expect(src).toMatch(/const trades = matchScope\(profile\)\.categories;/);
    expect(src).toMatch(/notesFor\(admin, ids, trades\), scoresFor\(admin, ids, trades\)/);
    expect(src).not.toMatch(/const trades = profile\.categories/);
  });
});

// ---- P2 #9: empty feed ---------------------------------------------------------------------------------------------------------

describe('P2 empty feed: a saved trade is never "not picked", and only feeds that can reach the radius are listed', () => {
  const NOW2 = new Date('2026-11-19T12:00:00Z');
  const smyrna = lookupZip('30080')!;
  const hvacRow = (id: number) => ({
    id, source: 'arcgis-dekalb-permits', kind: 'permit', title: 'HVAC permit in DeKalb County', categories: ['hvac'], lat: smyrna.lat + 0.01, lon: smyrna.lon,
    state: 'GA', severity: 1, occurred_at: ago(2), expires_at: null, data: { subtype: 'permit' },
  });
  const dbOf = (rows: any[]) => {
    const base = fakeSignalsDb(rows, { now: NOW2 });
    return {
      rpc: base.rpc,
      from(table: string) {
        if (table === 'holler_source_health') {
          const q: any = { select: () => q, in: () => Promise.resolve({ data: [], error: null }) };
          return q;
        }
        return base.from(table);
      },
    };
  };
  const noCheck = async () => ({ ok: true, items: [], checkedAt: NOW2.toISOString() });

  it('repro (a): a Solo member with 6 saved trades never sees the 6th under "trades you have not picked"', async () => {
    const profile: EmptyFeedProfile = {
      categories: ['roofing', 'siding-gutters', 'windows-doors', 'painting', 'flooring', 'hvac'], lat: smyrna.lat, lon: smyrna.lon, state: 'GA',
      zip: '30080', radius_mi: 25, plan: 'starter', subscription_status: 'active', extra_areas: [], keywords: [],
    };
    const data = await loadEmptyFeedData(profile, { db: dbOf([hvacRow(1), hvacRow(2), hvacRow(3)]) as any, now: NOW2, loadCheck: noCheck });
    expect(data.otherTrades.map((t) => t.trade)).not.toContain('hvac');
    expect(data.planLimited).toEqual(['hvac']);
    expect(data.planTrades).toBe(5);
    const html = renderToStaticMarkup(createElement(EmptyFeedView, { data, now: NOW2.getTime() }));
    expect(html).not.toMatch(/trades you have not picked/);
    expect(html).toContain('Your plan sends alerts for 5 of your saved trades. Not included now:');
  });

  it('repro (b): Smyrna at 5 miles no longer lists DeKalb or Atlanta; Newnan at 10 miles no longer lists Atlanta', async () => {
    const at = (zip: string, radius: number): EmptyFeedProfile => {
      const z = lookupZip(zip)!;
      return { categories: ['roofing'], lat: z.lat, lon: z.lon, state: 'GA', zip, radius_mi: radius, plan: 'starter', subscription_status: 'active', extra_areas: [], keywords: [] };
    };
    const smy = await loadEmptyFeedData(at('30080', 5), { db: dbOf([]) as any, now: NOW2, loadCheck: noCheck });
    const ids = smy.local.map((s) => s.id);
    expect(ids).not.toContain('arcgis-dekalb-permits');
    expect(ids).not.toContain('arcgis-dekalb-violations');
    expect(ids).not.toContain('arcgis-atlanta-permits');
    expect(ids).toContain('arcgis-cobb-residential-permits'); // Cobb rows match within radius + 15 miles of the county seat
    const newnan = await loadEmptyFeedData(at('30263', 10), { db: dbOf([]) as any, now: NOW2, loadCheck: noCheck });
    expect(newnan.local.map((s) => s.id)).not.toContain('arcgis-atlanta-permits');
    expect(feedReachMi('arcgis-atlanta-permits', 10)).toBe(10);
    expect(feedReachMi('arcgis-cobb-residential-permits', 10)).toBe(25);
  });
});
