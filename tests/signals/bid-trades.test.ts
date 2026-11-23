/**
 * Fixture provenance
 *  - tests/signals/adapters/fixtures/bids-{sf,la,batonrouge,nyc}-live-2026-11-21.json: 72 rows copied from the live portals' first pages on
 *    2026-11-21 through WebFetch (the shell had no network). SF and LA: first 20 rows, all fields. Baton Rouge: first 20 upcoming rows,
 *    contact and room columns left out. NYC: first 12 rows, contact, address and long description columns left out. Row text is as served,
 *    except one U+FFFD in a Baton Rouge title that was typed as a hyphen.
 *  - HELD_OUT below: 48 titles from rows 20 to 49 of SF and LA, fetched AFTER the keyword table was written (lib/signals/bid-trades.ts).
 *    Only title and category were kept. Two held-out titles are left out as ambiguous (see AMBIGUOUS).
 * Expected trades are the author's reading of the title against the 14 trades in the strategy doc, written before running the table on
 * each list. They are one person's judgment, not an independent review.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bidTrades } from '@/lib/signals/bid-trades';
import { isCategoryId, type CategoryId } from '@/lib/signals/categories';

const fx = (n: string): Record<string, unknown>[] => JSON.parse(readFileSync(join(__dirname, 'adapters', 'fixtures', `bids-${n}-live-2026-11-21.json`), 'utf8'));

const firstLine = (s: unknown) => String(s).split('\n')[0];

/** [portal, title as served, category as served, expected trades]. Every in-sample bid that SHOULD get a trade. */
const IN_SAMPLE_POSITIVE: [string, string, string | null, CategoryId[]][] = [
  ['sf', 'TC78150 Citywide Landscaping Services', 'Personal Services', ['landscaping']],
  ['la', 'BEST VALUE | RFQ/BID #2710078 & 2710079 | DISTRICT ADMINISTRATIVE OFFICE | REPLACE COOLING TOWERS & CHILLER (PSA)', 'Construction', ['hvac']],
  ['batonrouge', 'A26-1115 - Janitorial Services for the Dept. of Maintenance', null, ['janitorial-commercial', 'cleaning']],
  ['batonrouge', 'CORA DRIVE SIDEWALK IMPROVEMENTS CITY PARISH PROJECT NO. 24-EN-HC-0025', null, ['concrete-paving']],
  ['batonrouge', 'A26-91082 Window Washing Library Sites', null, ['janitorial-commercial', 'cleaning']],
  ['batonrouge', 'McHOST ROAD IMPRV 2 (LA Hwy 64 - Port Hudson - Pride Rd) 20-EN-HC-0107', null, ['concrete-paving']],
  ['batonrouge', '26-1500 DDD Interstate Underpass Gateway Lighting', null, ['electrical']],
  ['batonrouge', 'PARISHWIDE PAVEMENT RE-MARKING CITY-PARISH PROJECT No. 26-TS-CI-0026', null, ['concrete-paving']],
  ['nyc', 'HWXPRATT - RECONSTRUCTION OF PRATT AVENUE RETAINING WALL, THE BRONX', 'Construction Related Services', ['concrete-paving']],
  ['nyc', 'Hunter College - West Building Lower Roofs Replacement', 'Construction/Construction Services', ['roofing']],
  ['nyc', 'Temporary Security Staffing', 'Services (other than human services)', ['security']],
  ['nyc', 'Electrical System Replacement - 156 South 9th Street, Brooklyn', 'Construction/Construction Services', ['electrical']],
  ['nyc', 'Correction: Jacobi Building 1 Roof 2', 'Construction/Construction Services', ['roofing']],
];

/** In-sample titles a person could read a trade into but the table does not name: listed so the miss is on the record, not hidden. */
const IN_SAMPLE_KNOWN_MISSES = [
  'IMAGINATION WAY (ARDENWOOD DR. TO LOBDELL BLVD. CONNECTOR) CITY-PARISH PROJECT NO. 20-CP-HC-0017', // a road project; the title never says road
  'CM/GC Powell St Imprv Prjt Trade Package', // street improvement trade package; trades not named
  'PW 887 Ptrr Tnnt Imprv & Fire', // tenant improvement and fire work, abbreviated
  'FMC-ROLLUP DOOR-2027 - Installation and Repair of overhead roll up doors, Citywide', // doors are not one of the 14 trades
];

