import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, categoryById } from '@/lib/signals/categories';
import { PERMIT_KINDS } from '@/lib/signals/mapping/permit';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { NON_ADAPTER_SOURCES } from '@/lib/signals/source-meta';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import {
  OPPORTUNITIES,
  OPPORTUNITY_LABEL,
  OPPORTUNITY_RANK,
  OPPORTUNITY_REASONS,
  PERMIT_DOING,
  PERMIT_DOWNSTREAM,
  PERMIT_KIND_LABELS,
  assessOpportunity,
  bestOpportunity,
  opportunityCopy,
  opportunityFor,
  opportunityTrades,
  permitKindsFromTitle,
  type OpportunityInput,
} from '@/lib/signals/opportunity';

// Titles below are copied from anchors/signals-14d.json (14 days of live rows) unless marked "constructed".

function sig(source: string, kind: string, subtype: string | null, title: string, categories: string[] = [], extra: Partial<OpportunityInput> = {}): OpportunityInput {
  return { source, kind, subtype, title, summary: null, categories, severity: 1, data: subtype ? { subtype } : {}, ...extra };
}
const permit = (title: string, categories: string[]) => sig('socrata-austin-permits', 'permit', 'permit', title, categories);
const permitWith = (title: string, categories: string[], summary: string) => sig('socrata-austin-permits', 'permit', 'permit', title, categories, { summary });
const v311 = (source: string, title: string, categories: string[] = []) => sig(source, 'civic', '311', title, categories);
const violation = (title: string, categories: string[] = []) => sig('socrata-chicago-violations', 'civic', 'violation', title, categories);
const nws = (title: string, categories: string[] = []) =>
  sig('nws', 'alert', null, title, categories, { data: { event: title.split(':')[0] } });
const label = (s: OpportunityInput, trade: string) => opportunityFor(s, trade).label;
const allContext = (s: OpportunityInput) => CATEGORY_IDS.every((t) => label(s, t) === 'context');

describe('contract', () => {
  it('exports the labels, ranks and names other units rely on', () => {
    expect(OPPORTUNITIES).toEqual(['act', 'soon', 'intel', 'context']);
    expect(OPPORTUNITY_RANK).toEqual({ act: 3, soon: 2, intel: 1, context: 0 });
    expect(OPPORTUNITY_LABEL).toEqual({ act: 'Act now', soon: 'Coming soon', intel: 'Market insight', context: 'Background' });
  });

  it('returns a full brief for every trade', () => {
    const s = permit('Roof permit in Austin', ['roofing']);
    for (const t of CATEGORY_IDS) {
      const b = opportunityFor(s, t);
      expect(Object.keys(b).sort()).toEqual(['label', 'next', 'reason', 'uncertain', 'why']);
      expect(OPPORTUNITIES).toContain(b.label);
      expect((OPPORTUNITY_REASONS as readonly string[]).includes(b.reason)).toBe(true);
      for (const k of ['why', 'next', 'uncertain'] as const) expect(b[k].length).toBeGreaterThan(0);
    }
  });

  it('opportunityTrades lists only non-context trades, downstream ones included', () => {
    const t = opportunityTrades(permit('Roof permit in Austin', ['roofing']));
    expect(t).toEqual({ roofing: 'intel', 'siding-gutters': 'soon' });
    expect(Object.values(t)).not.toContain('context');
  });

  it('bestOpportunity picks the highest rank, first trade on ties, and null when all are context', () => {
    const roof = permit('Roof permit in Austin', ['roofing']);
    expect(bestOpportunity(roof, ['roofing', 'solar', 'siding-gutters'])).toMatchObject({ trade: 'siding-gutters', brief: { label: 'soon' } });
    // two trades tie at soon on a new home: the first one listed wins
    const home = permit('New home permit in Cobb County', ['general-contractor']);
    expect(bestOpportunity(home, ['general-contractor', 'moving', 'landscaping'])).toMatchObject({ trade: 'moving', brief: { label: 'soon' } });
    expect(bestOpportunity(home, ['general-contractor', 'landscaping', 'moving']).trade).toBe('landscaping');
    expect(bestOpportunity(roof, ['roofing', 'hvac'])).toMatchObject({ trade: 'roofing', brief: { label: 'intel' } });
    const none = bestOpportunity(roof, ['hvac', 'beauty']);
    expect(none.trade).toBeNull();
    expect(none.brief.label).toBe('context');
    expect(bestOpportunity(roof, []).trade).toBeNull();
    expect(bestOpportunity(roof, []).brief.uncertain.length).toBeGreaterThan(0);
  });

  it('never throws on thin or odd input', () => {
    // @ts-expect-error runtime guard for bad data
    expect(opportunityFor({ kind: undefined, source: undefined, categories: undefined }, 'roofing').label).toBe('context');
    expect(opportunityFor(sig('', '', null, ''), 'not-a-trade').label).toBe('context');
  });
});

