import { contactNameFor } from './names';
import { cleanAddressPart, sanitizeContacts } from './sanitize';
import type { ContactInput } from './types';
import { firstMoney } from '@/lib/signals/permit-value';

/**
 * Contact extraction from one open-data row, driven by a per-dataset ContactSpec. Every column named in a spec was read from the
 * portal's own column list (spec.verifiedUrl) before it was added. Columns that can hold a private person (owner, applicant, tenant,
 * free-text descriptions, a contractor's personal full name) are never named in a spec, so they are never read here.
 */

/** The address the record is about. Members may see it; the public title and summary never change because of it. */
export interface SiteSpec {
  /** Joined with spaces, in order ("street_number street_direction street_name"). */
  addressFields: string[];
  cityField?: string;
  stateField?: string;
  zipField?: string;
  /**
   * Licences and inspections: emit the site only when the record's business name passed the organization check, so a home business
   * run under a person's name gives neither a name nor its home address.
   */
  onlyWithOrganisation?: boolean;
}

/**
 * A column that is explicitly a business, contractor company or (code violations only) property-owner name. The name rule follows the
 * role (names.ts contactNameFor): contractor -> trade-name rule, owner -> registered-company rule, business -> strict rule.
 */
export interface OrgSpec {
  role: 'business' | 'contractor' | 'owner';
  /** Tried in order; the first value that passes the role's name rule is used. */
  nameFields: string[];
  addressFields?: string[];
  cityField?: string;
  stateField?: string;
  zipField?: string;
  /** Only a dedicated business phone column of this organization. */
  phoneField?: string;
  /** More candidate business phone columns, tried in order after phoneField. Never an owner or homeowner phone. */
  phoneFields?: string[];
  /** The contractor's licence number column(s), tried in order. Stored only next to an organization name that passed. */
  licenseFields?: string[];
  /**
   * A column that says what the named party is (DeKalb primaryContactType). When its value matches rejectType (owner, resident ...)
   * the party is skipped whole: no name, no phone.
   */
  typeField?: string;
  rejectType?: RegExp;
  /**
   * Allow-list for typeField: when set, the party is kept only when the type value matches this AND does not match rejectType. A missing
   * or empty type (the column is not in the layer, or the row leaves it blank) skips the party: it fails closed, never open.
   */
  acceptType?: RegExp;
  /**
   * Dallas shape: one string holding "NAME STREET, CITY, ST ZIP (phone)". The name is the text before the street address; the phone
   * is read from the tail; the street, city and ZIP of the string are never stored.
   */
  runTogether?: boolean;
}

/** Name + type column pairs (Chicago's contact_N_type / contact_N_name). */
export interface TypedPair {
  typeField: string;
  nameField: string;
  cityField?: string;
  stateField?: string;
  zipField?: string;
}

export interface TypedContractorSpec {
  pairs: TypedPair[];
  /** The type value must match this ... */
  acceptType: RegExp;
  /** ... and must not match this (owner, applicant, tenant, expediter ...). */
  rejectType: RegExp;
}

export interface ContactSpec {
  /** The portal URL the column names below were read from. */
  verifiedUrl: string;
  /** Date the columns were read (yyyy-mm-dd). */
  checkedOn: string;
  site?: SiteSpec;
  orgs?: OrgSpec[];
  typedContractors?: TypedContractorSpec;
  /**
   * 'sourced': every column below was read from the portal's own column list. 'assumed': some columns are candidates that could not be
   * read in the session that wrote the spec. A missing Socrata column is just an absent value; an ArcGIS layer rejects an unknown
   * outField, so the ArcGIS adapter drops the rejected field and asks again (arcgis.ts), never losing the rest of the row.
   */
  fieldStatus?: 'sourced' | 'assumed';
  /** Which columns of this spec are candidates (only meaningful when fieldStatus is 'assumed'). Everything else is sourced. */
  assumedFields?: string[];
}

export type ReadField = (field: string) => string;

