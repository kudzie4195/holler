import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/signals/categories';
import { TRADE_SIGNALS } from '@/lib/signals/capabilities';
import type { CategoryId } from '@/lib/signals/categories';
import { hasEnv, type EnvKey } from '@/lib/env';
import { absoluteUrl } from './canonical';
import { TRADE_FACTS, type TradeFacts, type TradeSignal } from './trade-pages';
import { SIGNAL_PHRASES, activeTradeSignals, signalTypeActive, tradeComingSoon } from './signal-types';

export const TRADE_PRICE_LINE = 'From $5 a month or $48 a year, with 7 days free and no card to start.';

export const HOW_IT_WORKS: string[] = [
  'Pick what you do. Add your ZIP and how far you will drive, from 5 to 100 miles.',
  'Holler checks public weather, city and federal data every few minutes to a few hours.',
  'When something nearby matches, you get a short email with the source link. Holler never posts anything for you.',
];

export interface TradeEntry {
  id: string;
  label: string;
  group: string | null;
  facts: TradeFacts;
}

/** One source for group names and order: CATEGORY_GROUPS in lib/signals/categories.ts. */
export const GROUP_LABELS: Record<string, string> = Object.fromEntries(CATEGORY_GROUPS.map((g) => [g.id, g.label]));
const GROUP_ORDER: string[] = CATEGORY_GROUPS.map((g) => g.id);

/** Every trade that has a page, in CATEGORIES order. `group` is read at runtime and may be absent. */
export function tradeEntries(): TradeEntry[] {
  const out: TradeEntry[] = [];
  for (const c of CATEGORIES) {
    const facts = TRADE_FACTS[c.id];
    if (!facts) continue;
    out.push({ id: c.id, label: c.label, group: (c as { group?: string }).group ?? null, facts });
  }
  return out;
}

/**
 * The "why it means work" sentences a trade page may show: only those whose record type the trade really receives
 * (TRADE_SIGNALS in lib/signals/capabilities.ts, derived from the adapters) and whose keys are configured (activeTradeSignals). Order is kept. `received` can be passed
 * in by tests; production code never does.
 */
export function visibleSignals(t: Pick<TradeEntry, 'id' | 'facts'>, received: readonly string[] = activeTradeSignals(t.id)): TradeSignal[] {
  return t.facts.signals.filter((s) => received.includes(s.type));
}

type Has = (...k: EnvKey[]) => boolean;

/** True when a key-gated type that this trade can receive is switched off here, so the default headline and lead may overclaim. */
function gatedOut(id: string, has?: Has): boolean {
  return (TRADE_SIGNALS[id as CategoryId] ?? []).some((t) => !signalTypeActive(t, has));
}

/** The headline for this deployment: the trade's `keyless` text when a key-gated type it leans on is off, else the default. */
export function tradeHeadline(t: Pick<TradeEntry, 'id' | 'facts'>, has?: Has): string {
  return t.facts.keyless && gatedOut(t.id, has) ? t.facts.keyless.headline : t.facts.headline;
}

export function tradeLead(t: Pick<TradeEntry, 'id' | 'facts'>, has?: Has): string {
  return t.facts.keyless && gatedOut(t.id, has) ? t.facts.keyless.lead : t.facts.lead;
}

/** Plain names of the record types that exist only in connected cities (airport status is a separate, named feed). */
const CITY_RECORD_NAMES: Partial<Record<TradeSignal['type'], string>> = {
  permit: 'Building permits',
  '311': '311 requests',
  inspection: 'inspections',
  business: 'business licenses',
  violation: 'code violations',
  'event-permit': 'city event permits',
};

/**
 * The one caveat sentence a trade page shows under "what Holler sends": built only from the city-record types that this trade's
 * visible sentences are about, so it never names a type the trade does not get. Null when none of them is a city record.
 */