describe('permits: own trade is intel, downstream trades are soon', () => {
  it('mirrors permit.ts PERMIT_KINDS ids and title labels in the same order', () => {
    expect(PERMIT_KIND_LABELS.map((k) => [k.id, k.label])).toEqual(PERMIT_KINDS.map((k) => [k.id, k.label]));
  });

  it('has doing and downstream entries for every PERMIT_KINDS kind, consistent with its cats', () => {
    for (const k of PERMIT_KINDS) {
      expect(PERMIT_DOING[k.id], `doing ${k.id}`).toBeDefined();
      expect(PERMIT_DOWNSTREAM[k.id], `downstream ${k.id}`).toBeDefined();
      // doing is a subset of the kind's cats; any other cat is documented as downstream (new home: real-estate, moving)
      for (const t of PERMIT_DOING[k.id]) expect(k.cats).toContain(t);
      for (const c of k.cats) if (!PERMIT_DOING[k.id].includes(c)) expect(PERMIT_DOWNSTREAM[k.id], `${k.id} ${c}`).toContain(c);
      for (const t of PERMIT_DOWNSTREAM[k.id]) {
        expect(categoryById(t), `${k.id} -> ${t}`).toBeDefined();
        expect(PERMIT_DOING[k.id]).not.toContain(t);
      }
    }
    expect(Object.keys(PERMIT_DOWNSTREAM).sort()).toEqual(PERMIT_KINDS.map((k) => k.id).sort());
  });

  it('parses kinds from the fixed title labels', () => {
    expect(permitKindsFromTitle('Roof, HVAC, plumbing and electrical permit in Austin').kinds).toEqual(['roof', 'hvac', 'plumbing', 'electrical']);
    expect(permitKindsFromTitle('Demolition and tenant fit-out permit in Cobb County').kinds).toEqual(['demolition', 'fit-out']);
    expect(permitKindsFromTitle('New home, retaining wall and concrete permit in Cobb County').kinds).toEqual(['new-home', 'retaining-wall', 'concrete']);
    expect(permitKindsFromTitle('Home Occupation permit in Raleigh')).toEqual({ kinds: [], unparsed: ['Home Occupation'] });
    expect(permitKindsFromTitle('Permit in Austin').kinds).toEqual([]);
  });

  it('a re-roof is intel for roofers and soon for gutters only', () => {
    const s = permit('Roof permit in Chicago', ['roofing']);
    expect(opportunityFor(s, 'roofing')).toMatchObject({ label: 'intel', reason: 'permit-own-trade' });
    expect(opportunityFor(s, 'siding-gutters')).toMatchObject({ label: 'soon', reason: 'permit-downstream' });
    expect(label(s, 'solar')).toBe('context');
    expect(label(s, 'junk-removal')).toBe('context');
    expect(label(s, 'hvac')).toBe('context');
  });

  it('self-contained trade permits give intel to the trade and nothing else', () => {
    for (const [title, trade] of [
      ['HVAC permit in New Orleans', 'hvac'],
      ['Electrical permit in Austin', 'electrical'],
      ['Plumbing permit in Austin', 'plumbing'],
      ['Water heater permit in Austin', 'plumbing'],
      ['Fence permit in New York City', 'fencing'],
    ] as const) {
      const s = permit(title, [trade]);
      expect(opportunityTrades(s), title).toEqual({ [trade]: 'intel' });
    }
  });

  it('own trade wins over downstream on a combined permit', () => {
    const s = permit('Roof and solar permit in Austin', ['roofing', 'solar']);
    expect(label(s, 'roofing')).toBe('intel');
    expect(label(s, 'solar')).toBe('intel');
    expect(label(s, 'electrical')).toBe('context'); // solar names no follow-on trade now
    const p = permit('Plumbing and remodel permit in Chicago', ['plumbing', 'general-contractor']);
    expect(label(p, 'plumbing')).toBe('intel');
    expect(label(p, 'general-contractor')).toBe('intel');
    // remodel names no finish work: follow-on trades are market insight (Nov 22 volume retune)
    expect(label(p, 'flooring')).toBe('intel');
    expect(label(p, 'electrical')).toBe('intel');
  });

  it('generic building / remodel / structural permits never alert follow-on trades; an addition still does', () => {
    for (const t of ['Building permit in Austin', 'Remodel permit in Chicago', 'Structural permit in Seattle']) {
      const s = permit(t, ['general-contractor']);
      for (const tr of ['painting', 'handyman', 'flooring', 'cleaning', 'junk-removal', 'electrical']) expect(label(s, tr), `${t} ${tr}`).toBe('intel');
    }
    const a = permit('Addition permit in Austin', ['general-contractor']);
    expect(label(a, 'painting')).toBe('soon');
    expect(label(a, 'hvac')).toBe('soon');
    const both = permit('Remodel and deck permit in Austin', ['general-contractor']);
    expect(label(both, 'painting')).toBe('soon');
  });

  it('a new home is soon for movers, realtors and yard trades; the builder gets intel', () => {
    const s = permit('New home permit in Cobb County', ['general-contractor', 'real-estate', 'moving']);
    expect(label(s, 'general-contractor')).toBe('intel');
    for (const t of ['moving', 'real-estate', 'landscaping', 'lawn-care', 'cleaning']) expect(label(s, t), t).toBe('soon');
    for (const t of ['fencing', 'security', 'pool-spa', 'windows-doors']) expect(label(s, t), t).toBe('context');
  });

  it('a new building is soon for landscaping only (house cleaning follows new homes; commercial cleaning follows fit-out and sign permits)', () => {
    const s = permit('New construction permit in Austin', ['general-contractor']);
    expect(label(s, 'landscaping')).toBe('soon');
    expect(label(s, 'cleaning')).toBe('context');
    expect(label(s, 'janitorial-commercial')).toBe('context');
    for (const t of ['concrete-paving', 'fencing', 'security']) expect(label(s, t), t).toBe('context');
  });

  it('a known job value under $5,000 makes every downstream trade intel; $5,000 and over keeps them soon', () => {
    const small = permitWith('New home permit in Cobb County', ['general-contractor'], 'Single family | $4,999 job value');
    for (const t of ['moving', 'real-estate', 'landscaping', 'lawn-care', 'cleaning']) expect(label(small, t), `small ${t}`).toBe('intel');
    expect(label(small, 'general-contractor')).toBe('intel');
    const big = permitWith('New home permit in Cobb County', ['general-contractor'], 'Single family | $5,000 job value');
    for (const t of ['moving', 'real-estate', 'landscaping', 'lawn-care', 'cleaning']) expect(label(big, t), `big ${t}`).toBe('soon');
    const reroof = permitWith('Roof permit in Austin', ['roofing'], '$2,500 job value');
    expect(label(reroof, 'siding-gutters')).toBe('intel');
    const addition = permitWith('Addition permit in Austin', ['general-contractor'], '$1,200 job value');
    for (const t of ['flooring', 'painting', 'hvac']) expect(label(addition, t), t).toBe('intel');
    // no stated value: the follow-on trades stay soon
    expect(label(permit('Addition permit in Austin', ['general-contractor']), 'painting')).toBe('soon');
  });

  it('a trade sub-permit on the record makes every downstream trade intel', () => {
    const s = permitWith('New home, HVAC and plumbing permit in Cobb County', ['general-contractor'], '$250,000 job value');
    for (const t of ['moving', 'real-estate', 'landscaping', 'lawn-care', 'cleaning']) expect(label(s, t), t).toBe('intel');
    for (const k of ['HVAC', 'Plumbing', 'Electrical', 'Water heater']) {
      const sub = permitWith(`New home and ${k} permit in Cobb County`, ['general-contractor'], '$90,000 job value');
      expect(label(sub, 'landscaping'), k).toBe('intel');
    }
  });

  it('damage repair is soon for general contractors, flooring and painting only', () => {
    const s = permitWith('Damage repair permit in Austin', ['general-contractor'], '$30,000 job value');
    for (const t of ['general-contractor', 'flooring', 'painting']) expect(label(s, t), t).toBe('soon');
    for (const t of ['handyman', 'junk-removal']) expect(label(s, t), t).toBe('context');
  });

  it('solar, demolition, tenant fit-out and sign permits reach the trades that follow', () => {
    expect(opportunityTrades(permit('Solar permit in Austin', ['solar']))).toEqual({ solar: 'intel' });
    const demo = permit('Demolition permit in Seattle', ['junk-removal']);
    expect(label(demo, 'junk-removal')).toBe('intel');
    expect(opportunityTrades(demo)).toEqual({ 'junk-removal': 'intel' });
    const fit = permit('Tenant fit-out permit in Cobb County', ['general-contractor']);
    for (const t of ['janitorial-commercial', 'signs-printing', 'security']) expect(label(fit, t), t).toBe('soon');
    for (const t of ['pest-control', 'flooring', 'painting', 'business-services']) expect(label(fit, t), t).toBe('context');
    const sign = permit('Sign permit in Austin', ['signs-printing']);
    expect(label(sign, 'signs-printing')).toBe('intel');
    expect(label(sign, 'janitorial-commercial')).toBe('soon');
    expect(label(sign, 'security')).toBe('context');
    expect(opportunityTrades(permit('Accessory building permit in Austin', ['general-contractor']))).toEqual({ 'general-contractor': 'intel' });
    expect(opportunityTrades(permit('Site work permit in Austin', ['general-contractor']))).toEqual({ 'general-contractor': 'intel' });
  });

  it('a permit with no parsed label is intel for its tagged trades only', () => {
    expect(opportunityTrades(permit('Home Occupation permit in Raleigh', ['general-contractor']))).toEqual({ 'general-contractor': 'intel' });
  });

  it('never gives act on a permit', () => {
    for (const k of PERMIT_KINDS) {
      const s = permit(`${k.label} permit in Austin`, k.cats);
      expect(Object.values(opportunityTrades(s))).not.toContain('act');
      for (const t of PERMIT_DOING[k.id]) expect(label(s, t), `${k.id} ${t}`).toBe('intel');
    }
  });
});

