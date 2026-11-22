import type { ContactInput, ContactRole } from '@/lib/contacts/types';
import { violationOwnersEnabled } from '@/lib/contacts/owner-switch';
import { companyKey } from '@/lib/signals/managed-by';
import { siteAddressFromSummary } from '@/lib/signals/permit-value';
import { buildLink, cleanText, type OutreachLink } from './links';
import { reminderFor, renderNote, type NoteKind } from './templates';
import { t, type Lang } from '@/lib/i18n';

/**
 * What the "Who to contact" block shows for one alert. Pure: no I/O, no framework. Contacts come from the server loader
 * (lib/contacts/load.ts) and only ever for a member with current access whose own match points at the record.
 */

export type RecordClass = 'request' | 'permit' | 'business' | 'inspection' | 'award' | 'bid' | 'storm' | 'area' | 'none';

/** Source and kind -> the kind of record, which decides the block. One mapping for the feed, the loader call and the email. */
export function recordClass(source: string, kind: string): RecordClass {
  const s = (source ?? '').toLowerCase();
  if (s === 'holler-request') return 'request';
  if (kind === 'ask') return 'none'; // people asking elsewhere keep the existing draft flow
  if (s === 'sam-gov') return 'bid';
  if (s === 'usaspending' || kind === 'contract') return 'award';
  if (s.endsWith('-permits') || kind === 'permit') return 'permit';
  if (s.endsWith('-business')) return 'business';
  if (s.endsWith('-inspections')) return 'inspection';
  if (s.endsWith('-311') || s.endsWith('-violations')) return 'area';
  if (s.endsWith('-events') || kind === 'event') return 'none';
  if (s === 'nws' || s === 'spc' || s === 'fema' || kind === 'alert' || kind === 'report' || kind === 'disaster') return 'storm';
  if (s === 'usgs' || kind === 'quake') return 'area';
  return 'none'; // faa, ticketmaster, unknown civic sources
}

const ORG_CLASSES: RecordClass[] = ['permit', 'business', 'inspection', 'award', 'bid'];

/** A code-violation source: its card may name an owner company (round 18). 311 sources never do. */
export function isViolationSource(source: string): boolean {
  return (source ?? '').toLowerCase().endsWith('-violations');
}

/**
 * True when contacts may exist for this record, so the loader is worth asking. Organisation records, and code violations (an owner
 * company on the public record, round 18). Other area records and requests never carry contacts.
 */
export function mayHaveContacts(source: string, kind: string, ownersOn: boolean = violationOwnersEnabled()): boolean {
  return ORG_CLASSES.includes(recordClass(source, kind)) || (ownersOn && recordClass(source, kind) === 'area' && isViolationSource(source));
}

/** True for records whose block names organisations (permits, licences, inspections, awards, bids): the locked prompt says so. */
export function isOrgRecord(source: string, kind: string): boolean {
  return ORG_CLASSES.includes(recordClass(source, kind));
}

/** True when the member sees any block at all for this record (used by the locked view for the heading). */
export function hasBlock(source: string, kind: string): boolean {
  const c = recordClass(source, kind);
  return c !== 'none' && c !== 'request';
}

const ROLE_FOR_CLASS: Partial<Record<RecordClass, ContactRole>> = {
  permit: 'contractor',
  business: 'business',
  inspection: 'business',
  award: 'awardee',
  bid: 'buyer',
};

const ROLE_KEYS = {
  permit: 'outreach.role.permit',
  business: 'outreach.role.business',
  inspection: 'outreach.role.inspection',
  award: 'outreach.role.award',
  bid: 'outreach.role.bid',
} as const;

const roleWordsFor = (cls: RecordClass, lang: Lang): string | undefined => {
  const k = (ROLE_KEYS as Partial<Record<RecordClass, (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS]>>)[cls];
  return k ? t(lang, k) : undefined;
};

const NOTE_FOR_CLASS: Partial<Record<RecordClass, NoteKind>> = {
  permit: 'sub-to-contractor',
  business: 'seller-to-new-business',
  inspection: 'service-to-inspected',
  award: 'supplier-to-awardee',
  bid: 'bidder-to-buyer',
};

