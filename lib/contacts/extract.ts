import { cleanOrgName } from './org';
import { cleanAddressPart, sanitizeContacts } from './sanitize';
import type { ContactInput } from './types';

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

/** A column that is explicitly a business or contractor company name. */
export interface OrgSpec {
  role: 'business' | 'contractor';
  /** Tried in order; the first value that passes cleanOrgName is used. */
  nameFields: string[];
  addressFields?: string[];
  cityField?: string;
  stateField?: string;
  zipField?: string;
  /** Only a dedicated business phone column of this organization. */
  phoneField?: string;
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
}

export type ReadField = (field: string) => string;

/** Every column a spec reads (ArcGIS needs them in outFields). */
export function contactSpecFields(spec: ContactSpec | undefined): string[] {
  if (!spec) return [];
  const f: (string | undefined)[] = [];
  if (spec.site) f.push(...spec.site.addressFields, spec.site.cityField, spec.site.stateField, spec.site.zipField);
  for (const o of spec.orgs ?? []) f.push(...o.nameFields, ...(o.addressFields ?? []), o.cityField, o.stateField, o.zipField, o.phoneField);
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

/** Record kinds that never get a contact or an exact address, whatever spec is configured (code violations, 311 requests). */
export const NO_CONTACT_SUBTYPES: ReadonlySet<string> = new Set(['violation', '311']);

/**
 * Contacts for one row: organizations first in the order the spec lists them, then the site. Sanitised (lib/contacts/sanitize.ts: every
 * address cut after the street suffix and one unit, state a US code, city only the dataset's own city or place words), de-duplicated and
 * capped at 6. Never throws. `subtype` is the dataset's record kind: a code violation or a 311 request gets no
 * contact at all, even when a spec is configured for it by mistake.
 */
export function extractContacts(
  read: ReadField,
  spec: ContactSpec | undefined,
  place: { city: string; state: string },
  subtype?: string,
): ContactInput[] {
  if (!spec) return [];
  if (subtype !== undefined && NO_CONTACT_SUBTYPES.has(subtype)) return [];
  try {
    const orgs: ContactInput[] = [];
    for (const o of spec.orgs ?? []) {
      let name: string | null = null;
      for (const f of o.nameFields) {
        name = cleanOrgName(read(f));
        if (name) break;
      }
      if (!name) continue;
      orgs.push({
        role: o.role,
        name,
        address: join(read, o.addressFields) || null,
        city: o.cityField ? read(o.cityField) || null : null,
        state: o.stateField ? read(o.stateField) || null : null,
        zip: o.zipField ? read(o.zipField) || null : null,
        phone: o.phoneField ? read(o.phoneField) || null : null,
      });
    }
    const t = spec.typedContractors;
    if (t) {
      for (const p of t.pairs) {
        const type = read(p.typeField);
        if (!type || !t.acceptType.test(type) || t.rejectType.test(type)) continue;
        const name = cleanOrgName(read(p.nameField));
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
    if (s && (!s.onlyWithOrganisation || orgs.some((c) => c.role === 'business'))) {
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
