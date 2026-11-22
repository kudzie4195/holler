import { registeredCompanyName } from './org';

/**
 * Round 18 (NAMES): the strict registered-company rule for OWNER, respondent and property-owner columns of code-violation records.
 *
 * A violation card may name the owner of the property only when the public record names a registered company, never a person. The
 * contractor trade-name rule (trade-name.ts) does NOT apply here: "Smith Roofing" in an owner column is refused, so is "John Smith".
 * ownerCompanyName(raw) returns the name with whitespace collapsed only when ALL hold:
 *  O1. It ENDS with a legal form (LLC, L.L.C., INC, INCORPORATED, CORP, CORPORATION, CO, COMPANY, LP, L.P., LLP, LLLP, PLLC, LTD,
 *      LIMITED), or with "TRUST COMPANY" / "TRUST CO" (a bank acting as a corporate trustee), or with "HOUSING AUTHORITY" or
 *      "LAND BANK" / "LAND BANK AUTHORITY" (public landlords).
 *  O2. It passes registeredCompanyName (org.ts): plain ASCII, no phone, email or link, no role word (owner, tenant, trust, estate,
 *      c/o, agent, manager, same as, n/a ...), no DBA, no listed given name next to another word, no honorific, no initial, nothing
 *      that reads as a person ("JOHN SMITH LLC", "J SMITH LLC", "DR. PATEL HOLDINGS INC" fail). For the trust-company form the word
 *      "TRUST" is set aside for this check only; a personal trust ("SMITH FAMILY TRUST", "JOHN SMITH TR", "LAND TRUST #1234") never
 *      ends with a legal form and fails O1.
 *  O3. At most 70 characters (registeredCompanyName).
 */
const LEGAL_END_RE = /(?:^|\s)(?:l\.?l\.?c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|l\.?p\.?|l\.?l\.?p\.?|lllp|p\.?l\.?l\.?c\.?|ltd\.?|limited)$/i;
const TRUST_COMPANY_RE = /\strust\s+(?:co\.?|company)$/i;
const PUBLIC_LANDLORD_RE = /\s(?:housing authority|land bank(?: authority)?)$/i;

export function ownerCompanyName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (TRUST_COMPANY_RE.test(t)) {
    // "CHICAGO TITLE LAND TRUST COMPANY": checked as "CHICAGO TITLE LAND COMPANY", stored as written. Nothing may follow the legal form.
    if (/\btrust\b.*\btrust\b/i.test(t)) return null;
    return registeredCompanyName(t.replace(TRUST_COMPANY_RE, ' COMPANY')) ? t : null;
  }
  if (PUBLIC_LANDLORD_RE.test(t)) {
    // "HOUSING AUTHORITY OF THE CITY OF X" is not this shape; "ATLANTA HOUSING AUTHORITY" is. HOUSING is a company marker in org.ts.
    return registeredCompanyName(t.replace(/\s(?:authority)$/i, '').replace(/\sland bank$/i, ' HOUSING')) ? t : null;
  }
  if (!LEGAL_END_RE.test(t)) return null;
  return registeredCompanyName(t);
}

/** True only when ownerCompanyName returns the same string (after whitespace normalization). */
export function isOwnerCompanyName(name: unknown): boolean {
  return typeof name === 'string' && ownerCompanyName(name) === name.replace(/\s+/g, ' ').trim() && ownerCompanyName(name) !== null;
}
