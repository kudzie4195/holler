import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/** Service-role client. Bypasses RLS. Never import from client code; never expose its results unfiltered. */
export function createAdminClient() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase admin is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
