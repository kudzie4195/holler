// The only file that talks to RevenueCat (@revenuecat/purchases-capacitor 14.x, Capacitor 8).
//
// Rules carried over from the owner's shipped app, each one a bug that once froze a real phone:
//   * The plugin is imported lazily, only on a phone, only once a key exists.
//   * A Capacitor plugin is a Proxy that answers every property, `then` included, so it is a
//     thenable. Returning it from an async function hangs the promise forever with no error.
//     readyPlugin() therefore returns a BOX ({ Purchases }) and callers destructure it.
//   * Background reads (configure, offerings, customer info, eligibility, the import itself) get a
//     10 s deadline. purchasePackage does NOT: the store sheet is modal and a person may take
//     minutes; they can always close it. restorePurchases gets a long (60 s) deadline so a store that
//     never answers cannot hang Settings or the paywall.
//   * Identity: before the paywall loads, a purchase or a restore, RevenueCat's own app user id must
//     equal the signed-in Supabase user id. A failed logIn leaves the wrapper with NO user, so a
//     purchase can never be made under the previous member's id.
//   * A pending purchase (Ask to Buy, a slow Play payment) is reported as pending, never as "not charged".
//   * getOfferings() resolves { all, current } itself, not { offerings }.
//   * A cancelled purchase rejects with code "1" (PURCHASE_CANCELLED_ERROR is a string of digits).
//   * Google Play product ids arrive as productId:basePlanId.
//   * An App Store trial is promised only when RevenueCat says this Apple ID is ELIGIBLE (2).
//     Play only lists offers the customer is eligible for, so a Play free phase is already checked.
//
// appUserID is the Supabase user id. Configure once per launch; a different member signing in on
// the same phone goes through logIn(), and sign-out goes through logOut().
import { config } from '../lib/env';
import { platform as currentPlatform } from '../lib/platform';
import { withTimeout } from '../lib/timeout';
import type { EntitlementId } from '../contract';
import { OFFERING_ID } from '../contract';
import { activeEntitlement, productIdToEntitlement, type Period } from './plan';

const READ_TIMEOUT_MS = 10000;
const RESTORE_TIMEOUT_MS = 60000;
const INTRO_ELIGIBLE = 2;

type PluginModule = { Purchases: any; LOG_LEVEL?: Record<string, string>; PURCHASES_ERROR_CODE?: Record<string, string> };

interface Harness {
  mod: PluginModule | null;
  apiKey: string;
  platform: 'ios' | 'android';
  readTimeoutMs?: number;
  restoreTimeoutMs?: number;
}

let harness: Harness | null = null;
let pluginPromise: Promise<PluginModule | null> | null = null;
let sdkConfigured = false;
let currentUserId: string | null = null;
let packageCache = new Map<string, unknown>();

/** Tests only: install a fake plugin module and pretend to be a phone. Pass null to reset. */
export function _setPluginForTests(mod: PluginModule | null, opts: Partial<Omit<Harness, 'mod'>> = {}): void {
  harness = mod
    ? { mod, apiKey: opts.apiKey ?? 'appl_test', platform: opts.platform ?? 'ios', readTimeoutMs: opts.readTimeoutMs, restoreTimeoutMs: opts.restoreTimeoutMs }
    : null;
  pluginPromise = null;
  sdkConfigured = false;
  currentUserId = null;
  packageCache = new Map();
}

function readTimeout(): number {
  return harness?.readTimeoutMs ?? READ_TIMEOUT_MS;
}

function storePlatform(): 'ios' | 'android' | null {
  if (harness) return harness.platform;
  const p = currentPlatform();
  return p === 'web' ? null : p;
}

export function apiKeyForPlatform(): string {
  if (harness) return harness.apiKey;
  const p = storePlatform();
  if (p === 'ios') return config.revenueCatIosKey;
  if (p === 'android') return config.revenueCatAndroidKey;
  return '';
}

/** Can this build sell anything at all? False on the web and in a build with no RevenueCat key. */
export function storeAvailable(): boolean {
  return storePlatform() !== null && apiKeyForPlatform() !== '';
}

