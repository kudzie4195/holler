import { cleanOrgName, isOrganisationName } from './org';
import { ownerCompanyName, isOwnerCompanyName } from './owner-company';
import { cleanBusinessName, cleanContractorName, isBusinessName, isContractorName } from './trade-name';
import type { ContactRole } from './types';

/**
 * Which name rule decides each contact role (round 18, NAMES). One place, used at extraction (extract.ts), at storage (sanitize.ts)
 * and when a stored row is shown (lib/outreach/loader.ts):
 *  - contractor: the contractor trade-name rule (trade-name.ts cleanContractorName: the strict rule, else a trade name with a business
 *    marker). Only contractor company columns carry this role.
 *  - owner: the strict registered-company rule (owner-company.ts ownerCompanyName). Code-violation owner columns only; never a person.
 *  - business (licence and inspection names): trade-name.ts cleanBusinessName, the strict rule, else a trade or business name in
 *    which no word is a listed given name, a listed surname or an initial. A licence can belong to a home business whose site is a home,
 *    so a person's name plus a trade word ("Maria Lopez Home Daycare", "Lopez Daycare") is refused here even though a contractor column
 *    would show it.
 *  - awardee, buyer: the strict organisation rule (org.ts cleanOrgName), unchanged.
 *  - site: no name.
 */
export function contactNameFor(role: ContactRole, raw: unknown): string | null {
  switch (role) {
    case 'site':
      return null;
    case 'contractor':
      return cleanContractorName(raw);
    case 'owner':
      return ownerCompanyName(raw);
    case 'business':
      return cleanBusinessName(raw);
    default:
      return typeof raw === 'string' ? cleanOrgName(raw) : null;
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
      return typeof name === 'string' && isOrganisationName(name);
  }
}