describe('code violations: act for the repair trades the notice names', () => {
  it.each([
    ['REPAIR EXTERIOR WALL', ['handyman', 'general-contractor']],
    ['REPAIR ROOF', ['roofing']],
    ['INSTALL SMOKE DETECTORS', ['handyman']],
    ['EXPOSED WIRING', ['electrical']],
    ['HEAT UNIT ADEQUATELY', ['hvac']],
    ['SOIL/WASTE,VENT PIPE MATRL', ['plumbing']],
    ['trash or debris and overgrown yard', ['junk-removal', 'lawn-care', 'landscaping']],
    ['CUT OR REMOVE HIGH WEEDS', ['lawn-care', 'landscaping']],
    ['MICE/RODENTS', ['pest-control']],
    ['REPAIR FENCE', ['fencing']],
    ['MAINTAIN WINDOW', ['windows-doors']],
    ['REPAIR EXTERIOR DOOR', ['windows-doors']],
    ['SCRAPE/PAINT FIRE ESCAPE', ['painting']],
    ['REPAIR GUTTER & DOWNSPOUT', ['siding-gutters']],
  ])('%s', (title, trades) => {
    const s = violation(`Code violation in Chicago: ${title}`);
    for (const t of trades) expect(opportunityFor(s, t), t).toMatchObject({ label: 'act', reason: 'violation-repair' });
  });

  it('smoke and CO detector violations are handyman work, not electrical', () => {
    for (const title of ['INSTALL SMOKE DETECTORS', 'CARBON MONOXIDE DETECTOR MISSING', 'INSTALL CO DETECTOR']) {
      const s = violation(`Code violation in Chicago: ${title}`);
      expect(opportunityTrades(s), title).toEqual({ handyman: 'act' });
    }
  });

  it('a water heater is plumbing, not heating', () => {
    const s = violation('Code violation in Chicago: WATER HEATER PERMIT');
    expect(label(s, 'plumbing')).toBe('act');
    expect(label(s, 'hvac')).toBe('context');
  });

  it('a wall or stair that only locates paint or lighting is not a structural repair', () => {
    expect(label(violation('Code violation in Chicago: INT WALL/CEILING PEELING PAINT'), 'general-contractor')).toBe('context');
    expect(label(violation('Code violation in Chicago: INT WALL/CEILING PEELING PAINT'), 'painting')).toBe('act');
    expect(label(violation('Code violation in Chicago: ILLUMINATE PUBLIC STAIR/HALL'), 'general-contractor')).toBe('context');
    expect(label(violation('Code violation in Chicago: ILLUMINATE PUBLIC STAIR/HALL'), 'electrical')).toBe('act');
  });

  it('unrecognised text is soon for handyman (plus tagged repair trades) and market insight for general contractors', () => {
    const s = violation('Code violation in Austin: Work Without Permit', ['general-contractor', 'handyman']);
    expect(opportunityTrades(s)).toEqual({ handyman: 'soon', 'general-contractor': 'intel' });
    expect(opportunityFor(s, 'handyman').reason).toBe('violation-general');
    const dekalb = sig('arcgis-dekalb-violations', 'civic', 'violation', 'Code violation in DeKalb County: property violation', ['junk-removal']);
    expect(opportunityTrades(dekalb)).toEqual({ handyman: 'soon', 'general-contractor': 'intel', 'junk-removal': 'soon' });
  });

  it('property abatement is soon for cleanup trades', () => {
    const s = sig('socrata-austin-violations', 'civic', 'violation', 'Code violation in Austin: Property Abatement', ['junk-removal', 'lawn-care', 'landscaping']);
    expect(opportunityTrades(s)).toEqual({ 'junk-removal': 'soon', 'lawn-care': 'soon' });
  });
});

