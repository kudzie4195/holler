import type { CategoryId } from './categories';

/**
 * Which Holler trades an open city bid is about, from its title and category text. Pure and client-safe.
 *
 * A bid with no match returns [] and is NOT stored or shown: city bid feeds are mostly goods, software renewals and social services, and
 * a bid with no trade would match nobody by trade anyway. The table is deliberately small and strict (whole words and phrases, no lone
 * "sign", "moving" or "network"); a missed bid costs a card, a wrong trade costs trust. It names the work in the title; it does not say
 * who may bid or who will win.
 *
 * Trades are the ones the strategy doc lists for bids, as existing CategoryIds (lib/signals/categories.ts). There is no separate IT
 * trade in Holler, so IT work (software, websites, help desk, cabling) maps to nothing rather than to 'business-services'. Janitorial maps to both
 * 'janitorial-commercial' and 'cleaning', the same pair lib/signals/adapters/usaspending.ts uses for NAICS 561720. Landscape services
 * map to 'landscaping' only; mowing is 'lawn-care' as well.
 *
 * Written from the first 20 rows of each portal's live feed on 2026-11-21 (tests/signals/bid-trades.test.ts) and then measured on rows
 * it had not seen (the held-out table in that test). Extend it from evidence, not from guesses about what a city might buy.
 */

interface BidTradeRule {
  trades: CategoryId[];
  /** Regex source strings. Each is wrapped so it only matches on word boundaries; plural "s"/"es" is allowed after the match. */
  patterns: string[];
}

export const BID_TRADE_RULES: BidTradeRule[] = [
  { trades: ['roofing'], patterns: ['roof', 'roofing', 're-?roof(?:ing)?', 'roof (?:replacement|repair)'] },
  {
    trades: ['hvac'],
    patterns: [
      'hvac', 'heating', 'boiler', 'air conditioning', 'air conditioner', 'in-wall air conditioner', 'chiller', 'cooling tower',
      'ventilation', 'furnace', 'ductwork', 'heat pump',
    ],
  },
  { trades: ['plumbing'], patterns: ['plumbing', 'plumber', 'backflow', 'water heater', 'drain cleaning', 'grease trap'] },
  {
    trades: ['electrical'],
    patterns: [
      'electrical', 'electrician', 'wiring', 'lighting', 'street ?light', 'traffic signal', 'switchgear',
      'generator (?:maintenance|repair|service|installation)', 'maintenance and repair of (?:\\w+ )?generator',
    ],
  },
  {
    trades: ['landscaping'],
    patterns: [
      'landscap(?:e|ing)', 'grounds maintenance', 'turf', 'irrigation', 'lawn', 'median maintenance', 'weed abatement',
      'vegetation management', 'mowing',
    ],
  },
  { trades: ['lawn-care'], patterns: ['lawn', 'mowing'] },
  {
    trades: ['tree-service'],
    patterns: ['tree (?:trim|trimming|removal|pruning|maintenance|care|services?)', 'arborist', 'stump', 'urban forestry', 'forestry'],
  },
  {
    trades: ['janitorial-commercial', 'cleaning'],
    patterns: [
      'janitorial', 'custodial', 'window washing', 'window cleaning', 'pressure washing', 'power washing', 'cleaning services?',
      'building cleaning', 'carpet cleaning',
    ],
  },
  { trades: ['painting'], patterns: ['paint', 'painting', 'repaint(?:ing)?', 'graffiti (?:removal|abatement)'] },
  {
    trades: ['concrete-paving'],
    patterns: [
      'paving', 'pavement', 'asphalt', 'concrete', 'sidewalk', 'curb', 'resurfacing', 'slurry seal', 'crack seal', 'striping',
      're-?marking', 'pothole', 'retaining wall',
      '(?:road|street|roadway) (?:imprv|improvements?|rehabilitation|rehab|reconstruction|resurfacing)',
    ],
  },
  { trades: ['pest-control'], patterns: ['pest', 'rodent', 'termite', 'mosquito', 'extermination', 'exterminator', 'vector control', 'fumigation', 'bed bug'] },
  {
    trades: ['security'],
    patterns: [
      'security guard', 'security services?', 'security staffing', 'security officer', 'guard services?', 'armed guard', 'patrol services?',
      'alarm (?:monitoring|systems?|services?)', 'cctv', 'video surveillance', 'surveillance cameras?', 'access control',
    ],
  },
  {
    trades: ['signs-printing'],
    patterns: [
      'signage', '(?:street|traffic|parking|park|wayfinding) signs?', 'sign (?:installation|fabrication|replacement|manufacturing)',
      'wayfinding', 'banner', 'decal', 'printing', 'print services?', 'vehicle wrap',
    ],
  },
  {
    trades: ['moving'],
    patterns: ['moving services?', 'mover', 'relocation services?', 'furniture moving', 'office moving', 'moving and storage'],
  },
];