/** Plain-words role of a named organisation on this record. Null for records that carry no organisation contact. */
export function roleWords(source: string, kind: string, lang: Lang = 'en'): string | null {
  return roleWordsFor(recordClass(source, kind), lang) ?? null;
}

export const MAX_CONTACTS_SHOWN = 3;

export interface PlanSignal {
  source: string;
  kind: string;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  /**
   * The record's stored public summary. For a permit with no stored site row, the job-site address printed in it (permit-value.ts
   * siteAddressFromSummary) stands in for one, so permits stored before the site rows existed still show the job-site block.
   */
  summary?: string | null;
  /** The record's public source page. Shown next to an owner company on a code-violation card. */
  url?: string | null;
}

export type PlanContact = ContactInput;

export interface PlanLink extends OutreachLink {
  label: string;
}

export interface OrgEntry {
  key: string;
  name: string;
  role: string;
  attn: string | null;
  address: string | null;
  /** 'Address' when the entry has its own street address; 'Job site' when the line shows the record's job-site address instead. */
  addressLabel: string;
  phone: string | null;
  email: string | null;
  /** The contractor's licence number when the permit publishes it. */
  license: string | null;
  website: PlanLink | null;
  search: PlanLink | null;
  map: PlanLink | null;
  note: string;
}

export type OutreachPlan =
  | { type: 'org'; entries: OrgEntry[]; moreCount: number; reminder: string }
  | {
      type: 'site';
      heading: string;
      address: string;
      map: PlanLink | null;
      letter: { label: string; note: string } | null;
      reminder: string;
    }
  | {
      type: 'area';
      place: string | null;
      zips: string[];
      eddm: PlanLink;
      noteLabel: string;
      note: string;
      rules: string;
      guide: PlanLink;
      reminder: string;
      /**
       * Code violations only (round 18): the registered company the record names as the property owner, worded so it never accuses:
       * "Owner on the public record: X", with the public source link. Null when the record names no company.
       */
      owner: { name: string; line: string; source: PlanLink | null } | null;
    };

function withLabel(link: OutreachLink | null, label: string): PlanLink | null {
  return link ? { ...link, label } : null;
}

function formatAddress(c: Pick<ContactInput, 'address' | 'city' | 'state' | 'zip'>, fallbackCity?: string | null, fallbackState?: string | null): string | null {
  const street = cleanText(c.address);
  if (!street) return null;
  const city = cleanText(c.city) || cleanText(fallbackCity);
  const state = cleanText(c.state) || cleanText(fallbackState);
  const zip = cleanText(c.zip);
  const tail = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, tail].filter(Boolean).join(', ');
}

function siteHeading(c: RecordClass, lang: Lang): string {
  switch (c) {
    case 'permit': return t(lang, 'outreach.site.permit');
    case 'business': return t(lang, 'outreach.site.business');
    case 'inspection': return t(lang, 'outreach.site.inspection');
    default: return t(lang, 'outreach.site.default');
  }
}

/** The owner company of a code-violation record, as the area block shows it, or null. */
function ownerLine(signal: PlanSignal, contacts: PlanContact[], lang: Lang): { name: string; line: string; source: PlanLink | null } | null {
  // Redo 2 (review P3-4): not gated here. This runs in the client card, where a server-only switch reads as undefined; the server is the
  // gate (lib/outreach/loader.ts drops every owner row while HOLLER_VIOLATION_OWNERS_ENABLED is off, and sanitize.ts and store.ts never
  // keep one), so an owner contact can only reach this function while the switch is on.
  if (!isViolationSource(signal.source)) return null;
  const c = contacts.find((x) => x.role === 'owner' && cleanText(x.name));
  if (!c) return null;
  const name = cleanText(c.name);
  return {
    name,
    line: t(lang, 'who.owner_record', { name }),
    source: withLabel(buildLink({ type: 'source', url: signal.url ?? '' }), t(lang, 'who.public_source')),
  };
}