describe('311: city work is context, with a few private exceptions', () => {
  it('NYC heat and hot water for one apartment is Coming soon for HVAC', () => {
    const s = v311('socrata-nyc-311', '311 request in New York City: HEAT/HOT WATER / APARTMENT ONLY', ['hvac', 'plumbing']);
    expect(opportunityTrades(s)).toEqual({ hvac: 'soon', plumbing: 'intel' });
    expect(opportunityFor(s, 'hvac').why).toMatch(/one apartment/);
  });
  it('NYC heat and hot water is act for HVAC and market insight for plumbing', () => {
    for (const title of ['311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING']) {
      const s = v311('socrata-nyc-311', title, ['hvac', 'plumbing']);
      expect(opportunityFor(s, 'hvac')).toMatchObject({ label: 'act', reason: 'heat-complaint' });
      expect(opportunityFor(s, 'plumbing')).toMatchObject({ label: 'intel', reason: 'heat-complaint' });
      expect(opportunityTrades(s)).toEqual({ hvac: 'act', plumbing: 'intel' });
    }
    expect(opportunityTrades(v311('socrata-nyc-311', '311 request in New York City: Non-Residential Heat / Inadequate or No Heat'))).toEqual({ hvac: 'act' });
    expect(label(v311('socrata-cincinnati-311', '311 request in Cincinnati: HEAT, NO HEAT HAZARD'), 'hvac')).toBe('act');
  });

  it('hot water or water alone out is act for plumbing, with no HVAC', () => {
    for (const title of ['311 request in New York City: No Hot Water', '311 request in New York City: No Water / ENTIRE BUILDING']) {
      const s = v311('socrata-nyc-311', title, ['plumbing']);
      expect(opportunityTrades(s), title).toEqual({ plumbing: 'act' });
      expect(opportunityFor(s, 'plumbing').reason).toBe('heat-complaint');
    }
    // a heat complaint that names no water gives plumbing nothing
    expect(label(v311('socrata-nyc-311', '311 request in New York City: Non-Residential Heat / Inadequate or No Heat'), 'plumbing')).toBe('context');
  });

  it('sewage back-ups are act for plumbing and restoration', () => {
    for (const [src, title] of [
      ['socrata-sf-311', '311 request in San Francisco: Sewer / sewage_back-up_discharge'],
      ['socrata-nyc-311', '311 request in New York City: Sewer Maintenance / Backup'],
      ['socrata-kansascity-311', '311 request in Kansas City: Sewer and Stormwater / Sewer Backup'],
    ]) {
      const s = v311(src, title, ['plumbing']);
      expect(opportunityTrades(s), title).toEqual({ plumbing: 'act', restoration: 'act' });
    }
  });

  it('graffiti is act for painting only when marked private', () => {
    const priv = v311('socrata-sf-311', '311 request in San Francisco: Graffiti Private / not_offensive', ['painting', 'cleaning']);
    expect(opportunityTrades(priv)).toEqual({ painting: 'act' });
    for (const [src, title] of [
      ['socrata-chicago-311', '311 request in Chicago: Graffiti Removal Request'],
      ['socrata-sf-311', '311 request in San Francisco: Graffiti Public / not_offensive'],
      ['socrata-nyc-311', '311 request in New York City: Graffiti'],
      ['socrata-austin-311', '311 request in Austin: APH - Graffiti Abatement - Public Property'],
    ]) {
      expect(allContext(v311(src, title, ['painting', 'cleaning'])), title).toBe(true);
    }
  });

  it.each([
    ['socrata-chicago-311', '311 request in Chicago: Tree Trim Request (NO LONGER BEING ACCEPTED)'],
    ['socrata-chicago-311', '311 request in Chicago: Tree Planting Request'],
    ['socrata-chicago-311', '311 request in Chicago: Sewer Cleaning Inspection Request'],
    ['socrata-sf-311', '311 request in San Francisco: Sewer / catch_basin'],
    ['socrata-nyc-311', '311 request in New York City: Sewer Maintenance / Catch Basin Clogged'],
    ['socrata-kansascity-311', '311 request in Kansas City: Trash Recycling Bulky Services / Missed Trash'],
    ['socrata-chicago-311', '311 request in Chicago: Fly Dumping Complaint'],
    ['socrata-chicago-311', '311 request in Chicago: Rodent Baiting/Rat Complaint'],
    ['socrata-chicago-311', '311 request in Chicago: Tree Debris Clean-Up Request'],
    ['socrata-dallas-311', '311 request in Dallas: Street Spillage/Debris'],
    ['socrata-nyc-311', '311 request in New York City: Illegal Dumping / Removal Request'],
    ['socrata-dallas-311', '311 request in Dallas: Street Lighting- New/Relocation - TPW'],
    ['socrata-cincinnati-311', '311 request in Cincinnati: VEHICLE, ROW JUNK/ABAN'],
    ['socrata-oakland-311', '311 request in Oakland: BLDGMAINT / City Bldg - Structural Issue'],
  ])('%s %s is context for every trade', (src, title) => {
    const s = v311(src, title, ['tree-service', 'junk-removal', 'pest-control', 'plumbing']);
    expect(allContext(s)).toBe(true);
  });

  it('problems inside private buildings and on private property are soon', () => {
    expect(opportunityTrades(v311('socrata-cincinnati-311', '311 request in Cincinnati: MICE, BUILDING HAS MICE'))).toEqual({ 'pest-control': 'soon' });
    expect(opportunityTrades(v311('socrata-cincinnati-311', '311 request in Cincinnati: MOLD, BUILDING OR APARTMENT'))).toEqual({ restoration: 'soon' });
    expect(opportunityTrades(v311('socrata-cincinnati-311', '311 request in Cincinnati: TALL GRASS/WEEDS, PRIVATE PROP'))).toEqual({ 'lawn-care': 'soon', landscaping: 'soon' });
    expect(opportunityTrades(v311('socrata-cincinnati-311', '311 request in Cincinnati: TREE, DEAD ON PRIV PROP STNDRD'))).toEqual({ 'tree-service': 'soon' });
    expect(label(v311('socrata-kansascity-311', '311 request in Kansas City: Property Violations / Litter and Trash'), 'junk-removal')).toBe('soon');
    expect(label(v311('socrata-nola-311', '311 request in New Orleans: Healthy Homes'), 'handyman')).toBe('soon');
  });
});

