import type { CookieOptionsWithName } from '@supabase/ssr';

/**
 * Options for the Supabase session cookies (security pass r16 SEC-3). @supabase/ssr defaults to httpOnly: false and no Secure flag,
 * because its browser client reads the session from document.cookie. Holler never uses the browser client: every sign-in, read and
 * write goes through the server (route handlers, server actions, the proxy). So the session cookie is HttpOnly (script on the page,
 * including any future XSS, cannot read the tokens) and Secure in production (never sent over plain http). SameSite stays Lax, which
 * keeps cross-site POSTs from carrying the session.
 */
export function sessionCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV): CookieOptionsWithName {
  return { path: '/', sameSite: 'lax', httpOnly: true, secure: nodeEnv === 'production' };
}
