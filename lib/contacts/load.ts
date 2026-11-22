import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContactRecord, ContactRole } from './types';

/**
 * Who to contact, for one signed-in member. The ONLY reader of holler_signal_contacts (service role only, migration 0006).
 * Pass the service-role client. Returns contacts only for signal ids that appear in this member's own holler_matches rows, and only
 * while the member has current access. The loader reads the member's profile itself on every call (no caller hint exists). Access is an allow-list on the exact status string: trialing until trial_ends_at, active and
 * past_due paid. Anything else (null, "Canceled", " canceled", "unpaid", "paused", an unknown word) gets nothing. Profiles are created
 * with status 'trialing' (migration 0001: not null, default 'trialing'), so a new trial account keeps working. At most 200 signal ids
 * per call. Any error gives an empty map and logs the step and the error code only, never row data.
 */

type Db = SupabaseClient;

export const MAX_SIGNAL_IDS = 200;
const ACCESS_STATUSES = new Set(['trialing', 'active', 'past_due']);
const ROLES = new Set<ContactRole>(['site', 'business', 'contractor', 'awardee', 'buyer']);

/** The access rule: exact allow-list on status, plus the trial date for trialing. */
export function statusGrantsAccess(status: unknown, trialEndsAt: unknown, nowMs: number): boolean {
  if (typeof status !== 'string' || !ACCESS_STATUSES.has(status)) return false;
  if (status !== 'trialing') return true;
  if (typeof trialEndsAt !== 'string') return false;
  const end = Date.parse(trialEndsAt);
  return Number.isFinite(end) && end > nowMs;
}

function logFailure(step: string, err: unknown): void {
  const code = err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : 'unknown';
  console.error('contacts: load failed', step, code);
}

interface ContactRow {
  signal_id: number;
  role: string;
  name: string | null;
  attn: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

export async function contactsForMember(
  db: Db,
  userId: string,
  signalIds: number[],
  now: Date = new Date(),
): Promise<Map<number, ContactRecord[]>> {
  const out = new Map<number, ContactRecord[]>();
  if (!db || typeof userId !== 'string' || !userId || !Array.isArray(signalIds)) return out;
  const ids = [...new Set(signalIds.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MAX_SIGNAL_IDS);
  if (ids.length === 0) return out;
  try {
    // 1. Current access, always read here from the member's own profile row. No caller-supplied value can influence it.
    const { data: prof, error: pErr } = await db
      .from('holler_profiles')
      .select('subscription_status, trial_ends_at')
      .eq('user_id', userId)
      .limit(1);
    if (pErr) {
      logFailure('profile', pErr);
      return new Map();
    }
    if (!Array.isArray(prof) || prof.length !== 1) return new Map();
    const p = prof[0] as { subscription_status: unknown; trial_ends_at: unknown };
    if (!statusGrantsAccess(p.subscription_status, p.trial_ends_at, now.getTime())) return new Map();

    // 2. Only signals this member has a match for.
    const { data: matches, error: mErr } = await db
      .from('holler_matches')
      .select('signal_id')
      .eq('user_id', userId)
      .in('signal_id', ids)
      .limit(ids.length);
    if (mErr) {
      logFailure('matches', mErr);
      return new Map();
    }
    if (!Array.isArray(matches)) return new Map();
    const owned = [...new Set((matches as { signal_id: number }[]).map((m) => m.signal_id).filter((n) => ids.includes(n)))];
    if (owned.length === 0) return out;

    // 3. Their contacts.
    const { data: rows, error: cErr } = await db
      .from('holler_signal_contacts')
      .select('signal_id, role, name, attn, address, city, state, zip, phone, email, website')
      .in('signal_id', owned)
      .order('id', { ascending: true })
      .limit(owned.length * 6);
    if (cErr) {
      logFailure('contacts', cErr);
      return new Map();
    }
    if (!Array.isArray(rows)) return new Map();
    const allowed = new Set(owned);
    for (const r of rows as ContactRow[]) {
      if (!r || !allowed.has(r.signal_id) || !ROLES.has(r.role as ContactRole)) continue;
      const rec: ContactRecord = {
        signalId: r.signal_id,
        role: r.role as ContactRole,
        name: r.name ?? '',
        attn: r.attn ?? null,
        address: r.address || null,
        city: r.city ?? null,
        state: r.state ?? null,
        zip: r.zip ?? null,
        phone: r.phone ?? null,
        email: r.email ?? null,
        website: r.website ?? null,
      };
      const list = out.get(r.signal_id) ?? [];
      if (list.length < 6) list.push(rec);
      out.set(r.signal_id, list);
    }
    return out;
  } catch (e) {
    logFailure('exception', e);
    return new Map();
  }
}

/**
 * ADMIN ONLY (the owner score report, lib/signals/score-admin.ts behind the CRON_SECRET route). Which of these signal ids have a named
 * organisation on file (any role but a bare 'site' address, with a name). Returns ids only: no name, phone, e-mail or address leaves
 * this function. It is not for a member-facing path: those use contactsForMember, which checks the member's own match and access.
 * Reads in chunks of 200 ids; a read error stops early and the ids found so far are returned (the score then simply lacks +30).
 */
export async function signalIdsWithNamedContact(db: Db, signalIds: number[]): Promise<{ ids: Set<number>; reads: number }> {
  const ids = [...new Set(signalIds.filter((n) => Number.isSafeInteger(n) && n > 0))];
  const found = new Set<number>();
  let reads = 0;
  for (let i = 0; i < ids.length; i += MAX_SIGNAL_IDS) {
    reads++;
    const { data, error } = await db
      .from('holler_signal_contacts')
      .select('signal_id')
      .neq('role', 'site')
      .neq('name', '')
      .in('signal_id', ids.slice(i, i + MAX_SIGNAL_IDS));
    if (error) {
      logFailure('named-contact-ids', error);
      break;
    }
    for (const r of (data ?? []) as { signal_id: number }[]) found.add(r.signal_id);
  }
  return { ids: found, reads };
}
