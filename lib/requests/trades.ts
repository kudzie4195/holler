import { tradeGroups, tradeLabel, type TradeGroup } from '@/lib/check/trades';
import { tradeComingSoon } from '@/lib/seo/signal-types';

/**
 * Trades a resident can ask for. Same list and order as the /check form (tradeGroups minus the trades onboarding disables on this
 * deployment, so no one is asked for a trade no member can pick), minus trades that are not a service a resident hires.
 */
const NOT_HIREABLE = new Set(['rideshare-delivery']);

export function requestTradeGroups(comingSoon: (trade: string) => boolean = (t) => tradeComingSoon(t)): TradeGroup[] {
  return tradeGroups()
    .map((g) => ({ ...g, options: g.options.filter((o) => !NOT_HIREABLE.has(o.id) && !comingSoon(o.id)) }))
    .filter((g) => g.options.length > 0);
}

export function isRequestTrade(id: string, comingSoon?: (trade: string) => boolean): boolean {
  return requestTradeGroups(comingSoon).some((g) => g.options.some((o) => o.id === id));
}

export { tradeLabel };