function loadPlugin(): Promise<PluginModule | null> {
  if (harness) return Promise.resolve(harness.mod);
  if (!pluginPromise) {
    pluginPromise = withTimeout(import('@revenuecat/purchases-capacitor') as Promise<PluginModule>, readTimeout(), 'load RevenueCat').catch(
      (err) => {
        console.error('[purchases] plugin failed to load', err);
        pluginPromise = null;
        return null;
      },
    );
  }
  return pluginPromise;
}

const NO_PLUGIN = Object.freeze({ Purchases: null as any });

/**
 * The configured plugin in a box. Never returns the plugin itself (see the header). With an expected
 * user id, a wrapper pointed at anyone else answers NO_PLUGIN.
 */
async function readyPlugin(expectedUserId?: string | null): Promise<{ Purchases: any }> {
  if (!storeAvailable() || !sdkConfigured || !currentUserId) return NO_PLUGIN;
  if (expectedUserId !== undefined && expectedUserId !== currentUserId) return NO_PLUGIN;
  const mod = await loadPlugin();
  return { Purchases: mod?.Purchases ?? null };
}

/** Point the SDK at this member. Idempotent; false on the web or when the key is missing. */
export async function configurePurchases(userId: string): Promise<boolean> {
  if (!userId || !storeAvailable()) return false;
  if (sdkConfigured && currentUserId === userId) return true;
  const mod = await loadPlugin();
  if (!mod?.Purchases) return false;
  // Forget the previous member BEFORE switching: if logIn fails, nothing is sold under their id.
  currentUserId = null;
  packageCache = new Map();
  try {
    if (!sdkConfigured) {
      if (mod.LOG_LEVEL) {
        const dev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
        await withTimeout(mod.Purchases.setLogLevel({ level: dev ? mod.LOG_LEVEL.DEBUG : mod.LOG_LEVEL.ERROR }), readTimeout(), 'setLogLevel');
      }
      await withTimeout(mod.Purchases.configure({ apiKey: apiKeyForPlatform(), appUserID: userId }), readTimeout(), 'configure');
      sdkConfigured = true;
    } else {
      await withTimeout(mod.Purchases.logIn({ appUserID: userId }), readTimeout(), 'logIn');
    }
    currentUserId = userId;
    packageCache = new Map();
    return true;
  } catch (err) {
    console.error('[purchases] configure failed', err);
    return false;
  }
}

/** Sign-out: forget the member in RevenueCat too. Never throws. */
export async function logOutPurchases(): Promise<void> {
  currentUserId = null;
  packageCache = new Map();
  // Even with no member recorded (a failed logIn), RevenueCat may still hold the previous id.
  if (!sdkConfigured) return;
  const mod = await loadPlugin();
  if (!mod?.Purchases) return;
  try {
    await withTimeout(mod.Purchases.logOut(), readTimeout(), 'logOut');
  } catch {
    // logOut rejects when the current user is already anonymous. Nothing to undo.
  }
}

/** The member this wrapper is pointed at, or null. */
export function purchasesUserId(): string | null {
  return currentUserId;
}

export function isPurchasesReady(): boolean {
  return sdkConfigured && currentUserId !== null;
}

export interface StoreTrial {
  days: number;
  source: 'appstore' | 'play';
}

export interface StorePackage {
  id: string;
  entitlement: EntitlementId;
  period: Period;
  productId: string;
  priceString: string;
  price: number | null;
  currencyCode: string | null;
  trial: StoreTrial | null;
}

const DAYS_PER: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

function periodOf(pkg: any): Period | null {
  const type = String(pkg?.packageType ?? '').toUpperCase();
  if (type === 'MONTHLY') return 'monthly';
  if (type === 'ANNUAL') return 'yearly';
  const iso = String(pkg?.product?.subscriptionPeriod ?? '').toUpperCase();
  if (iso === 'P1M') return 'monthly';
  if (iso === 'P1Y' || iso === 'P12M') return 'yearly';
  return null;
}

/** The free trial a store product carries, in days, or null. A paid intro price is not a trial. */
export function freeTrialOf(product: any): StoreTrial | null {
  const phase = product?.defaultOption?.freePhase?.billingPeriod;
  if (phase && DAYS_PER[String(phase.unit)] && Number(phase.value) > 0) {
    return { days: DAYS_PER[String(phase.unit)] * Number(phase.value), source: 'play' };
  }
  const intro = product?.introPrice;
  const unit = String(intro?.periodUnit ?? '').toUpperCase();
  if (intro && Number(intro.price) === 0 && DAYS_PER[unit]) {
    const n = Number(intro.periodNumberOfUnits || 0) * Math.max(1, Number(intro.cycles || 1));
    if (n > 0) return { days: DAYS_PER[unit] * n, source: 'appstore' };
  }
  return null;
}

