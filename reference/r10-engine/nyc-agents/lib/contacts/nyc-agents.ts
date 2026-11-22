/**
 * NYC heat / hot-water 311 -> the building's registered managing-agent COMPANY (pure functions, no I/O).
 *
 * Join (recon 2026-11-22, /home/claude/runlog/recon-phl-nyc.md):
 *   311 erm2-nwe9 (bbl, incident_address)
 *     -> parseBbl: boro digit + block + lot
 *     -> HPD Multiple Dwelling Registrations tesw-yqqr rows with that boroid/block/lot
 *     -> chooseRegistration: the ONE registration whose street matches and whose house number equals / spans the complaint's number
 *     -> HPD Registration Contacts feu5-w2e2 rows of that registrationid with type 'Agent'
 *     -> pickAgent: a corporationname that passes cleanOrgName, else nothing.
 *
 * Rules that never bend: never guess (more than one candidate, or none, gives null), never return a person (firstname/lastname are not
 * even typed here and the fetch helper does not select them), and no street address of the agent is returned (an Agent row's address may be
 * a person's home; only city, state and zip are kept).
 *
 * HOW TO SWITCH THIS ON for members, after the probation samples were checked (holler_source_samples, source 'nyc-hpd-agents'; read the
 * data.joinStatus mix and eyeball company vs address on 30 rows, second query in scripts/metro-scorecard.sql):
 *   1. In lib/signals/adapters/socrata.ts parseSocrataReport, for dataset socrata-nyc-311 and complaint_type 'HEAT/HOT WATER' only, call
 *      joinNycComplaints (lib/contacts/nyc-agents-fetch.ts) once per scan and attach contacts [{role:'business', name: company, ...}].
 *      Or simpler: delete `probation: true` in lib/signals/adapters/nyc-hpd-agents.ts and let this adapter replace the heat rows of
 *      socrata-nyc-311 (then exclude HEAT/HOT WATER from the socrata-nyc-311 query so a complaint is not stored twice).
 *   2. 311 is in NO_CONTACT_SUBTYPES (lib/contacts/extract.ts) and sanitizeSample/store drop every contact of a '311' row. The probation
 *      adapter writes data.subtype 'hpd-agent' to get around that for samples. For live, decide deliberately: keep subtype 'hpd-agent' (and
 *      add it to opportunity.ts so heat rules apply) or carve one exception out of NO_CONTACT_SUBTYPES. The contact is a company from a
 *      public HPD registry, never the complainant, but that is a policy call, not a code detail.
 *   3. Keep the tests in tests/contacts/nyc-agents.test.ts; add a test that a live row has the contact and no person field.
 */
import { cleanOrgName } from './org';

/**
 * 'no-bbl' = the complaint has no valid bbl (nothing was looked up); 'no-registration' = a valid bbl with no (live, same-address) registration;
 * 'not-attempted' = the run budget ended before this complaint's lookups were made (set by the adapter, never by joinComplaint).
 */
export type NycJoinStatus = 'matched' | 'ambiguous' | 'no-registration' | 'no-bbl' | 'agent-individual' | 'no-agent' | 'not-attempted';

export interface Bbl {
  boroid: string;
  block: string;
  lot: string;
}

/** The canonical 10-digit text of a parsed Bbl (boro + 5-digit block + 4-digit lot). */
export function formatBbl(b: Bbl): string {
  return `${b.boroid}${b.block.padStart(5, '0')}${b.lot.padStart(4, '0')}`;
}

/**
 * 311 bbl: a 10-digit string or number, boro digit (1 to 5) + 5-digit block + 4-digit lot, zero padded ("3013020001" -> 3 / 1302 / 1).
 * A trailing ".0", surrounding spaces and dashes ("3-01302-0001") are tolerated. Returns block and lot WITHOUT leading zeros, the way
 * tesw-yqqr stores them. Anything else (wrong length, boro 0 or 6+, block or lot 0) is null.
 */
export function parseBbl(raw: unknown): Bbl | null {
  if (raw == null) return null;
  let t = typeof raw === 'number' ? (Number.isFinite(raw) ? String(Math.trunc(raw)) : '') : typeof raw === 'string' ? raw.trim() : '';
  t = t.replace(/\.0+$/, '');
  if (/^\d-\d{5}-\d{4}$/.test(t)) t = t.replace(/-/g, '');
  if (!/^\d{10}$/.test(t)) return null;
  const boroid = t[0];
  if (!/^[1-5]$/.test(boroid)) return null;
  const block = String(Number(t.slice(1, 6)));
  const lot = String(Number(t.slice(6)));
  if (block === '0' || lot === '0') return null;
  return { boroid, block, lot };
}

// ---- street names -----------------------------------------------------------------------------------------------------------------

