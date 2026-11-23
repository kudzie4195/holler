/**
 * verify-v1 finding 2 (P1) and finding 7 (P2): the Atlanta `Name` column mixes a street address, a description and a name.
 * Commander decision 1: from such a column the rules pick a specific trade ONLY through a few anchored whole phrases that name the work
 * (roofing, tree removal, pool, solar), with negative guards, and never drop the general contractor the structured type column gave.
 * Everything else keeps the type column's trades so the scheduled AI step can refine it.
 *
 * Every input is run through parseArcgis on the real Atlanta config (Name = mixed column, TypeCombo / Subtype / Use_ = structured).
 */
import { describe, expect, it } from 'vitest';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import type { CategoryId } from '@/lib/signals/categories';

const atl = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-atlanta-permits')!;
const sorted = (c: readonly string[]) => [...c].sort();
const RA = 'Residential Alteration';
const CA = 'Commercial Alteration';
const RD = 'Residential Addition';
const GC: CategoryId[] = ['general-contractor'];
const REMODEL = 'Remodel permit in Atlanta';
// Round 15 re-grade #42, #43: a commercial alteration is a tenant fit-out (it routes to commercial cleaning, not house cleaning).
const FIT_OUT = 'Tenant fit-out permit in Atlanta';

function run(name: string, type: string, i: number) {
  const [r] = parseArcgis(
    {
      features: [
        {
          attributes: { RecordID: `BB-V1-${i}`, Opend: Date.UTC(2026, 10, 12), Name: name, TypeCombo: type, Subtype: '', Use_: '', Address: '1 MAIN ST NE' },
          geometry: { x: -84.39, y: 33.75 },
        },
      ],
    },
    atl,
  );
  return r;
}

// [Name, TypeCombo, categories, title]
type Case = [string, string, CategoryId[], string];

