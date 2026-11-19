/**
 * What the web billing pages show for a member whose paid plan is billed by the App Store or Google Play. Pure (client-safe).
 * While such a plan is live the web must not offer Stripe checkout, a plan switch or the Stripe portal: the member manages the plan
 * in the store. Used by app/app/settings/page.tsx (integration patch).
 */
import { MANAGE_URLS } from '@/lib/mobile/types';
import { isStorePlanLive, type BillingRow } from './source';

export interface StoreManaged {
  store: 'apple' | 'google';
  storeName: 'the App Store' | 'Google Play';
  manageUrl: string;
  /** One plain sentence for the billing card. */
  line: string;
}

export function storeManaged(row: BillingRow | null | undefined, now: number = Date.now()): StoreManaged | null {
  if (!row || !isStorePlanLive(row, now)) return null;
  const store = row.plan_source === 'apple' ? 'apple' : 'google';
  const storeName = store === 'apple' ? 'the App Store' : 'Google Play';
  return {
    store,
    storeName,
    manageUrl: MANAGE_URLS[store],
    line: `You pay for Holler through ${storeName}. To change or cancel your plan, use ${storeName} on your phone.`,
  };
}