describe('inspections and business licences', () => {
  it('a failed food inspection is soon for pest control and market insight for commercial cleaning', () => {
    const s = sig('socrata-chicago-inspections', 'civic', 'inspection', 'Failed inspection in Chicago: food establishment', [
      'pest-control', 'cleaning', 'janitorial-commercial', 'plumbing', 'general-contractor',
    ]);
    expect(opportunityTrades(s)).toEqual({ 'pest-control': 'soon', 'janitorial-commercial': 'intel' });
    expect(allContext(sig('socrata-chicago-inspections', 'civic', 'inspection', 'Inspection in Chicago: food establishment (constructed)'))).toBe(true);
  });

  it('a failed food inspection that names vermin is act for pest control', () => {
    const cats = ['pest-control', 'cleaning', 'janitorial-commercial', 'plumbing'];
    for (const text of ['roaches observed', 'evidence of rodent droppings', 'mice in kitchen', 'rats seen', 'flies present']) {
      const s = sig('socrata-chicago-inspections', 'civic', 'inspection', 'Failed inspection in Chicago: food establishment', cats, { summary: text });
      expect(opportunityTrades(s), text).toEqual({ 'pest-control': 'act', 'janitorial-commercial': 'intel' });
    }
  });

  it('a storefront business licence is soon for signs, business services, commercial cleaning and security only', () => {
    const s = sig('socrata-nyc-business', 'civic', 'business', 'New business license in New York City: Locksmith retail store', [
      'signs-printing', 'business-services', 'insurance', 'janitorial-commercial', 'security', 'cleaning', 'locksmith',
    ]);
    expect(opportunityTrades(s)).toEqual({ 'signs-printing': 'soon', 'business-services': 'soon', 'janitorial-commercial': 'soon', security: 'soon' });
    for (const t of ['locksmith', 'insurance', 'cleaning']) expect(label(s, t), t).toBe('context');
  });
  it('a bare-category licence is market insight; a food licence adds pest control', () => {
    const bare = sig('socrata-chicago-business', 'civic', 'business', 'New business license in Chicago: Limited Business License', ['signs-printing', 'janitorial-commercial']);
    expect(label(bare, 'janitorial-commercial')).toBe('intel');
    expect(label(bare, 'signs-printing')).toBe('intel');
    const food = sig('socrata-chicago-business', 'civic', 'business', 'New business license in Chicago: Retail Food Establishment', ['janitorial-commercial']);
    expect(label(food, 'janitorial-commercial')).toBe('soon');
    expect(label(food, 'pest-control')).toBe('soon');
  });
  it('a closed or complied case is never Act now or Coming soon', () => {
    const s = { ...sig('socrata-austin-violations', 'civic', 'violation', 'Code violation in Austin: trash or debris and overgrown yard', ['junk-removal']), summary: 'trash or debris and overgrown yard | Closed | 1200 block of X ST' };
    expect(label(s, 'junk-removal')).toBe('intel');
  });
});

