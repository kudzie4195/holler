// Review 2 P1-1: real bid titles and real agency names must pass UNCHANGED (nothing is rewritten; a field with contact details is refused
// instead). The corpus is the one the second review used: every title in the repo's Gwinnett, Rockdale, Tucker and Dunwoody page fixtures
// (52), the 17 live bid rows, and its agency list.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManualBid, contactFound, onlyPersonName } from '@/lib/signals/manual-bids/record';
import { MANUAL_PORTALS } from '@/lib/signals/manual-bids/portals';

const NOW = new Date('2026-11-25T15:00:00Z');
const base = { url: 'https://mariettaga.gov/Bids.aspx?bidID=412', title: 'Roof replacement at Fire Station 3', agency: 'City of Marietta', dueDate: '2026-12-15', place: '30060' };
const build = (over: Record<string, string>) => buildManualBid({ ...base, ...over }, { now: NOW, served: () => true });
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim();

const FIXTURE_TITLES: string[] = [];
for (const f of ['gwinnett', 'rockdale', 'tucker', 'dunwoody']) {
  const j = JSON.parse(readFileSync(join(__dirname, '..', 'firecrawl', 'fixtures', `bids-${f}.extracted.json`), 'utf8')) as { solicitations: Array<{ title?: string }> };
  for (const s of j.solicitations) if (s.title) FIXTURE_TITLES.push(String(s.title));
}

const LIVE_TITLES = [
  'Security Services', 'TC78150 Citywide Landscaping Services', '2027PS001 - Campus-Wide Fire Alarm System Replacement', '2710064 FIGUEROA ELEMENTARY SCHOOL - ROOFING (PSA)',
  'Asphalt Mill & Overlay Services at the Union Tower Apartments', 'Sidewalk Repair Program - Package No. 88 (LA28)', 'VISION ZERO PHASE 2H, BACKLOG REDUCTION PHASE 3 & REAP 2.0 TRAFFIC SIGNAL IMPROVEMENTS',
  'FDC-HVAC2027 - As-Needed Heating, Ventilation, and Air Conditioning Repair and Replacement Services', 'Const. & Eng. Support for CLARTS related Upgrades to Electrical MHSB, Electrical Wiring and General Offices (S-078)',
  'BEST VALUE | RFQ/BID #2710078 & 2710079 | DISTRICT ADMINISTRATIVE OFFICE | REPLACE COOLING TOWERS & CHILLER (PSA)', 'A26-91082 Window Washing Library Sites',
  'McHOST ROAD IMPRV 2 (LA Hwy 64 Port Hudson Pride Rd) 20-EN-HC-0107', '26-1500 DDD Interstate Underpass Gateway Lighting', 'PARISHWIDE PAVEMENT RE-MARKING CITY-PARISH PROJECT No. 26-TS-CI-0026',
  'BRC0000472 - RFSQ - Graffiti Removal Services', 'BRC0000478 - Request for Statement of Qualifications for Landscape and Grounds Maintenance Services', 'EXT ADM RED | HVAC Master Agreement',
];

const govs = MANUAL_PORTALS.flatMap((m) => m.portals.map((p) => p.government));
const AGENCIES = [
  ...govs, ...govs.filter((g) => !/county|parish/i.test(g)).map((g) => `City of ${g}`), ...govs.filter((g) => !/county|parish/i.test(g)).map((g) => `Town of ${g}`),
  'Georgia DOT', 'Georgia Tech', 'Georgia Ports', 'Austin Energy', 'Austin ISD', 'Atlanta BeltLine', 'Charlotte Water', 'Raleigh Parks', 'Jackson EMC', 'Cobb EMC', 'MARTA', 'Holly Springs Public Works',
  'Marietta City Schools', 'Marietta Power', 'Cobb County Purchasing', 'CITY OF MARIETTA', 'For City of Marietta', 'Contact: Gwinnett County Purchasing',
  'St. Tammany Parish', 'Fort Bend County', 'Stephen F. Austin State University', 'Martin Luther King Jr. Recreation Center', 'Lyndon B. Johnson Hospital', 'Travis County', 'Wake County Public Schools',
  'Douglas County Water and Sewer', 'Jefferson Parish', 'Lafayette Utilities', 'Grant Park Conservancy', 'Piedmont Park Conservancy', 'Henry County', 'Clayton County', 'Fayette County',
];

describe('real titles pass unchanged', () => {
  it('the 52 fixture titles and the 17 live rows', () => {
    expect(FIXTURE_TITLES).toHaveLength(52);
    expect(LIVE_TITLES).toHaveLength(17);
    for (const t of [...FIXTURE_TITLES, ...LIVE_TITLES]) {
      const title = tidy(t).slice(0, 200);
      expect(contactFound(title), title).toBeNull();
      expect(onlyPersonName(title, 'title'), title).toBe(false);
      // Stored exactly as typed (a trade is picked so a title that names no trade is still built).
      const r = build({ title, trade: 'roofing' });
      expect(r.ok, `${title}: ${r.ok ? '' : r.problem}`).toBe(true);
      if (r.ok) expect(r.view.title).toBe(title);
    }
  });

  it('the cases the review named', () => {
    for (const title of ['Emergency Repair Services for Water and Sewer Mains on an Annual Contract', 'Call for Artists - 26-08']) {
      const r = build({ title, trade: 'event-services' });
      expect(r.ok && r.signal.title).toBe(`Open bid in Marietta: ${title}`);
    }
  });
});

describe('real agencies pass unchanged', () => {
  it('every name on the list is accepted and stored exactly as typed', () => {
    for (const agency of [...new Set(AGENCIES)]) {
      const r = build({ agency });
      expect(r.ok, `${agency}: ${r.ok ? '' : r.problem}`).toBe(true);
      if (r.ok) expect((r.signal.data as { buyer: string }).buyer, agency).toBe(agency);
    }
    for (const agency of ['Georgia DOT', 'Austin ISD', 'Raleigh Parks', 'Jackson EMC', 'City of Marietta']) {
      const r = build({ agency });
      expect(r.ok && r.view.agency).toBe(agency);
    }
  });
});
