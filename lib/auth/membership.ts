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

/** True only when Holler is the sole product, i.e. nothing else depends on this auth user. */
export function isHollerOnly(appMetadata: unknown): boolean {
  const p = productsOf(appMetadata);
  const raw = (appMetadata as { products?: unknown } | null | undefined)?.products;
  return Array.isArray(raw) && raw.length === 1 && p.length === 1 && p[0] === PRODUCT;
}

export function withoutHoller(appMetadata: unknown): string[] {
  return productsOf(appMetadata).filter((p) => p !== PRODUCT);
}
