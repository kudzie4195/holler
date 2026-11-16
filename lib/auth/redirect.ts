/** Only allow same-site relative paths, to prevent open redirects via ?next=. */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (next.includes('\n') || next.includes('\r')) return fallback;
  return next;
}

/** City slugs look like "atlanta-ga". Anything else is ignored. */
export function cleanCitySlug(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/.test(value) && value.length <= 60 ? value : null;
}
