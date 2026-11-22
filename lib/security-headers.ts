/**
 * Security headers for every response (next.config.ts headers()). Security pass r16 SEC-1.
 * - No page may be framed by another site (clickjacking: Settings has "Delete account", the billing buttons, the reply box):
 *   X-Frame-Options DENY for old browsers and CSP frame-ancestors 'none' for current ones.
 * - The CSP sets only directives that need no per-request nonce, so prerendered and cached pages keep working: no framing, no
 *   <base> hijack, no plugins, and forms may only post to this site (every form here does).
 * - nosniff, a referrer policy that never sends a full URL (with tokens in the query) to another site, and no powerful features.
 */
export const CONTENT_SECURITY_POLICY = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join('; ');

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];