/** Every column a spec reads (ArcGIS needs them in outFields). */
export function contactSpecFields(spec: ContactSpec | undefined): string[] {
  if (!spec) return [];
  const f: (string | undefined)[] = [];
  if (spec.site) f.push(...spec.site.addressFields, spec.site.cityField, spec.site.stateField, spec.site.zipField);
  for (const o of spec.orgs ?? []) f.push(...o.nameFields, ...(o.addressFields ?? []), o.cityField, o.stateField, o.zipField, o.phoneField, ...(o.phoneFields ?? []), ...(o.licenseFields ?? []), o.typeField);
  for (const p of spec.typedContractors?.pairs ?? []) f.push(p.typeField, p.nameField, p.cityField, p.stateField, p.zipField);
  return [...new Set(f.filter((x): x is string => Boolean(x)))];
}

/**
 * Address parts joined with spaces. Each part is checked on its own first (sanitize.ts cleanAddressPart: no phone, email, link or role
 * word; for an organization's address lines no personal name either), so a bad second line ("ATTN JOHN SMITH 512-555-0199") is dropped
 * instead of riding on a good first line. For a site (`whole`), one bad part drops the whole address: a cut street is not the place.
 */
function join(read: ReadField, fields: string[] | undefined, whole = false): string {
  const raw = (fields ?? []).map((f) => read(f)).filter((v) => v.trim());
  const parts = raw.map((v) => cleanAddressPart(v, { names: !whole }));
  if (whole && parts.some((p) => !p)) return '';
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** A phone at the end of a run-together string: "(817) 969-5050", "469-360-6479" or "/9722431100". */
const TAIL_PHONE_RE = /(?:\/|\s|^)\(?(\d{3})\)?[\s./-]*(\d{3})[\s.-]*(\d{4})\s*$/;
/** Where the street address of a run-together string starts: " 7501 US HWY", " \\1201 Main St", " PO BOX 12". */
const STREET_START_RE = /\s\\?(?:\d{1,6}[A-Za-z]?\s+[A-Za-z#]|p\.?\s?o\.?\s*box\b)/i;

/** Splits "ALL MASTERS PLUMBING 7501 US HWY 287, SuiteC4, ARLINGTON, TX 76001 (817) 969-5050" into the name part and the phone. */
export function splitRunTogether(value: string): { name: string; phone: string | null } {
  const v = value.replace(/\s+/g, ' ').trim();
  const m = STREET_START_RE.exec(v);
  const name = (m ? v.slice(0, m.index) : '').replace(/[,\\/\s]+$/, '').trim();
  const p = TAIL_PHONE_RE.exec(v);
  return { name, phone: p ? `${p[1]}-${p[2]}-${p[3]}` : null };
}

/** Record kinds that never get a contact or an exact address, whatever spec is configured (311 requests). */
export const NO_CONTACT_SUBTYPES: ReadonlySet<string> = new Set(['311']);

/**
 * Record kinds whose only possible contact is an owner company (round 18): a code violation may name the registered company that owns
 * the property ("Owner on the public record"), never a person, never a phone, an email, an address or a site.
 */
export const OWNER_ONLY_SUBTYPES: ReadonlySet<string> = new Set(['violation']);

/**
 * The contacts a record of this kind may keep: none for a 311 request, only role 'owner' for a code violation, and never role 'owner'
 * for anything else. Used at extraction and again before any write (lib/signals/store.ts). `subtype` is matched trimmed, any case.
 */
export function contactsAllowedFor<T extends { role: string }>(subtype: unknown, contacts: readonly T[] | null | undefined): T[] {
  const list = Array.isArray(contacts) ? contacts : [];
  const k = typeof subtype === 'string' ? subtype.trim().toLowerCase() : '';
  if (NO_CONTACT_SUBTYPES.has(k)) return [];
  if (OWNER_ONLY_SUBTYPES.has(k)) return list.filter((c) => c?.role === 'owner');
  return list.filter((c) => c?.role !== 'owner');
}

/**
 * The project value a permit row declares: the first plausible amount among the dataset's valueFields (permit-value.ts parseMoney). Separate from
 * the contacts so a dataset with a value column and no contact spec still gets it. Never throws.
 */
export function extractJobValue(read: ReadField, valueFields: readonly string[] | undefined): number | null {
  if (!valueFields?.length) return null;
  try {
    return firstMoney(valueFields.map((f) => read(f)));
  } catch {
    return null;
  }
}

/**
 * Contacts for one row: organizations first in the order the spec lists them, then the site. Sanitised (lib/contacts/sanitize.ts: every
 * address cut after the street suffix and one unit, state a US code, city only the dataset's own city or place words), de-duplicated and
 * capped at 6. Never throws. `subtype` is the dataset's record kind: a 311 request gets no contact at all, and a code violation gets
 * only an owner company (role 'owner', registered-company rule, name only), even when a spec is configured for it by mistake.
 */
export function extractContacts(
  read: ReadField,
  spec: ContactSpec | undefined,
  place: { city: string; state: string },
  subtype?: string,
): ContactInput[] {
  if (!spec) return [];
  if (subtype !== undefined && NO_CONTACT_SUBTYPES.has(subtype)) return [];
  const ownerOnly = subtype !== undefined && OWNER_ONLY_SUBTYPES.has(subtype);
  try {
    const orgs: ContactInput[] = [];
    for (const o of spec.orgs ?? []) {
      // An owner company only on a code violation, and a code violation carries nothing else (no site, no business, no contractor).
      if ((o.role === 'owner') !== ownerOnly) continue;
      if (o.typeField) {
        const t = read(o.typeField);
        if (o.acceptType && !o.acceptType.test(t)) continue; // allow-list, fails closed on a blank or missing type
        if (o.rejectType && o.rejectType.test(t)) continue;
      }
      let name: string | null = null;
      let runPhone: string | null = null;
      for (const f of o.nameFields) {
        const raw = read(f);
        if (o.runTogether) {
          const parts = splitRunTogether(raw);
          name = contactNameFor(o.role, parts.name);
          runPhone = parts.phone;
        } else {
          name = contactNameFor(o.role, raw);
        }
        if (name) break;
      }
      if (!name) continue;
      if (o.role === 'owner') {
        // The owner on the public record: the company name only. Owner phones, emails, addresses and ids are never read.
        orgs.push({ role: 'owner', name, address: null, city: null, state: null, zip: null, phone: null });
        continue;
      }
      let phone: string | null = null;
      for (const f of [o.phoneField, ...(o.phoneFields ?? [])]) {
        const v = f ? read(f) : '';
        if (v) {
          phone = v;
          break;
        }
      }
      let license: string | null = null;
      for (const f of o.licenseFields ?? []) {
        const v = read(f);
        if (v) {
          license = v;
          break;
        }
      }
      orgs.push({
        role: o.role,
        name,
        address: join(read, o.addressFields) || null,
        city: o.cityField ? read(o.cityField) || null : null,
        state: o.stateField ? read(o.stateField) || null : null,
        zip: o.zipField ? read(o.zipField) || null : null,
        phone: phone ?? runPhone,
        ...(license ? { license } : {}),
      });
    }
    const t = ownerOnly ? undefined : spec.typedContractors;
    if (t) {
      for (const p of t.pairs) {
        const type = read(p.typeField);
        if (!type || !t.acceptType.test(type) || t.rejectType.test(type)) continue;
        const name = contactNameFor('contractor', read(p.nameField));
        if (!name) continue;
        orgs.push({
          role: 'contractor',
          name,
          address: null,
          city: p.cityField ? read(p.cityField) || null : null,
          state: p.stateField ? read(p.stateField) || null : null,
          zip: p.zipField ? read(p.zipField) || null : null,
        });
      }
    }
    const out = [...orgs];
    const s = spec.site;
    if (s && !ownerOnly && (!s.onlyWithOrganisation || orgs.some((c) => c.role === 'business'))) {
      const address = join(read, s.addressFields, true);
      if (address) {
        out.push({
          role: 'site',
          name: '',
          address,
          city: (s.cityField && read(s.cityField)) || place.city,
          state: (s.stateField && read(s.stateField)) || place.state,
          zip: s.zipField ? read(s.zipField) || null : null,
        });
      }
    }
    return sanitizeContacts(out, { datasetCity: place.city });
  } catch {
    return [];
  }
}