/**
 * The four packages of the `default` offering, flattened. Always an array; empty on any failure, and
 * empty when the wrapper is pointed at someone other than `userId` (when given).
 */
export async function getPackages(userId?: string | null): Promise<StorePackage[]> {
  const { Purchases } = await readyPlugin(userId);
  if (!Purchases) return [];
  try {
    // getOfferings() resolves { all, current } itself (not wrapped in { offerings }).
    const offerings = await withTimeout<any>(Purchases.getOfferings(), readTimeout(), 'getOfferings');
    const offering = offerings?.all?.[OFFERING_ID] ?? offerings?.current ?? null;
    const available: any[] = offering?.availablePackages ?? [];
    const rows: StorePackage[] = [];
    packageCache = new Map();
    for (const pkg of available) {
      const product = pkg?.product;
      const entitlement = productIdToEntitlement(product?.identifier);
      const period = periodOf(pkg);
      if (!entitlement || !period || typeof product?.priceString !== 'string') continue;
      packageCache.set(String(pkg.identifier), pkg);
      rows.push({
        id: String(pkg.identifier),
        entitlement,
        period,
        productId: String(product.identifier),
        priceString: product.priceString,
        price: typeof product.price === 'number' ? product.price : null,
        currencyCode: product.currencyCode ?? null,
        trial: freeTrialOf(product),
      });
    }
    await dropIneligibleAppStoreTrials(Purchases, rows);
    return rows;
  } catch (err) {
    console.error('[purchases] getOfferings failed', err);
    return [];
  }
}

async function dropIneligibleAppStoreTrials(Purchases: any, rows: StorePackage[]): Promise<void> {
  const ids = rows.filter((r) => r.trial?.source === 'appstore').map((r) => r.productId);
  if (!ids.length) return;
  let answer: Record<string, { status?: number }> | null = null;
  try {
    if (typeof Purchases.checkTrialOrIntroductoryPriceEligibility === 'function') {
      answer = await withTimeout<any>(
        Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: ids }),
        readTimeout(),
        'checkTrialOrIntroductoryPriceEligibility',
      );
    }
  } catch (err) {
    console.error('[purchases] trial eligibility check failed', err);
  }
  for (const r of rows) {
    if (r.trial?.source === 'appstore' && Number(answer?.[r.productId]?.status) !== INTRO_ELIGIBLE) r.trial = null;
  }
}

function isCancelled(err: any, codes?: Record<string, string>): boolean {
  if (!err) return false;
  const cancelled = codes?.PURCHASE_CANCELLED_ERROR ?? '1';
  if (String(err.code) === String(cancelled)) return true;
  if (err.userCancelled === true) return true;
  return String(err.readableErrorCode ?? err.userInfo?.readableErrorCode ?? '').toUpperCase().includes('PURCHASE_CANCELLED');
}

export interface StoreState {
  entitlement: EntitlementId | null;
  managementUrl: string | null;
}

function stateOf(customerInfo: unknown): StoreState {
  return {
    entitlement: activeEntitlement(customerInfo),
    managementUrl: (customerInfo as { managementURL?: string | null } | null)?.managementURL ?? null,
  };
}

export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseError';
  }
}

/** The store accepted the order but has not charged yet (Ask to Buy, a slow payment). Nothing unlocks. */
export class PurchasePendingError extends PurchaseError {
  constructor() {
    super('Your purchase is pending. Holler unlocks when the store confirms it.');
    this.name = 'PurchasePendingError';
  }
}

export const IDENTITY_MESSAGE = 'We could not connect your account to the store. Try again in a moment.';

function isPending(err: any, codes?: Record<string, string>): boolean {
  if (!err) return false;
  const pending = codes?.PAYMENT_PENDING_ERROR ?? '20';
  if (String(err.code) === String(pending)) return true;
  return String(err.readableErrorCode ?? err.userInfo?.readableErrorCode ?? '').toUpperCase().includes('PAYMENT_PENDING');
}