function areaPlan(signal: PlanSignal, contacts: PlanContact[], cls: RecordClass, lang: Lang, owner: ReturnType<typeof ownerLine> = null): OutreachPlan | null {
  const city = cleanText(signal.city);
  const state = cleanText(signal.state);
  const zips = [...new Set([signal.zip, ...contacts.map((c) => c.zip)].map(cleanText).filter((z) => /^\d{5}(-\d{4})?$/.test(z)).map((z) => z.slice(0, 5)))].slice(0, 6);
  const place = [city, state].filter(Boolean).join(', ') || null;
  if (!place && zips.length === 0 && !owner) return null;
  const eddm = withLabel(buildLink({ type: 'eddm' }), t(lang, 'outreach.link.eddm'));
  const storm = cls === 'storm';
  const guide = withLabel(buildLink({ type: 'guide', guide: storm ? 'storms' : 'respond' }), t(lang, storm ? 'outreach.link.guide_storms' : 'outreach.link.guide_respond'));
  if (!eddm || !guide) return null;
  return {
    type: 'area',
    place,
    zips,
    eddm,
    noteLabel: t(lang, 'who.copy_door'),
    note: renderNote(storm ? 'door-hanger-storm' : 'door-hanger', {}, lang),
    rules: t(lang, 'outreach.rules'),
    guide,
    reminder: reminderFor(storm, lang),
    owner,
  };
}

/**
 * Decides the block for one alert.
 *  - organisation records (permit with a contractor company, new business, failed inspection, federal award, open bid): the named
 *    organisations (at most MAX_CONTACTS_SHOWN) with their role, published details and actions;
 *  - the same records with only a site address: the job-site block;
 *  - weather, storm reports, disasters, quakes, 311 and code violations: the area kit, and any contacts passed in are ignored, except
 *    that a code violation shows its owner company (role 'owner') as "Owner on the public record: X" with the public source link;
 *  - resident requests, airport delays, events and unknown sources: null (no block).
 * An organisation record with nothing usable falls back to the area kit when the record names a place, else null.
 */
