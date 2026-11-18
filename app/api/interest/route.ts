import { clientIp } from '@/lib/auth/limits';
import { originAllowed } from '@/lib/auth/origin';
import { getProfile, getUser } from '@/lib/auth/session';
import { siteUrl } from '@/lib/env';
import { pickedFromCookieString, pickedSetCookie } from '@/lib/interest/cookie';
import { interestDeps } from '@/lib/interest/deps';
import { recordInterest } from '@/lib/interest/service';

/**
 * POST /api/interest { feature, page }: someone pressed "I want this" on the "Coming next" list.
 * JSON only (a cross-site HTML form cannot send it) and same-origin when the browser says where it came from.
 * The answer is { ok: true } or { ok: false, error }. It never returns counts.
 * A signed-in member's pick (a user with a Holler profile) is saved with their user id. A signed-out pick is a row with user_id null, and the browser gets a
 * first-party cookie that lists only the feature ids it picked. Nothing else about the visitor is stored.
 */
const HEADERS = { 'cache-control': 'no-store' };

function fail(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status, headers: HEADERS });
}

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return fail('unsupported', 415);
  if (!originAllowed(req, siteUrl)) return fail('forbidden', 403);

  const body = (await req.json().catch(() => null)) as { feature?: unknown; page?: unknown } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid', 400);

  const cookiePicked = pickedFromCookieString(req.headers.get('cookie'));
  const secure = new URL(req.url).protocol === 'https:';

  try {
    const authed = await getUser();
    // Only a member with a Holler profile row is a member here. A shared sign-in with no profile cannot reach Settings > Delete
    // account, so its pick would stay forever: treat it as signed out (user_id null, cookie set). A lookup error is a soft failure.
    const user = authed && (await getProfile(authed.id)) ? authed : null;
    const result = await recordInterest(interestDeps(), {
      feature: body.feature,
      page: body.page,
      userId: user?.id ?? null,
      ip: clientIp(req),
      cookiePicked,
    });
    switch (result.code) {
      case 'ok':
        return Response.json({ ok: true }, { headers: { ...HEADERS, 'set-cookie': pickedSetCookie(result.picked ?? [], secure) } });
      case 'already':
        return Response.json({ ok: false, error: 'already' }, { status: 409, headers: HEADERS });
      case 'invalid':
        return fail('invalid', 400);
      case 'limited':
        return Response.json({ ok: false, error: 'limited' }, { status: 429, headers: { ...HEADERS, 'retry-after': '3600' } });
      default:
        return fail('unavailable', 503);
    }
  } catch {
    return fail('unavailable', 503);
  }
}
