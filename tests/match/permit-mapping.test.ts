// Round 7 MATCH: one classification for a permit's trades and its title label. Values are real-shaped (assumed from each portal's
// published type vocabulary and typical applicant descriptions; DeKalb WorkTypeDescription values from arcgis-datasets.ts notes).
import { describe, expect, it } from 'vitest';
import { classifyPermit, permitTitleFor, PERMIT_KINDS, PERMIT_TRADES, type PermitFields } from '@/lib/signals/mapping/permit';
import type { CategoryId } from '@/lib/signals/categories';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { PERMIT_RULES, SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { CAT_V } from '@/lib/signals/mapping/version';

type Case = [structured: string[], free: string[], cats: CategoryId[], label: string | null];

const S = (...v: string[]) => v;

/** [structured values, description values, expected categories (exact, any order), expected title label]. */
const CASES: Case[] = [
  // ---- roofing ----
  [S('Re-Roof'), [], ['roofing'], 'Roof'],
  [S('Residential Re-Roof'), [], ['roofing'], 'Roof'],
  [S('Reroof'), [], ['roofing'], 'Roof'],
  [S('REROOF'), [], ['roofing'], 'Roof'],
  [S('Roof Replacement'), [], ['roofing'], 'Roof'],
  [S('Roofing'), [], ['roofing'], 'Roof'],
  [S('Commercial Roofing'), [], ['roofing'], 'Roof'],
  [S('Roof Repair'), [], ['roofing'], 'Roof'],
  [S('Building Permit', 'Roofing'), [], ['roofing'], 'Roof'],
  [S('Residential', 'Re-roof'), [], ['roofing'], 'Roof'],
  [S('PERMIT - EASY PERMIT PROCESS'), ['TEAR OFF AND REROOF 1 LAYER'], ['roofing'], 'Roof'],
  [S('PERMIT - EASY PERMIT PROCESS'), ['REMOVE AND REPLACE ASPHALT SHINGLES ON GARAGE'], ['roofing'], 'Roof'],
  [S('Building Permit'), ['Replace shingle roof, same for same'], ['roofing'], 'Roof'],
  [S('PERMIT - RENOVATION/ALTERATION'), ['REROOF'], ['roofing'], 'Roof'],
  [S('Alteration'), ['tear off existing shingles and install new architectural shingles'], ['roofing'], 'Roof'],
  [S(''), ['re-roof single family house'], ['roofing'], 'Roof'],
  [S(''), ['roof replacement'], ['roofing'], 'Roof'],
  [S('Roof Covering'), [], ['roofing'], 'Roof'],
  [S('Re-Roof Commercial'), [], ['roofing'], 'Roof'],
  [S('Residential Roof Mount Solar'), [], ['solar'], 'Solar'],
  [S('Electrical'), ['install 7.2 kW roof mounted PV system'], ['electrical'], 'Electrical'],
  [S(''), ['install roof mounted solar panels'], ['solar'], 'Solar'],
  [S('Mechanical'), ['replace rooftop unit'], ['hvac'], 'HVAC'],
  [S(''), ['replace 2 roof top units'], ['hvac'], 'HVAC'],
  [S(''), ['add roof deck with railing'], ['general-contractor'], 'Deck'],
  // ---- HVAC ----
  [S('Residential Air Conditioning', 'Single Family Dwelling'), [], ['hvac'], 'HVAC'],
  [S('Commercial Air Conditioning', 'Business'), [], ['hvac'], 'HVAC'],
  [S('Mechanical'), [], ['hvac'], 'HVAC'],
  [S('HVAC'), [], ['hvac'], 'HVAC'],
  [S('HVAC Change-Out'), [], ['hvac'], 'HVAC'],
  [S('Mechanical Systems'), [], ['hvac'], 'HVAC'],
  [S('Boiler Equipment'), [], ['hvac'], 'HVAC'],
  [S('Furnace Replacement'), [], ['hvac'], 'HVAC'],
  [S('Heat Pump'), [], ['hvac'], 'HVAC'],
  [S(''), ['change out 3 ton heat pump and air handler'], ['hvac'], 'HVAC'],
  [S(''), ['replace furnace and ductwork'], ['hvac'], 'HVAC'],
  [S(''), ['install ductless mini split'], ['hvac'], 'HVAC'],
  [S(''), ['new gas heater in garage'], ['hvac'], 'HVAC'],
  [S('Protection and Mechanical Methods'), [], [], null],
  // ---- water heater and plumbing (the mislabelled shape) ----
  [S('Residential Water Heater', 'Single Family Dwelling'), [], ['plumbing'], 'Water heater'],
  [S('Water Heater'), [], ['plumbing'], 'Water heater'],
  [S('Water Heater Replacement'), [], ['plumbing'], 'Water heater'],
  [S('Plumbing'), ['replace 50 gal gas water heater'], ['plumbing'], 'Plumbing'],
  [S(''), ['replace water heater and sewer lateral'], ['plumbing'], 'Water heater'],
  [S(''), ['install tankless water heater'], ['plumbing'], 'Water heater'],
  [S('Residential Plumbing'), [], ['plumbing'], 'Plumbing'],
  [S('Plumbing'), [], ['plumbing'], 'Plumbing'],
  [S('Sewer Line Replacement'), [], ['plumbing'], 'Plumbing'],
  [S('Sewer Repair'), [], ['plumbing'], 'Plumbing'],
  [S('Backflow Preventer'), [], ['plumbing'], 'Plumbing'],
  [S('Gas Line'), [], ['plumbing'], 'Plumbing'],
  [S('Residential Gas Piping'), [], ['plumbing'], 'Plumbing'],
  [S('Water Service'), [], ['plumbing'], 'Plumbing'],
  [S(''), ['repipe house with pex'], ['plumbing'], 'Plumbing'],
  [S(''), ['replace septic tank'], ['plumbing'], 'Plumbing'],
  [S('Mechanical/Plumbing'), [], ['hvac', 'plumbing'], 'HVAC and plumbing'],
  [S('Combination Mechanical and Plumbing'), [], ['hvac', 'plumbing'], 'HVAC and plumbing'],
  // ---- electrical ----
  [S('Residential Electrical'), [], ['electrical'], 'Electrical'],
  [S('Commercial Electrical'), [], ['electrical'], 'Electrical'],
  [S('Electrical'), [], ['electrical'], 'Electrical'],
  [S('Electrical Service Upgrade'), [], ['electrical'], 'Electrical'],
  [S(''), ['upgrade panel to 200 amp'], ['electrical'], 'Electrical'],
  [S(''), ['panel upgrade 100 to 200 amp'], ['electrical'], 'Electrical'],
  [S(''), ['install level 2 EV charger in garage'], ['electrical'], 'Electrical'],
  [S('Generator'), [], ['electrical'], 'Electrical'],
  [S(''), ['install whole house standby generator'], ['electrical'], 'Electrical'],
  [S('Low Voltage'), [], ['electrical'], 'Electrical'],
  [S('Temporary Power Pole'), [], ['electrical'], 'Electrical'],
  [S(''), ['rewire kitchen'], ['electrical'], 'Electrical'],
  // ---- solar, pool, fence, concrete, windows, siding, flooring, sign, painting ----
  [S('Solar'), [], ['solar'], 'Solar'],
  [S('Solar Photovoltaic'), [], ['solar'], 'Solar'],
  [S('PV System'), [], ['solar'], 'Solar'],
  [S(''), ['install rooftop solar photovoltaic array'], ['solar'], 'Solar'],
  [S('Swimming Pool'), [], ['pool-spa'], 'Pool'],
  [S('Pool'), [], ['pool-spa'], 'Pool'],
  [S('Residential Pool and Spa'), [], ['pool-spa'], 'Pool'],
  [S(''), ['install new in-ground swimming pool and spa'], ['pool-spa'], 'Pool'],
  [S('Fence'), [], ['fencing'], 'Fence'],
  [S('Fence Permit'), [], ['fencing'], 'Fence'],
  [S('Residential Fence'), [], ['fencing'], 'Fence'],
  [S(''), ['install 6 ft privacy fence'], ['fencing'], 'Fence'],
  [S('FENDRIVE'), [], ['fencing', 'concrete-paving'], 'Fence and concrete'],
  [S('Driveway'), [], ['concrete-paving'], 'Concrete'],
  // Round 15 quality gate (Q-grades #6/#7/#40): street-side work types name no trade. Curb Cut was Concrete before; now dropped with the others.
  [S('Curb Cut'), [], [], null],
  [S('Supported Scaffold'), [], [], null],
  [S('Construction Fence'), [], [], null],
  [S('Sprinklers'), [], [], null],
  [S('Standpipe'), [], [], null],
  [S(''), ['replace concrete driveway and sidewalk'], ['concrete-paving'], 'Concrete'],
  [S('Sidewalk Shed'), [], [], null],
  [S('Window Replacement'), [], ['windows-doors'], 'Window'],
  [S('Garage Door'), [], ['windows-doors'], 'Door'],
  [S(''), ['replace windows and siding on single family dwelling'], ['windows-doors', 'siding-gutters'], 'Window and siding'],
  [S(''), ['replace 12 windows and entry door'], ['windows-doors'], 'Window'],
  [S(''), ['install new vinyl siding and gutters'], ['siding-gutters'], 'Siding'],
  [S(''), ['replace gutters and downspouts'], ['siding-gutters'], 'Gutter'],
  [S('Siding'), [], ['siding-gutters'], 'Siding'],
  [S(''), ['install hardwood flooring'], ['flooring'], 'Flooring'],
  [S(''), ['interior renovation 6th floor office'], ['general-contractor'], 'Remodel'],
  [S('Sign'), [], ['signs-printing'], 'Sign'],
  [S('Signs'), [], ['signs-printing'], 'Sign'],
  [S('PERMIT - SIGNS'), ['install illuminated wall sign'], ['signs-printing'], 'Sign'],
  [S('Wall Sign'), [], ['signs-printing'], 'Sign'],
  [S(''), ['exterior painting of building'], ['painting'], 'Painting'],
  [S('Plumbing'), ['replace sump pump'], ['plumbing'], 'Plumbing'],
  // ---- tree, demolition, landscaping, restoration ----
  [S('Tree Removal'), [], ['tree-service'], 'Tree removal'],
  [S('Tree Permit'), [], ['tree-service'], 'Tree removal'],
  [S(''), ['remove 2 dead oak trees'], ['tree-service'], 'Tree removal'],
  [S(''), ['remove 3 trees in rear yard'], ['tree-service'], 'Tree removal'],
  [S('Demolition'), [], ['junk-removal'], 'Demolition'],
  [S('Full Demolition'), [], ['junk-removal'], 'Demolition'],
  [S('PERMIT - WRECKING/DEMOLITION'), [], ['junk-removal'], 'Demolition'],
  [S('Residential Demolition'), [], ['junk-removal'], 'Demolition'],
  [S(''), ['demolish single family house'], ['junk-removal'], 'Demolition'],
  [S('Retaining Wall'), [], ['landscaping'], 'Retaining wall'],
  [S('Retaining Walls'), [], ['landscaping'], 'Retaining wall'],
  [S('Irrigation'), [], ['landscaping'], 'Landscaping'],
  [S(''), ['landscape and hardscape improvements'], ['landscaping'], 'Landscaping'],
  [S('Fire Damage Repair'), [], ['restoration'], 'Damage repair'],
  [S(''), ['repair water damage to kitchen ceiling'], ['restoration'], 'Damage repair'],
  [S('Mold Remediation'), [], ['restoration'], 'Damage repair'],
  // ---- generic building permits: general-contractor only, never cleaning or landscaping ----
  [S('Building Permit'), [], ['general-contractor'], 'Building'],
  [S('Building'), [], ['general-contractor'], 'Building'],
  [S('Residential Building'), [], ['general-contractor'], 'Building'],
  [S('Commercial Building'), [], ['general-contractor'], 'Building'],
  [S('General Construction'), [], ['general-contractor'], 'Building'],
  [S('New Construction', 'Single Family Dwelling'), [], ['general-contractor'], 'New construction'],
  [S('New Construction', 'Business'), [], ['general-contractor'], 'New construction'],
  [S('New'), [], ['general-contractor'], 'New construction'],
  [S('New Commercial'), [], ['general-contractor'], 'New construction'],
  [S(''), ['New single family residence'], ['general-contractor', 'real-estate', 'moving'], 'New home'],
  [S('Building Permit', 'New'), ['Construct new 2-story single family dwelling with attached garage'], ['general-contractor', 'real-estate', 'moving'], 'New home'],
  [S('New Construction', 'Single Family Dwelling'), ['detached garage'], ['general-contractor'], 'New construction'],
  [S('Building Permit'), ['Construct new 2-story single family dwelling with attached garage'], ['general-contractor', 'real-estate', 'moving'], 'New home'],
  [S('Additions to Existing Structures'), [], ['general-contractor'], 'Addition'],
  [S('Residential Addition'), [], ['general-contractor'], 'Addition'],
  [S('Alterations/Repairs'), [], ['general-contractor'], 'Remodel'],
  [S('Interior Alteration'), [], ['general-contractor'], 'Remodel'],
  [S('Remodel'), [], ['general-contractor'], 'Remodel'],
  [S('Renovation'), [], ['general-contractor'], 'Remodel'],
  [S('Tenant Fit-Out'), [], ['general-contractor'], 'Tenant fit-out'],
  [S('Tenant Improvement'), [], ['general-contractor'], 'Tenant fit-out'],
  [S('Commercial Tenant Finish'), [], ['general-contractor'], 'Tenant fit-out'],
  [S('Tenant Build-Out'), [], ['general-contractor'], 'Tenant fit-out'],
  [S('Interior Remodel'), ['remodel kitchen, new electrical and plumbing'], ['plumbing', 'electrical', 'general-contractor'], 'Plumbing, electrical and remodel'],
  [S('Building Permit'), ['remodel kitchen, new electrical and plumbing'], ['plumbing', 'electrical', 'general-contractor'], 'Plumbing, electrical and remodel'],
  [S('Deck'), [], ['general-contractor'], 'Deck'],
  [S('Porch'), [], ['general-contractor'], 'Porch'],
  [S('Tenant Upfit'), ['new HVAC rooftop unit and upfit'], ['hvac', 'general-contractor'], 'HVAC and tenant fit-out'],
  [S(''), ['new pool with pool deck'], ['pool-spa'], 'Pool'],
  [S('CONSTRUCTION', 'ALTERATION AND REPAIR'), ['FRONT PORCH REPLACEMENT AND NEW FENCE'], ['fencing', 'general-contractor'], 'Fence and porch'],
  [S('Accessory Structure'), [], ['general-contractor'], 'Accessory building'],
  [S(''), ['new storage shed 10x12'], ['general-contractor'], 'Accessory building'],
  [S('Foundation'), [], ['general-contractor'], 'Structural'],
  [S('Structural'), [], ['general-contractor'], 'Structural'],
  [S('Earth Work'), [], ['general-contractor'], 'Site work'],
  [S('Grading'), [], ['general-contractor'], 'Site work'],
  // ---- paperwork and noise: no trade, so the row is dropped ----
  [S('Owner Change Only', 'Business'), [], [], null],
  [S('Owner Change Only', 'Single Family Dwelling'), [], [], null],
  [S('Permit Renewal'), ['re-roof'], [], null],
  [S('Permit Extension'), [], [], null],
  [S('Sprinklers'), [], [], null],
  [S('Standpipe'), [], [], null],
  [S('Antenna'), [], [], null],
  [S('Supported Scaffold'), [], [], null],
  [S('Elevator'), [], [], null],
  [S(''), [''], [], null],
  // ---- multi-trade records: the title names every trade it carries ----
  [S(''), ['re-roof, replace HVAC and water heater'], ['roofing', 'plumbing', 'hvac'], 'Roof, water heater and HVAC'],
  [S(''), ['new pool with fence and paver deck'], ['pool-spa', 'fencing', 'concrete-paving', 'general-contractor'], 'Pool, fence, concrete and deck'],
];

const sortCats = (c: string[]) => [...c].sort();

describe('permit classification: categories and title label from one classification (>= 120 real-shaped values)', () => {
  it('has at least 120 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(120);
  });
  for (const [structured, free, cats, label] of CASES) {
    const name = `${JSON.stringify(structured)} ${JSON.stringify(free)} -> ${label ?? 'dropped'} [${cats.join('+')}]`;
    it(name, () => {
      const f: PermitFields = { structured, free };
      const r = classifyPermit(f, 'DeKalb County');
      expect(sortCats(r.categories)).toEqual(sortCats(cats));
      expect(r.label).toBe(label);
      if (label) expect(permitTitleFor('DeKalb County', r.label)).toBe(`${label} permit in DeKalb County`);
    });
  }

  it('invariant: every category is named by a kind in the title, and every titled kind contributes its categories', () => {
    for (const [structured, free] of CASES) {
      const r = classifyPermit({ structured, free }, 'DeKalb County');
      const kinds = PERMIT_KINDS.filter((k) => r.kinds.includes(k.id));
      const fromKinds = new Set(kinds.flatMap((k) => k.cats));
      expect(sortCats([...fromKinds])).toEqual(sortCats(r.categories));
      for (const k of kinds) expect(r.label).toContain(k.label === 'HVAC' ? 'HVAC' : k.label.toLowerCase().slice(1));
    }
  });

  it('a row titled "HVAC permit" never carries plumbing unless the record is a combined mechanical and plumbing permit', () => {
    for (const [structured, free] of CASES) {
      const r = classifyPermit({ structured, free }, 'DeKalb County');
      if (r.label === 'HVAC') expect(r.categories).toEqual(['hvac']);
      if (r.categories.includes('plumbing') && r.categories.includes('hvac')) expect(r.label).toMatch(/plumbing|water heater/i);
    }
  });

  it('a generic building permit never fans out to cleaning or landscaping', () => {
    for (const v of ['Building Permit', 'New Construction', 'Residential Building', 'Alterations/Repairs', 'Additions to Existing Structures']) {
      const r = classifyPermit({ structured: [v] });
      expect(r.categories).toEqual(['general-contractor']);
    }
    expect(PERMIT_TRADES).not.toContain('cleaning');
  });

  it('the title is at most 60 characters and drops the lowest-priority kinds together with their trades', () => {
    const r = classifyPermit({ structured: [], free: ['re-roof, new HVAC, water heater, panel upgrade, windows, siding, fence'] }, "Prince George's County");
    const title = permitTitleFor("Prince George's County", r.label);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(r.categories[0]).toBe('roofing');
    expect(r.kinds.length).toBeLessThanOrEqual(4);
  });

  it('description text picks trades but never reaches the title', () => {
    const r = classifyPermit({ structured: ['Building Permit'], free: ['Re-roof for John Smith call 404-555-1212'] }, 'Atlanta');
    const t = permitTitleFor('Atlanta', r.label);
    expect(t).toBe('Roof permit in Atlanta');
    expect(t).not.toMatch(/John|Smith|404/);
  });

  it('PERMIT_RULES (the capabilities claim table) names exactly the trades the classification can produce', () => {
    expect(sortCats([...new Set(PERMIT_RULES.flatMap((r) => r.add))])).toEqual(sortCats(PERMIT_TRADES));
  });
});

