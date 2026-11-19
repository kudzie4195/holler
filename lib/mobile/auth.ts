import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Profile } from '@/lib/auth/session';
import { clientIp } from '@/lib/auth/limits';
import { adminOrNull } from './admin';
import { authClient, memberClient } from './clients';
import { fail } from './http';
import { MOBILE_LIMITS, safeHit, type MemberLimitKind } from './limits';

/** A JWT is three base64url parts. Anything else is refused before a network call. */
const JWT_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  if (!m) return null;
  const t = m[1];
  return t.length <= 4096 && JWT_SHAPE.test(t) ? t : null;
}

export type VerifyResult =
  | { ok: true; user: User; token: string }
  | { ok: false; error: 'unauthorized' | 'not_configured' | 'unavailable' };

/**
 * What an Auth server error means for the token. Only 400, 401, 403 and 404 say the token is bad (malformed, expired, revoked, from
 * another project, or its user is gone): the app refreshes, then signs out. Anything else (no answer, a timeout, 429 rate limited,
 * any 5xx, an unknown status) says nothing about the token: 503 `unavailable`, and the app keeps the session and retries.
 */
export function authErrorKind(status: number | undefined): 'unauthorized' | 'unavailable' {
  return status === 400 || status === 401 || status === 403 || status === 404 ? 'unauthorized' : 'unavailable';
}

/**
 * Who sent this request. The token is checked by the Supabase Auth server (GET /auth/v1/user), never by decoding it here, so an
 * expired, revoked, tampered or other-project token is refused by the only party that can tell. An Auth outage or a throttled Auth
 * server is 503 `unavailable` (the app keeps the session and retries), never "signed out".
 */
export async function verifyRequest(req: Request): Promise<VerifyResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, error: 'unauthorized' };
  let client: SupabaseClient;
  try {
    client = authClient();
  } catch {
    return { ok: false, error: 'not_configured' };
  }
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error) return { ok: false, error: authErrorKind((error as { status?: number }).status) };
    if (!data?.user?.id) return { ok: false, error: 'unauthorized' };
    return { ok: true, user: data.user, token };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

export interface MemberContext {
  user: User;
  token: string;
  /** The member's own RLS client. */
  db: SupabaseClient;
  /** Null when the member has not onboarded yet. */
  profile: Profile | null;
}

/**
 * Rate limits, verifies the token and loads the member's own profile (with their own client, so RLS applies).
 * Returns a ready Response on failure. `needProfile` (default true): no profile is 409 needs_onboarding.
 * `limit` (default 'read'): the per-member limit of this route (lib/mobile/limits.ts), counted only for a verified member.
 * Per network address only failed tokens are counted (missing, malformed, or refused by the Auth server: review v2 P2, commander
 * decision 8): past 60 in 5 minutes such a request is 429 instead of 401. A valid token is never counted or refused per address, so
 * one client sending junk cannot lock out members behind the same address. An Auth outage ('unavailable') is not a failed token.
 * Both limits fail open (a limiter that cannot run lets the request through, as web login does); only 'limited' is 429.
 * Trade-off: a junk token still costs one Auth call before it is counted (only the Auth server can tell a valid token).
 */
export async function requireMember(
  req: Request,
  methods: string,
  opts: { needProfile?: boolean; limit?: MemberLimitKind } = {},
): Promise<{ ok: true; ctx: MemberContext } | { ok: false; response: Response }> {
  const v = await verifyRequest(req);
  if (!v.ok) {
    if (v.error === 'unauthorized') {
      const admin = adminOrNull();
      if (admin && (await safeHit([MOBILE_LIMITS.badToken(clientIp(req))], admin)) === 'limited') {
        return { ok: false, response: fail(req, methods, 'rate_limited') };
      }
    }
    return { ok: false, response: fail(req, methods, v.error) };
  }
  const admin = adminOrNull();
  if (admin && (await safeHit([MOBILE_LIMITS[opts.limit ?? 'read'](v.user.id)], admin)) === 'limited') {
    return { ok: false, response: fail(req, methods, 'rate_limited') };
  }
  let db: SupabaseClient;
  try {
    db = memberClient(v.token);
  } catch {
    return { ok: false, response: fail(req, methods, 'not_configured') };
  }
  const { data, error } = await db.from('holler_profiles').select('*').eq('user_id', v.user.id).maybeSingle();
  if (error) return { ok: false, response: fail(req, methods, 'server_error') };
  const profile = (data as Profile | null) ?? null;
  if (!profile && opts.needProfile !== false) return { ok: false, response: fail(req, methods, 'needs_onboarding') };
  return { ok: true, ctx: { user: v.user, token: v.token, db, profile } };
}