/**
 * Purchases and paper work are not trade work. A painter cannot fill a "Paint Sprayer Equipment Purchase", and a roofer is not the
 * buyer's "Roofing Consultant". Three tiers, applied before the trade table:
 *  1. The portal's own category says the buyer wants goods ("Goods", "Commodity"): no trade. Los Angeles and San Francisco call every
 *     purchase a Commodity; their construction and service bids carry another category.
 *  2. The title is design, consulting, engineering, software or licence work: no trade, whatever else it says.
 *  3. The title is a supply purchase (supplies, materials, parts, filters, fixtures, equipment, "purchase of"): no trade, unless it also
 *     names a work verb (install, repair, replace, maintenance), as in "HVAC equipment replacement".
 */
const GOODS_CATEGORY = /^\s*goods\b|commodit/i;
const PAPER_WORK = /(?<![a-z0-9])(?:consult(?:ant|ants|ing)|engineering|engineers?|design services?|architect(?:ural|ure)?(?: services?)?|software|licen[cs]es?|licen[cs]ing|subscriptions?)(?![a-z0-9])/i;
const SUPPLY_WORDS = /(?<![a-z0-9])(?:supplies|supply of|materials?|parts|filters?|fixtures?|equipment|purchase of|purchase|goods|commodities)(?![a-z0-9])/i;
const WORK_VERBS = /(?<![a-z0-9])(?:install(?:ation|ing|ed)?|repairs?|repairing|replac(?:e|es|ing|ement)|maintenance|maintain|rehabilitat(?:e|ion)|retrofit|construction)(?![a-z0-9])/i;

const COMPILED = BID_TRADE_RULES.map((r) => ({
  trades: r.trades,
  re: new RegExp(`(?<![a-z0-9])(?:${r.patterns.join('|')})(?:s|es)?(?![a-z0-9])`, 'i'),
}));

export interface BidText {
  title: string;
  /** The portal's category or commodity text ("Construction", "Commodity"), when it has one. Read as plain text. */
  category?: string | null;
  /** Any further descriptive text the portal gives. */
  description?: string | null;
}

/** Trades a bid is about, in CATEGORIES-independent rule order, no duplicates. Empty when the text names none of them. */
export function bidTrades(bid: BidText): CategoryId[] {
  const text = [bid.title, bid.category, bid.description]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' | ')
    .toLowerCase()
    .replace(/[‘’]/g, "'");
  if (!text) return [];
  if (bid.category && GOODS_CATEGORY.test(bid.category)) return [];
  const title = bid.title.toLowerCase();
  if (PAPER_WORK.test(title)) return [];
  if (SUPPLY_WORDS.test(title) && !WORK_VERBS.test(title)) return [];
  const out = new Set<CategoryId>();
  for (const r of COMPILED) if (r.re.test(text)) r.trades.forEach((t) => out.add(t));
  return [...out];
}