/** The verifier's inputs (verify-v1 r1-5, finding 2 and finding 7), with the answers decision 1 calls right. */
const VERIFIER: Case[] = [
  // finding 2: traps that picked a trade (each also dropped the general contractor)
  ['REPLACE ROOF TOP UNIT (RTU)', CA, GC, FIT_OUT],
  ['INSTALL ROOF MOUNTED SOLAR ARRAY', RA, ['solar', 'general-contractor'], 'Solar and remodel permit in Atlanta'],
  ['NEW ROOF DECK AND PERGOLA', RA, GC, REMODEL],
  ['INSTALL NEW ROOF HATCH LADDER', CA, GC, FIT_OUT],
  ['Water service replacement', RA, GC, REMODEL],
  ['NEW FLOOR & DECOR STORE #231', CA, GC, FIT_OUT],
  ['NEW SPA TENANT BUILD OUT', CA, GC, FIT_OUT],
  ['NEW POOL HALL TENANT BUILDOUT', CA, GC, FIT_OUT],
  ['INSTALL POOL TABLES AND BAR', CA, GC, FIT_OUT],
  ['NEW DOOR FELLOWSHIP CHURCH ALTERATION', CA, GC, FIT_OUT],
  ['NEW WINDOW WORLD SHOWROOM', CA, GC, FIT_OUT],
  ['THE NEW HOME COMPANY OFFICE ALTERATION', CA, GC, FIT_OUT],
  ['ABC TREE REMOVAL LLC OFFICE', CA, GC, FIT_OUT],
  ['SOLAR ENERGY SYSTEM SHOWROOM', CA, GC, FIT_OUT],
  // finding 2: traps that were already right
  ['POOLE RESIDENCE', RA, GC, REMODEL],
  ['12 SOLAR DR', RA, GC, REMODEL],
  ['PEACHTREE ROOFING SUPPLY CO', CA, GC, FIT_OUT],
  ['ROOF TOP BAR BUILD OUT', CA, GC, FIT_OUT],
  ['T-MOBILE ROOF TOP ANTENNA REPLACEMENT', CA, GC, FIT_OUT],
  ['200 AMP ST', RA, GC, REMODEL],
  // r1-5 reproductions
  ['456 PINE TREE DR NE', RD, GC, 'Addition permit in Atlanta'],
  ['DOLLAR TREE #4411 INTERIOR ALTERATION', CA, GC, FIT_OUT],
  ['LUXE NAIL SPA', CA, GC, FIT_OUT],
  ['POOL RESIDENCE', RA, GC, REMODEL],
  ['Install 20 solar panels on existing roof', RA, ['solar', 'general-contractor'], 'Solar and remodel permit in Atlanta'],
  // A sign is not one of the allowed work phrases: from the Name column it stays with the type column (the AI step refines it).
  ['wall sign for Restoration Hardware', CA, GC, FIT_OUT],
  // finding 7: real trade names. Only the allowed phrases pick a trade; the rest keep the general contractor for the AI step.
  ['Roof Replacement (RES)', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['REROOF', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['Re-Roofing', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['Roof repairs', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['Shingle replacement', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['Solar PV system', RA, ['solar', 'general-contractor'], 'Solar and remodel permit in Atlanta'],
  ['Swimming pool', RA, ['pool-spa', 'general-contractor'], 'Pool and remodel permit in Atlanta'],
  ['Tree removal', RA, ['tree-service', 'general-contractor'], 'Tree removal and remodel permit in Atlanta'],
  ['Metal roof install', RA, GC, REMODEL],
  ['HVAC changeout', RA, GC, REMODEL],
  ['Panel replacement', RA, GC, REMODEL],
  ['Water heater replacement', RA, GC, REMODEL],
  ['Sewer repair', RA, GC, REMODEL],
  ['Wood fence replacement', RA, GC, REMODEL],
  ['Window replacement', RA, GC, REMODEL],
  ['Retaining wall', RA, GC, REMODEL],
  ['Fire damage repair', RA, GC, REMODEL],
  ['Smith Residence - Roofing', RA, GC, REMODEL],
  ['Roofing (RES)', RA, GC, REMODEL],
  ['Roofing replacement', RA, GC, REMODEL],
  ['Residential roofing', RA, GC, REMODEL],
  ['Roof', RA, GC, REMODEL],
  ['A/C replacement', RA, GC, REMODEL],
  ['AC changeout', RA, GC, REMODEL],
  ['Furnace replacement', RA, GC, REMODEL],
  ['Heat pump replacement', RA, GC, REMODEL],
  ['HVAC', RA, GC, REMODEL],
  ['Mechanical - RTU replacement', CA, GC, FIT_OUT],
  ['Electrical', RA, GC, REMODEL],
  ['Generator', RA, GC, REMODEL],
  ['Plumbing', RA, GC, REMODEL],
  ['Gas line', RA, GC, REMODEL],
  ['Fence', RA, GC, REMODEL],
  ['6 ft privacy fence', RA, GC, REMODEL],
  ['Windows and doors', RA, GC, REMODEL],
  ['Siding', RA, GC, REMODEL],
  ['Gutters', RA, GC, REMODEL],
  ['Rooftop solar', RA, GC, REMODEL],
  ['Solar', RA, GC, REMODEL],
  ['Pool', RA, GC, REMODEL],
  ['Concrete driveway', RA, GC, REMODEL],
  ['Driveway', RA, GC, REMODEL],
];

/** 30 more of my own: real work phrases that must still map, and traps that must not. */
const MINE: Case[] = [
  // must map
  ['RE ROOF', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['REROOF 2 STORY HOUSE', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['Re-roof (tear off and replace)', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['ROOF REPLACEMENT - SHINGLES', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['Roof repair after storm', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['REPLACE ROOF', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['Replace the roof on rear porch', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['NEW ROOF (RES)', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['SHINGLE REPAIR REAR SLOPE', RA, ['roofing', 'general-contractor'], 'Roof and remodel permit in Atlanta'],
  ['REMOVE 2 TREES IN BACK YARD', RA, ['tree-service', 'general-contractor'], 'Tree removal and remodel permit in Atlanta'],
  ['NEW SWIMMING POOL AND SPA', RD, ['pool-spa', 'general-contractor'], 'Pool and addition permit in Atlanta'],
  ['POOL INSTALLATION', RD, ['pool-spa', 'general-contractor'], 'Pool and addition permit in Atlanta'],
  ['Pool renovation', RA, ['pool-spa', 'general-contractor'], 'Pool and remodel permit in Atlanta'],
  ['POOL DEMOLITION', RA, ['pool-spa', 'general-contractor'], 'Pool and remodel permit in Atlanta'],
  ['GROUND MOUNT SOLAR ARRAY', RA, ['solar', 'general-contractor'], 'Solar and remodel permit in Atlanta'],
  ['PHOTOVOLTAIC', RA, ['solar', 'general-contractor'], 'Solar and remodel permit in Atlanta'],
  ['Roof mounted PV system', RA, ['solar', 'general-contractor'], 'Solar and remodel permit in Atlanta'],
  // must not map
  ['NEW ROOF TOP UNIT', CA, GC, FIT_OUT],
  ['REPLACE ROOF CURB', CA, GC, FIT_OUT],
  ['NEW ROOF DRAIN', CA, GC, FIT_OUT],
  ['REPLACE ROOF ACCESS LADDER', CA, GC, FIT_OUT],
  ['NEW ROOF MOUNTED EXHAUST FAN', CA, GC, FIT_OUT],
  ['ROOF REPAIR LLC OFFICE', CA, GC, FIT_OUT],
  ['NEW POOL TABLE ROOM', CA, GC, FIT_OUT],
  ['SWIMMING POOL SUPPLY STORE', CA, GC, FIT_OUT],
  ['SOLAR PANEL OUTLET STORE', CA, GC, FIT_OUT],
  ['NEW HOME DEPOT GARDEN CENTER', CA, GC, FIT_OUT],
  ['Electrical service upgrade', RA, GC, REMODEL],
  ['New hardwood floors', RA, GC, REMODEL],
  ['NEW SPA', CA, GC, FIT_OUT],
];

describe('verify-v1 P1 #2 / P2 #7: Atlanta Name column, anchored work phrases only, the general contractor kept', () => {
  it('holds every verifier input plus 30 of my own, split between work phrases and traps', () => {
    expect(VERIFIER.length).toBeGreaterThanOrEqual(30);
    expect(MINE.length).toBe(30);
    expect(MINE.filter(([, , c]) => c.length > 1).length).toBeGreaterThanOrEqual(15);
    expect(MINE.filter(([, , c]) => c.length === 1).length).toBeGreaterThanOrEqual(12);
  });
  [...VERIFIER, ...MINE].forEach(([name, type, cats, title], i) => {
    it(`"${name}" / ${type} -> ${title}`, () => {
      const r = run(name, type, i);
      expect(r, name).toBeDefined();
      expect(sorted(r.categories)).toEqual(sorted(cats));
      expect(r.title).toBe(title);
    });
  });
  it('a hit in the Name column never removes the general contractor the type column gave', () => {
    for (const [name, type, cats] of [...VERIFIER, ...MINE]) {
      expect(run(name, type, 999).categories, `${name}`).toContain('general-contractor');
      void cats;
    }
  });
  it('a type column with no trade and no allowed phrase still drops the row (unchanged rule)', () => {
    expect(run('Example Pool Cabana (RES)', 'Residential Miscellaneous', 1000)).toBeUndefined();
    // an allowed phrase under a type with no trade gives that trade alone
    expect(run('REROOF', 'Residential Miscellaneous', 1001).categories).toEqual(['roofing']);
  });
});
