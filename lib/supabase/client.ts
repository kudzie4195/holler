import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';

/** Browser Supabase client (anon key, cookie session). Prefer server routes for auth; this exists for client-side reads. */
export function createBrowserClient() {
  // NEXT_PUBLIC_* must be referenced literally so Next inlines them.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return createSsrBrowserClient(url, anon);
}
