import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Only the routes that need the session. Public and SEO pages are never touched,
// so Set-Cookie headers can't interfere with their caching.
export const config = {
  matcher: ['/app/:path*', '/onboarding/:path*', '/login', '/signup', '/forgot'],
};
