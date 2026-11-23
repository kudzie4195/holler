import { clientIp } from '@/lib/auth/limits';
import { originAllowed } from '@/lib/auth/origin';
import { siteUrl } from '@/lib/env';
import { WAITLIST_HONEYPOT } from '@/lib/waitlist/copy';
import { waitlistDeps } from '@/lib/waitlist/deps';
import { joinWaitlist } from '@/lib/waitlist/service';

/**
 * POST /api/waitlist { email, zip, trade, page, leave_blank }: someone left an email on /check for a ZIP Holler does not serve yet.
 * JSON only (a cross-site HTML form cannot send it) and same-origin when the browser says where it came from.
 * The answer is { ok: true } or { ok: false, error, field? }. It never says whether an address was already on the list, and never
 * returns counts. No account is needed. If the database or the table (migration 0021) is not there yet, the answer is a 503 with
 * error 'unavailable' that the card turns into a friendly message; nothing here throws a 500 page. Logs hold a status code only.
 */
const HEADERS = { 'cache-control': 'no-store' };

function fail(error: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, error, ...extra }, { status, headers: HEADERS });
}

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return fail('unsupported', 415);
  if (!originAllowed(req, siteUrl)) return fail('forbidden', 403);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid', 400);

  try {
    const result = await joinWaitlist(waitlistDeps, {
      email: body.email,
      zip: body.zip,
      trade: body.trade,
      page: body.page,
      [WAITLIST_HONEYPOT]: body[WAITLIST_HONEYPOT],
      ip: clientIp(req),
    });
    switch (result.code) {
      case 'ok':
        return Response.json({ ok: true }, { headers: HEADERS });
      case 'invalid':
        return fail('invalid', 400, result.field ? { field: result.field } : {});
      case 'limited':
        return Response.json({ ok: false, error: 'limited' }, { status: 429, headers: { ...HEADERS, 'retry-after': '3600' } });
      default:
        return fail('unavailable', 503);
    }
  } catch (e) {
    // Supabase not configured, or anything unexpected. The error's name only: its message could carry request data.
    console.error('[waitlist] route failed', e instanceof Error ? e.name : 'unknown');
    return fail('unavailable', 503);
  }
}
