import 'server-only';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Supabase clients for the mobile API. A mobile request carries the member's access token in the Authorization header instead of a
 * cookie, so the cookie client (lib/supabase/server.ts) cannot be used.
 */

function urlAndAnon(): { url: string; anon: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  return { url, anon };
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** Anon client with no session: used only to ask the Auth server who a token belongs to (auth.getUser(token)). */
export function authClient(): SupabaseClient {
  const { url, anon } = urlAndAnon();
  return createSupabaseClient(url, anon, { auth: NO_SESSION });
}

/** The member's own client: every query runs as that member, under RLS and the column grants, exactly like the web's cookie client. */
export function memberClient(accessToken: string): SupabaseClient {
  const { url, anon } = urlAndAnon();
  return createSupabaseClient(url, anon, { auth: NO_SESSION, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}