describe('the adapters use the same classification', () => {
  const dekalb = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;
  const feature = (id: string, work: string, occ = 'Single Family Dwelling') => ({
    attributes: { applicationNumber: id, issuedDateTime: Date.UTC(2026, 10, 12, 15), WorkTypeDescription: work, OccupancyTypeDescription: occ, statusDescription: 'Issued', location: '100 MAIN ST, DECATUR GA 30030' },
    geometry: { x: -84.29, y: 33.77 },
  });

  it('DeKalb water heater: plumbing only, titled "Water heater permit"', () => {
    const [row] = parseArcgis({ features: [feature('BW-1', 'Residential Water Heater')] }, dekalb);
    expect(row.categories).toEqual(['plumbing']);
    expect(row.title).toBe('Water heater permit in DeKalb County');
    expect(row.data?.cat_v).toBe(CAT_V);
  });

  it('DeKalb re-roof: roofing, titled "Roof permit"; new construction: general-contractor only; owner change dropped', () => {
    const rows = parseArcgis(
      { features: [feature('BR-1', 'Residential Re-Roof'), feature('BN-1', 'New Construction'), feature('BO-1', 'Owner Change Only', 'Business'), feature('BA-1', 'Residential Air Conditioning')] },
      dekalb,
    );
    const by = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(by['BR-1'].categories).toEqual(['roofing']);
    expect(by['BR-1'].title).toBe('Roof permit in DeKalb County');
    expect(by['BN-1'].categories).toEqual(['general-contractor']);
    expect(by['BN-1'].title).toBe('New construction permit in DeKalb County');
    expect(by['BO-1']).toBeUndefined();
    expect(by['BA-1'].categories).toEqual(['hvac']);
    expect(by['BA-1'].title).toBe('HVAC permit in DeKalb County');
  });

  it('Socrata permits (Chicago shape): the work type column decides, descriptions only fill in', () => {
    const chicago = SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-permits')!;
    const row = (id: string, permit_type: string, work_description: string) => ({
      id, permit_: id, issue_date: '2026-11-12T00:00:00.000', permit_type, work_description, work_type: '', latitude: '41.88', longitude: '-87.63',
      reported_cost: '5000', street_number: '100', street_direction: 'N', street_name: 'STATE',
    });
    const rows = parseSocrata(
      [row('P1', 'PERMIT - EASY PERMIT PROCESS', 'TEAR OFF AND REROOF'), row('P2', 'PERMIT - EASY PERMIT PROCESS', 'REPLACE WATER HEATER'), row('P3', 'PERMIT - WRECKING/DEMOLITION', 'WRECK 2 STORY FRAME')],
      chicago,
    );
    const by = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    for (const r of rows) expect(r.title).not.toMatch(/TEAR|WRECK 2|REPLACE/);
    expect(by.P1?.categories).toEqual(['roofing']);
    expect(by.P1?.title).toBe('Roof permit in Chicago');
    expect(by.P2?.categories).toEqual(['plumbing']);
    expect(by.P2?.title).toBe('Water heater permit in Chicago');
    expect(by.P3?.categories).toEqual(['junk-removal']);
    expect(by.P3?.title).toBe('Demolition permit in Chicago');
  });
});

