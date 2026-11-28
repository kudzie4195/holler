// Round 13 unit A (PLAN-2.0 items 0.1 to 0.3): the opportunity label table. Every registered source has an explicit rule, the audit
// cases from the 14-day review give the label the plan names, and the label is pure and deterministic.
import { describe, expect, it } from 'vitest';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { NON_ADAPTER_SOURCES } from '@/lib/signals/source-meta';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import {
  FALLBACK_LABEL,
  HANDLED_SUBTYPES,
  OPPORTUNITY_CHIP,
  OPPORTUNITY_LABELS,
  OPPORTUNITY_NOTE,
  RULES,
  SOURCE_DEFAULTS,
  isAlertLabel,
  labelFor,
  labelForMember,
  labelForTrades,
  ruleFor,
  type LabelInput,
  type OpportunityLabel,
} from '@/lib/signals/lead-rules';
import type { CategoryId } from '@/lib/signals/categories';
import { LABEL_PENDING_INTEGRATION } from '@/lib/signals/probation';
import { PROPOSED_LABELS } from '@/lib/signals/proposed-labels';
import { AUDIT_CASES, inputOf, liveRow } from './rules-audit-cases';

// Round 19 COVERAGE: lead-rules.ts belongs to another unit this round, so the new probation sources get their SOURCE_DEFAULTS entry at
// integration (lib/signals/probation.ts LABEL_PENDING_INTEGRATION lists them with the label each needs). Only those ids, and only while on
// probation (no member ever sees a label for them), may go without an entry; once an entry is added they are checked like any other.
const PENDING = new Set(ALL_ADAPTERS.filter((a) => a.probation && LABEL_PENDING_INTEGRATION.includes(a.id) && !(a.id in SOURCE_DEFAULTS)).map((a) => a.id));
// Round 20: a probation source whose label is PROPOSED (lib/signals/proposed-labels.ts) waits for promotion the same way.
for (const a of ALL_ADAPTERS) if (a.probation && a.id in PROPOSED_LABELS && !(a.id in SOURCE_DEFAULTS)) PENDING.add(a.id);
const REGISTERED = [...ALL_ADAPTERS.map((a) => a.id).filter((id) => !PENDING.has(id)), ...NON_ADAPTER_SOURCES];

describe('every registered source has an explicit rule (acceptance 1)', () => {
  it('lists a SOURCE_DEFAULTS entry for each adapter id and for holler-request', () => {
    const missing = REGISTERED.filter((id) => !(id in SOURCE_DEFAULTS));
    expect(missing).toEqual([]);
  });

  it('has no entry for a source that is not registered (a stale rule is a bug too)', () => {
    const stale = Object.keys(SOURCE_DEFAULTS).filter((id) => !REGISTERED.includes(id));
    expect(stale).toEqual([]);
  });

  it('a source may wait for its label only while it is on probation (round 19 coverage, round 20 proposed labels)', () => {
    for (const id of [...LABEL_PENDING_INTEGRATION, ...Object.keys(PROPOSED_LABELS)]) {
      const a = ALL_ADAPTERS.find((x) => x.id === id);
      if (a && !(id in SOURCE_DEFAULTS)) expect(a.probation, id).toBe(true);
    }
  });

  it('every default is a real label', () => {
    for (const [id, l] of Object.entries(SOURCE_DEFAULTS)) expect(OPPORTUNITY_LABELS, id).toContain(l);
  });

  it('every dataset subtype the Socrata and ArcGIS configs write is handled', () => {
    const written = new Set<string>();
    for (const d of [...SOCRATA_DATASETS, ...ARCGIS_DATASETS] as Array<{ subtype?: string }>) if (d.subtype) written.add(d.subtype);
    const unhandled = [...written].filter((s) => !(HANDLED_SUBTYPES as readonly string[]).includes(s));
    expect(unhandled).toEqual([]);
  });

  it('counts: explicit rules exist for 59 sources and 6 dataset subtypes, with the specific rules listed in RULES', () => {
    expect(REGISTERED.length).toBe(Object.keys(SOURCE_DEFAULTS).length);
    expect(Object.keys(SOURCE_DEFAULTS).length).toBeGreaterThanOrEqual(59);
    expect(HANDLED_SUBTYPES.length).toBe(6);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length); // ids are unique
  });

  it('a source nobody listed defaults to coming_soon, never to context (it must not silently vanish)', () => {
    expect(FALLBACK_LABEL).toBe('coming_soon');
    expect(labelFor({ source: 'brand-new-source', kind: 'civic', title: 'Anything at all' }, 'plumbing')).toBe('coming_soon');
    expect(labelFor({ source: 'brand-new-source' }, null)).toBe('coming_soon');
    expect(labelFor({ source: '' }, null)).toBe('coming_soon');
  });

  it('every label has a chip and a note and only act_now and coming_soon are alerts', () => {
    for (const l of OPPORTUNITY_LABELS) {
      expect(OPPORTUNITY_CHIP[l].length).toBeGreaterThan(0);
      expect(OPPORTUNITY_NOTE[l].length).toBeGreaterThan(0);
    }
    expect(OPPORTUNITY_LABELS.filter(isAlertLabel)).toEqual(['act_now', 'coming_soon']);
  });
});

