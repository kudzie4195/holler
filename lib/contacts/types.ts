/**
 * "Who to contact" for a record. Organisations and public offices only: never a private individual.
 * Stored in holler_signal_contacts (service role only) and shown only to signed-in members whose own match points at the record.
 * Nothing here is ever written to holler_signals, which the public can read.
 */
export type ContactRole =
  | 'site' // the address the record is about (job site, establishment location). name is empty.
  | 'business' // a business named in the record (new license, inspected establishment)
  | 'contractor' // a contractor company named on a permit
  | 'awardee' // company that won a public award
  | 'buyer' // public agency or office buying something (bids); attn may hold the named public official
  | 'owner'; // round 18: the registered company a code-violation record names as the property owner (never a person; no phone, email or address)

export interface ContactInput {
  role: ContactRole;
  /** Organisation or agency name. Empty for role 'site'. Never a private person's name. */
  name: string;
  /** Named public official or office for role 'buyer' only (procurement contact published in the solicitation). */
  attn?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  /** Only when the public record itself publishes it for the organisation. */
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** The contractor's licence number when the permit publishes it (a public registry number, never a personal id). Roles contractor and business only. */
  license?: string | null;
  /**
   * Round 18 (lib/enrich/business-lookup.ts): the phone and website of the business's own public listing (DataForSEO Business Listings),
   * attached at read time from the holler_business_lookup cache. Never stored in holler_signal_contacts and never set for a contact whose
   * name the business classifier rejects, for a public buyer or for a site. Absent when no listing passed the name and place checks.
   */
  listing?: ListingInfo | null;
}

/** A business's public listing as shown on a card: its phone (312-555-0100 form) and website (https URL). At least one is set. */
export interface ListingInfo {
  phone: string | null;
  website: string | null;
}

export interface ContactRecord extends ContactInput {
  signalId: number;
}
