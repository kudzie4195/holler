/**
 * Holler shares auth.users with other products, so "has a Holler account" is explicit:
 * app_metadata.products contains 'holler' (set at signup), or a holler_profiles row exists (legacy accounts).
 */
export const PRODUCT = 'holler';

export function productsOf(appMetadata: unknown): string[] {
  const products = (appMetadata as { products?: unknown } | null | undefined)?.products;
  return Array.isArray(products) ? products.filter((p): p is string => typeof p === 'string') : [];
}

export function hasHollerTag(appMetadata: unknown): boolean {
  return productsOf(appMetadata).includes(PRODUCT);
}

export function withoutHoller(appMetadata: unknown): string[] {
  return productsOf(appMetadata).filter((p) => p !== PRODUCT);
}

export function withHoller(appMetadata: unknown): string[] {
  const p = productsOf(appMetadata);
  return p.includes(PRODUCT) ? p : [...p, PRODUCT];
}

/** Set when someone deletes their Holler account. The shared sign-in is never deleted, so they may come back. */
export function hasLeftHoller(appMetadata: unknown): boolean {
  const at = (appMetadata as { holler_left_at?: unknown } | null | undefined)?.holler_left_at;
  return typeof at === 'string' && at.length > 0;
}

/** app_metadata patch applied when a user deletes their Holler account. Keeps every other product's tags. */
export function leaveHollerPatch(appMetadata: unknown, now: Date): Record<string, unknown> {
  return { products: withoutHoller(appMetadata), holler_email_verified_at: null, holler_left_at: now.toISOString() };
}

/** app_metadata patch applied when a former member logs in again. */
export function rejoinHollerPatch(appMetadata: unknown): Record<string, unknown> {
  return { products: withHoller(appMetadata), holler_left_at: null };
}
