/**
 * Store product ids and RevenueCat vocabulary. Pure: no server imports.
 * The database function holler_apply_store_event (migration 0020) applies the same product rule; this copy lets the webhook log and
 * test the mapping without a database. tests/mobile/storebilling.test.ts keeps the two in step with the fixed product list.
 */
import type { Tier } from '@/lib/plan/limits';

/** Every store product id starts with the app id. */
export const STORE_PRODUCT_PREFIX = 'com.localholler.app.';

/** Removes Google Play's ':<basePlanId>' suffix and surrounding space. Empty input gives null. */
export function normalizeProductId(productId: unknown): string | null {
  if (typeof productId !== 'string') return null;
  const id = productId.split(':')[0]?.trim() ?? '';
  return id === '' ? null : id;
}

/**
 * The plan a store product grants: '.pro.' -> 'pro', '.solo.' -> 'starter' (the internal id of Solo). Only our own products count
 * (com.localholler.app.*); anything else is null, never guessed.
 */
export function planForStoreProduct(productId: unknown): Tier | null {
  const id = normalizeProductId(productId)?.toLowerCase();
  if (!id || !id.startsWith(STORE_PRODUCT_PREFIX)) return null;
  if (id.includes('.pro.')) return 'pro';
  if (id.includes('.solo.')) return 'starter';
  return null;
}

export type Store = 'apple' | 'google';

/** RevenueCat `store` to our plan_source. Only the App Store and Google Play are sold through; anything else is null (ignored). */
export function storeFromRevenueCat(store: unknown): Store | null {
  switch (String(store ?? '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'apple';
    case 'PLAY_STORE':
      return 'google';
    default:
      return null;
  }
}

export function envFromRevenueCat(environment: unknown): 'sandbox' | 'production' | null {
  const e = String(environment ?? '').toUpperCase();
  if (e === 'SANDBOX') return 'sandbox';
  if (e === 'PRODUCTION') return 'production';
  return null;
}

/** Plain 8-4-4-4-12 hex UUID. RevenueCat anonymous ids ($RCAnonymousID:...) and anything else fail. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