/** Titles from rows the table never saw. [title, category, expected]. Every one is expected to get NO trade: the feeds are mostly goods, software and social services. */
const HELD_OUT: [string, string, CategoryId[]][] = [
  ['EXT AIR | 50433 Credit Liquidity and Bond Purchase', 'Personal Services', []],
  ['EXT AIR | T3 BA/E TRAVEL CONVENIENCE STORE, SBSA', 'Personal Services', []],
  ['OCA FIR | Starlink Performance Kits & Accessories', 'Personal Services', []],
  ['EXT AIR | RFP 11211.52 SFO CUPT RMS/AODB IMSS', 'Personal Services', []],
  ['OCA DT | TM3 RedSky E911 Cloud Service License', 'Commodity', []],
  ['OCA AIR | TC68415 Disposal of Biosolids', 'Personal Services', []],
  ['OCA DAT | TM3 – Nintex Software License Renewal', 'Commodity', []],
  ['CHF | 2027 Our415 Request for Proposals', 'Personal Services', []],
  ['CHF | Student Success Fnd Technical Assistance RFP', 'Personal Services', []],
  ['EXT HSA | RFP 1269 Senior Accompaniment Services', 'Personal Services', []],
  ['EXT AIR | TERMINAL 3 EAST VIDEO GAME LOUNGE LEASE', 'Personal Services', []],
  ['OCA AIR | TM3 - ReadyAPI License', 'Personal Services', []],
  ['EXT HSA | RFP 1280 Supportive Services for Former', 'Personal Services', []],
  ['DPH | Black Wellness Initiative', 'Personal Services', []],
  ['OCA | TC71846 Closed Loop Solvents &Rental Service', 'Personal Services', []],
  ['EXT PUC | Construction & Prof Services', 'Commodity', []],
  ['EXT AIR | As-Needed Airport Conveyance Maintenance', 'Personal Services', []],
  ['OCA POL | TM3 – Magnet Graykey Software Lic. RNWL', 'Commodity', []],
  ['90927 Large Power Transformers and Variable Shunt Reactors...', 'Commodity', []],
  ['90929 Best Management Practices for Stormwater Regulatory Compliance', 'Personal Services', []],
  ['LACDA26-107 - Senior Grant Program SG22-330 - Closing: 11/26/2026 3:00 PM', 'Personal Services', []],
  ['DBH89B - AS-NEEDED HARBOR ENGINEERING AND ARCHITECTURAL DESIGN CONSULTANT SERVICES - RFSQ - Closing: Continuous', 'Personal Services', []],
  ['LACDA26-108 - Senior Grant Program SG22-327 - Closing: 11/26/2026 3:00 PM', 'Personal Services', []],
  ['DBH89A - AS-NEEDED HARBOR ENGINEERING AND ARCHITECTURAL DESIGN CONSULTANT SERVICES - RFSQ - Closing: Continuous', 'Personal Services', []],
  ['DBH89 - AS-NEEDED HARBOR ENGINEERING AND ARCHITECTURAL DESIGN CONSULTANT SERVICES - RFSQ - Closing: Continuous', 'Personal Services', []],
  ['145635 SUBMERSIBLE WELL PUMPS FOR THE NORTH HOLLYWOOD WEST WELLFIELD', 'Commodity', []],
  ['ALTEC PLATFORM AND COMPONENTS', 'Commodity', []],
  ['146821 ADA COMPLIANT RESTROOM TRAILER AND 2-STATION RESTROOM TRAILER', 'Commodity', []],
  ['147093 HAND PUMP AND BLOWER', 'Commodity', []],
  ['RFB-IS-27200349 - MEDICAL TEAM SPECIALIST COURSE- FEMA - Closing: 11/30/2026 12:00 PM', 'Commodity', []],
  ['RFB-IS-27200346 - Complaint Investigation Services - Closing: 11/25/2026 12:00 PM', 'Commodity', []],
  ['RFB-IS-27200358 - 937046 / MANHOLE LIDS - Closing: 12/4/2026 12:00 PM', 'Commodity', []],
  ['RFB-IS-27200352 - 27-00318 Water Generator - Closing: 12/9/2026 12:00 PM', 'Commodity', []],
  ['RFB-IS-27200357 - (ERP)THERAPY TRAINING EXPOSURE&RESPONSE PREVENTION - Closing: 11/30/2026 12:00 PM', 'Commodity', []],
  ['RFB-IS-27200339 - COMPUTER - STORAGE - NUTANIX NX-3460S-G10 - Closing: 12/2/2026 12:00 PM', 'Commodity', []],
  ['RFB-IS-27200355 - 1st DISTRICT SUPERVISOR DURAZO VEHICLE - Closing: 11/25/2026 12:00 PM', 'Commodity', []],
  ['RFB-IS-27200356 - 2710017-Talend SW (Data Integration ETL SW) Renewal - Closing: 11/30/2026 12:00 PM', 'Commodity', []],
  ['RFP2417730131 Environmental Site Assessment', 'None', []],
  ['PW-RMO-237 - Prescription Safety Glasses for Fiscal Year 2026-2027 - Closing: 12/2/2026 5:00 PM', 'Personal Services', []],
  ['DPH-RFP-2026-005 - As-Needed Temporary Personnel Services - Closing: 1/6/2027 11:59 PM', 'Personal Services', []],
  ['146379 San Fernando PP AVR Replacement', 'Commodity', []],
  ['Collection, Transportation, Processing, and Marketing of Salvaged Plastic Containers from the City of Los Angeles', 'Personal Services', []],
  ['RFQ 2026-35174897 - RFQ 2026-35174897 for Octopus Deploy Enterprise License - Closing: 11/24/2026 1:00 PM', 'Personal Services', []],
  ['LACDA26-106 - Senior Grant Program Construction Rehabilitation Services-337 - Closing: 11/30/2026 3:00 PM', 'Personal Services', []],
  ['2027 FORD E TRANSIT CARGO VAN', 'Commodity', []],
  ['147097 Submonitor Connect FE Electronic Motor Overload', 'Commodity', []],
  ['PUGET SERVER EPYC 4005 WITH INSTALLATION', 'Commodity', []],
];

