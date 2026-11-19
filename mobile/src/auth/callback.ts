// Pure helpers for the OAuth return trip (holler://auth-callback?code=...). No network, no storage.

export const AUTH_SCHEME = 'holler';
export const AUTH_CALLBACK_URL = 'holler://auth-callback';

export interface AuthCallback {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
}

/** Is this URL our sign-in return trip? Matches holler://auth-callback with or without a path, query or fragment. */
export function isAuthCallbackUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  return /^holler:\/\/auth-callback(?:[/?#]|$)/i.test(url.trim());
}

/**
 * Read the PKCE result off the callback URL. Never throws. Supabase sends `?code=` on success, or
 * `error` / `error_code` with `error_description` when the person backed out or the provider refused.
 * Some providers put the values in the fragment, so both are read. An error wins over a code.
 */
export function parseAuthCallback(url: unknown): AuthCallback {
  const empty: AuthCallback = { code: null, error: null, errorDescription: null };
  if (!isAuthCallbackUrl(url)) return empty;
  const raw = String(url).trim();
  const q = raw.indexOf('?');
  const h = raw.indexOf('#');
  const query = q === -1 ? '' : raw.slice(q + 1, h > q ? h : undefined);
  const fragment = h === -1 ? '' : raw.slice(h + 1);
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
    const extra = new URLSearchParams(fragment);
    extra.forEach((v, k) => {
      if (!params.has(k)) params.set(k, v);
    });
  } catch {
    return empty;
  }
  const error = params.get('error') || params.get('error_code') || null;
  return {
    code: error ? null : params.get('code') || null,
    error,
    errorDescription: params.get('error_description') || null,
  };
}

/** Did the person just tap Cancel on a provider sheet? Then the app shows nothing, not an error. */
export function isUserCancelled(err: unknown): boolean {
  const e = err as { message?: unknown; code?: unknown } | null | undefined;
  const msg = String(e?.message ?? err ?? '').toLowerCase();
  const code = String(e?.code ?? '');
  return (
    code === '1001' ||
    code === 'SIGN_IN_CANCELED' ||
    msg.includes('1001') ||
    msg.includes('cancel') ||
    msg.includes('access_denied')
  );
}
