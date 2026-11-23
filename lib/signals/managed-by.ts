import { registeredCompanyName } from '@/lib/contacts/org';
import { ownerCompanyName } from '@/lib/contacts/owner-company';
import { gluedPersonWord } from '@/lib/contacts/trade-name';

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
 *  - the CorporationName column is free text and sometimes holds a person ("JOHN B. LOVETT"), so every name must pass companyNameOf
 *    (registeredCompanyName in lib/contacts/org.ts): a real company marker (LLC, INC, CORP, MANAGEMENT, REALTY ...), no role word
 *    (owner, manager, tenant, agent, trust, estate), no placeholder, no listed given name, nothing that reads as a person. A single word,
 *    a trust and an estate never pass.
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

/** A building that has more registrations than this (a development with one registration per building, such as Co-op City) gets nothing: no single company can be named for the lot. */
export const MAX_REGISTRATIONS_PER_BBL = 6;

/**
 * The AGENT or site-manager company name to print, or null: registeredCompanyName in
 * lib/contacts/org.ts (company marker required, role words, placeholders and person shapes rejected). Never throws.
 */
export function companyNameOf(raw: unknown): string | null {
  const n = registeredCompanyName(raw);
  // Round 18 redo 2: a person's name written as one word ("JOHNSMITH MANAGEMENT LLC", "JSMITH REALTY INC") is not a company.
  if (n && n.split(/[\s,/()&.#-]+/).some((w) => /^[A-Za-z]{5,}$/.test(w) && gluedPersonWord(w.toLowerCase()))) return null;
  return n;
}

/**
 * Round 18 redo 2 (review P2-5): the registered CORPORATE OWNER of the building gets the institutional-owner rule of code-violation
 * cards (lib/contacts/owner-company.ts ownerCompanyName): "SMITH LLC", "JOHNSMITH LLC", "MARIA LLC", "GARCIA FAMILY PROPERTIES LLC"
 * are not shown as the owner company. This path is NOT behind HOLLER_VIOLATION_OWNERS_ENABLED (it predates it and stays on). A managing
 * agent or site manager company keeps companyNameOf above.
 */
export function ownerNameOf(raw: unknown): string | null {
  return ownerCompanyName(raw);
}

/** A registration's contact rows to one company: the agent company, else a site manager company, else the corporate owner. */
export function managerForRegistration(rows: readonly HpdContactRow[]): Manager | null {
  const byType = (type: string): string | null => {
    for (const r of rows) {
      if (typeof r?.type === 'string' && r.type.toLowerCase() === type) {
        const n = type === 'corporateowner' ? ownerNameOf(r.corporationname) : companyNameOf(r.corporationname);
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
  const isOwner = role === 'owner';
  const n = isOwner ? ownerNameOf(name) : companyNameOf(name);
  if (!n) return null;
  return managedByLine({ name: n, role: isOwner ? 'owner' : 'agent' });
}

/** A no-heat or no-hot-water request in a residential building. A non-residential heat request is not an HPD-registered dwelling. */
export function isResidentialHeatTitle(title: unknown): boolean {
  if (typeof title !== 'string') return false;
  if (/non-?\s?residential/i.test(title)) return false;
  return /heat\/hot water|\bhot water\b|\bno heat\b|\binadequate heat\b/i.test(title);
}

/** The two stored keys read flat, as a PostgREST select alias list (like DEADLINE_SELECT). Added to every feed read that builds a card. */
export const MANAGER_SELECT = 'managerName:data->>managerName,managerRole:data->>managerRole';
