/**
 * Fixtures for the NYC managing-agent join.
 * SOURCED = copied from /home/claude/runlog/recon-phl-nyc.md (live fetch 2026-11-22, data.cityofnewyork.us).
 * ASSUMED = invented for a test where the recon file has no row; never presented as real data.
 */
import type { HpdContact, HpdRegistration } from '@/lib/contacts/nyc-agents';

// SOURCED 2026-11-22: 311 erm2-nwe9 sample rows 1 and 2 (recon section (c)).
export const COMPLAINT_175_W87 = { unique_key: '71204274', bbl: '1012180001', incident_address: '175 WEST   87 STREET', borough: 'MANHATTAN', incident_zip: '10024' };
export const COMPLAINT_77_SULLIVAN = { unique_key: '71198289', bbl: '3013020001', incident_address: '77 SULLIVAN PLACE', borough: 'BROOKLYN', incident_zip: '11225' };

// SOURCED 2026-11-22 (recon "Join path (tested live)"): bbl 1012180001 -> exactly 1 row, registrationid 139274, "175 WEST 87 STREET", bin 1032228.
// ASSUMED: housenumber/low/high 175, zip 10024.
export const REG_175_W87: HpdRegistration = { registrationid: '139274', boroid: '1', block: '1218', lot: '1', housenumber: '175', lowhousenumber: '175', highhousenumber: '175', streetname: 'WEST 87 STREET', zip: '10024' };

// SOURCED 2026-11-22: bbl 3013020001 returned 7 registrations on boroid 3 / block 1302 / lot 1: 1700 Bedford, 11 McKeever, 220 Montgomery,
// 1672-1726 Bedford, 77 Sullivan, 47 McKeever, 1680 Bedford; 77 Sullivan = registrationid 373108 (buildingid 809612, bin 3388697).
// ASSUMED: every registrationid except 373108, every low/high range, and the street suffixes (AVENUE/PLACE/STREET) of the other six.
const lot = { boroid: '3', block: '1302', lot: '1', zip: '11225' };
export const REGS_SULLIVAN_LOT: HpdRegistration[] = [
  { ...lot, registrationid: '373101', housenumber: '1700', lowhousenumber: '1700', highhousenumber: '1700', streetname: 'BEDFORD AVENUE' },
  { ...lot, registrationid: '373102', housenumber: '11', lowhousenumber: '11', highhousenumber: '11', streetname: 'MC KEEVER PLACE' },
  { ...lot, registrationid: '373103', housenumber: '220', lowhousenumber: '220', highhousenumber: '220', streetname: 'MONTGOMERY STREET' },
  { ...lot, registrationid: '373104', housenumber: '1672', lowhousenumber: '1672', highhousenumber: '1726', streetname: 'BEDFORD AVENUE' },
  { ...lot, registrationid: '373108', housenumber: '77', lowhousenumber: '77', highhousenumber: '77', streetname: 'SULLIVAN PLACE' },
  { ...lot, registrationid: '373105', housenumber: '47', lowhousenumber: '47', highhousenumber: '47', streetname: 'MC KEEVER PLACE' },
  { ...lot, registrationid: '373106', housenumber: '1680', lowhousenumber: '1680', highhousenumber: '1680', streetname: 'BEDFORD AVENUE' },
];

// SOURCED 2026-11-22: feu5-w2e2 Agent rows as returned (first and last names are real-looking values from the portal; the privacy test
// scans for them). Business street (businesshousenumber/businessstreetname) is omitted: the fetch helper never selects it.
export const AGENT_MAXWELL: HpdContact & { firstname: string; lastname: string } = { registrationid: '139143', type: 'Agent', corporationname: 'MAXWELL KATES INC.', firstname: 'SABREEN', lastname: 'SPEARS', businesscity: 'New York', businessstate: 'NY', businesszip: '10016' };
export const AGENT_PROVIDENT: HpdContact & { firstname: string; lastname: string } = { registrationid: '101700', type: 'Agent', corporationname: 'PROVIDENT MANAGEMENT CORP', firstname: 'PATRICK', lastname: 'GILROY', businesscity: 'Scarsdale', businessstate: 'NY', businesszip: '10583' };
export const AGENT_INDIVIDUAL: HpdContact & { firstname: string; lastname: string } = { registrationid: '131179', type: 'Agent', firstname: 'Sam', lastname: 'Rosen', businesscity: 'Brooklyn', businessstate: 'NY', businesszip: '11222' };
// SOURCED (summarised output, spelling not verbatim): registration 373108 Agent FIELDBRIDGE ASSOCIATES LLC, contact Benjamin Baum, 1720 Bedford Avenue, Brooklyn NY 11225.
export const AGENT_FIELDBRIDGE: HpdContact & { firstname: string; lastname: string } = { registrationid: '373108', type: 'Agent', corporationname: 'FIELDBRIDGE ASSOCIATES LLC', firstname: 'Benjamin', lastname: 'Baum', businesscity: 'Brooklyn', businessstate: 'NY', businesszip: '11225' };

// ASSUMED: a company agent for 139274 (recon did not pull it), written so cleanOrgName accepts it. Mixed case on purpose: see the
// finding that ALL CAPS company names such as 'PROVIDENT MANAGEMENT CORP' are refused by cleanOrgName (R11).
export const AGENT_139274: HpdContact & { firstname: string; lastname: string } = { registrationid: '139274', type: 'Agent', corporationname: 'Skyline Associates LLC', firstname: 'Dana', lastname: 'Whitfield', businesscity: 'New York', businessstate: 'NY', businesszip: '10019' };

/** Every first/last name above: none may appear in any output. */
export const PERSON_NAMES = ['SABREEN', 'SPEARS', 'PATRICK', 'GILROY', 'Sam', 'Rosen', 'Benjamin', 'Baum', 'Dana', 'Whitfield'];
