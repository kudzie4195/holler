import { SIGNAL_TYPE_IDS, TRADE_SIGNALS, type SignalTypeId } from '@/lib/signals/capabilities';
import type { CategoryId } from '@/lib/signals/categories';

/** Plain-words name for each record type, used in descriptions and in the checker's "what Holler watches" list. */
export const SIGNAL_PHRASES: Record<SignalTypeId, string> = {
  'weather-alert': 'weather warnings from the National Weather Service',
  'storm-report': 'hail, wind and tornado reports',
  disaster: 'FEMA disaster declarations',
  quake: 'earthquakes',
  airport: 'airport delays',
  permit: 'new building permits',
  '311': '311 service requests',
  inspection: 'failed health inspections',
  business: 'new business licenses',
  violation: 'code violations',
  event: 'big concerts, games and festivals',
  'event-permit': 'city event permits',
  contract: 'federal contract awards',
  ask: 'public posts where someone asks for a recommendation',
};

/** Types that come from sources covering the whole country. */
export const NATIONAL_TYPES: SignalTypeId[] = ['weather-alert', 'storm-report', 'disaster', 'quake', 'contract', 'event', 'ask'];
/** Types that exist only where a city or airport feed is connected (see CITY_FEEDS in lib/signals/capabilities.ts). */
export const CITY_TYPES: SignalTypeId[] = SIGNAL_TYPE_IDS.filter((t) => !NATIONAL_TYPES.includes(t));

/** The record types a trade can receive, from the adapters (TRADE_SIGNALS). Unknown trade ids receive nothing. */
export function typesForTrade(trade: string): SignalTypeId[] {
  return TRADE_SIGNALS[trade as CategoryId] ?? [];
}
