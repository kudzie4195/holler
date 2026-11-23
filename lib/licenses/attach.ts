import type { SupabaseClient } from '@supabase/supabase-js';
import { isStoredContactName } from '@/lib/contacts/names';
import type { ContactInput } from '@/lib/contacts/types';
import { licenseKey } from './company-row';
import { lookupLicenses } from './store';

type Db = SupabaseClient;

/**
 * A contractor licence number a permit row carries, with the state whose licence file it belongs to (OrgSpec.licenseState). PRIVATE and
 * transient: built by the adapter, used once at insert time to look the number up, never stored, never in a sample, never logged.
 */
export interface LicenseRef {
  state: string;
  number: string;
}

export interface LicenseAttachItem {
  contacts: ContactInput[];
  refs: readonly LicenseRef[];
}

/**
 * Round 20 (LIC): look the permits' licence numbers up in holler_contractor_licenses (company licensees only) and attach the business
 * name and business phone. A contractor contact that already carries the same licence gets the phone when it has none; otherwise a
 * contractor contact is added with the stored company name (re-checked with the contractor and licence rules) and phone. No name or
 * address matching is ever done: the licence number is the only key. Without the table (migration 0036 not applied) nothing is attached
 * and nothing fails. Mutates the items' contact arrays; returns how many contacts gained a name or a phone.
 */
export async function attachLicensedContacts(db: Db, items: readonly LicenseAttachItem[], log: (m: string) => void = () => undefined): Promise<number> {
  const byState = new Map<string, Set<string>>();
  for (const it of items) for (const r of it.refs) {
    const k = licenseKey(r.number);
    const st = (r.state ?? '').toUpperCase();
    if (!k || !/^[A-Z]{2}$/.test(st)) continue;
    if (!byState.has(st)) byState.set(st, new Set());
    byState.get(st)!.add(k);
  }
  if (!byState.size) return 0;
  const found = new Map<string, Awaited<ReturnType<typeof lookupLicenses>>['found']>();
  for (const [st, nums] of byState) {
    const res = await lookupLicenses(db, st, [...nums]);
    if (res.missing) {
      log('licences: holler_contractor_licenses is missing (apply migration 0036); no licence contacts attached');
      return 0;
    }
    found.set(st, res.found);
  }
  let gained = 0;
  for (const it of items) {
    for (const r of it.refs) {
      const k = licenseKey(r.number);
      const hit = k ? found.get((r.state ?? '').toUpperCase())?.get(k) : undefined;
      if (!hit || !k) continue;
      // Defence in depth: the stored name must still pass both company rules as a stored name.
      if (!isStoredContactName('contractor', hit.business_name) || !isStoredContactName('business', hit.business_name)) continue;
      const same = it.contacts.find((c) => c.role === 'contractor' && (licenseKey(c.license) === k || c.name === hit.business_name));
      if (same) {
        if (!same.license) same.license = k; // the holder is a company: its number may be shown
        if (!same.phone && hit.business_phone) {
          same.phone = hit.business_phone;
          gained += 1;
        }
        continue;
      }
      it.contacts.push({
        role: 'contractor',
        name: hit.business_name,
        address: hit.business_address ?? null,
        city: hit.business_address ? hit.business_city : null,
        state: hit.business_address ? hit.state : null,
        zip: hit.business_address ? hit.business_zip : null,
        phone: hit.business_phone ?? null,
        license: k,
      });
      gained += 1;
    }
  }
  return gained;
}