describe('311, violation, licence and inspection mappings (audited round 7): the title text and the trades come from the same value', () => {
  const ds = (subtype: string) => SOCRATA_DATASETS.find((d) => d.subtype === subtype)!;
  const cases: [string, string, CategoryId[], CategoryId[]][] = [
    // [subtype, record type value (it is also the title text), must contain, must not contain]
    ['violation', 'ROOF LEAKS', ['roofing'], ['plumbing']],
    ['violation', 'Roof leak at rear', ['roofing'], ['plumbing']],
    ['violation', 'PLUMBING LEAK', ['plumbing'], []],
    ['violation', 'Water leak from ceiling', ['plumbing'], []],
    ['violation', 'Overgrown weeds', ['lawn-care', 'landscaping'], ['roofing']],
    ['violation', 'Peeling paint', ['painting'], []],
    ['violation', 'Broken windows', ['windows-doors'], []],
    ['violation', 'No heat', ['hvac'], []],
    ['violation', 'Unsafe structure', ['general-contractor'], []],
    ['311', 'Tree Debris Clean-Up Request', ['tree-service'], ['roofing']],
    ['311', 'Rodent Baiting/Rat Complaint', ['pest-control'], []],
    ['311', 'HEAT/HOT WATER', ['hvac', 'plumbing'], []],
    ['311', 'Sewer Cave-In Inspection Request', ['plumbing'], []],
    ['311', 'Illegal Dumping', ['junk-removal'], []],
    ['311', 'Graffiti Removal Request', ['painting', 'cleaning'], []],
    ['business', 'Retail Food Establishment', ['pest-control', 'hvac', 'signs-printing'], ['roofing']],
    ['business', 'Limited Business License', ['signs-printing', 'insurance', 'locksmith'], ['pest-control']],
    ['business', 'Roofing contractor', ['signs-printing'], ['roofing']], // a new roofer is a competitor, not a roofing lead
    // Round 15 quality gate (Q-grades #41-#50): a failed inspection is not a house-cleaning job, so cleaning is no longer tagged.
    ['inspection', 'Restaurant', ['pest-control', 'janitorial-commercial'], ['cleaning']],
  ];
  for (const [subtype, value, has, hasNot] of cases) {
    it(`${subtype}: "${value}"`, async () => {
      const { categorize } = await import('@/lib/signals/adapters/socrata');
      const c = categorize(ds(subtype), value).categories;
      expect(c).toEqual(expect.arrayContaining(has));
      for (const x of hasNot) expect(c).not.toContain(x);
    });
  }
});
