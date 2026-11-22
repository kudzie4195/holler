import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contactsForMember } from '@/lib/contacts/load';
import { isStoredContactName } from '@/lib/contacts/names';
import type { ContactRecord, ContactRole } from '@/lib/contacts/types';

/**
 * Server-side glue between the feed or the alert email and the contacts loader owned by lib/contacts (service role only).
 * A failing loader means "no contacts", never a broken page. The `loader` and `orgCheck` params exist so tests can inject fakes.
 * Nothing here touches holler_signals, and nothing leaves this function for a signal id the caller did not ask for.
 */
export type ContactLoader = (db: SupabaseClient, userId: string, signalIds: number[], now?: Date) => Promise<Map<number, ContactRecord[]>>;
/** Re-check of a stored name. `role` picks the rule (names.ts): contractor trade names, owner companies, strict for the rest. */
export type OrgCheck = (name: string, role: ContactRole) => boolean;

const MAX_SIGNALS = 100;

/**
 * Contacts for the signals the member's own matches point at. Pass only signal ids taken from that member's matches.
 * Returns an empty map when the loader is missing, throws, or the caller is locked (`locked: true`: the loader is not even called).
 * Defence in depth on top of the loader: only requested ids come back, each contact must carry the id it is filed under, and a
 * contractor, business, awardee or owner name that its role's rule (lib/contacts/names.ts) does not give back unchanged is dropped.
 */
export async function loadMemberContacts(opts: {
  db: SupabaseClient;
  userId: string;
  signalIds: number[];
  locked?: boolean;
  loader?: ContactLoader | null;
  orgCheck?: OrgCheck | null;
}): Promise<Map<number, ContactRecord[]>> {
  const out = new Map<number, ContactRecord[]>();
  if (opts.locked || !opts.userId) return out;
  const ids = [...new Set(opts.signalIds.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MAX_SIGNALS);
  if (ids.length === 0) return out;
  try {
    const loader = opts.loader === undefined ? contactsForMember : opts.loader;
    if (!loader) return out;
    const orgCheck: OrgCheck | null = opts.orgCheck === undefined ? (name, role) => isStoredContactName(role, name) : opts.orgCheck;
    const got = await loader(opts.db, opts.userId, ids);
    if (!(got instanceof Map)) return out;
    const wanted = new Set(ids);
    for (const [signalId, list] of got) {
      if (!wanted.has(signalId) || !Array.isArray(list)) continue;
      const kept = list.filter((c) => {
        if (!c || c.signalId !== signalId) return false;
        if (c.role === 'site' || c.role === 'buyer') return true;
        return orgCheck ? orgCheck(c.name, c.role) : true;
      });
      if (kept.length > 0) out.set(signalId, kept);
    }
  } catch {
    console.error('contacts: load failed', 'loader', 'exception');
    return new Map();
  }
  return out;
}
