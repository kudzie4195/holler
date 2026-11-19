/**
 * RevenueCat webhook vocabulary (api_version 1.0) turned into calls to holler_apply_store_event (migration 0020). Pure except for
 * node:crypto. The route (app/api/revenuecat/webhook/route.ts) authenticates, parses and calls the database; everything that decides
 * what an event means is here so it can be tested without a server.
 *
 * Payload fields used: event.id, .type, .app_user_id, .product_id, .new_product_id, .store, .environment, .expiration_at_ms,
 * .grace_period_expiration_at_ms, .cancel_reason, .event_timestamp_ms, .transferred_from, .transferred_to.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { envFromRevenueCat, isUuid, normalizeProductId, planForStoreProduct, storeFromRevenueCat, type Store } from './products';

/**
 * Constant-time compare of the Authorization header with the configured secret. Both sides are hashed first, so neither the content
 * nor the length of the supplied value shows in the timing. An empty secret never matches.
 */
export function secretMatches(supplied: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(String(supplied ?? ''), 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** One call to holler_apply_store_event. */
export interface StoreCall {
  eventId: string;
  userId: string;
  /** RevenueCat type, TRANSFER_FROM / TRANSFER_TO for the two halves of a TRANSFER, or REFUND for a refunded purchase. */
  type: string;
  store: Store;
  env: 'sandbox' | 'production' | null;
  productId: string | null;
  expiresAt: string | null;
  eventTs: string;
  /** TRANSFER_TO only: the old owners (transferred_from UUIDs). The database revokes them and moves a live plan in one transaction. */
  fromUserIds?: string[];
}

export type Ignored = 'bad_json' | 'no_event' | 'test' | 'no_event_id' | 'not_a_user' | 'unsupported_store' | 'not_our_product';

export interface EventPlan {
  calls: StoreCall[];
  ignored?: Ignored;
}

/** Milliseconds since the epoch to an ISO string, or null. */
export function msToIso(ms: unknown): string | null {
  const n = typeof ms === 'number' ? ms : typeof ms === 'string' && ms.trim() !== '' ? Number(ms) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

type RcEvent = Record<string, unknown>;

/** PRODUCT_CHANGE names the new product in new_product_id. */
export function productIdOf(event: RcEvent): string | null {
  return normalizeProductId(event.new_product_id) ?? normalizeProductId(event.product_id);
}

/** SHA-256 (hex) of a user id. TRANSFER ledger ids carry this, never the id, so a deleted member's id does not stay in the ledger. */
export function userIdHash(userId: string): string {
  return createHash('sha256').update(userId.toLowerCase(), 'utf8').digest('hex');
}

/**
 * The type sent to the database. RevenueCat reports a refund as CANCELLATION with cancel_reason CUSTOMER_SUPPORT: that becomes
 * REFUND, which ends access at once (review r2 F4). An ordinary CANCELLATION is a promise not to renew and keeps access to the expiry.
 */
export function storeEventType(event: RcEvent): string {
  const type = String(event.type ?? '').trim().toUpperCase();
  if (type === 'CANCELLATION' && String(event.cancel_reason ?? '').trim().toUpperCase() === 'CUSTOMER_SUPPORT') return 'REFUND';
  return type;
}

/** The expiry sent to the database. BILLING_ISSUE: the later of the expiry and the store's billing grace date (review r2 F9). */
export function expiryOf(event: RcEvent, type: string): string | null {
  const exp = msToIso(event.expiration_at_ms);
  if (type !== 'BILLING_ISSUE') return exp;
  const grace = msToIso(event.grace_period_expiration_at_ms);
  if (!exp) return grace;
  if (!grace) return exp;
  return Date.parse(grace) > Date.parse(exp) ? grace : exp;
}

/**
 * What to do with one webhook body. TEST is ignored. A store other than the App Store or Google Play is ignored (Holler sells only
 * there). A TRANSFER becomes one call per moved id, TRANSFER_TO calls first: TRANSFER_TO for each id in transferred_to (carrying the
 * transferred_from ids), then TRANSFER_FROM for each id in transferred_from, with the event id suffixed (":to:<sha256 of id>" /
 * ":from:<sha256 of id>") so each member gets one ledger row and no raw user id stays in an event id after the account is deleted.
 * TRANSFER carries no product and no expiry. The database (review v2 P1), in the TRANSFER_TO call's one transaction, revokes each old
 * owner and, when an old owner's row holds a plan from this store that is live right now, gives the new owner that plan, product, env
 * and expiry; a lapsed plan moves nothing. It ledgers the old owners under the ":from:" ids, so the TRANSFER_FROM calls that follow
 * are duplicates (they still revoke the old owner when there is no UUID new owner or the new owner has no profile yet).
 * Every other type is one call for app_user_id, which must be a Supabase user id (UUID): RevenueCat anonymous ids are ignored.
 * The database decides what the type does (grant, revoke, record only), the plan, and every guard.
 */
export function planEvent(body: unknown, now: Date = new Date()): EventPlan {
  const event = (body as { event?: unknown } | null)?.event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { calls: [], ignored: 'no_event' };
  const e = event as RcEvent;
  const type = storeEventType(e);
  if (type === 'TEST') return { calls: [], ignored: 'test' };
  const store = storeFromRevenueCat(e.store);
  if (!store) return { calls: [], ignored: 'unsupported_store' };
  const eventId = String(e.id ?? '').trim().slice(0, 200);
  if (!eventId) return { calls: [], ignored: 'no_event_id' };
  // A product that is not one of ours (another app in the same RevenueCat or store account) never reaches the ledger. Events with no
  // product at all (TRANSFER and SUBSCRIBER_ALIAS events) go on; the database records them.
  const pid = productIdOf(e);
  if (pid && !planForStoreProduct(pid)) return { calls: [], ignored: 'not_our_product' };

  const base = {
    store,
    env: envFromRevenueCat(e.environment),
    productId: productIdOf(e),
    expiresAt: expiryOf(e, type),
    eventTs: msToIso(e.event_timestamp_ms) ?? now.toISOString(),
  };

  if (type === 'TRANSFER') {
    const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter(isUuid).map((s) => s.toLowerCase()))];
    const from = list(e.transferred_from);
    const calls: StoreCall[] = [
      ...list(e.transferred_to).map((u) => ({ ...base, eventId: `${eventId}:to:${userIdHash(u)}`, userId: u, type: 'TRANSFER_TO', fromUserIds: from })),
      ...from.map((u) => ({ ...base, eventId: `${eventId}:from:${userIdHash(u)}`, userId: u, type: 'TRANSFER_FROM' })),
    ];
    return calls.length ? { calls } : { calls: [], ignored: 'not_a_user' };
  }

  if (!isUuid(e.app_user_id)) return { calls: [], ignored: 'not_a_user' };
  return { calls: [{ ...base, eventId, userId: e.app_user_id.toLowerCase(), type: type.slice(0, 40) || 'UNKNOWN' }] };
}

/**
 * Sandbox grants (TestFlight, Play license testers, App Review) give a plan only when REVENUECAT_ALLOW_SANDBOX is exactly '1'. Off,
 * the database ledgers a sandbox grant as 'sandbox' and gives no plan. A sandbox event never ends or changes a production plan either
 * way.
 */
export function sandboxGrantsAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return (env.REVENUECAT_ALLOW_SANDBOX ?? '').trim() === '1';
}

/** Event fields kept in the ledger's `raw`: no subscriber attributes, aliases, emails, country, or transaction ids. */
const RAW_EVENT_KEYS = [
  'id',
  'type',
  'store',
  'environment',
  'product_id',
  'new_product_id',
  'period_type',
  'entitlement_ids',
  'purchased_at_ms',
  'expiration_at_ms',
  'grace_period_expiration_at_ms',
  'event_timestamp_ms',
  'cancel_reason',
  'expiration_reason',
  'is_trial_conversion',
  'currency',
  'price',
] as const;

export function trimRaw(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as { api_version?: unknown; event?: Record<string, unknown> };
  const ev: Record<string, unknown> = {};
  const src = b.event && typeof b.event === 'object' ? b.event : {};
  for (const k of RAW_EVENT_KEYS) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') ev[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') ev[k] = v;
    else if (Array.isArray(v)) ev[k] = v.filter((x) => typeof x === 'string').slice(0, 10).map((x) => (x as string).slice(0, 60));
  }
  return { api_version: typeof b.api_version === 'string' ? b.api_version.slice(0, 20) : null, event: ev };
}

/** Same rule as the database, exposed for logs and tests. */
export { planForStoreProduct };