export function cityRecordsCaveat(signals: TradeSignal[]): string | null {
  const names = [...new Set(signals.map((s) => CITY_RECORD_NAMES[s.type]).filter((n): n is string => Boolean(n)))];
  if (!names.length) return null;
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} come only from the cities Holler has connected so far.`;
}

/** True when a visible sentence is about a record type that exists only in connected cities. */
export function showsCityRecords(signals: TradeSignal[]): boolean {
  return cityRecordsCaveat(signals) !== null;
}

export function tradeEntry(id: string): TradeEntry | undefined {
  return tradeEntries().find((t) => t.id === id);
}

/** Groups in a fixed order. With no `group` on any category everything lands in one untitled group. */
export function groupTrades(entries: TradeEntry[]): { id: string; title: string | null; trades: TradeEntry[] }[] {
  if (!entries.some((e) => e.group)) return [{ id: 'all', title: null, trades: entries }];
  const byGroup = new Map<string, TradeEntry[]>();
  for (const e of entries) {
    const g = e.group && GROUP_LABELS[e.group] ? e.group : 'other';
    byGroup.set(g, [...(byGroup.get(g) ?? []), e]);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
    id: g,
    title: GROUP_LABELS[g],
    trades: byGroup.get(g) ?? [],
  }));
}

export function tradePath(id: string): string {
  return `/for/${id}`;
}

export function tradeTitle(t: TradeEntry): string {
  const base = tradeHeadline(t);
  return base.length + 9 <= 66 ? `${base} | Holler` : base;
}

export function tradeDescription(t: TradeEntry): string {
  const kinds = [...new Set(visibleSignals(t).map((s) => s.type))].slice(0, 3).map((k) => SIGNAL_PHRASES[k]);
  const what = kinds.length ? `when ${kinds.join(', ')} point to work nearby` : 'when public records point to work nearby';
  const d = `${tradeHeadline(t)}. Holler emails ${t.facts.noun} ${what}. ${TRADE_PRICE_LINE}`;
  return d.length <= 155 ? d : `${d.slice(0, 152).trimEnd()}...`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** 2 to 3 questions, each answered from the trade's own data file or the fixed price and rules. */
export function tradeFaq(t: TradeEntry, has: Has = hasEnv): { q: string; a: string }[] {
  const comingSoon = tradeComingSoon(t.id, has);
  const names = visibleSignals(t).map((s) => lowerFirst(s.signal));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
  return [
    {
      q: `What does Holler send ${t.facts.noun}?`,
      a: list
        ? `Holler watches for ${list}. You pick your trade and how far you will drive, and a short email arrives whenever something nearby matches what you do. Each one links to the public source.`
        : 'Nothing yet. The sources behind this trade are not switched on for this launch, so Holler has no alerts to send it today.',
    },
    {
      q: `How much does Holler cost for ${t.facts.noun}?`,
      a: comingSoon
        ? 'Plans start at $5 a month or $48 a year, with a 7-day free trial and no card to start. Holler has no alerts to send this trade yet, so there is nothing to try today. Check back once its sources are switched on.'
        : 'Plans start at $5 a month or $48 a year, and the first 7 days are free with no card needed to start, so you can see real alerts for your area before you pay anything.',
    },
    {
      q: 'Does Holler post or contact anyone for me?',
      a: 'No. Holler only sends alerts to you, and it never posts, messages or touches your social accounts, so there is nothing on any platform for anyone to ban.',
    },
  ];
}

export function serviceLd(t: TradeEntry): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: tradeHeadline(t),
    serviceType: 'Local lead and storm alerts',
    description: tradeLead(t),
    url: absoluteUrl(tradePath(t.id)),
    audience: { '@type': 'Audience', audienceType: t.label },
    provider: { '@type': 'Organization', name: 'Holler', url: absoluteUrl('/') },
    areaServed: { '@type': 'Country', name: 'United States' },
    offers: [
      { '@type': 'Offer', price: '5', priceCurrency: 'USD', description: 'Monthly plan, 7 days free' },
      { '@type': 'Offer', price: '48', priceCurrency: 'USD', description: 'Annual plan, 7 days free' },
    ],
  };
}
