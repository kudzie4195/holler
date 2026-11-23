import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/signals/categories';
import { TRADE_SIGNALS } from '@/lib/signals/capabilities';
import type { CategoryId } from '@/lib/signals/categories';
import { hasEnv, type EnvKey } from '@/lib/env';
import { FROM_MONTHLY, FROM_YEARLY } from '@/lib/plan/price-copy';
import { absoluteUrl } from './canonical';
import { TRADE_FACTS, type TradeFacts, type TradeSignal } from './trade-pages';
import { SIGNAL_PHRASES, activeTradeSignals, signalTypeActive, tradeComingSoon } from './signal-types';
import { TRIAL_DAYS, TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { TIER_NAMES } from '@/lib/plan/limits';
import { priceDecimal } from '@/lib/stripe/plans';
import { tradeLiveAnywhere, tradeSignupClosed, type CoverageState } from '@/lib/check/cells';
import { t as tr } from '@/lib/i18n';
import { AREA_LIST_TRADES } from '@/lib/lists/core';

/**
 * Round 24 (review P1-3, decision d): what a trade page may offer, from the measured cells (lib/check/cells.ts).
 *   live      the trade is live in at least one measured centre: the full offer (price line, trial, Start free);
 *   limited   pickable but live nowhere (the storm trades): "Check your ZIP" is the only button and there is no price line;
 *   waitlist  sign-up does not take it: "Check your ZIP" and join the list, with no price and no trial anywhere on the page.
 * The page keeps its content, its index setting and its canonical URL in every state.
 */
export function tradeOffer(id: string): CoverageState {
  if (tradeLiveAnywhere(id)) return 'live';
  if (tradeSignupClosed(id)) return 'waitlist';
  return 'limited';
}

/**
 * Round 24 INT2 (COPY report section 6 item 2): one true line about the address lists and the door hanger, only for a trade that has a
 * neighborhood list (lib/lists/core.ts AREA_LIST_TRADES: a permit kind routes work to it) and only where sign-up takes the trade (a
 * "coming soon" trade page offers the check and the waitlist, never a member tool).
 */
export function tradeListsLine(id: string): string | null {
  if (!AREA_LIST_TRADES.includes(id) || tradeOffer(id) === 'waitlist') return null;
  return 'Members also get the street addresses of these permits on an address list, and a door hanger with their name and number to print, so they know where to hang and flyer this week.';
}

// Precise trial form here on purpose: the month headline right after a yearly price would read like a yearly saving.
export const TRADE_PRICE_LINE = `From ${FROM_MONTHLY} a month or ${FROM_YEARLY} a year, with a ${TRIAL_PHRASE} and no card to start.`;

export const HOW_IT_WORKS: string[] = [
  'Pick what you do. Add your ZIP and how far you will drive, from 5 to 100 miles.',
  'Holler checks public weather, city and federal data every few minutes to a few hours.',
  'When something nearby matches, you get a short email with a link to the public source. Holler never posts anything for you.',
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
  const offer = tradeOffer(t.id);
  const tail = offer === 'live' ? TRADE_PRICE_LINE : tr('en', offer === 'waitlist' ? 'tp.waitlist.line' : 'tp.limited.line', { trade: t.label.toLowerCase() });
  const d = `${tradeHeadline(t)}. Holler emails ${t.facts.noun} ${what}. ${tail}`;
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
      a: tradeOffer(t.id) === 'waitlist'
        ? tr('en', 'tp.faq.cost.waitlist', { trade: t.label.toLowerCase() })
        : tradeOffer(t.id) === 'limited'
          ? tr('en', 'tp.faq.cost.limited', { trade: t.label.toLowerCase(), monthly: FROM_MONTHLY, yearly: FROM_YEARLY })
          : comingSoon
        ? `Plans start at ${FROM_MONTHLY} a month or ${FROM_YEARLY} a year, with a ${TRIAL_PHRASE} and no card to start. Holler has no alerts to send this trade yet, so there is nothing to try today. Check back once its sources are switched on.`
        : `Plans start at ${FROM_MONTHLY} a month or ${FROM_YEARLY} a year, and the first ${TRIAL_DAYS} days are free with no card needed to start, so you can see real alerts for your area before you pay anything.`,
    },
    {
      q: 'Does Holler post or contact anyone for me?',
      a: 'No. Holler sends alerts to you. It never posts for you or touches your social accounts, and the only message it sends is a reply you write to a resident request.',
    },
  ];
}

export function serviceLd(t: TradeEntry): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: tradeHeadline(t),
    serviceType: 'Local public record and storm alerts',
    description: tradeLead(t),
    url: absoluteUrl(tradePath(t.id)),
    audience: { '@type': 'Audience', audienceType: t.label },
    provider: { '@type': 'Organization', name: 'Holler', url: absoluteUrl('/') },
    areaServed: { '@type': 'Country', name: 'United States' },
  };
  // Prices and the trial only for a trade with a live cell (review P1-3): a search engine must not print a trial nobody can use.
  if (tradeOffer(t.id) !== 'live') return ld;
  return {
    ...ld,
    offers: [
      // Offer prices and names from lib/stripe/plans.ts (cheapest plan), never typed.
      { '@type': 'Offer', name: `Holler ${TIER_NAMES.starter} monthly`, price: priceDecimal('starter', 'monthly'), priceCurrency: 'USD', description: `Monthly plan, ${TRIAL_PHRASE}` },
      { '@type': 'Offer', name: `Holler ${TIER_NAMES.starter} yearly`, price: priceDecimal('starter', 'annual'), priceCurrency: 'USD', description: `Annual plan, ${TRIAL_PHRASE}` },
    ],
  };
}