/**
 * Buy a package for this member. Null when the person cancelled. A pending payment throws
 * PurchasePendingError; other failures throw PurchaseError with a plain message.
 */
export async function purchase(packageId: string, userId: string | null | undefined): Promise<StoreState | null> {
  if (!storeAvailable() || !packageId) throw new PurchaseError('The store is not available right now. Try again in a moment.');
  if (!(await ensurePurchases(userId))) throw new PurchaseError(IDENTITY_MESSAGE);
  const { Purchases } = await readyPlugin(userId);
  if (!Purchases) throw new PurchaseError(IDENTITY_MESSAGE);
  let aPackage = packageCache.get(packageId);
  if (!aPackage) {
    await getPackages(userId);
    aPackage = packageCache.get(packageId);
  }
  if (!aPackage) throw new PurchaseError('That plan is not available right now. Try again in a moment.');
  const mod = await loadPlugin();
  try {
    const result = await Purchases.purchasePackage({ aPackage });
    return stateOf(result?.customerInfo);
  } catch (err) {
    if (isCancelled(err, mod?.PURCHASES_ERROR_CODE)) return null;
    if (isPending(err, mod?.PURCHASES_ERROR_CODE)) throw new PurchasePendingError();
    console.error('[purchases] purchase failed', err);
    throw new PurchaseError('The purchase did not go through. Try again.');
  }
}

/** What a restore found for the signed-in member. */
export type RestoreResult =
  | { kind: 'restored'; entitlement: EntitlementId; managementUrl: string | null }
  | { kind: 'none' }
  | { kind: 'other-account' };

export const RESTORED_MESSAGE = 'Your subscription is restored.';
export const RESTORE_NONE_MESSAGE = 'No active Holler subscription was found for this Apple or Google account.';
export const RESTORE_OTHER_ACCOUNT_MESSAGE = 'This purchase is linked to another Holler account. Sign in to that account, or contact support.';

/** The words to show after a restore. Only "restored" says the subscription is back. */
export function restoreMessage(r: RestoreResult): { tone: 'success' | 'warn'; text: string } {
  if (r.kind === 'restored') return { tone: 'success', text: RESTORED_MESSAGE };
  if (r.kind === 'other-account') return { tone: 'warn', text: RESTORE_OTHER_ACCOUNT_MESSAGE };
  return { tone: 'warn', text: RESTORE_NONE_MESSAGE };
}

/** The store says this receipt belongs to another app user id (RevenueCat codes 7 and 13). */
function isReceiptInUse(err: any, codes?: Record<string, string>): boolean {
  if (!err) return false;
  const ids = [codes?.RECEIPT_ALREADY_IN_USE_ERROR ?? '7', codes?.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR ?? '13'];
  if (ids.includes(String(err.code))) return true;
  const readable = String(err.readableErrorCode ?? err.userInfo?.readableErrorCode ?? '').toUpperCase();
  return readable.includes('RECEIPT_ALREADY_IN_USE') || readable.includes('RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER');
}

/** RevenueCat's own current app user id is this member. */
async function storeUserIs(Purchases: any, userId: string): Promise<boolean> {
  if (currentUserId !== userId) return false;
  if (typeof Purchases.getAppUserID !== 'function') return true;
  try {
    const res = await withTimeout<{ appUserID?: string }>(Purchases.getAppUserID(), readTimeout(), 'getAppUserID');
    return res?.appUserID === userId;
  } catch {
    return false;
  }
}

/**
 * Restore purchases for this member (required on every screen that sells). "restored" only when
 * RevenueCat's customer info for THIS member's app user id shows an active Holler entitlement after
 * the restore. "other-account" when the store says the purchase belongs to another app user id,
 * "none" when nothing active comes back. Throws PurchaseError on a store failure or after 60 s.
 */