/** Held-out titles left out of HELD_OUT because the author could not say what the expected trade is. */
const AMBIGUOUS = [
  'EXT REC | CON27-0011 Alta Plaza Pathways - MLBE', // park pathways: paving or landscaping?
  'TIS | IT Project Manager Staff Augmentation', // IT or staffing?
  '0877 12kV Medium Voltage Cable', // electrical supply or utility stock?
];

const PORTALS: [string, string, string][] = [
  ['sf', 'title', 'category'],
  ['la', 'title', 'category'],
  ['batonrouge', 'description', ''],
  ['nyc', 'short_title', 'category_description'],
];

describe('bidTrades: in-sample real titles', () => {
  it.each(IN_SAMPLE_POSITIVE)('%s: "%s" -> its trades', (_p, title, category, expected) => {
    expect(bidTrades({ title, category })).toEqual(expected);
  });

  it('every trade it returns is a real Holler category', () => {
    for (const [, , , trades] of IN_SAMPLE_POSITIVE) for (const t of trades) expect(isCategoryId(t)).toBe(true);
  });

  it('gives no trade to every other row of the four live samples, except the 4 known misses, which are also none', () => {
    // A positive is listed by its cleaned title; the raw title may carry an agency-code prefix ("PUC | ...") or addenda text.
    const isPositive = (p: string, title: string) => IN_SAMPLE_POSITIVE.some(([pp, t]) => pp === p && title.includes(t));
    let negatives = 0;
    for (const [p, tf, cf] of PORTALS) {
      for (const row of fx(p)) {
        const title = firstLine(row[tf]);
        if (isPositive(p, title)) continue;
        negatives += 1;
        const category = cf && typeof row[cf] === 'string' ? (row[cf] as string) : null;
        expect(bidTrades({ title, category }), `${p}: ${title}`).toEqual([]);
      }
    }
    expect(negatives).toBeGreaterThan(50);
    expect(IN_SAMPLE_KNOWN_MISSES).toHaveLength(4);
  });

  it('reports the share of sample bids that got a trade (in-sample: 13 of 72)', () => {
    let total = 0;
    let withTrade = 0;
    const perPortal: Record<string, [number, number]> = {};
    for (const [p, tf, cf] of PORTALS) {
      for (const row of fx(p)) {
        total += 1;
        perPortal[p] ??= [0, 0];
        perPortal[p][1] += 1;
        const category = cf && typeof row[cf] === 'string' ? (row[cf] as string) : null;
        if (bidTrades({ title: firstLine(row[tf]), category }).length > 0) {
          withTrade += 1;
          perPortal[p][0] += 1;
        }
      }
    }
    expect(total).toBe(72);
    expect(withTrade).toBe(13);
    expect(perPortal).toEqual({ sf: [1, 20], la: [1, 20], batonrouge: [6, 20], nyc: [5, 12] });
  });
});

describe('bidTrades: held-out titles the table never saw', () => {
  it('has 47 clear titles and 3 ambiguous ones set aside', () => {
    expect(HELD_OUT).toHaveLength(47);
    expect(AMBIGUOUS).toHaveLength(3);
  });

  it.each(HELD_OUT)('"%s" -> %j', (title, category, expected) => {
    expect(bidTrades({ title, category })).toEqual(expected);
  });

  it('the ambiguous titles are not asserted, only that the table does not crash on them', () => {
    for (const t of AMBIGUOUS) expect(Array.isArray(bidTrades({ title: t }))).toBe(true);
  });
});

