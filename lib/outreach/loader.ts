import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contactsForMember } from '@/lib/contacts/load';
import { isOrganisationName } from '@/lib/contacts/org';
import type { ContactRecord } from '@/lib/contacts/types';
import { attachCachedListings, type SignalPlaces } from '@/lib/enrich/business-lookup';

/**
 * Server-side glue between the feed or the alert email and the contacts loader owned by lib/contacts (service role only).
 * A failing loader means "no contacts", never a broken page. The `loader` and `orgCheck` params exist so tests can inject fakes.
 * Nothing here touches holler_signals, and nothing leaves this function for a signal id the caller did not ask for.
 */
export type ContactLoader = (db: SupabaseClient, userId: string, signalIds: number[], now?: Date) => Promise<Map<number, ContactRecord[]>>;
export type OrgCheck = (name: string) => boolean;

const MAX_SIGNALS = 100;

/**
 * Contacts for the signals the member's own matches point at. Pass only signal ids taken from that member's matches.
 * Returns an empty map when the loader is missing, throws, or the caller is locked (`locked: true`: the loader is not even called).
 * Defence in depth on top of the loader: only requested ids come back, each contact must carry the id it is filed under, and a
 * contractor, business or awardee name that the classifier does not accept as an organisation is dropped.
 */
export async function loadMemberContacts(opts: {
  db: SupabaseClient;
  userId: string;
  signalIds: number[];
  locked?: boolean;
  loader?: ContactLoader | null;
  orgCheck?: OrgCheck | null;
  /**
   * Round 18: the city and state of each requested signal. When given, a business's public listing found earlier (the
   * holler_business_lookup cache, migration 0026) is attached to its contact. Read only: no lookup call is ever made here. Absent, or
   * any failure, or 0026 not applied: the contacts are returned exactly as before.
   */
  places?: SignalPlaces | null;
}): Promise<Map<number, ContactRecord[]>> {
  const out = new Map<number, ContactRecord[]>();
  if (opts.locked || !opts.userId) return out;
  const ids = [...new Set(opts.signalIds.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MAX_SIGNALS);
  if (ids.length === 0) return out;
  try {
    const loader = opts.loader === undefined ? contactsForMember : opts.loader;
    if (!loader) return out;
    const orgCheck = opts.orgCheck === undefined ? isOrganisationName : opts.orgCheck;
    const got = await loader(opts.db, opts.userId, ids);
    if (!(got instanceof Map)) return out;
    const wanted = new Set(ids);
    for (const [signalId, list] of got) {
      if (!wanted.has(signalId) || !Array.isArray(list)) continue;
      const kept = list.filter((c) => {
        if (!c || c.signalId !== signalId) return false;
        if (c.role === 'site' || c.role === 'buyer') return true;
        return orgCheck ? orgCheck(c.name) : true;
      });
      if (kept.length > 0) out.set(signalId, kept);
    }
  } catch {
    console.error('contacts: load failed', 'loader', 'exception');
    return new Map();
  }
  if (opts.places && out.size > 0) {
    try {
      return await attachCachedListings(opts.db, out, opts.places);
    } catch {
      return out;
    }
  }
  return out;
}
