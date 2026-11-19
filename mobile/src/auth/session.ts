// How the app reads and refreshes the Supabase session for API calls.
//
// Offline is not signed out. supabase-js answers getSession() with { session: null, error } when an
// expired access token cannot be refreshed because the network is down (AuthRetryableFetchError),
// and it keeps the stored session in that case. Only a definite auth failure means signed out:
//   * nothing is stored (getSession gives no session and no error), or
//   * Supabase Auth itself rejected the refresh token (400 or 401 with an auth error code such as
//     invalid_grant or refresh_token_not_found, 403 with a JSON auth error, or AuthSessionMissingError).
// A 429, any 5xx, an HTML page, a transport error, a timeout or anything unknown is "offline": the
// caller gets ApiCallError('network'). supabase-js deletes the stored session on some of those; the
// storage guard (auth/guard.ts) puts it back, using this same rule.
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { ApiCallError, NETWORK_MESSAGE } from '../api/client';
import { withTimeout } from '../lib/timeout';
import { isRefreshRejectionError } from './guard';

/** The two supabase-js auth calls this module needs. */
export interface SessionAuth {
  getSession(): Promise<{ data: { session: Session | null }; error: unknown }>;
  refreshSession(): Promise<{ data: { session: Session | null }; error: unknown }>;
}

/** getSession can block for about 25 s while supabase-js retries an offline refresh. */
export const SESSION_TIMEOUT_MS = 12000;

/** True only when Supabase Auth has said the session is gone. Never true for 429, 5xx, HTML pages or the network. */
export function isDefiniteAuthError(err: unknown): boolean {
  if (!err) return false;
  if (isAuthRetryableFetchError(err)) return false;
  return isRefreshRejectionError(err);
}

export type SessionRead = { kind: 'session'; session: Session } | { kind: 'none' } | { kind: 'offline' };

/** The stored session, "none" only when signed out for certain, or "offline" when it cannot be told. */
export async function readSession(auth: SessionAuth, timeoutMs = SESSION_TIMEOUT_MS): Promise<SessionRead> {
  try {
    const { data, error } = await withTimeout(auth.getSession(), timeoutMs, 'getSession');
    if (data?.session) return { kind: 'session', session: data.session };
    if (!error || isDefiniteAuthError(error)) return { kind: 'none' };
    return { kind: 'offline' };
  } catch {
    return { kind: 'offline' };
  }
}

function offline(): ApiCallError {
  return new ApiCallError('network', NETWORK_MESSAGE, 0);
}

/** For the API client: the access token, null when signed out for certain. Throws ApiCallError('network') when offline. */
export async function accessToken(auth: SessionAuth, timeoutMs = SESSION_TIMEOUT_MS): Promise<string | null> {
  const r = await readSession(auth, timeoutMs);
  if (r.kind === 'session') return r.session.access_token;
  if (r.kind === 'none') return null;
  throw offline();
}

/** For the API client after a 401: a fresh token, null when Supabase rejected the refresh token. Throws when offline. */
export async function refreshedToken(auth: SessionAuth, timeoutMs = SESSION_TIMEOUT_MS): Promise<string | null> {
  let res: Awaited<ReturnType<SessionAuth['refreshSession']>>;
  try {
    res = await withTimeout(auth.refreshSession(), timeoutMs, 'refreshSession');
  } catch {
    throw offline();
  }
  if (res.data?.session?.access_token && !res.error) return res.data.session.access_token;
  if (isDefiniteAuthError(res.error)) return null;
  throw offline();
}
