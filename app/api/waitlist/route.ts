import { clientIp } from '@/lib/auth/limits';
import { originAllowed } from '@/lib/auth/origin';
import { siteUrl } from '@/lib/env';
import { waitlistDeps } from '@/lib/waitlist/deps';
import { joinWaitlist } from '@/lib/waitlist/service';

/**
 * POST /api/waitlist { email, zip, trade }: "Tell me when Holler reaches my area" from the check page.
 * JSON only (a cross-site HTML form cannot send it) and same-origin when the browser says where it came from.
 * The answer is { ok: true } or { ok: false, error }. It never says whether the address was already on the list.
 */
const HEADERS = { 'cache-control': 'no-store' };

function fail(error: string, status: number, extra: Record<string, string> = {}): Response {
  return Response.json({ ok: false, error }, { status, headers: { ...HEADERS, ...extra } });
}

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return fail('unsupported', 415);
  if (!originAllowed(req, siteUrl)) return fail('forbidden', 403);

  const body = (await req.json().catch(() => null)) as { email?: unknown; zip?: unknown; trade?: unknown } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid', 400);

  try {
    const result = await joinWaitlist(waitlistDeps(), { email: body.email, zip: body.zip, trade: body.trade, ip: clientIp(req) });
    switch (result.code) {
      case 'ok':
        return Response.json({ ok: true }, { headers: HEADERS });
      case 'invalid_email':
      case 'invalid_zip':
        return fail(result.code, 400);
      case 'limited':
        return fail('limited', 429, { 'retry-after': '3600' });
      default:
        return fail('unavailable', 503);
    }
  } catch {
    return fail('unavailable', 503);
  }
}
