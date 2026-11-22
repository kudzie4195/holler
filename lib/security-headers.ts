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

/**
 * Pages whose URL carries a single-use or signed token (?t=, ?token=, ?token_hash=). They get Referrer-Policy: no-referrer, so not
 * even a same-origin click sends the token URL on as a Referer (review P2-2). lib/email/html-page.ts sets the same header itself, but
 * a next.config.ts header with the same key replaces it, so the override lives here and comes AFTER the global rule: for two
 * matching entries with the same key, the last one wins (node_modules/next/dist/docs/01-app/03-api-reference/05-config/
 * 01-next-config-js/headers.md, "Header Overriding Behavior").
 */
export const TOKEN_PAGE_PATHS = [
  '/api/auth/verify',
  '/api/feedback/outcome',
  '/api/cron/notify/unsubscribe',
  '/api/cron/lifecycle/unsubscribe',
  '/request/confirm',
  '/request/close',
  '/auth/confirm',
  '/auth/confirm/continue',
  // The Spanish twin of /auth/confirm/continue (round 18 ES): same token in the URL, same rule.
  '/es/confirm',
] as const;

export const NO_REFERRER = [{ key: 'Referrer-Policy', value: 'no-referrer' }];

/** The full headers() list: the global rule first, then the token pages (last match wins). */
export function securityHeaderRules(): { source: string; headers: { key: string; value: string }[] }[] {
  return [{ source: '/:path*', headers: SECURITY_HEADERS }, ...TOKEN_PAGE_PATHS.map((source) => ({ source, headers: NO_REFERRER }))];
}