export async function restorePurchases(userId: string | null | undefined): Promise<RestoreResult> {
  if (!storeAvailable()) throw new PurchaseError('The store is not available right now. Try again in a moment.');
  if (!userId || !(await ensurePurchases(userId))) throw new PurchaseError(IDENTITY_MESSAGE);
  const { Purchases } = await readyPlugin(userId);
  if (!Purchases) throw new PurchaseError(IDENTITY_MESSAGE);
  const mod = await loadPlugin();
  let restored: any;
  try {
    restored = await withTimeout<any>(Purchases.restorePurchases(), harness?.restoreTimeoutMs ?? RESTORE_TIMEOUT_MS, 'restorePurchases');
  } catch (err) {
    if (isReceiptInUse(err, mod?.PURCHASES_ERROR_CODE)) return { kind: 'other-account' };
    console.error('[purchases] restore failed', err);
    throw new PurchaseError('We could not reach the store. Try again.');
  }
  // The answer counts only for the member who is still signed in and still the store's user.
  if (!(await storeUserIs(Purchases, userId))) throw new PurchaseError(IDENTITY_MESSAGE);
  let info: unknown = restored?.customerInfo ?? null;
  try {
    const fresh = await withTimeout<any>(Purchases.getCustomerInfo(), readTimeout(), 'getCustomerInfo');
    if (fresh?.customerInfo) info = fresh.customerInfo;
  } catch (err) {
    console.error('[purchases] getCustomerInfo after restore failed', err);
  }
  const st = stateOf(info);
  return st.entitlement ? { kind: 'restored', entitlement: st.entitlement, managementUrl: st.managementUrl } : { kind: 'none' };
}

/** What the store says right now for `userId` (when given), or null when it cannot be read. */
export async function currentStoreState(userId?: string | null): Promise<StoreState | null> {
  const { Purchases } = await readyPlugin(userId);
  if (!Purchases) return null;
  try {
    const result = await withTimeout<any>(Purchases.getCustomerInfo(), readTimeout(), 'getCustomerInfo');
    return stateOf(result?.customerInfo);
  } catch (err) {
    console.error('[purchases] getCustomerInfo failed', err);
    return null;
  }
}

/** Store-pushed changes (renewal, cancel from Settings). Returns an unsubscribe function, or null. */
export async function onStoreChange(callback: (state: StoreState) => void): Promise<(() => void) | null> {
  const { Purchases } = await readyPlugin();
  if (!Purchases) return null;
  try {
    // Not wrapped in a timeout: abandoning the registration would orphan a native listener.
    const id = await Purchases.addCustomerInfoUpdateListener((info: unknown) => {
      try {
        callback(stateOf(info));
      } catch (err) {
        console.error('[purchases] listener threw', err);
      }
    });
    return () => {
      const listenerToRemove = typeof id === 'string' ? id : (id as { listenerId?: string } | null)?.listenerId;
      if (!listenerToRemove) return;
      Promise.resolve(Purchases.removeCustomerInfoUpdateListener({ listenerToRemove })).catch(() => undefined);
    };
  } catch (err) {
    console.error('[purchases] addCustomerInfoUpdateListener failed', err);
    return null;
  }
}

/** The store country (ISO 3166-1 alpha-3, "USA"), or null when unknown. */
export async function storefrontCountry(): Promise<string | null> {
  const { Purchases } = await readyPlugin();
  if (!Purchases || typeof Purchases.getStorefront !== 'function') return null;
  try {
    const sf = await withTimeout<{ countryCode?: string }>(Purchases.getStorefront(), readTimeout(), 'getStorefront');
    return typeof sf?.countryCode === 'string' ? sf.countryCode.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * For screens that sell: point the SDK at this member and check that RevenueCat's own current app user
 * id is this member. False when logIn failed or the ids differ: the caller blocks buying and restoring.
 */
export async function ensurePurchases(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  if (!(await configurePurchases(userId))) return false;
  if (currentUserId !== userId) return false;
  const mod = await loadPlugin();
  const Purchases = mod?.Purchases;
  if (!Purchases) return false;
  // The real plugin always has getAppUserID; a plain-object stand-in (capture build) does not, and then
  // the id this wrapper set with configure / logIn is the answer.
  if (typeof Purchases.getAppUserID !== 'function') return true;
  try {
    const res = await withTimeout<{ appUserID?: string }>(Purchases.getAppUserID(), readTimeout(), 'getAppUserID');
    return res?.appUserID === userId;
  } catch (err) {
    console.error('[purchases] getAppUserID failed', err);
    return false;
  }
}
