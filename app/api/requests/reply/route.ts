import { siteUrl } from '@/lib/env';
import { originAllowed } from '@/lib/auth/origin';
import { getUser } from '@/lib/auth/session';
import { requestDeps } from '@/lib/requests/deps';
import { REPLY_RESULTS, replyToRequest, type ReplierProfile, type ReplyCode } from '@/lib/requests/service';

/**
 * POST /api/requests/reply {matchId, message}: a business answers a resident's request.
 * JSON only (a cross-site HTML form cannot send it) and same-origin when the browser says where it came from.
 * Every rule (session, verified email, access, own match, open request, one reply per business, 5 per request, 10 a day) is checked
 * in lib/requests/service.ts replyToRequest; this route only gathers the session and profile.
 */
function answer(code: ReplyCode, error?: string): Response {
  const r = REPLY_RESULTS[code];
  return Response.json(
    { ok: code === 'sent', code, message: error ?? r.message },
    { status: r.status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ ok: false, code: 'invalid', message: 'Unsupported request.' }, { status: 415 });
  }
  if (!originAllowed(req, siteUrl)) return Response.json({ ok: false, code: 'invalid', message: 'Unsupported request.' }, { status: 403 });

  const user = await getUser();
  if (!user) return answer('unauthorized');
  const body = (await req.json().catch(() => null)) as { matchId?: unknown; message?: unknown } | null;
  if (!body || typeof body !== 'object') return answer('invalid');

  try {
    const deps = requestDeps();
    const { data: profile, error } = await deps.db
      .from('holler_profiles')
      .select('business_name, city, state, email_verified_at, subscription_status, trial_ends_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return answer('unavailable');
    const result = await replyToRequest(deps, {
      user: { id: user.id, email: user.email ?? null },
      profile: (profile as ReplierProfile | null) ?? null,
      matchId: body.matchId,
      message: body.message,
    });
    return answer(result.code, result.error);
  } catch {
    return answer('unavailable');
  }
}