describe('weather alerts', () => {
  it('warnings are soon for the storm trades', () => {
    const tstorm = nws('Severe Thunderstorm Warning: Garfield, CO; Rio Blanco, CO');
    for (const t of ['roofing', 'tree-service', 'restoration', 'siding-gutters']) expect(opportunityFor(tstorm, t), t).toMatchObject({ label: 'soon', reason: 'storm-warning' });
    // a warning is not a claim: public adjusters wait for damage reports
    expect(label(tstorm, 'public-adjuster')).toBe('context');
    expect(label(nws('Tornado Warning: Merced, CA'), 'roofing')).toBe('soon');
    expect(opportunityTrades(nws('Flash Flood Warning: Coconino, AZ; Yavapai, AZ'))).toEqual({ restoration: 'soon', plumbing: 'soon' });
    const winter = nws('Winter Storm Warning: Eastern Sierra Slopes of Inyo County');
    expect(opportunityTrades(winter)).toEqual({ 'snow-removal': 'soon', plumbing: 'soon', hvac: 'soon', towing: 'soon' });
    expect(label(nws('Snow Squall Warning: Moffat, CO; Rio Blanco, CO; Routt, CO'), 'snow-removal')).toBe('soon');
  });

  it('watches and advisories are intel; cold is intel for plumbing and HVAC', () => {
    expect(opportunityFor(nws('Wind Advisory: Western Clark and Southern Nye County; Las Vegas Valley'), 'roofing')).toMatchObject({ label: 'intel', reason: 'weather-watch' });
    expect(label(nws('Flood Advisory: Coconino, AZ; Yavapai, AZ'), 'restoration')).toBe('intel');
    expect(label(nws('Tornado Watch: Palm Beach, FL (constructed)'), 'roofing')).toBe('intel');
    expect(opportunityTrades(nws('Freeze Warning: Joshua Tree NP West'))).toEqual({ plumbing: 'intel', hvac: 'intel' });
    expect(opportunityFor(nws('Freeze Warning: Joshua Tree NP West'), 'plumbing').reason).toBe('cold-weather');
  });

  it.each([
    'Coastal Flood Advisory: Kenedy Island; Willacy Island; Cameron Island',
    'Red Flag Warning: Eastern Panhandle/Crescent Lake NWR',
    'Brisk Wind Advisory: Motherwood Point to Cape Krusenstern out to 10 NM',
    'Frost Advisory: Antelope Valley',
    'Coastal Flood Statement: Brevard, FL (constructed)',
  ])('%s is context', (title) => {
    expect(allContext(nws(title, ['restoration', 'plumbing', 'roofing', 'tree-service']))).toBe(true);
  });

  it('an event name with no rule is context and flagged unknown', () => {
    const s = nws('Volcano Warning: Somewhere (constructed)');
    expect(allContext(s)).toBe(true);
    expect(assessOpportunity(s).known).toBe(false);
  });
});

describe('storm reports, disasters, quakes', () => {
  const spc = (title: string, data: Record<string, unknown>) => sig('spc', 'report', null, title, [], { data });
  it('wind damage naming trees in a yard is act for tree service; a tree across a road is not', () => {
    const road = spc('Wind damage reported near 11 NE Nipomo, CA', { type: 'wind', comments: 'Tree down blocking entire road in association with convective band. (LOX)' });
    expect(label(road, 'tree-service')).toBe('soon');
    const s = spc('Wind damage reported near 11 NE Nipomo, CA', { type: 'wind', comments: 'Large tree uprooted in a yard. (LOX)' });
    expect(opportunityTrades(s)).toEqual({ 'tree-service': 'act', roofing: 'soon', restoration: 'soon' });
    expect(opportunityFor(s, 'tree-service').reason).toBe('storm-damage-report');
  });
  it('wind damage naming a roof or tarp is act for roofing and restoration, market insight for tree service', () => {
    for (const comments of ['Tarp on roof after wind blew shingles off home. (LOX)', 'Siding and gutter torn loose by wind. (LOX)']) {
      const s = spc('Wind damage reported near 11 NE Nipomo, CA', { type: 'wind', comments });
      expect(opportunityTrades(s), comments).toEqual({ 'tree-service': 'intel', roofing: 'act', restoration: 'act' });
      expect(opportunityFor(s, 'restoration').uncertain).not.toMatch(/not confirmed/);
    }
  });
  it('wind damage naming both trees and a roof is act for tree service and roofing', () => {
    const s = spc('Wind damage reported near 11 NE Nipomo, CA', { type: 'wind', comments: 'Tree limb fell on roof of home. (LOX)' });
    expect(opportunityTrades(s)).toEqual({ 'tree-service': 'act', roofing: 'act', restoration: 'act' });
    expect(opportunityFor(s, 'tree-service').why).toMatch(/trees or limbs/);
  });
  it('a gust with no damage is soon for tree service only', () => {
    const s = spc('60 mph wind gust reported near 1 S Allison, NM', { type: 'wind', windMph: 60, comments: 'Peak wind gust from passing thunderstorm. (ABQ)' });
    expect(opportunityTrades(s)).toEqual({ 'tree-service': 'soon', roofing: 'intel', restoration: 'intel' });
  });
  it('one inch hail is act for roof, siding and public adjusters; cars need golf-ball hail', () => {
    const s = spc('1.00 inch hail reported near 2 W Hollywood, FL', { type: 'hail', hailInches: 1 });
    expect(opportunityTrades(s)).toEqual({ roofing: 'act', 'siding-gutters': 'act', 'auto-body': 'intel', 'auto-glass': 'intel', 'public-adjuster': 'act', insurance: 'intel' });
    const big = spc('1.75 inch hail reported near 2 W Hollywood, FL', { type: 'hail', hailInches: 1.75 });
    expect(opportunityTrades(big)).toMatchObject({ 'auto-body': 'act', 'auto-glass': 'act' });
  });
  it('a tornado report is act for restoration, tree service and roofing', () => {
    const s = spc('Tornado reported near 3 N Moore, OK (constructed)', { type: 'tornado' });
    expect(opportunityTrades(s)).toEqual({ restoration: 'act', 'tree-service': 'act', roofing: 'act', insurance: 'intel' });
  });
  it('a FEMA declaration is soon for recovery trades', () => {
    const s = sig('fema', 'disaster', null, 'Major disaster declaration: Severe Storms (FL) (constructed)');
    expect(opportunityTrades(s)).toEqual({ restoration: 'soon', roofing: 'soon', 'tree-service': 'soon', 'public-adjuster': 'soon', 'junk-removal': 'soon', insurance: 'intel' });
  });
  it('earthquakes below magnitude 5 are context', () => {
    expect(allContext(sig('usgs', 'quake', null, 'M2.8 earthquake 83 km ENE of Ugashik, Alaska'))).toBe(true);
    expect(opportunityTrades(sig('usgs', 'quake', null, 'M5.1 earthquake 157 km S of Attu Station, Alaska'))).toEqual({ restoration: 'soon' });
  });
});