describe('bidTrades: the table, term by term', () => {
  const cases: [string, CategoryId[]][] = [
    ['Re-roofing of Fire Station 4', ['roofing']],
    ['HVAC replacement, City Hall', ['hvac']],
    ['In-wall air conditioners', ['hvac']],
    ['Plumbing repair services, citywide', ['plumbing']],
    ['Backflow preventer testing', ['plumbing']],
    ['Electrical maintenance contract', ['electrical']],
    ['Emergency generator maintenance and repair', ['electrical']],
    ['Grounds maintenance and mowing, parks', ['landscaping', 'lawn-care']],
    ['Tree trimming and removal services', ['tree-service']],
    ['Janitorial services for libraries', ['janitorial-commercial', 'cleaning']],
    ['Interior painting of recreation centers', ['painting']],
    ['Asphalt paving and concrete repair', ['concrete-paving']],
    ['Pest control services, rodent abatement', ['pest-control']],
    ['Armed security guard services', ['security']],
    ['Street signs and traffic signs, fabrication and installation', ['signs-printing']],
    ['Office moving services', ['moving']],
  ];
  it.each(cases)('"%s" -> %j', (title, expected) => {
    expect(bidTrades({ title })).toEqual(expected);
  });

  it('does not match inside words or on lone ambiguous words', () => {
    for (const t of [
      'IT support and help desk services', // IT has no Holler trade (P2-10)
      'Sign language interpreting services', // "sign" alone is not a trade
      'Moving parts kit for pumps', // "moving" alone is not a trade
      'Network switches', // "network" alone is not IT work
      'Proofing and fireproofing consultation', // "roof" inside a longer word
      'Printer toner cartridges', // not "printing"
      'Hotel and motel stays', // "hot..." fragments
      'Spaint', // "paint" inside a word
    ]) {
      expect(bidTrades({ title: t }), t).toEqual([]);
    }
  });

  it('reads the category text too, but a generic category alone gives nothing', () => {
    expect(bidTrades({ title: 'Annual contract', category: 'Roofing and waterproofing' })).toEqual(['roofing']);
    expect(bidTrades({ title: 'Annual contract', category: 'Commodity' })).toEqual([]);
    expect(bidTrades({ title: '' })).toEqual([]);
  });
});

describe('bidTrades: supply purchases and paper work are not trade work (review P1-5)', () => {
  // The first row is a real NYC row from the 2026-11-21 fixture (category Goods), the rest are SYNTHETIC titles from the independent
  // review: each names a trade word but is a purchase or a design/consulting contract that no tradesperson can fill.
  const negatives: [string, string | null][] = [
    ['SMPD_Materials _Heating Materials (Heating CMA & Boilers/Parts)', 'Goods'],
    ['Janitorial Supplies', null],
    ['Purchase of HVAC Filters', null],
    ['Plumbing Fixtures and Parts', null],
    ['Electrical Engineering Design Services', null],
    ['Roofing Consultant Services for Municipal Buildings', null],
    ['Paint Sprayer Equipment Purchase', null],
    ['Landscaping Equipment and Supplies', null],
    ['Pest Control Chemicals and Materials', null],
    ['Security Camera Software License Renewal', null],
    ['HVAC Controls Software Subscription', null],
    ['Architectural Design Services for Roof Replacement', null],
    ['TM3 - Satellite Website Migration RFP', 'Personal Services'], // real SF row: IT work maps to no trade (P2-10)
  ];
  it.each(negatives)('"%s" -> none', (title, category) => {
    expect(bidTrades({ title, category })).toEqual([]);
  });

  it('a Goods or Commodity category gives no trade, even when the title names one', () => {
    expect(bidTrades({ title: 'Roofing', category: 'Goods' })).toEqual([]);
    expect(bidTrades({ title: 'HVAC units', category: 'Commodity' })).toEqual([]);
    expect(bidTrades({ title: 'Re-roofing of Fire Station 4', category: 'Construction' })).toEqual(['roofing']);
    expect(bidTrades({ title: 'Re-roofing of Fire Station 4', category: 'Personal Services' })).toEqual(['roofing']);
  });

  it('a work verb keeps a supply word in the title: the buyer wants the work done', () => {
    expect(bidTrades({ title: 'HVAC equipment replacement, City Hall' })).toEqual(['hvac']);
    expect(bidTrades({ title: 'Boiler parts and installation' })).toEqual(['hvac']);
    expect(bidTrades({ title: 'Plumbing fixtures: repair and maintenance, citywide' })).toEqual(['plumbing']);
    expect(bidTrades({ title: 'Electrical materials and installation, Pier 4' })).toEqual(['electrical']);
  });

  it('the rule does not touch the plain work titles the table already tagged', () => {
    for (const [, title, category, expected] of IN_SAMPLE_POSITIVE) expect(bidTrades({ title, category }), title).toEqual(expected);
  });
});
