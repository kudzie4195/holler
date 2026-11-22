import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client (anon key). Unused: the session cookie is HttpOnly (lib/supabase/cookie-options.ts, SEC-3), so this client
 * cannot see a signed-in session. Use server routes and server actions for anything that needs the member.
 */
export function createBrowserClient() {
  // NEXT_PUBLIC_* must be referenced literally so Next inlines them.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return createSsrBrowserClient(url, anon);
}