// ---- table-driven audit cases ---------------------------------------------------------------------------------------------------
interface Case {
  name: string;
  sig: LabelInput;
  trade: CategoryId | null;
  want: OpportunityLabel;
}
const c311 = (source: string, rest: string) => ({ source, kind: 'civic', subtype: '311', title: `311 request in X: ${rest}` });
const permit = (title: string) => ({ source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit', title });

const CASES: Case[] = [
  // context: public work and city property (item 0.2)
  { name: 'Chicago graffiti removal for a painter', sig: c311('socrata-chicago-311', 'Graffiti Removal Request'), trade: 'painting', want: 'context' },
  { name: 'Austin public-property graffiti', sig: c311('socrata-austin-311', 'APH - Graffiti Abatement - Public Property'), trade: 'painting', want: 'context' },
  { name: 'Austin "paint or graffiti" (assumed public)', sig: c311('socrata-austin-311', 'paint or graffiti'), trade: 'painting', want: 'context' },
  { name: 'SF public graffiti', sig: c311('socrata-sf-311', 'Graffiti Public / not_offensive'), trade: 'painting', want: 'context' },
  { name: 'Chicago city tree trim', sig: c311('socrata-chicago-311', 'Tree Trim Request (NO LONGER BEING ACCEPTED)'), trade: 'tree-service', want: 'context' },
  { name: 'Chicago tree removal inspection', sig: c311('socrata-chicago-311', 'Tree Removal Inspection'), trade: 'tree-service', want: 'context' },
  { name: 'Chicago tree planting', sig: c311('socrata-chicago-311', 'Tree Planting Request'), trade: 'tree-service', want: 'context' },
  { name: 'Austin tree issue in the right of way', sig: c311('socrata-austin-311', 'TPW - Tree Issue Right of Way'), trade: 'tree-service', want: 'context' },
  { name: 'NYC damaged tree', sig: c311('socrata-nyc-311', 'Damaged Tree / Tree Leaning/Uprooted'), trade: 'tree-service', want: 'context' },
  { name: 'Chicago sewer cleaning inspection', sig: c311('socrata-chicago-311', 'Sewer Cleaning Inspection Request'), trade: 'plumbing', want: 'context' },
  { name: 'NYC catch basin clogged', sig: c311('socrata-nyc-311', 'Sewer Maintenance / Catch Basin Clogged'), trade: 'plumbing', want: 'context' },
  { name: 'SF sewer flooding on the street', sig: c311('socrata-sf-311', 'Sewer / flooding'), trade: 'plumbing', want: 'context' },
  { name: 'Dallas storm sewer line locate', sig: c311('socrata-dallas-311', 'Storm Sewer Line Locate - DWU'), trade: 'plumbing', want: 'context' },
  { name: 'Oakland city building plumbing', sig: c311('socrata-oakland-311', 'BLDGMAINT / City Bldg - Plumbing'), trade: 'plumbing', want: 'context' },
  { name: 'Austin debris in the street', sig: c311('socrata-austin-311', 'TPW - Debris in Street'), trade: 'junk-removal', want: 'context' },
  { name: 'Chicago fly dumping', sig: c311('socrata-chicago-311', 'Fly Dumping Complaint'), trade: 'junk-removal', want: 'context' },
  { name: 'Kansas City missed trash', sig: c311('socrata-kansascity-311', 'Trash Recycling Bulky Services / Missed Trash'), trade: 'junk-removal', want: 'context' },
  { name: 'Chicago vacant lot clean-up', sig: c311('socrata-chicago-311', 'Clean Vacant Lot Request'), trade: 'junk-removal', want: 'context' },
  { name: 'Chicago rodent baiting', sig: c311('socrata-chicago-311', 'Rodent Baiting/Rat Complaint'), trade: 'pest-control', want: 'context' },
  { name: 'Dallas street lighting', sig: c311('socrata-dallas-311', 'Street Lighting- New/Relocation - TPW'), trade: 'electrical', want: 'context' },
  { name: 'NYC plaza event for catering', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in Queens: Plaza Event' }, trade: 'catering', want: 'context' },
  { name: 'NYC special event for security (not a caterer)', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in Queens: Special Event at Central Park: Dene Lawn' }, trade: 'security', want: 'context' },
  { name: 'NYC special event for cleaning (not a caterer)', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in Queens: Special Event at Prospect Park' }, trade: 'cleaning', want: 'context' },
  { name: 'Chicago sewer cleaning inspection (city sewer main, no private-property field)', sig: c311('socrata-chicago-311', 'Sewer Cleaning Inspection Request'), trade: 'plumbing', want: 'context' },
  { name: 'SF sewer flooding for plumbing (public sewer work)', sig: c311('socrata-sf-311', 'Sewer / flooding'), trade: 'plumbing', want: 'context' },
  { name: 'Chicago park permit event', sig: { source: 'socrata-chicago-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in X: Permit - Event 1 Cluster 3' }, trade: 'security', want: 'context' },
  { name: 'blanket business license for a locksmith', sig: { source: 'socrata-nyc-business', kind: 'civic', subtype: 'business', title: 'New business license' }, trade: 'locksmith', want: 'context' },
  { name: 'blanket business license for insurance', sig: { source: 'socrata-sf-business', kind: 'civic', subtype: 'business', title: 'New business license' }, trade: 'insurance', want: 'context' },
  { name: 'blanket business license for business services', sig: { source: 'socrata-la-business', kind: 'civic', subtype: 'business', title: 'New business license' }, trade: 'business-services', want: 'context' },

  // act_now: someone has to fix something or has asked (item 0.3)
  // round 19 RULES (audited list, lines 1 to 3): heat is feed only for plumbing, one apartment is feed only for HVAC, and a whole building is
  // HVAC act now only at its third complaint in 48 hours (tests/signals/rules-audit.test.ts).
  { name: 'NYC heat and hot water, entire building, for plumbing (line 2)', sig: c311('socrata-nyc-311', 'HEAT/HOT WATER / ENTIRE BUILDING'), trade: 'plumbing', want: 'market_insight' },
  { name: 'NYC heat, apartment only (line 1)', sig: c311('socrata-nyc-311', 'HEAT/HOT WATER / APARTMENT ONLY'), trade: 'hvac', want: 'market_insight' },
  { name: 'NYC non-residential heat', sig: c311('socrata-nyc-311', 'Non-Residential Heat / Inadequate or No Heat'), trade: 'hvac', want: 'act_now' },
  { name: 'Cincinnati no-heat hazard', sig: c311('socrata-cincinnati-311', 'HEAT, NO HEAT HAZARD'), trade: 'hvac', want: 'act_now' },
  // round 19 line 16: an order that names no repair is a heads-up for the tagged trades and feed only for the general contractor
  { name: 'Chicago code violation naming no repair (line 16)', sig: { source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation' }, trade: 'general-contractor', want: 'market_insight' },
  { name: 'Chicago order naming a repair (line 13)', sig: { source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: REPAIR EXTERIOR WALL' }, trade: 'general-contractor', want: 'act_now' },
  { name: 'Austin code violation naming no repair (line 16)', sig: { source: 'socrata-austin-violations', kind: 'civic', subtype: 'violation', title: 'Code violation' }, trade: 'junk-removal', want: 'coming_soon' },
  { name: 'DeKalb code violation naming no repair (line 16)', sig: { source: 'arcgis-dekalb-violations', kind: 'civic', subtype: 'violation', title: 'Code violation' }, trade: 'lawn-care', want: 'coming_soon' },
  { name: 'failed food inspection for pest control (line 19)', sig: { source: 'socrata-nyc-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection' }, trade: 'pest-control', want: 'coming_soon' },
  // Round 15 quality gate: a failed inspection is no house-cleaning job (stored rows still tagged cleaning are context)
  { name: 'failed food inspection for a house cleaner (context)', sig: { source: 'socrata-chicago-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection' }, trade: 'cleaning', want: 'context' },
  { name: 'failed food inspection for commercial cleaning (line 20, owner call 6 NO)', sig: { source: 'socrata-chicago-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection' }, trade: 'janitorial-commercial', want: 'market_insight' },
  // Round 15 quality gate (Q-grades #41-#50, #26): event permits and mobile-food licences are not building work
  { name: 'NYC street event for house cleaning (event-permit blanket tag)', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in New York City: Street Event at 5 AVENUE' }, trade: 'cleaning', want: 'context' },
  { name: 'NYC farmers market for security (event-permit blanket tag)', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in New York City: Farmers Market' }, trade: 'security', want: 'context' },
  { name: 'Mobile Food Services licence for HVAC', sig: { source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Mobile Food Services' }, trade: 'hvac', want: 'context' },
  { name: 'Outdoor patio liquor licence for HVAC (final review P2-6)', sig: { source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Outdoor Patio, Sale of Liquor' }, trade: 'hvac', want: 'context' },
  { name: 'Consumption on premises licence for HVAC', sig: { source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Consumption on Premises - Incidental Activity' }, trade: 'hvac', want: 'context' },
  { name: 'A restaurant that also sells liquor is no HVAC card (line 25)', sig: { source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Retail Food Establishment, Sale of Liquor' }, trade: 'hvac', want: 'context' },
  { name: 'Mobile food licence for pest control', sig: { source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Mobile Food Dispenser' }, trade: 'pest-control', want: 'context' },
  { name: 'Retail food licence for HVAC (line 25: the licence says nothing about heating)', sig: { source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Retail Food Establishment' }, trade: 'hvac', want: 'context' },
  { name: 'Retail food licence for pest control (line 24)', sig: { source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Retail Food Establishment' }, trade: 'pest-control', want: 'coming_soon' },
  { name: 'new business licence for house cleaning (blanket tag)', sig: { source: 'socrata-sf-business', kind: 'civic', subtype: 'business', title: 'New business license in San Francisco: Retail' }, trade: 'cleaning', want: 'context' },
  { name: 'new business licence for commercial cleaning keeps its alert', sig: { source: 'socrata-sf-business', kind: 'civic', subtype: 'business', title: 'New business license in San Francisco: Retail' }, trade: 'janitorial-commercial', want: 'coming_soon' },
  { name: 'failed food inspection for plumbing (a repair trade: only possibly needed)', sig: { source: 'socrata-nyc-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection' }, trade: 'plumbing', want: 'coming_soon' },
  { name: 'failed food inspection for a general contractor (line 21)', sig: { source: 'socrata-chicago-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection' }, trade: 'general-contractor', want: 'context' },
  { name: 'failed food inspection for a food truck (line 21)', sig: { source: 'socrata-nyc-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection' }, trade: 'food-truck', want: 'context' },
  { name: 'SF sewage back-up', sig: c311('socrata-sf-311', 'Sewer / sewage_back-up_discharge'), trade: 'plumbing', want: 'act_now' },
  { name: 'NYC sewer back-up', sig: c311('socrata-nyc-311', 'Sewer Maintenance / Backup'), trade: 'plumbing', want: 'act_now' },
  { name: 'Kansas City sewer backup', sig: c311('socrata-kansascity-311', 'Sewer and Stormwater / Sewer Backup'), trade: 'plumbing', want: 'act_now' },
  { name: 'SF graffiti on PRIVATE property', sig: c311('socrata-sf-311', 'Graffiti Private / not_offensive'), trade: 'painting', want: 'act_now' },
  { name: 'Kansas City property violation (line 9)', sig: c311('socrata-kansascity-311', 'Property Violations / Weeds'), trade: 'lawn-care', want: 'coming_soon' },
  { name: 'SPC wind damage report naming trees (line 39)', sig: { source: 'spc', kind: 'report', title: 'Wind damage reported', summary: 'Several trees and tree limbs down in the yard.' }, trade: 'tree-service', want: 'act_now' },
  { name: 'SPC wind damage report naming no trees (line 39)', sig: { source: 'spc', kind: 'report', title: 'Wind damage reported' }, trade: 'tree-service', want: 'coming_soon' },
  { name: 'SPC tornado report', sig: { source: 'spc', kind: 'report', title: 'Tornado reported near Marietta' }, trade: 'roofing', want: 'act_now' },
  { name: 'SPC hail report', sig: { source: 'spc', kind: 'report', title: 'hail reported' }, trade: 'roofing', want: 'act_now' },
  { name: 'a resident request on Holler', sig: { source: 'holler-request', kind: 'ask', title: 'Looking for a roofer' }, trade: 'roofing', want: 'act_now' },
  { name: 'an open federal bid placed in a city', sig: { source: 'sam-gov', kind: 'contract', title: 'Federal bid in Denver, CO: Janitorial services', summary: 'Solicitation | GSA | NAICS 561720' }, trade: 'janitorial-commercial', want: 'act_now' },
  { name: 'a federal notice that is not open yet (line 44)', sig: { source: 'sam-gov', kind: 'contract', title: 'Federal bid in Denver, CO: Janitorial services', summary: 'Sources Sought | GSA | NAICS 561720' }, trade: 'janitorial-commercial', want: 'coming_soon' },
  { name: 'a federal bid naming a state and no city (UNIFY review defect 2)', sig: { source: 'sam-gov', kind: 'contract', title: 'Federal bid in GA: Grounds maintenance services' }, trade: 'landscaping', want: 'market_insight' },
  { name: 'a public post asking for a plumber', sig: { source: 'bluesky', kind: 'ask', title: 'anyone know a plumber' }, trade: 'plumbing', want: 'act_now' },

  // a measured gust is not a damage report (review P1-1): coming_soon, never act_now
  ...['60', '61', '62', '68', '69'].map((mph): Case => ({ name: `SPC ${mph} mph wind gust (no damage reported) for a tree service`, sig: { source: 'spc', kind: 'report', title: `${mph} mph wind gust reported` }, trade: 'tree-service', want: 'coming_soon' })),
  { name: 'SPC measured gust for insurance (line 38)', sig: { source: 'spc', kind: 'report', title: '62 mph wind gust reported near Smyrna' }, trade: 'insurance', want: 'context' },
  { name: 'SPC measured gust for roofing (line 40)', sig: { source: 'spc', kind: 'report', title: '62 mph wind gust reported near Smyrna' }, trade: 'roofing', want: 'market_insight' },
  { name: 'SPC 1.75 inch hail for auto body (line 41)', sig: { source: 'spc', kind: 'report', title: '1.75 inch hail reported near Smyrna' }, trade: 'auto-body', want: 'act_now' },

  // disputed groups decided from sample rows (round 13 review): see A-report.md "Disputed context groups"
  { name: 'SF sewer flooding for restoration, not on a property (line 7)', sig: c311('socrata-sf-311', 'Sewer / flooding'), trade: 'restoration', want: 'context' },
  { name: 'SF sewer flooding on_property for restoration (line 7)', sig: { ...c311('socrata-sf-311', 'Sewer / flooding'), summary: 'Sewer | flooding | on_property' }, trade: 'restoration', want: 'coming_soon' },
  // round 19 line 27: an event permit is a heads-up only when it names an event people are hired for
  { name: 'NYC special event at a park for a caterer (line 27: no named event)', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in New York City: Special Event at Central Park: Dene Lawn' }, trade: 'catering', want: 'market_insight' },
  { name: 'NYC special event for event services (line 27)', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in New York City: Special Event' }, trade: 'event-services', want: 'market_insight' },
  { name: 'NYC farmers market for a food truck (line 27: a named event)', sig: { source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Permitted event in New York City: Farmers Market' }, trade: 'food-truck', want: 'coming_soon' },
  { name: 'Cambridge sewer pipe boundary (private side is the owner\'s)', sig: c311('socrata-cambridge-311', 'Sewer pipe boundary'), trade: 'plumbing', want: 'coming_soon' },
  { name: 'rodent baiting stays city work (free city service)', sig: c311('socrata-chicago-311', 'Rodent Baiting/Rat Complaint'), trade: 'pest-control', want: 'context' },

  // a city name never fires a title pattern: only the part after ": " is tested (review P2-4)
  { name: '"Park Ridge" in the city part is not a park', sig: { source: 'socrata-chicago-311', kind: 'civic', subtype: '311', title: '311 request in Park Ridge: Mold complaint in a building' }, trade: 'restoration', want: 'coming_soon' },
  { name: '"Oak Park" in the city part is not a park', sig: { source: 'socrata-chicago-311', kind: 'civic', subtype: '311', title: '311 request in Oak Park: Mold complaint in a building' }, trade: 'restoration', want: 'coming_soon' },

  // private property: the owner pays, so not context even when the words look like city work
  { name: 'Cincinnati dead tree on PRIVATE property', sig: c311('socrata-cincinnati-311', 'TREE, DEAD ON PRIV PROP STNDRD'), trade: 'tree-service', want: 'coming_soon' },
  { name: 'Cincinnati dumping on PRIVATE property', sig: c311('socrata-cincinnati-311', 'DUMPING, PRV PROP <2500 SQ FT'), trade: 'junk-removal', want: 'coming_soon' },

  // coming_soon: evidence of likely future demand
  { name: 'NWS flood advisory for restoration (line 32: feed only)', sig: { source: 'nws', kind: 'alert', title: 'Flood Advisory' }, trade: 'restoration', want: 'market_insight' },
  { name: 'NWS wind advisory for a tree service (line 34: feed only)', sig: { source: 'nws', kind: 'alert', title: 'Wind Advisory' }, trade: 'tree-service', want: 'market_insight' },
  { name: 'NWS high wind warning for a tree service', sig: { source: 'nws', kind: 'alert', title: 'High Wind Warning: Laramie' }, trade: 'tree-service', want: 'coming_soon' },
  // Round 33 (HOLLER_HAIL_ROUTING_ENABLED): the facts arrive only with the switch on (weatherFactsOf); here they are given directly.
  { name: 'NWS high wind watch naming 60 mph gusts, siding and gutters (hazard-route: feed only, a watch)', sig: { source: 'nws', kind: 'alert', title: 'High Wind Watch: Central Laramie County', weather: { hailInches: null, gustMph: 60 } }, trade: 'siding-gutters', want: 'market_insight' },
  { name: 'NWS severe thunderstorm warning naming 1.75 inch hail, roofing (hazard-route: heads-up)', sig: { source: 'nws', kind: 'alert', title: 'Severe Thunderstorm Warning: Seward, NE', weather: { hailInches: 1.75, gustMph: null } }, trade: 'roofing', want: 'coming_soon' },
  { name: 'a new home permit for a mover (downstream)', sig: permit('New home permit in X'), trade: 'moving', want: 'coming_soon' },
  { name: 'a new home permit for real estate (downstream)', sig: permit('New home permit in X'), trade: 'real-estate', want: 'coming_soon' },
  { name: 'a demolition permit for junk removal (line 53: the demolition contractor hauls)', sig: permit('Demolition permit in X'), trade: 'junk-removal', want: 'market_insight' },
  { name: 'round 18 review: an alteration with interior demolition (tagged junk-removal, titled by the alteration) for junk removal', sig: permit('Tenant fit-out permit in X'), trade: 'junk-removal', want: 'coming_soon' },
  { name: 'a re-roof permit for a gutter company (downstream, item 1.1)', sig: permit('Roof permit in X'), trade: 'siding-gutters', want: 'coming_soon' },
  { name: 'FAA ground stop for rideshare (line 43)', sig: { source: 'faa', kind: 'travel', title: 'Ground stop' }, trade: 'rideshare-delivery', want: 'market_insight' },
  { name: 'NYC rodent sighting (line 11, owner call 5: feed only)', sig: c311('socrata-nyc-311', 'Rodent / Rat Sighting'), trade: 'pest-control', want: 'market_insight' },

  // market_insight: a permit in the member's OWN trade, an awarded contract
  { name: 'roof permit for a roofer', sig: permit('Roof permit in X'), trade: 'roofing', want: 'market_insight' },
  { name: 'electrical permit for an electrician', sig: permit('Electrical permit in X'), trade: 'electrical', want: 'market_insight' },
  { name: 'HVAC permit for an HVAC company', sig: permit('HVAC permit in X'), trade: 'hvac', want: 'market_insight' },
  { name: 'roof and demolition permit, roofing member', sig: permit('Roof and demolition permit in X'), trade: 'roofing', want: 'market_insight' },
  { name: 'awarded federal contract', sig: { source: 'usaspending', kind: 'contract', title: 'Federal contract' }, trade: 'plumbing', want: 'market_insight' },
  { name: 'awarded federal contract with no trade', sig: { source: 'usaspending', kind: 'contract', title: 'Federal contract' }, trade: null, want: 'market_insight' },

  // round 15 re-grade (Q2): stored rows from before the ingest changes
  { name: 'stored M4.2 quake for a plumber', sig: { source: 'usgs', kind: 'quake', title: 'M4.2 earthquake 5 km SW of Town, CA' }, trade: 'plumbing', want: 'context' },
  { name: 'stored M4.2 quake for restoration', sig: { source: 'usgs', kind: 'quake', title: 'M4.2 earthquake 5 km SW of Town, CA' }, trade: 'restoration', want: 'context' },
  { name: 'M4.2 quake for insurance (line 42)', sig: { source: 'usgs', kind: 'quake', title: 'M4.2 earthquake 5 km SW of Town, CA' }, trade: 'insurance', want: 'context' },
  { name: 'M5.1 quake for a plumber (line 42)', sig: { source: 'usgs', kind: 'quake', title: 'M5.1 earthquake 5 km SW of Town, CA' }, trade: 'plumbing', want: 'context' },
  { name: 'M5.1 quake for restoration (line 42)', sig: { source: 'usgs', kind: 'quake', title: 'M5.1 earthquake 5 km SW of Town, CA' }, trade: 'restoration', want: 'coming_soon' },
  { name: 'stored flood advisory for a plumber', sig: { source: 'nws', kind: 'alert', title: 'Flood Advisory: Los Angeles, CA' }, trade: 'plumbing', want: 'context' },
  { name: 'stored flood statement for a plumber', sig: { source: 'nws', kind: 'alert', title: 'Flood Statement: Fulton, GA' }, trade: 'plumbing', want: 'context' },
  { name: 'flood advisory for restoration (line 32)', sig: { source: 'nws', kind: 'alert', title: 'Flood Advisory: Los Angeles, CA' }, trade: 'restoration', want: 'market_insight' },
  { name: 'flash flood warning for a plumber (line 31)', sig: { source: 'nws', kind: 'alert', title: 'Flash Flood Warning: Los Angeles, CA' }, trade: 'plumbing', want: 'context' },
  { name: 'flash flood warning for restoration (line 32)', sig: { source: 'nws', kind: 'alert', title: 'Flash Flood Warning: Los Angeles, CA' }, trade: 'restoration', want: 'coming_soon' },
  // a keyword-only match has no trade: a code violation keeps act now (the trade rules need a trade)
  { name: 'code violation seen through a keyword watch', sig: { source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: REPAIR PORCH SYSTEM' }, trade: null, want: 'act_now' },
  // a keyword-only match has no trade: the permit keeps its source default and is not silently dropped
  { name: 'permit seen through a keyword watch', sig: permit('Roof permit in X'), trade: null, want: 'coming_soon' },
];

describe('label audit cases (table-driven)', () => {
  it.each(CASES)('$name -> $want', ({ sig, trade, want }) => {
    expect(labelFor(sig, trade)).toBe(want);
  });

  it('covers all four labels', () => {
    expect(new Set(CASES.map((c) => c.want))).toEqual(new Set(OPPORTUNITY_LABELS));
  });

  it('every rule in RULES is exercised by at least one audit case (here or in the round 19 cases on live rows)', () => {
    const used = new Set<string>();
    for (const c of CASES) {
      const r = ruleFor(c.sig, c.trade);
      if (r) used.add(r.id);
    }
    for (const c of AUDIT_CASES) {
      if (c.want === 'none') continue;
      const r = ruleFor(inputOf(liveRow(c.row), { noLocation: c.noLocation }), c.trade);
      if (r) used.add(r.id);
    }
    // decided by an ingest mark or a location, tested in tests/signals/rules-audit.test.ts
    for (const id of ['ctx-undeliverable', 'closed-case', 'heat-per-building', 'stage-finished-downstream']) used.add(id);
    const unused = RULES.map((r) => r.id).filter((id) => !used.has(id));
    expect(unused).toEqual([]);
  });
});

describe('same-trade permits become market_insight; no trade is added to permits', () => {
  it('a permit is market_insight for the trade that does the work, whatever the permit says', () => {
    for (const t of ['roofing', 'electrical', 'plumbing', 'hvac', 'general-contractor', 'solar', 'fencing'] as CategoryId[]) {
      expect(labelFor(permit('Any permit in X'), t), t).toBe('market_insight');
    }
  });

  it('the best label across the trades a record carries wins; a member sees the record once', () => {
    const sig = permit('Roof permit in X');
    expect(labelForTrades(sig, ['roofing', 'siding-gutters'])).toBe('coming_soon');
    expect(labelForTrades(sig, ['roofing'])).toBe('market_insight');
    expect(labelForMember({ ...sig, categories: ['roofing'] }, ['siding-gutters', 'plumbing'])).toBe('coming_soon');
    expect(labelForMember({ ...sig, categories: ['roofing'] }, ['plumbing'])).toBe('coming_soon'); // none shared: trade unknown
  });
});

describe('the label is pure and deterministic', () => {
  it('same input, same label, over repeated calls and in a different order', () => {
    const first = CASES.map((c) => labelFor(c.sig, c.trade));
    const again = CASES.map((c) => labelFor({ ...c.sig }, c.trade));
    const reversed = [...CASES].reverse().map((c) => labelFor(c.sig, c.trade)).reverse();
    expect(again).toEqual(first);
    expect(reversed).toEqual(first);
  });

  it('does not mutate its input and does not read the clock', () => {
    const sig: LabelInput = { source: 'nws', kind: 'alert', title: 'Flash Flood Warning' };
    const copy = JSON.stringify(sig);
    labelFor(sig, 'restoration');
    expect(JSON.stringify(sig)).toBe(copy);
    const realNow = Date.now;
    Date.now = () => {
      throw new Error('clock read');
    };
    try {
      expect(labelFor(sig, 'restoration')).toBe('coming_soon');
    } finally {
      Date.now = realNow;
    }
  });

  it('case and spacing of source and subtype do not change the label', () => {
    expect(labelFor({ source: ' SPC ', kind: 'report', title: 'hail reported' }, 'roofing')).toBe('act_now');
    expect(labelFor({ source: 'socrata-chicago-violations', subtype: ' Violation ', title: 'Code violation in Chicago: LEAKING PIPE' }, 'plumbing')).toBe('act_now');
  });

  it('is client-safe: the module imports nothing from the server', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('lib/signals/lead-rules.ts', 'utf8');
    const imports = [...src.matchAll(/^import [^;]*? from '([^']+)'/gm)].map((m) => m[1]);
    // each of these is pure too: no server import, no clock (permit-routing.ts: tests/signals/permit-routing.test.ts; the others below)
    expect(imports).toEqual(['./categories', './carry', './permit-routing', './permit-value', './rule-choices', './sam-labels-switch', './mapping/business-flag', './weather-hazard', './pw-switch']);
    // round 33: the licence switch reader has no imports at all (round 35: nor has the pw switch reader)
    expect(readFileSync('lib/signals/mapping/business-flag.ts', 'utf8')).not.toMatch(/^import /m);
    expect(readFileSync('lib/signals/pw-switch.ts', 'utf8')).not.toMatch(/^import /m);
    // Round 33: weather-hazard.ts reads HOLLER_HAIL_ROUTING_ENABLED at call time (hailRoutingEnabled); nothing else in it is impure.
    for (const f of ['carry', 'rule-choices', 'permit-value', 'sam-labels-switch', 'weather-hazard']) {
      const dep = readFileSync(`lib/signals/${f}.ts`, 'utf8');
      expect([...dep.matchAll(/^import (?!type ).* from '([^']+)'/gm)].map((m) => m[1]).filter((m) => !m.startsWith('./')), f).toEqual([]);
      expect(dep, f).not.toMatch(/server-only|Date\.now|new Date\(\)|Math\.random/);
    }
    expect(src).not.toMatch(/server-only|Date\.now|new Date\(\)|Math\.random/);
  });
});

describe('wording rule', () => {
  it('no member-facing text in the table says lead, "they need you", "you will win" or guaranteed', () => {
    const text = [...Object.values(OPPORTUNITY_CHIP), ...Object.values(OPPORTUNITY_NOTE), ...RULES.map((r) => r.why)].join('\n');
    expect(text).not.toMatch(/\blead(s)?\b/i);
    expect(text).not.toMatch(/they need you|you will win|guaranteed|official record/i);
  });
});
