import { CITY_FEEDS, type SignalTypeId } from '@/lib/signals/capabilities';
import { t, type Lang } from '@/lib/i18n';
import { CITY_TYPES, NATIONAL_TYPES, SIGNAL_PHRASES, activeTradeSignals } from '@/lib/seo/signal-types';

/**
 * What Holler really watches for a trade near a place, in plain words. Used only for the "nothing yet" state.
 * National types come from activeTradeSignals (what an adapter can tag for the trade, and only when its optional keys are set). City types (permits, 311, inspections,
 * business licenses, violations, event permits, airport status) are named only when the nearby city's feed has them
 * (CITY_FEEDS) and the trade receives them. Never a type that nothing sends.
 */
export function watchTypes(trade: string, citySlug: string | null, has?: Parameters<typeof activeTradeSignals>[1]): SignalTypeId[] {
  const forTrade = activeTradeSignals(trade, has);
  const cityHas = citySlug ? (CITY_FEEDS[citySlug] ?? []) : [];
  return forTrade.filter((t) => (NATIONAL_TYPES.includes(t) ? true : CITY_TYPES.includes(t) && cityHas.includes(t)));
}

export function watchList(trade: string, citySlug: string | null, has?: Parameters<typeof activeTradeSignals>[1], lang: Lang = 'en'): string[] {
  return watchTypes(trade, citySlug, has).map((type) => (lang === 'en' ? SIGNAL_PHRASES[type] : t(lang, `chk.watch.${type}` as 'chk.watch.permit')));
}
