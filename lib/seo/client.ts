import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

let cached: SupabaseClient | null | undefined;

/**
 * Anonymous, read-only Supabase client for public pages.
 * Public pages only ever read holler_signals (RLS allows anon SELECT there). Never user tables.
 * Returns null when the public URL or anon key is missing.
 */
export function publicClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
      : null;
  return cached;
}
