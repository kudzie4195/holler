import { cleanBusinessName, cleanContractorName } from '@/lib/contacts/trade-name';
import { cleanAddress, usPhone } from '@/lib/contacts/sanitize';
import type { LicenseSource } from './sources';

/** A licence-file row as it may be stored in holler_contractor_licenses (migration 0036). Company licensees only. */
export interface LicenseRow {
  state: string;
  license_number: string;
  source: string;
  business_name: string;
  business_phone: string | null;
  business_address: string | null;
  business_city: string | null;
  business_zip: string | null;
  license_type: string | null;
  fetched_at: string;
}

export type ReadCol = (column: string) => string;

/** Why a row was not kept (counts only; the row itself is never logged). */
export type DropReason = 'no_number' | 'individual_type' | 'holder_not_company' | 'no_name';

/**
 * The licence number as stored and looked up: upper case, spaces removed, 3 to 40 characters of letters, digits, ".", "/", "#" or "-",
 * at least one digit, never a phone or an SSN shape. Unlike cleanLicense (what a contact may SHOW), a board number shaped like a driver
 * licence ("QB1234567", Florida's business certificates) is a valid KEY here: it only finds a row of a state board's file, and a number
 * is shown on a contact only when cleanLicense also passes it.
 */
export function licenseKey(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  if (s.length < 3 || s.length > 40) return null;
  if (!/^[A-Z0-9][A-Z0-9./#-]*$/.test(s) || !/\d/.test(s)) return null;
  if (/^[\d./-]+$/.test(s) && s.replace(/\D/g, '').length === 9) return null; // SSN shape, with or without separators
  if (usPhone(s) || /^\d{3}[-.]\d{4}$/.test(s)) return null;
  return s;
}

/**
 * Review LIC P1-1: a holder or DBA cell that joins two names is never a company licensee: "JOHN SMITH DBA ACME ROOFING LLC" is the
 * person's licence. Every doing-business-as form, a care-of join, a slash and brackets are refused whole; any other join the contractor
 * rule cuts down ("JOHN SMITH OF ACME ROOFING LLC", "JOHN SMITH, ACME ROOFING LLC") fails the whole-value comparison below (the
 * contractor rule keeps the firm part, which is right for a permit column and wrong for a licence file).
 */
const JOINED_RE =
  /\b(?:d\s*[./]?\s*b\s*[./]?\s*a|t\s*\/\s*a|trading\s+as|doing\s+business\s+as|operating\s+as|o\s*\/\s*a|a\s*\/\s*k\s*\/\s*a|aka|f\s*\/\s*k\s*\/\s*a|fka|n\s*\/\s*k\s*\/\s*a|c\s*\/\s*o|care\s+of|in\s+care\s+of|on\s+behalf\s+of|attn)\b/i;

/** The cell reduced to words for the whole-value comparison (punctuation and case ignored). */
function whole(s: string): string {
  return s.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9&]+/g, ' ').trim();
}

/**
 * The company rules for a licence holder: a listed large company named exactly (with a legal form, as in the licence role), or a name that
 * passes BOTH the contractor rule and the licence rule with the row's person columns compared, AND that both rules give back whole (no part
 * of a joined value). Rule L3 of the licence rule needs an owner column that is filled and different; with none, a bare "Kowalski Roofing"
 * holder gives nothing.
 */
export function companyLicenseName(raw: string, persons: readonly string[]): string | null {
  if (!raw || !raw.trim()) return null;
  if (JOINED_RE.test(raw) || /[/\\()[\]{}|;:]/.test(raw)) return null;
  const business = cleanBusinessName(raw, { ownerNames: persons });
  if (!business) return null;
  const contractor = cleanContractorName(raw);
  if (!contractor) return null;
  // Both rules must give the same name, and that name must be the whole cell (review LIC P1-1: nothing cut away).
  if (business !== contractor || whole(contractor) !== whole(raw)) return null;
  return business;
}

/**
 * One licence-file row to the row that may be stored, or the reason it is dropped. A row is kept ONLY when
 *  - its licence number matches the state's pattern (a misread column never becomes a key),
 *  - the file's own type column, when the source names one, holds an ALLOWED company type (unknown, individual and blank codes drop it),
 *  - its licence HOLDER passes the company rules.
 * The shown name is the DBA when it passes too, else the holder. The phone is kept only from a business-phone column; the address only
 * when the source marks it as the business address; a licence type that does not have the source's shape is stored as null.
 */
export function toCompanyRow(read: ReadCol, src: LicenseSource, fetchedAt: string): { row: LicenseRow } | { drop: DropReason } {
  const c = src.columns;
  const number = licenseKey(read(c.number));
  if (!number || !src.numberPattern.test(number)) return { drop: 'no_number' };
  if (c.entityType) {
    // An allow-list that fails closed: no companyType, a blank value or any value it does not list drops the row.
    const t = read(c.entityType).trim();
    if (!src.companyType || !t || !src.companyType.test(t)) return { drop: 'individual_type' };
  }
  const persons = (c.personFields ?? []).map((f) => read(f)).filter((v) => v.trim().length > 0);
  const holder = companyLicenseName(read(c.holder), persons);
  if (!holder) return { drop: 'holder_not_company' };
  const dbaRaw = c.dba ? read(c.dba) : '';
  const dba = dbaRaw ? companyLicenseName(dbaRaw, [...persons]) : null;
  const name = dba ?? holder;
  if (!name) return { drop: 'no_name' };
  let phone: string | null = null;
  if (src.phoneIsBusiness) {
    const p = c.phoneParts?.length ? c.phoneParts.map((f) => read(f)).join('') : c.phone ? read(c.phone) : '';
    phone = usPhone(p);
  }
  const address = src.addressIsBusiness && c.address ? cleanAddress(read(c.address)) : null;
  const city = src.addressIsBusiness && c.city ? read(c.city).trim().slice(0, 80) || null : null;
  const zipRaw = src.addressIsBusiness && c.zip ? read(c.zip).trim() : '';
  const zip = /^\d{5}(?:-\d{4})?$/.test(zipRaw) ? zipRaw.slice(0, 5) : null;
  const typeRaw = c.licenseType ? read(c.licenseType).replace(/\s+/g, ' ').trim() : '';
  const licenseType = typeRaw && src.typePattern.test(typeRaw) ? typeRaw.slice(0, 120) : null;
  return {
    row: {
      state: src.state,
      license_number: number,
      source: src.id,
      business_name: name,
      business_phone: phone,
      business_address: address,
      business_city: address ? city : null,
      business_zip: address ? zip : null,
      license_type: licenseType,
      fetched_at: fetchedAt,
    },
  };
}
