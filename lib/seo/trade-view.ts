import { CATEGORIES } from '@/lib/signals/categories';
import { absoluteUrl } from './canonical';
import { TRADE_FACTS, type TradeFacts } from './trade-pages';

export const TRADE_PRICE_LINE = '$5 a month or $48 a year, with 7 days free and no card to start.';

export const HOW_IT_WORKS: string[] = [
  'Pick what you do. Add your ZIP and how far you will drive, from 5 to 100 miles.',
  'Holler checks public weather, city, federal and event data every few minutes to a few hours.',
  'When something nearby matches, you get a short email with the source link. Holler never posts anything for you.',
];

export interface TradeEntry {
  id: string;
  label: string;
  group: string | null;
  facts: TradeFacts;
}

export const GROUP_LABELS: Record<string, string> = {
  home: 'Home and property',
  storm: 'Storm and emergency work',
  auto: 'Auto and roadside',
  business: 'Business and commercial',
  'food-events': 'Food and events',
  other: 'Other trades',
};
const GROUP_ORDER = ['home', 'storm', 'auto', 'business', 'food-events', 'other'];

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
  const base = t.facts.headline;
  return base.length + 9 <= 66 ? `${base} | Holler` : base;
}

export function tradeDescription(t: TradeEntry): string {
  const d = `${t.facts.headline}. Holler emails ${t.facts.noun} when weather, permits, city records or public posts point to work nearby. ${TRADE_PRICE_LINE}`;
  return d.length <= 155 ? d : `${d.slice(0, 152).trimEnd()}...`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** 2 to 3 questions, each answered from the trade's own data file or the fixed price and rules. */
export function tradeFaq(t: TradeEntry): { q: string; a: string }[] {
  const names = t.facts.signals.map((s) => lowerFirst(s.signal));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return [
    {
      q: `What does Holler send ${t.facts.noun}?`,
      a: `Holler watches for ${list}. You pick your trade and how far you travel, and it emails you when something nearby matches. Each alert links to the public source.`,
    },
    {
      q: `How much does Holler cost for ${t.facts.noun}?`,
      a: TRADE_PRICE_LINE,
    },
    {
      q: 'Does Holler post or contact anyone for me?',
      a: 'No. Holler only sends you alerts. It never posts, messages or touches your social accounts, so there is nothing to get banned.',
    },
  ];
}

export function serviceLd(t: TradeEntry): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: t.facts.headline,
    serviceType: 'Local lead and storm alerts',
    description: t.facts.lead,
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