const DIRECTIONS: Record<string, string> = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' };
const SUFFIXES: Record<string, string> = {
  AVE: 'AVENUE', AV: 'AVENUE', AVENU: 'AVENUE', BLVD: 'BOULEVARD', BLV: 'BOULEVARD', RD: 'ROAD', PL: 'PLACE', LN: 'LANE', CT: 'COURT',
  PKWY: 'PARKWAY', PKY: 'PARKWAY', TER: 'TERRACE', TERR: 'TERRACE', HWY: 'HIGHWAY', EXPY: 'EXPRESSWAY', SQ: 'SQUARE', CIR: 'CIRCLE',
  PLZ: 'PLAZA', ALY: 'ALLEY', BDWY: 'BROADWAY', BWAY: 'BROADWAY', MT: 'MOUNT', FT: 'FORT', CRES: 'CRESCENT', TPKE: 'TURNPIKE',
  PK: 'PARK', GDNS: 'GARDENS', HTS: 'HEIGHTS', STREET: 'STREET',
};
const SPELLED: Record<string, string> = {
  FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10',
  ELEVENTH: '11', TWELFTH: '12',
};

/**
 * One comparable form of a NYC street name: upper case, punctuation and extra spaces gone, a leading N/S/E/W spelled out, ordinals as
 * plain numbers ("87TH" and "87" -> "87", "SECOND" -> "2"), street-type abbreviations spelled out ("ST" last -> STREET, "ST" before
 * another word -> SAINT, "DR" last -> DRIVE, before another word -> DOCTOR), and Avenue of the Americas = 6 Avenue.
 * "W 87 ST", "WEST 87 STREET" and "West 87th St." all give "WEST 87 STREET".
 */
export function normalizeStreet(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.toUpperCase().replace(/[.,'`]/g, '').replace(/[^A-Z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const words = t.split(' ');
  const out = words.map((w, i) => {
    const last = i === words.length - 1;
    if (i === 0 && words.length > 1 && DIRECTIONS[w]) return DIRECTIONS[w];
    const ord = w.match(/^(\d+)(?:ST|ND|RD|TH)$/);
    if (ord) return String(Number(ord[1]));
    if (/^\d+$/.test(w)) return String(Number(w));
    if (SPELLED[w]) return SPELLED[w];
    if (w === 'ST') return last ? 'STREET' : 'SAINT';
    if (w === 'DR') return last ? 'DRIVE' : 'DOCTOR';
    return SUFFIXES[w] ?? w;
  });
  const s = out.join(' ');
  return s === 'AVENUE OF THE AMERICAS' ? '6 AVENUE' : s;
}

// ---- house numbers ----------------------------------------------------------------------------------------------------------------

export interface HouseNumber {
  /** the part before a hyphen ("41" of "41-10"); the whole number when there is no hyphen */
  n: number;
  /** the part after a hyphen (Queens), else null */
  sub: number | null;
  /** a trailing letter ("12A"), else '' */
  letter: string;
}

/** "175" -> {175}, "41-10" -> {41, 10}, "0012A" -> {12, letter A}. Anything else (fractions, ranges, text) is null. */
export function parseHouseNumber(raw: unknown): HouseNumber | null {
  if (raw == null) return null;
  const t = String(raw).toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
  const m = t.match(/^0*(\d{1,6})(?:-0*(\d{1,6}))?([A-Z])?$/);
  if (!m) return null;
  return { n: Number(m[1]), sub: m[2] != null ? Number(m[2]) : null, letter: m[3] ?? '' };
}

/** Canonical text of a house number ("41-10", "12A"); '' when unparseable. */
export function normalizeHouseNumber(raw: unknown): string {
  const h = parseHouseNumber(raw);
  return h ? `${h.n}${h.sub != null ? `-${h.sub}` : ''}${h.letter}` : '';
}

function cmpHouse(a: HouseNumber, b: HouseNumber): number {
  return a.n - b.n || (a.sub ?? 0) - (b.sub ?? 0);
}

const parity = (h: HouseNumber) => (h.sub ?? h.n) % 2;

/** "175 WEST   87 STREET" -> { house: "175", street: "WEST 87 STREET" }; null when there is no leading house number and a street. */
export function parseIncidentAddress(raw: unknown): { house: HouseNumber; street: string } | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d[0-9A-Za-z-]*)\s+(\S.*)$/);
  if (!m) return null;
  const house = parseHouseNumber(m[1]);
  const street = normalizeStreet(m[2]);
  if (!house || !street || /^\d\/\d\b/.test(m[2].trim())) return null;
  return { house, street };
}

// ---- registration choice ----------------------------------------------------------------------------------------------------------

