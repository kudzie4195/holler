import { hasContactShape, isListedGivenName } from '@/lib/contacts/org';

/**
 * "Managed by" for NYC no-heat / hot-water cards (PLAN-2.0 item 2.6).
 *
 * Source: NYC HPD Registration Contacts (NYC Open Data, dataset feu5-w2e2) joined by RegistrationID to HPD Multiple Dwelling
 * Registrations (tesw-yqqr) on borough + block + lot (the 311 row's BBL). See lib/signals/adapters/nyc-hpd.ts for the lookup.
 *
 * PRIVACY (company only, by construction):
 *  - the lookup selects ONLY registrationid, type and corporationname. FirstName, LastName, title and the business address are never
 *    requested, so no person's name can reach this file;
 *  - a contact whose CorporationName is empty (an individual owner, an individual site manager) yields nothing;
 *  - the CorporationName column is free text and sometimes holds a person ("JOHN B. LOVETT"), so every name must pass companyNameOf:
 *    a company word (LLC, INC, CORP, MANAGEMENT, REALTY ...) or a single non-given-name word. A trust, an estate or a two-word name with
 *    no company word is dropped.
 *
 * Pure and client-safe apart from the org.ts helpers (no server import). Same input, same output.
 */

export type ManagerRole = 'agent' | 'owner';

export interface Manager {
  /** Company name as the registration prints it. Never a person. */
  name: string;
  /** agent: a managing agent or site manager company. owner: the registered corporate owner (no agent company was named). */
  role: ManagerRole;
}

/** One row of HPD Registration Contacts, reduced to the three columns the lookup requests. */
export interface HpdContactRow {
  registrationid?: unknown;
  type?: unknown;
  corporationname?: unknown;
}

const MAX_NAME_LEN = 70;
/** A building that has more registrations than this (a development with one registration per building, such as Co-op City) gets nothing: no single company can be named for the lot. */
export const MAX_REGISTRATIONS_PER_BBL = 6;

const COMPANY_WORD =
  /\b(?:l\.?l\.?c|l\.?l\.?p|l\.?p|inc|incorporated|corp|corporation|co|company|companies|ltd|limited|hdfc|associates|association|assoc|management|managment|mgmt|mgt|manager|realty|real estate|properties|property|holdings?|group|equities|equity|enterprises?|services?|housing|condominiums?|condo|owners?|tenants?|partners|partnership|cooperative|coop|organization|development|developers|capital|residential|redevelopment|federation|ventures?|investors?|investments?|builders?|construction|apartments?|apts|realtors?|brokerage|advisors?|operating|operations|resources|solutions|consulting|bank|church|foundation|society|council|authority)\b/i;

/** Words that mark a person's or a family's legal vehicle, never a company that manages a building. */
const NOT_A_COMPANY = /\b(?:estate of|estates?|trust|trustee|living|revocable|irrevocable|deceased|heirs|individual|unknown|none|n\/a)\b/i;

const GENERIC_ONLY = /^(?:corporation|company|corp|inc|llc|owner|agent|manager|management|individual|self|same|tbd|na|n\/a|none|unknown)\.?$/i;

/**
 * The company name to print, or null. Accepts only a name that reads as a company (see the file header). Never throws, never returns a
 * string longer than 70 characters.
 */
export function companyNameOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > MAX_NAME_LEN) return null;
  if (!/^[A-Za-z0-9 &.,'\-/()#+]+$/.test(t)) return null; // plain ASCII only: no look-alike letters, no markup, no "@"
  if (!/[A-Za-z]/.test(t)) return null;
  if (hasContactShape(t)) return null;
  if (GENERIC_ONLY.test(t)) return null;
  if (NOT_A_COMPANY.test(t)) return null;
  if (COMPANY_WORD.test(t)) return t;
  const words = t.split(/[\s,]+/).filter(Boolean);
  // One word ("Newmark", "RHAMCO"): a person is never named by one word, unless it is a listed given name.
  if (words.length === 1 && t.replace(/[^A-Za-z]/g, '').length >= 4 && !isListedGivenName(words[0].replace(/[^A-Za-z]/g, ''))) return t;
  return null;
}

/** A registration's contact rows to one company: the agent company, else a site manager company, else the corporate owner. */
export function managerForRegistration(rows: readonly HpdContactRow[]): Manager | null {
  const byType = (type: string): string | null => {
    for (const r of rows) {
      if (typeof r?.type === 'string' && r.type.toLowerCase() === type) {
        const n = companyNameOf(r.corporationname);
        if (n) return n;
      }
    }
    return null;
  };
  const agent = byType('agent') ?? byType('sitemanager');
  if (agent) return { name: agent, role: 'agent' };
  const owner = byType('corporateowner');
  return owner ? { name: owner, role: 'owner' } : null;
}

/** Same company written two ways ("PRESTIGE MANAGEMENT INC." and "Prestige Management Inc"): compare on letters and digits only, minus a trailing company word. */
export function companyKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'()#]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ (?:LLC|INC|CORP|CORPORATION|CO|COMPANY|LP|LTD)$/, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * One lot can hold several registrations (one per building). A company is named only when MORE THAN HALF of the lot's registrations agree
 * on it (same company, any spelling); otherwise nothing is named. More than MAX_REGISTRATIONS_PER_BBL registrations: nothing.
 */
export function managerForBuilding(perRegistration: readonly (Manager | null)[]): Manager | null {
  const n = perRegistration.length;
  if (n === 0 || n > MAX_REGISTRATIONS_PER_BBL) return null;
  const tally = new Map<string, { m: Manager; count: number }>();
  for (const m of perRegistration) {
    if (!m) continue;
    const k = `${m.role}|${companyKey(m.name)}`;
    const cur = tally.get(k);
    if (cur) cur.count += 1;
    else tally.set(k, { m, count: 1 });
  }
  let best: { m: Manager; count: number } | null = null;
  let tie = false;
  for (const v of tally.values()) {
    if (!best || v.count > best.count) {
      best = v;
      tie = false;
    } else if (v.count === best.count) tie = true;
  }
  if (!best || tie || best.count * 2 <= n) return null;
  return best.m;
}

/** The card line. Registration data can be out of date, so the line says where it comes from and never that the company is "responsible". */
export function managedByLine(m: Manager): string {
  return `${m.role === 'agent' ? 'Managed by' : 'Owner company'}: ${m.name} (from the city's building registration)`;
}

/**
 * The line for a stored signal (data.managerName and data.managerRole, written at ingest), or null. The stored name is checked again here
 * with companyNameOf, so a row that was edited or written by another path can never print a person.
 */
export function managedByLineFrom(name: unknown, role: unknown): string | null {
  const n = companyNameOf(name);
  if (!n) return null;
  return managedByLine({ name: n, role: role === 'owner' ? 'owner' : 'agent' });
}

/** A no-heat or no-hot-water request in a residential building. A non-residential heat request is not an HPD-registered dwelling. */
export function isResidentialHeatTitle(title: unknown): boolean {
  if (typeof title !== 'string') return false;
  if (/non-?\s?residential/i.test(title)) return false;
  return /heat\/hot water|\bhot water\b|\bno heat\b|\binadequate heat\b/i.test(title);
}

/** The two stored keys read flat, as a PostgREST select alias list (like DEADLINE_SELECT). Added to every feed read that builds a card. */
export const MANAGER_SELECT = 'managerName:data->>managerName,managerRole:data->>managerRole';