describe('asking, federal, events, travel, unknown', () => {
  it('asking sources are act for their categories', () => {
    expect(opportunityTrades(sig('holler-request', 'ask', null, 'Need a roofer (constructed)', ['roofing']))).toEqual({ roofing: 'act' });
    const post = opportunityFor(sig('bluesky', 'ask', null, 'anyone know a good plumber? (constructed)', ['plumbing']), 'plumbing');
    expect(post).toMatchObject({ label: 'act', reason: 'asking' });
    expect(post.uncertain).toMatch(/not checked who wrote/);
  });
  it('open federal solicitations are act; presolicitations and sources sought are soon; awards are intel', () => {
    const bid = sig('sam-gov', 'contract', null, 'Federal bid in Cave Junction, OR: Z--Rehab Kiosk Restrooms, NPS-ORCA', ['general-contractor'], { data: { type: 'Solicitation' } });
    expect(opportunityFor(bid, 'general-contractor')).toMatchObject({ label: 'act', reason: 'open-bid' });
    const combined = sig('sam-gov', 'contract', null, 'Federal bid in San Diego, CA: H263--ANTI-LIGATURE DOOR ALARM INSTALLATION SERVICES', ['security'], { data: { type: 'Combined Synopsis/Solicitation' } });
    expect(label(combined, 'security')).toBe('act');
    // no placed city in the title ("Federal bid in <City>, ST:"): worth a look, not Act now
    const unplaced = sig('sam-gov', 'contract', null, 'Federal bid in OR: Z--Rehab Kiosk Restrooms, NPS-ORCA', ['general-contractor'], { data: { type: 'Solicitation' } });
    expect(opportunityFor(unplaced, 'general-contractor')).toMatchObject({ label: 'soon', reason: 'open-bid-statewide' });
    const noPlace = sig('sam-gov', 'contract', null, 'Federal bid: Z--Rehab Kiosk Restrooms', ['general-contractor'], { data: { type: 'Solicitation' } });
    expect(label(noPlace, 'general-contractor')).toBe('soon');
    const sought = sig('sam-gov', 'contract', null, 'Federal bid in Cleveland, OH: S222--Sources Sought - Hazardous Waste Removal/Disposal', ['junk-removal'], { data: { type: 'Sources Sought' } });
    expect(opportunityFor(sought, 'junk-removal')).toMatchObject({ label: 'soon', reason: 'bid-notice' });
    const award = sig('usaspending', 'contract', null, 'Federal contract ($114K) in Blacksburg, VA: NAICS 561730', ['landscaping', 'lawn-care']);
    expect(opportunityTrades(award)).toEqual({ landscaping: 'intel', 'lawn-care': 'intel' });
  });
  it('named event permits are soon for catering, food trucks, event services and security; unnamed park permits are insight', () => {
    const cats = ['food-truck', 'catering', 'event-services', 'security', 'cleaning'];
    const named = sig('socrata-nyc-events', 'event', 'event-permit', 'Permitted event in New York City: Street Fair at Court Street', cats);
    expect(opportunityTrades(named)).toEqual({ catering: 'soon', 'food-truck': 'soon', 'event-services': 'soon', security: 'soon' });
    const bare = sig('socrata-nyc-events', 'event', 'event-permit', 'Permitted event in New York City: Special Event at Bell Tower Park: Bell Tower Park', cats);
    expect(opportunityTrades(bare)).toEqual({ catering: 'intel', 'food-truck': 'intel', 'event-services': 'intel', security: 'intel' });
  });
  it('airport delays are soon for rideshare and delivery only', () => {
    expect(opportunityTrades(sig('faa', 'travel', null, 'Ground stop at Phoenix Sky Harbor (PHX)', ['rideshare-delivery']))).toEqual({ 'rideshare-delivery': 'soon' });
  });
  it('unknown sources and kinds are context and flagged', () => {
    const s = sig('nowhere', 'mystery', null, 'Something happened', ['roofing']);
    expect(opportunityFor(s, 'roofing')).toMatchObject({ label: 'context', reason: 'unknown' });
    expect(assessOpportunity(s)).toMatchObject({ family: 'unknown', known: false });
    expect(assessOpportunity(sig('x', 'civic', 'new-thing', 'Thing in Austin: thing')).family).toBe('unknown');
  });
  it('every registered source falls into an explicit rule family', () => {
    const datasets = new Map<string, string>([...SOCRATA_DATASETS.map((d) => [d.id, d.subtype] as const), ...ARCGIS_DATASETS.map((d) => [d.id, d.subtype] as const)]);
    for (const a of ALL_ADAPTERS) {
      const subtype = datasets.get(a.id) ?? null;
      expect(assessOpportunity(sig(a.id, a.kind, subtype, '')).family, `${a.id} (${a.kind}/${subtype})`).not.toBe('unknown');
    }
    for (const id of NON_ADAPTER_SOURCES) expect(assessOpportunity(sig(id, 'ask', null, '')).family).toBe('asking');
  });
});

