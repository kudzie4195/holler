import { APP_TAG } from './scope';
import { PRODUCT_IDS, productName, type Tier } from './plans';

/** The few Stripe product calls ensureProduct needs, so tests can pass a fake. Matches stripe@23 products.retrieve/create/update. */
export interface ProductsApi {
  products: {
    retrieve(id: string): Promise<{ id: string; active: boolean; name?: string; metadata?: Record<string, string> | null }>;
    create(params: { id: string; name: string; metadata: Record<string, string> }): Promise<{ id: string }>;
    update(id: string, params: { active?: boolean; name?: string }): Promise<{ id: string }>;
  };
}

function code(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

/**
 * Returns the id of Holler's Stripe product for a tier, creating it the first time. Checkout and plan switches both use it, so
 * there is one product per tier, never one per checkout.
 * - Lookup is by the fixed id (PRODUCT_IDS), never by name. A display name change ("Holler Starter" to "Holler Solo") cannot make
 *   the lookup miss, so it can never create a second product, and the product id stays `holler_starter`.
 * - Name: when the stored name differs from productName(tier) and the product carries metadata.app = 'holler', the name is updated
 *   in place (one call, same id). The name is a label on Checkout, invoices and the portal. Prices and subscription items point at
 *   the product id, so renaming changes no amount and breaks no lookup. The next call finds the name equal and does nothing
 *   (idempotent). A product without the Holler tag is used as is and never renamed (shared Stripe account).
 * - An archived product is turned back on in the same update.
 * - Two requests racing to create it are fine: the loser gets resource_already_exists and uses the same id.
 */
export async function ensureProduct(stripe: ProductsApi, tier: Tier): Promise<string> {
  const id = PRODUCT_IDS[tier];
  const name = productName(tier);
  try {
    const p = await stripe.products.retrieve(id);
    const patch: { active?: boolean; name?: string } = {};
    if (!p.active) patch.active = true;
    if (p.metadata?.app === APP_TAG && typeof p.name === 'string' && p.name !== name) patch.name = name;
    if (Object.keys(patch).length) await stripe.products.update(id, patch);
    return id;
  } catch (e) {
    if (code(e) !== 'resource_missing') throw e;
  }
  try {
    await stripe.products.create({ id, name, metadata: { app: APP_TAG, tier } });
  } catch (e) {
    if (code(e) !== 'resource_already_exists') throw e;
  }
  return id;
}