/** The tesw-yqqr columns the join reads (all strings, as Socrata sends them). */
export interface HpdRegistration {
  registrationid?: string;
  boroid?: string;
  block?: string;
  lot?: string;
  housenumber?: string;
  lowhousenumber?: string;
  highhousenumber?: string;
  streetname?: string;
  zip?: string;
  /** ISO text from tesw-yqqr ("2027-09-01T00:00:00.000"); a registration whose end is before `now` is ignored (recon 2026-11-22: 131179 ended 2026-09-01) */
  registrationenddate?: string;
}

export interface RegistrationChoice {
  registration: HpdRegistration | null;
  status: 'matched' | 'ambiguous' | 'none';
  /** which rule decided: exact house number, or inside the low..high range; null when none */
  step: 'exact' | 'range' | null;
  /** live (not expired) registrations of the BBL that were offered */
  candidates: number;
  /** registrations of the BBL ignored because their registrationenddate is before `now` */
  expired: number;
}

/** True when the row has a readable registrationenddate that is before `now`. A missing or unreadable date is not expired. */
export function isExpiredRegistration(r: HpdRegistration, now: Date): boolean {
  const t = typeof r.registrationenddate === 'string' ? Date.parse(r.registrationenddate.trim()) : NaN;
  return Number.isFinite(t) && t < now.getTime();
}

const distinctIds = (rows: HpdRegistration[]) => [...new Set(rows.map((r) => String(r.registrationid ?? '')))];

/**
 * The registration for a complaint at `incidentAddress` among the registrations of its BBL (a multi-building lot returns several):
 *  1. keep rows whose street (normalizeStreet) equals the complaint's;
 *  2. exact: housenumber equals the complaint's house number; else
 *  3. range: low <= number <= high with the same odd/even side (Queens hyphenated numbers compare as pairs).
 * A letter suffix is part of the number: "12" is not "12A" in either step, and a suffixed number matches a range only when it equals
 * an endpoint's text. Registrations whose registrationenddate is before `now` are ignored first.
 * Exactly one distinct registrationid at a step -> matched. More than one -> ambiguous (null). None, or an unreadable address -> none.
 * Never falls back to "the only registration on the lot": a different street is a different building.
 */
export function chooseRegistration(incidentAddress: unknown, allRegs: readonly HpdRegistration[], now: Date = new Date()): RegistrationChoice {
  const regs = allRegs.filter((r) => !isExpiredRegistration(r, now));
  const expired = allRegs.length - regs.length;
  const candidates = regs.length;
  const none: RegistrationChoice = { registration: null, status: 'none', step: null, candidates, expired };
  const addr = parseIncidentAddress(incidentAddress);
  if (!addr || !regs.length) return none;
  const sameStreet = regs.filter((r) => normalizeStreet(r.streetname) === addr.street);
  if (!sameStreet.length) return none;
  const decide = (rows: HpdRegistration[], step: 'exact' | 'range'): RegistrationChoice | null => {
    if (!rows.length) return null;
    const ids = distinctIds(rows);
    if (ids.length > 1) return { registration: null, status: 'ambiguous', step, candidates, expired };
    return { registration: rows[0], status: 'matched', step, candidates, expired };
  };
  const key = normalizeHouseNumber(`${addr.house.n}${addr.house.sub != null ? `-${addr.house.sub}` : ''}${addr.house.letter}`);
  const exact = sameStreet.filter((r) => normalizeHouseNumber(r.housenumber) === key);
  const hit = decide(exact, 'exact');
  if (hit) return hit;
  const inRange = sameStreet.filter((r) => {
    const lo = parseHouseNumber(r.lowhousenumber ?? r.housenumber);
    const hi = parseHouseNumber(r.highhousenumber ?? r.housenumber);
    if (!lo || !hi) return false;
    if (parity(lo) !== parity(addr.house)) return false;
    const atEnd = key === normalizeHouseNumber(r.lowhousenumber ?? r.housenumber) || key === normalizeHouseNumber(r.highhousenumber ?? r.housenumber);
    const inside = !addr.house.letter && cmpHouse(lo, addr.house) < 0 && cmpHouse(addr.house, hi) < 0;
    return atEnd || inside;
  });
  return decide(inRange, 'range') ?? none;
}

// ---- agent choice -----------------------------------------------------------------------------------------------------------------

/**
 * The feu5-w2e2 columns the join reads. firstname, lastname and the business street are deliberately NOT here: the fetch helper never
 * selects them, and nothing below could return them.
 */
export interface HpdContact {
  registrationid?: string;
  type?: string;
  corporationname?: string;
  businesscity?: string;
  businessstate?: string;
  businesszip?: string;
}

export interface NycAgent {
  company: string;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
}