export function outreachPlan(signal: PlanSignal, contacts: PlanContact[] | null | undefined, lang: Lang = 'en'): OutreachPlan | null {
  const cls = recordClass(signal.source, signal.kind);
  if (cls === 'none' || cls === 'request') return null;
  const list = Array.isArray(contacts) ? contacts.filter((c): c is PlanContact => !!c && typeof c === 'object') : [];
  if (!ORG_CLASSES.includes(cls)) return areaPlan(signal, [], cls, lang, cls === 'area' ? ownerLine(signal, list, lang) : null);

  const wantRole = ROLE_FOR_CLASS[cls]!;
  const sites = list.filter((c) => c.role === 'site');
  let siteAddress = sites.map((c) => formatAddress(c, signal.city, signal.state)).find((a): a is string => !!a) ?? null;
  let siteRaw = sites.find((c) => cleanText(c.address));
  if (!siteAddress && cls === 'permit') {
    // A permit stored before site rows existed: the address its public summary already prints.
    const fromSummary = siteAddressFromSummary(signal.summary);
    if (fromSummary) {
      const zip = /(\d{5})(?:-\d{4})?$/.exec(fromSummary.tail ?? '')?.[1] ?? signal.zip ?? null;
      const derived: PlanContact = { role: 'site', name: '', address: fromSummary.address, city: signal.city ?? null, state: signal.state ?? null, zip };
      siteAddress = formatAddress(derived, signal.city, signal.state);
      siteRaw = derived;
    }
  }
  const orgs = list.filter((c) => c.role === wantRole && cleanText(c.name));
  const role = roleWordsFor(cls, lang)!;
  const noteKind = NOTE_FOR_CLASS[cls]!;

  if (orgs.length > 0) {
    // The same company written two ways ("SUNRUN INSTALLATION SERVICES" and "SUNRUN INSTALLATION SERVICES INC") is one entry: the first
    // spelling is kept and fills in any phone, e-mail, website, licence or address only the other row has (final review P2-2).
    const byKey = new Map<string, PlanContact>();
    for (const c of orgs) {
      const name = cleanText(c.name);
      const k = companyKey(name) || name.toLowerCase();
      const first = byKey.get(k);
      if (!first) {
        byKey.set(k, { ...c });
        continue;
      }
      for (const f of ['phone', 'email', 'website', 'license', 'address', 'city', 'state', 'zip'] as const) {
        if (!cleanText(first[f]) && cleanText(c[f])) (first as unknown as Record<string, unknown>)[f] = c[f];
      }
    }
    const unique = [...byKey.values()];
    // The job site is one fact about the record, so it is printed on the first entry that has no address of its own, not on every entry.
    let siteLinePrinted = false;
    const entries: OrgEntry[] = unique.slice(0, MAX_CONTACTS_SHOWN).map((c, i) => {
      const name = cleanText(c.name);
      const own = formatAddress(c, signal.city, signal.state);
      const address = own ?? siteAddress;
      const printAddress = own ? true : !siteLinePrinted;
      if (!own && address) siteLinePrinted = true;
      const mapSrc = own ? c : (siteRaw ?? c);
      const city = cleanText(c.city) || cleanText(signal.city);
      const state = cleanText(c.state) || cleanText(signal.state);
      return {
        key: `${i}-${name.toLowerCase()}`,
        name,
        role,
        attn: cls === 'bid' ? cleanText(c.attn) || null : null,
        address: printAddress ? address : null,
        addressLabel: t(lang, own || cls !== 'permit' ? 'who.address' : 'who.job_site'),
        phone: cleanText(c.phone) || null,
        email: cleanText(c.email) || null,
        license: cleanText(c.license) || null,
        website: withLabel(buildLink({ type: 'website', url: c.website ?? '' }), t(lang, 'outreach.link.website')),
        search: withLabel(buildLink({ type: 'search', org: name, city, state }), t(lang, 'outreach.link.search')),
        map: address
          ? withLabel(
              buildLink({
                type: 'map',
                address: cleanText(mapSrc.address),
                city: cleanText(mapSrc.city) || signal.city,
                state: cleanText(mapSrc.state) || signal.state,
                zip: mapSrc.zip,
              }),
              t(lang, 'outreach.link.map'),
            )
          : null,
        // A permit note names the job site, never the contractor's own office. No site address means no address in the note.
        note: renderNote(noteKind, { org: name, address: cls === 'permit' ? siteAddress : address }, lang),
      };
    });
    return { type: 'org', entries, moreCount: Math.max(0, unique.length - entries.length), reminder: reminderFor(false, lang) };
  }

  if (siteAddress && siteRaw) {
    return {
      type: 'site',
      heading: siteHeading(cls, lang),
      address: siteAddress,
      map: withLabel(
        buildLink({ type: 'map', address: cleanText(siteRaw.address), city: siteRaw.city || signal.city, state: siteRaw.state || signal.state, zip: siteRaw.zip }),
        t(lang, 'outreach.link.map'),
      ),
      letter: cls === 'permit' ? { label: t(lang, 'who.copy_letter'), note: renderNote('trade-to-owner', { address: siteAddress, greeting: 'Property owner' }, lang) } : null,
      reminder: reminderFor(false, lang),
    };
  }

  return areaPlan(signal, list, cls, lang);
}

/** The single organisation named for the alert email: name and role in words. No address, phone or email ever. */
export function emailContact(signal: Pick<PlanSignal, 'source' | 'kind'>, contacts: PlanContact[] | null | undefined, lang: Lang = 'en'): { name: string; role: string } | null {
  const cls = recordClass(signal.source, signal.kind);
  const wantRole = ROLE_FOR_CLASS[cls];
  const role = roleWordsFor(cls, lang);
  if (!wantRole || !role || !Array.isArray(contacts)) return null;
  const hit = contacts.find((c) => c && c.role === wantRole && cleanText(c.name));
  return hit ? { name: cleanText(hit.name), role } : null;
}
