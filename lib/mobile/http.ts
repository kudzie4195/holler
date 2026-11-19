/**
 * Response helpers for the mobile API (app/api/m/**): JSON bodies in the shape lib/mobile/types.ts describes, no-store caching, and
 * CORS for the Capacitor origins only. No server-only imports, so tests can load it directly.
 */
import { MOBILE_CORS_ORIGINS, type ApiError, type ApiErrorCode, type ProfileField } from './types';

const ALLOWED = new Set<string>(MOBILE_CORS_ORIGINS);

/** CORS headers for this request: the origin is echoed only when it is one of the app's webview origins. */
export function corsHeaders(req: Request, methods: string): Record<string, string> {
  const origin = req.headers.get('origin');
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && ALLOWED.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = methods;
    h['Access-Control-Allow-Headers'] = 'authorization, content-type';
    h['Access-Control-Max-Age'] = '600';
    h['Access-Control-Expose-Headers'] = 'Retry-After';
  }
  return h;
}

/** The OPTIONS (preflight) answer for a route: 204 with CORS headers for an allowed origin, 204 without them otherwise. */
export function preflight(req: Request, methods: string): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req, `${methods}, OPTIONS`) });
}

export function ok<T extends object>(req: Request, methods: string, body: T, init: { status?: number; cache?: string } = {}): Response {
  return Response.json(
    { ok: true, ...body },
    { status: init.status ?? 200, headers: { 'Cache-Control': init.cache ?? 'no-store', ...corsHeaders(req, `${methods}, OPTIONS`) } },
  );
}

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  not_member: 403,
  needs_onboarding: 409,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  confirm_required: 400,
  unsupported: 415,
  rate_limited: 429,
  billing_cancel_failed: 409,
  not_configured: 503,
  unavailable: 503,
  server_error: 500,
};

/** Seconds the app should wait before retrying, sent as Retry-After. */
const RETRY_AFTER: Partial<Record<ApiErrorCode, number>> = { unavailable: 10, rate_limited: 60 };

export const MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: 'Sign in again to keep going.',
  not_member: 'This account is not set up for Holler yet.',
  needs_onboarding: 'Finish setting up your account first.',
  forbidden: 'You cannot do that.',
  not_found: 'We could not find that alert.',
  invalid: 'That request was not valid.',
  confirm_required: 'Type DELETE to confirm.',
  unsupported: 'Unsupported request.',
  rate_limited: 'Too many tries. Wait a bit, then try again.',
  billing_cancel_failed: "We couldn't cancel your web subscription, so we haven't deleted anything. Try again in a moment.",
  not_configured: 'This is not switched on yet. Try again later.',
  unavailable: 'We could not check your sign-in just now. Try again in a moment.',
  server_error: 'Something went wrong on our side. Try again in a moment.',
};

export function fail(
  req: Request,
  methods: string,
  error: ApiErrorCode,
  message: string = MESSAGES[error],
  fieldErrors?: Partial<Record<ProfileField, string>>,
): Response {
  const body: ApiError = { ok: false, error, message };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) body.fieldErrors = fieldErrors;
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', ...corsHeaders(req, `${methods}, OPTIONS`) };
  const retry = RETRY_AFTER[error];
  if (retry) headers['Retry-After'] = String(retry);
  return Response.json(body, { status: STATUS[error], headers });
}

/** Reads a JSON object body. Requires application/json. */
export async function readBody(req: Request): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: 'unsupported' | 'invalid' }> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return { ok: false, error: 'unsupported' };
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 20_000) return { ok: false, error: 'invalid' };
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid' };
  return { ok: true, data: raw as Record<string, unknown> };
}
