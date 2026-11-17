import { SIGNAL_NEEDS_KEY, SIGNAL_TYPE_IDS, TRADE_SIGNALS, type SignalTypeId } from '@/lib/signals/capabilities';
import { hasEnv, type EnvKey } from '@/lib/env';
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

/** The record types a trade can receive if every optional key were set (TRADE_SIGNALS). Unknown trade ids receive nothing. */
export function typesForTrade(trade: string): SignalTypeId[] {
  return TRADE_SIGNALS[trade as CategoryId] ?? [];
}

/** True when a signal type works with the keys that are set: it needs no key, or at least one of its adapters has all of its keys. */
export function signalTypeActive(type: SignalTypeId, has: (...k: EnvKey[]) => boolean = hasEnv): boolean {
  const needs = SIGNAL_NEEDS_KEY[type];
  if (!needs) return true;
  return needs.some((keys) => has(...(keys as EnvKey[])));
}

/**
 * The record types a trade really receives on THIS deployment: typesForTrade minus the types whose only sources need optional keys
 * that are not set ('event' needs Ticketmaster, 'ask' needs Brave, Serper or both Bluesky keys). Server only (reads lib/env).
 * Public pages and the checker use this, so they never claim a signal nothing here can send. `has` is for tests.
 */
export function activeTradeSignals(trade: string, has: (...k: EnvKey[]) => boolean = hasEnv): SignalTypeId[] {
  return typesForTrade(trade).filter((t) => signalTypeActive(t, has));
}
