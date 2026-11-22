import { cleanOrgName, isOrganisationName } from './org';
import { ownerCompanyName, isOwnerCompanyName } from './owner-company';
import { cleanBusinessName, cleanContractorName, isBusinessName, isContractorName, isPlaceholderName, type LicenceContext } from './trade-name';
import type { ContactRole } from './types';

/**
 * Which name rule decides each contact role (round 18, NAMES). One place, used at extraction (extract.ts), at storage (sanitize.ts)
 * and when a stored row is shown (lib/outreach/loader.ts):
 *  - contractor: the contractor trade-name rule (trade-name.ts cleanContractorName, C1 to C8: wider than the strict org.ts rule for
 *    trade names, narrower for person shapes, placeholders and family holdings). Only contractor company columns carry this role.
 *  - owner: the institutional-owner rule (owner-company.ts ownerCompanyName: legal form required, no person-name word anywhere).
 *    Code-violation owner columns only, and only while HOLLER_VIOLATION_OWNERS_ENABLED is on (owner-switch.ts); never a person.
 *  - business (licence and inspection names): trade-name.ts cleanBusinessName: a legal form, or a business name with no person-name
 *    word, no possessive person form, no initial and no home-based activity. A licence can belong to a home business whose site is a
 *    home, so "Maria Lopez Home Daycare", "Lopez Daycare" and "Gareth Barber" give nothing here.
 *  - awardee, buyer: the strict organisation rule (org.ts cleanOrgName), plus the placeholder refusal of redo rule 2 ("Self
 *    Contractor", "No Contractor", "TBD" ...) that every role gets.
 *  - site: no name.
 */
export function contactNameFor(role: ContactRole, raw: unknown, licence: LicenceContext = {}): string | null {
  switch (role) {
    case 'site':
      return null;
    case 'contractor':
      return cleanContractorName(raw);
    case 'owner':
      return ownerCompanyName(raw);
    case 'business':
      return cleanBusinessName(raw, licence);
    default:
      return typeof raw === 'string' && !isPlaceholderName(raw) ? cleanOrgName(raw) : null;
  }
}

/** A stored name re-checked under its role's rule: true only when the rule gives the name back unchanged. */
export function isStoredContactName(role: ContactRole, name: unknown): boolean {
  switch (role) {
    case 'site':
      return false;
    case 'contractor':
      return isContractorName(name);
    case 'owner':
      return isOwnerCompanyName(name);
    case 'business':
      return isBusinessName(name);
    default:
      return typeof name === 'string' && !isPlaceholderName(name) && isOrganisationName(name);
  }
}
