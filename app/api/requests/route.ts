import { htmlPage } from '@/lib/email/html-page';
import { clientIp, RATE_LIMIT_MESSAGE } from '@/lib/auth/limits';
import { requestDeps } from '@/lib/requests/deps';
import { createRequest, type CreateResult } from '@/lib/requests/service';
import { REQUEST_FIELDS, type RawRequest } from '@/lib/requests/validate';

/**
 * POST /api/requests: a resident's new request.
 * Accepts JSON (the enhanced form) or a plain form post (no JavaScript). A plain form post is answered with a 303 to /request/sent,
 * or a short page listing what to fix. The answer is the same for a new and a repeated email address.
 */
const UNAVAILABLE = "We couldn't take your request just now. Try again in a few minutes.";
const INVALID = 'Check the highlighted fields and try again.';
/** REQUESTS_ENABLED=0, or the site-wide daily cap on confirmation emails is reached. */
const PAUSED = 'We are not taking new requests right now. Try again later.';

async function readBody(req: Request, isJson: boolean): Promise<RawRequest> {
  if (isJson) {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    const obj = body as Record<string, unknown>;
    return Object.fromEntries(REQUEST_FIELDS.map((f) => [f, obj[f]]));
  }
  const form = await req.formData().catch(() => null);
  return Object.fromEntries(
    REQUEST_FIELDS.map((f) => {
      const v = form?.get(f);
      return [f, typeof v === 'string' ? v : undefined];
    }),
  );
}

export async function POST(req: Request) {
  const isJson = (req.headers.get('content-type') ?? '').includes('application/json');
  const raw = await readBody(req, isJson);
  let result: CreateResult;
  try {
    result = await createRequest(requestDeps(), raw, clientIp(req));
  } catch {
    result = { status: 'unavailable' };
  }
  return isJson ? jsonAnswer(result) : formAnswer(result);
}

function jsonAnswer(result: CreateResult): Response {
  const headers = { 'cache-control': 'no-store' };
  switch (result.status) {
    case 'accepted':
      return Response.json({ ok: true }, { headers });
    case 'invalid':
      return Response.json({ ok: false, errors: result.errors, message: INVALID }, { status: 400, headers });
    case 'limited':
      return Response.json({ ok: false, message: RATE_LIMIT_MESSAGE }, { status: 429, headers: { ...headers, 'retry-after': '3600' } });
    case 'paused':
      return Response.json({ ok: false, paused: true, message: PAUSED }, { status: 503, headers: { ...headers, 'retry-after': '3600' } });
    default:
      return Response.json({ ok: false, message: UNAVAILABLE }, { status: 503, headers });
  }
}

function formAnswer(result: CreateResult): Response {
  const back = [{ href: '/request', label: 'Back to the form' }];
  switch (result.status) {
    case 'accepted':
      return new Response(null, { status: 303, headers: { location: '/request/sent', 'cache-control': 'no-store' } });
    case 'invalid':
      return htmlPage('Check your request', Object.values(result.errors).join(' '), { status: 400, links: back });
    case 'limited':
      return htmlPage('Too many tries', RATE_LIMIT_MESSAGE, { status: 429, links: back });
    case 'paused':
      return htmlPage('Requests are paused', PAUSED, { status: 503 });
    default:
      return htmlPage('Something went wrong', UNAVAILABLE, { status: 503, links: back });
  }
}
