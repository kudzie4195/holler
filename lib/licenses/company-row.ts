import { cleanBusinessName, cleanContractorName } from '@/lib/contacts/trade-name';
import { knownCompanyName } from '@/lib/contacts/known-companies';
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
 * The company rules for a licence holder: a listed large company named exactly, or a name that passes BOTH the contractor rule and the
 * licence rule with the row's person columns compared (a name sharing a word with a person named on the row is that person's). Rule L3 of
 * the licence rule needs an owner column that is filled and different; with none, a bare "Kowalski Roofing" gives nothing.
 */
export function companyLicenseName(raw: string, persons: readonly string[]): string | null {
  if (!raw || !raw.trim()) return null;
  const known = knownCompanyName(raw);
  if (known) return known;
  const contractor = cleanContractorName(raw);
  if (!contractor) return null;
  const business = cleanBusinessName(raw, { ownerNames: persons });
  if (!business) return null;
  // Both rules must give the same name (no part of a joined value only one of them kept).
  return business === contractor ? business : null;
}

/**
 * One licence-file row to the row that may be stored, or the reason it is dropped. A row is kept ONLY when its licence HOLDER passes the
 * company rules; the file's own individual marker drops it first. The shown name is the DBA when it passes too, else the holder. The
 * phone is kept only from a business-phone column; the address only when the source marks it as the business address.
 */
export function toCompanyRow(read: ReadCol, src: LicenseSource, fetchedAt: string): { row: LicenseRow } | { drop: DropReason } {
  const c = src.columns;
  const number = licenseKey(read(c.number));
  if (!number) return { drop: 'no_number' };
  if (c.entityType && src.individualType) {
    const t = read(c.entityType);
    // The file says what the licensee is: an individual is dropped, and so is a row that leaves the type blank (fails closed).
    if (!t.trim() || src.individualType.test(t)) return { drop: 'individual_type' };
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
  const licenseType = c.licenseType ? read(c.licenseType).replace(/\s+/g, ' ').trim().slice(0, 120) || null : null;
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
