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
  | 'buyer'; // public agency or office buying something (bids); attn may hold the named public official

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
   * Alert gate only (round 18): the source's own site-address columns name a place to go, but the display cutter refused them, so there is
   * no stored site contact. Set by the adapter on an entry with role 'site', empty name and no address. NEVER stored (writeSignalContacts
   * drops it) and never shown; lib/signals/run.ts markContactPaths reads it.
   */
  gateOnly?: boolean;
}

export interface ContactRecord extends ContactInput {
  signalId: number;
}