describe('copy rules', () => {
  const BANNED = [/\bleads?\b/i, /they need you/i, /you will win/i, /\s[-–—]\s/, /[–—]/, /guarantee/i, /!/];
  const details = [
    {},
    { kinds: ['Roof', 'HVAC'], event: 'Severe Thunderstorm Warning', publicPost: true, residential: false, hailInches: 1 },
    { kinds: ['Tenant fit-out'], event: 'Freeze Warning', publicPost: false, residential: true },
  ];
  it('every reason, label and trade gives short plain copy with an uncertain line and no banned words', () => {
    for (const reason of OPPORTUNITY_REASONS) {
      for (const l of OPPORTUNITIES) {
        for (const trade of ['roofing', 'hvac', '', 'not-a-trade']) {
          for (const d of details) {
            const c = opportunityCopy(reason, trade, l, d);
            for (const [k, text] of Object.entries(c)) {
              expect(text.trim().length, `${reason} ${k}`).toBeGreaterThan(0);
              expect(text.length, `${reason} ${k}`).toBeLessThan(200);
              expect(text, `${reason} ${k}`).toMatch(/\.$/);
              for (const b of BANNED) expect(text, `${reason} ${k}: ${b}`).not.toMatch(b);
              // Never invents numbers ("311" is the service's name).
              expect(text.replace(/\b311\b/g, ''), `${reason} ${k}`).not.toMatch(/\d/);
              // Never says damage or a problem is confirmed.
              for (const m of text.matchAll(/confirmed/g)) expect(text.slice(Math.max(0, (m.index ?? 0) - 12), m.index), `${reason} ${k}`).toMatch(/not/);
              expect(text).not.toContain('undefined');
            }
          }
        }
      }
    }
  });
  it('names the trade by its category label', () => {
    expect(opportunityFor(permit('Roof permit in Austin', ['roofing']), 'siding-gutters').why).toContain('Siding and gutters');
    expect(opportunityFor(permit('HVAC permit in Austin', ['hvac']), 'hvac').why).toContain('an HVAC permit');
  });
});

describe('round 3 grading fixes', () => {
  it('roof and solar together is rooftop solar: nothing follows for gutters', () => {
    const s = permit('Roof and solar permit in Austin', ['roofing', 'solar']);
    expect(label(s, 'siding-gutters')).toBe('context');
  });
  it('a food truck licence is not a premises: no cleaning or pest contract', () => {
    const s = sig('socrata-chicago-business', 'civic', 'business', 'New business license in Chicago: Mobile Food License', ['janitorial-commercial']);
    expect(label(s, 'janitorial-commercial')).toBe('intel');
    expect(label(s, 'pest-control')).toBe('context');
  });
});

describe('round 4 grading fixes', () => {
  it('a Cincinnati CLOS-NO case is never Act now', () => {
    const s = { ...sig('socrata-cincinnati-311', 'civic', '311', '311 request in Cincinnati: Tall grass/weeds, private property', ['lawn-care']), summary: 'Tall grass/weeds, private property | CLOS-NO | 100 block of X' };
    expect(['intel', 'context']).toContain(label(s, 'lawn-care'));
  });
  it('wind damage with no trees named is not Act now for tree service', () => {
    const s = sig('spc', 'report', null, 'Wind damage reported near 1 N Delray, FL', [], { data: { type: 'wind', comments: 'Power lines down. (MFL)' } });
    expect(label(s, 'tree-service')).toBe('soon');
  });
  it('downstream HVAC on an addition says to contact the builder now', () => {
    const s = permit('Addition permit in Austin', ['general-contractor']);
    expect(opportunityFor(s, 'hvac').next).toMatch(/now/);
    expect(opportunityFor(s, 'painting').next).toMatch(/check back/);
  });
});

describe('round 5 grading fixes', () => {
  it('a category-only Austin violation is never Act now and says the repair is not named', () => {
    const s = sig('socrata-austin-violations', 'civic', 'violation', 'Code violation in Austin: Structure Condition Violation(s)', ['handyman', 'general-contractor']);
    expect(opportunityFor(s, 'handyman')).toMatchObject({ label: 'soon', reason: 'violation-general' });
    expect(label(s, 'general-contractor')).toBe('intel');
  });
  it('a fire sprinkler permit is not landscaping work', async () => {
    const { classifyText } = await import('@/lib/signals/categories');
    expect(classifyText('Sprinklers permit at 40 Wall St')).not.toContain('landscaping');
    expect(classifyText('lawn sprinkler repair')).toContain('landscaping');
  });
});
