import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/** The service-role client, or null when it is not configured (callers then skip the extras that need it). */
export function adminOrNull(): SupabaseClient | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}
