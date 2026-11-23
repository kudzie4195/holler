import { coverageFor } from '@/lib/check/cells';
import { tradeGroups, type TradeGroup } from '@/lib/check/trades';
import { t, type Lang } from '@/lib/i18n';

/**
 * Round 24 (review P2-3). The ONE list of trades the waitlist takes for a place: every trade whose answer there is 'waitlist'
 * (lib/check/cells.ts coverageFor). The card on /check offers exactly this list (app/check/page.tsx) and the server accepts exactly
 * this list (lib/waitlist/service.ts), so a visitor can never pick a trade the server then refuses. A trade that is live or limited
 * here is not on it: its answer is the trial, not the list.
 */
export function waitlistTradeGroups(place: { lat: number; lon: number }, served: boolean, lang: Lang = 'en'): TradeGroup[] {
  return tradeGroups(lang)
    .map((g) => ({
      ...g,
      options: g.options
        .filter((o) => coverageFor(place, o.id, served).state === 'waitlist')
        .map((o) => (o.id === 'cleaning' ? { ...o, label: t(lang, 'chk.trade.cleaning') } : o)),
    }))
    .filter((g) => g.options.length > 0);
}

/** The ids of waitlistTradeGroups, flat. */
export function waitlistTradeIds(place: { lat: number; lon: number }, served: boolean): string[] {
  return waitlistTradeGroups(place, served).flatMap((g) => g.options.map((o) => o.id));
}

/** True when the waitlist takes this trade for this place. */
export function waitlistAccepts(place: { lat: number; lon: number }, served: boolean, trade: string): boolean {
  return waitlistTradeIds(place, served).includes(trade);
}
