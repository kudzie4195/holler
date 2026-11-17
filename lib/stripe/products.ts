import { APP_TAG } from './scope';
import { PRODUCT_IDS, TIER_LABEL, type Tier } from './plans';

/** The few Stripe product calls ensureProduct needs, so tests can pass a fake. Matches stripe@23 products.retrieve/create/update. */
export interface ProductsApi {
  products: {
    retrieve(id: string): Promise<{ id: string; active: boolean }>;
    create(params: { id: string; name: string; metadata: Record<string, string> }): Promise<{ id: string }>;
    update(id: string, params: { active: boolean }): Promise<{ id: string }>;
  };
}

function code(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

/**
 * Returns the id of Holler's Stripe product for a tier, creating it the first time (fixed id, so it is created once and reused).
 * A subscription item update with inline price_data needs a product id (stripe@23 has no product_data there).
 * Two requests racing to create it are fine: the loser gets resource_already_exists and uses the same id.
 */
export async function ensureProduct(stripe: ProductsApi, tier: Tier): Promise<string> {
  const id = PRODUCT_IDS[tier];
  try {
    const p = await stripe.products.retrieve(id);
    if (!p.active) await stripe.products.update(id, { active: true });
    return id;
  } catch (e) {
    if (code(e) !== 'resource_missing') throw e;
  }
  try {
    await stripe.products.create({ id, name: tier === 'pro' ? `Holler ${TIER_LABEL.pro}` : `Holler ${TIER_LABEL.starter}`, metadata: { app: APP_TAG, tier } });
  } catch (e) {
    if (code(e) !== 'resource_already_exists') throw e;
  }
  return id;
}
