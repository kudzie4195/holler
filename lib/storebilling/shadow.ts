/**
 * The store plan a double payer has waiting in holler_billing_shadow (migration 0020): a member whose live plan is billed by Stripe
 * (or the other store) while an App Store or Google Play subscription is also still running. Account deletion reads it BEFORE the
 * profile is deleted (the shadow row is deleted with it), so the member is told to cancel that subscription in the store too
 * (review v2 P2, commander decision 7). Service role only: the table is closed to members.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ShadowStoreRow {
  store?: string | null;
  store_expires_at?: string | null;
}

/** The store of a shadow row whose subscription has not ended yet (a future expiry), or null. Pure. */
export function liveShadowStore(row: ShadowStoreRow | null | undefined, now: number = Date.now()): 'apple' | 'google' | null {
  if (!row || (row.store !== 'apple' && row.store !== 'google')) return null;
  const exp = row.store_expires_at ? Date.parse(row.store_expires_at) : NaN;
  return Number.isFinite(exp) && exp > now ? row.store : null;
}

/**
 * Reads the member's shadow row. Fails soft: before migration 0020, or on any read error, it answers null (a notice must never stop an
 * account deletion), and logs the error.
 */
export async function readShadowStore(admin: Pick<SupabaseClient, 'from'>, userId: string, now: number = Date.now()): Promise<'apple' | 'google' | null> {
  try {
    const { data, error } = await admin.from('holler_billing_shadow').select('store, store_expires_at').eq('user_id', userId).maybeSingle();
    if (error) {
      console.error(`[account] billing shadow read failed: ${(error as { code?: string }).code ?? 'unknown'}`);
      return null;
    }
    return liveShadowStore(data as ShadowStoreRow | null, now);
  } catch {
    return null;
  }
}
