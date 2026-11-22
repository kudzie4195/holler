import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { LANG_COOKIE, clearLangCookie } from '@/lib/auth/lang-cookie';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    // 'local': the default 'global' scope would also end this user's sessions in the other products on the shared project.
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Nothing to sign out of if Supabase is unconfigured.
  }
  const url = request.nextUrl.clone();
  // A Spanish member lands on the Spanish home (round 18 ES); the hint cookie is then cleared.
  url.pathname = request.cookies.get(LANG_COOKIE)?.value === 'es' ? '/es' : '/';
  url.search = '';
  // 303 turns the POST into a GET on the home page.
  const res = NextResponse.redirect(url, 303);
  clearLangCookie(res);
  return res;
}