const NYC_NAMES = new Set(['new york', 'new york city', 'manhattan', 'brooklyn', 'bronx', 'the bronx', 'queens', 'staten island']);
/** A plausible city; the five boroughs and 'New York' (any case) become 'New York' so the sample sanitizer can keep it for the NYC dataset. */
export const cityOk = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!t || t.length > 40 || !/^[A-Za-z][A-Za-z .'-]*$/.test(t)) return null;
  return NYC_NAMES.has(t.toLowerCase()) ? 'New York' : t;
};
const stateOk = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(t) ? t : null;
};
const zipOk = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^\d{5}(-\d{4})?$/.test(t) ? t.slice(0, 5) : null;
};

export interface AgentChoice {
  agent: NycAgent | null;
  status: 'matched' | 'ambiguous' | 'agent-individual' | 'no-agent';
  /** Agent rows that had a corporationname which cleanOrgName refused (a count only, never the text: it may be a person) */
  rejectedNames: number;
}

/**
 * The managing agent among the contact rows of ONE registration: rows with type exactly 'Agent' whose corporationname passes
 * cleanOrgName. no Agent rows -> no-agent. Agent rows but no accepted company name (blank, or an individual entered as a person) ->
 * agent-individual. Two or more different accepted companies -> ambiguous (null). One company (repeated rows are fine) -> that company with
 * the city/state/zip of its first row that has them.
 */
export function classifyAgents(contacts: readonly HpdContact[]): AgentChoice {
  const agents = contacts.filter((c) => c && c.type === 'Agent');
  if (!agents.length) return { agent: null, status: 'no-agent', rejectedNames: 0 };
  const byName = new Map<string, HpdContact[]>();
  let rejectedNames = 0;
  for (const c of agents) {
    const rawName = typeof c.corporationname === 'string' ? c.corporationname : '';
    const name = cleanOrgName(rawName);
    if (!name) {
      if (rawName.trim()) rejectedNames += 1;
      continue;
    }
    const k = name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), { ...c, corporationname: name }]);
  }
  if (!byName.size) return { agent: null, status: 'agent-individual', rejectedNames };
  if (byName.size > 1) return { agent: null, status: 'ambiguous', rejectedNames };
  const rows = [...byName.values()][0];
  const withPlace = rows.find((r) => cityOk(r.businesscity) || stateOk(r.businessstate) || zipOk(r.businesszip)) ?? rows[0];
  return {
    status: 'matched',
    rejectedNames,
    agent: {
      company: rows[0].corporationname as string,
      businessCity: cityOk(withPlace.businesscity),
      businessState: stateOk(withPlace.businessstate),
      businessZip: zipOk(withPlace.businesszip),
    },
  };
}

/** The managing-agent company of one registration, or null. Never an individual. */
export function pickAgent(contacts: readonly HpdContact[]): NycAgent | null {
  return classifyAgents(contacts).agent;
}

/** One complaint's join outcome from its registrations and their contacts. */
export interface NycJoin {
  status: NycJoinStatus;
  agent: NycAgent | null;
  /** the complaint's bbl as parsed (10 digits), null when missing or invalid */
  bbl: string | null;
  /** the chosen registration, null when none was chosen (no match, ambiguous, no bbl) */
  registrationId: string | null;
  /** live registrations on the BBL, and the rule that picked one */
  candidates: number;
  /** registrations of the BBL ignored as expired */
  expired: number;
  step: 'exact' | 'range' | null;
  /** Agent rows whose corporationname cleanOrgName refused (count only; ALL CAPS company names are often refused) */
  rejectedNames: number;
}

export function joinComplaint(
  bbl: unknown,
  incidentAddress: unknown,
  regsFor: (b: Bbl) => readonly HpdRegistration[],
  contactsFor: (registrationId: string) => readonly HpdContact[],
  now: Date = new Date(),
): NycJoin {
  const b = parseBbl(bbl);
  const base = { bbl: b ? formatBbl(b) : null, registrationId: null, agent: null, expired: 0, step: null, rejectedNames: 0 };
  if (!b) return { ...base, status: 'no-bbl', candidates: 0 };
  const regs = regsFor(b);
  if (!regs.length) return { ...base, status: 'no-registration', candidates: 0 };
  const choice = chooseRegistration(incidentAddress, regs, now);
  const withChoice = { ...base, candidates: choice.candidates, expired: choice.expired };
  if (choice.status === 'ambiguous') return { ...withChoice, status: 'ambiguous', step: choice.step };
  if (choice.status === 'none' || !choice.registration) return { ...withChoice, status: 'no-registration' };
  const registrationId = String(choice.registration.registrationid ?? '') || null;
  const picked = classifyAgents(contactsFor(registrationId ?? ''));
  return { ...withChoice, registrationId, status: picked.status, agent: picked.agent, step: choice.step, rejectedNames: picked.rejectedNames };
}
