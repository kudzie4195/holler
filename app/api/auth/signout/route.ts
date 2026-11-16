import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    // 'local': the default 'global' scope would also end this user's sessions in the other products on the shared project.
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Nothing to sign out of if Supabase is unconfigured.
  }
  const url = request.nextUrl.clone();
  url.pathname = '/';
  url.search = '';
  // 303 turns the POST into a GET on the home page.
  return NextResponse.redirect(url, 303);
}
