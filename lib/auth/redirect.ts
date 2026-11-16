const BASE = 'https://x.invalid';
// ASCII control characters, DEL, any whitespace (including unicode spaces and line separators), backslash.
// The WHATWG URL parser silently strips tab/CR/LF and treats "\\" as "/", so any of these can turn
// "/\t/evil.com" into "//evil.com" after parsing.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\s\\]/;

function hasForbidden(value: string): boolean {
  return FORBIDDEN.test(value);
}

/**
 * Only allow same-site relative paths, to prevent open redirects via ?next=.
 * Rejects control characters, whitespace and backslashes (raw or percent-encoded), protocol-relative
 * paths, and anything that does not resolve to the same origin once parsed like a browser would.
 */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (hasForbidden(next)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  // Encoded control characters or backslashes (%09, %0a, %5c) are never legitimate in our paths.
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(decoded) || decoded.startsWith('//')) return fallback;
  try {
    if (new URL(next, BASE).origin !== BASE) return fallback;
  } catch {
    return fallback;
  }
  return next;
}

/** City slugs look like "atlanta-ga". Anything else is ignored. */
export function cleanCitySlug(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/.test(value) && value.length <= 60 ? value : null;
}
