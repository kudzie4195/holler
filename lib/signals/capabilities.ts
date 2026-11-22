import { APPROX_LOCATION_SOURCES } from './approx-location';
import { CATEGORY_IDS, type CategoryId } from './categories';
import { cityBySlug, nearestCity } from '@/lib/geo';
import { NWS_HAIL_EXTRA, NWS_RULES } from './adapters/nws';
import { HAIL_CATS, TORNADO_CATS, WIND_CATS } from './adapters/spc';
import { categoriesFor as femaCategoriesFor } from './adapters/fema';
import { QUAKE_TRADES } from './adapters/usgs';
import { AIRPORTS, FAA_TRADES } from './adapters/faa';
import { NAICS_RULES } from './adapters/usaspending';
import { BASE_CATEGORIES as TICKETMASTER_TRADES } from './adapters/ticketmaster';
import {
  BUSINESS_RULES,
  CIVIC_RULES,
  EVENT_RULES,
  INSPECTION_RULES,
  PERMIT_RULES,
  SOCRATA_DATASETS,
  VIOLATION_RULES,
  type CategoryRule,
} from './adapters/socrata-datasets';
import { ARCGIS_DATASETS } from './adapters/arcgis-datasets';

/**
 * What Holler can really deliver, derived from the adapters' own rule tables and dataset configs (imported, never copied).
 * Public pages read this instead of claiming signals the product never tags.
 *
 * What counts: an explicit rule or category list in an adapter that is part of ALL_ADAPTERS. Incidental free-text keyword hits
 * (for example a permit description that happens to say "deadbolt") are NOT claimed: the table only lists what is designed to happen.
 * Signal types fed only by an optional key are still listed here; see SIGNAL_NEEDS_KEY and TRADE_SIGNALS_KEYLESS.
 */
export type SignalTypeId =
  | 'weather-alert'
  | 'storm-report'
  | 'disaster'
  | 'quake'
  | 'airport'
  | 'permit'
  | '311'
  | 'inspection'
  | 'business'
  | 'violation'
  | 'event'
  | 'event-permit'
  | 'contract'
  | 'ask';

export const SIGNAL_TYPE_IDS: SignalTypeId[] = [
  'weather-alert', 'storm-report', 'disaster', 'quake', 'airport', 'permit', '311', 'inspection',
  'business', 'violation', 'event', 'event-permit', 'contract', 'ask',
];

/** OpenFEMA incidentType values (the dataset's vocabulary). categoriesFor decides which become trade signals. */
export const FEMA_INCIDENT_TYPES = [
  'Fire', 'Flood', 'Severe Storm', 'Hurricane', 'Tornado', 'Snowstorm', 'Severe Ice Storm', 'Drought', 'Earthquake', 'Typhoon',
  'Tropical Storm', 'Coastal Storm', 'Mud/Landslide', 'Dam/Levee Break', 'Freezing', 'Tsunami', 'Volcanic Eruption',
  'Biological', 'Chemical', 'Terrorist', 'Other',
];

function fromRules(rules: CategoryRule[]): CategoryId[] {
  return rules.flatMap((r) => r.add);
}

/** Every trade each signal type can be tagged with, straight from the adapters. */
const TAGGED: Record<SignalTypeId, CategoryId[]> = {
  'weather-alert': [...NWS_RULES.flatMap((r) => r.categories), ...NWS_HAIL_EXTRA],
  'storm-report': [...TORNADO_CATS, ...HAIL_CATS, ...WIND_CATS],
  disaster: FEMA_INCIDENT_TYPES.flatMap((t) => femaCategoriesFor(t)),
  quake: QUAKE_TRADES,
  airport: FAA_TRADES,
  permit: fromRules(PERMIT_RULES),
  '311': fromRules(CIVIC_RULES),
  inspection: fromRules(INSPECTION_RULES),
  business: fromRules(BUSINESS_RULES),
  violation: fromRules(VIOLATION_RULES),
  event: TICKETMASTER_TRADES,
  'event-permit': fromRules(EVENT_RULES),
  contract: NAICS_RULES.flatMap(([, cats]) => cats),
  // Every category has ask keywords (ASK_TERMS in websearch.ts and CATEGORIES keywords for the classifier). Resident requests made on
  // Holler (source 'holler-request', lib/requests) are kind 'ask' too, for the trades in lib/requests/trades.ts; they are not an adapter.
  ask: CATEGORY_IDS,
};

/** Signal type to the trades it can be tagged with (deduplicated). */
export const SIGNAL_TRADES: Record<SignalTypeId, CategoryId[]> = Object.fromEntries(
  SIGNAL_TYPE_IDS.map((t) => [t, [...new Set(TAGGED[t])]]),
) as Record<SignalTypeId, CategoryId[]>;

/** For each trade, exactly the signal types that some adapter can tag with it. */
export const TRADE_SIGNALS: Record<CategoryId, SignalTypeId[]> = Object.fromEntries(
  CATEGORY_IDS.map((c) => [c, SIGNAL_TYPE_IDS.filter((t) => SIGNAL_TRADES[t].includes(c))]),
) as Record<CategoryId, SignalTypeId[]>;

/**
 * Signal types whose adapters all need an optional key (each inner list is one adapter's full set of keys; any one adapter is enough).
 * Types missing here work with no optional keys.
 * 'ask' stays here on purpose: every ADAPTER that feeds it (web search, Bluesky) needs a key, and public copy built from this table
 * describes those public posts. The one keyless 'ask' source is resident requests made on Holler at /request, which is not an adapter
 * and only exists for trades that already have a keyless source. Copy names it on its own ("requests residents post on Holler"),
 * never as "people asking online", and never implies Holler reads social sites.
 */
export const SIGNAL_NEEDS_KEY: Partial<Record<SignalTypeId, string[][]>> = {
  event: [['TICKETMASTER_API_KEY']],
  ask: [['BRAVE_SEARCH_API_KEY'], ['SERPER_API_KEY'], ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD']],
};

/** Same as TRADE_SIGNALS but only types that work on a launch with no optional keys set. */
export const TRADE_SIGNALS_KEYLESS: Record<CategoryId, SignalTypeId[]> = Object.fromEntries(
  CATEGORY_IDS.map((c) => [c, TRADE_SIGNALS[c].filter((t) => !SIGNAL_NEEDS_KEY[t])]),
) as Record<CategoryId, SignalTypeId[]>;

// ---- Cities ----------------------------------------------------------------------------------------------------------------

type Dataset = { city: string; state: string; subtype: SignalTypeId; verified: boolean; fallbackCenter?: { lat: number; lon: number }; countyAnchor?: { lat: number; lon: number } };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The city place slug a dataset's rows land on (nearestCity, as the scanner does), or null when it cannot be resolved. */
export function placeSlugOfDataset(ds: Pick<Dataset, 'city' | 'state' | 'fallbackCenter' | 'countyAnchor'>): string | null {
  if (ds.countyAnchor) return nearestCity(ds.countyAnchor.lat, ds.countyAnchor.lon, 40)?.slug ?? null;
  const direct = cityBySlug(`${slugify(ds.city)}-${ds.state.toLowerCase()}`);
  if (direct) return nearestCity(direct.lat, direct.lon, 40)?.slug ?? direct.slug;
  if (ds.fallbackCenter) return nearestCity(ds.fallbackCenter.lat, ds.fallbackCenter.lon, 40)?.slug ?? null;
  return null;
}

/** Enabled datasets (verified: true, not on probation) from both the Socrata and ArcGIS configs. A probation dataset is never advertised as live. */
export function enabledDatasets(): (Dataset & { id: string })[] {
  return [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.verified && !d.probation).map((d) => ({ ...d, subtype: d.subtype as SignalTypeId }));
}

function buildCityFeeds(): { all: Record<string, SignalTypeId[]>; county: Record<string, SignalTypeId[]> } {
  const all = new Map<string, Set<SignalTypeId>>();
  const county = new Map<string, Set<SignalTypeId>>();
  const add = (m: Map<string, Set<SignalTypeId>>, slug: string, t: SignalTypeId) => {
    const s = m.get(slug) ?? new Set<SignalTypeId>();
    s.add(t);
    m.set(slug, s);
  };
  for (const ds of enabledDatasets()) {
    // Rows of an approximate-location feed (Cobb County) are never listed on a city page (run.ts placeSlugFor), so no city claims it.
    if (APPROX_LOCATION_SOURCES.has(ds.id)) continue;
    const slug = placeSlugOfDataset(ds);
    if (!slug) continue;
    add(all, slug, ds.subtype);
    if (ds.countyAnchor) add(county, slug, ds.subtype);
  }
  for (const ap of Object.values(AIRPORTS)) {
    const slug = nearestCity(ap.lat, ap.lon, 40)?.slug;
    if (slug) add(all, slug, 'airport');
  }
  const order = (m: Map<string, Set<SignalTypeId>>) =>
    Object.fromEntries([...m].map(([k, v]) => [k, SIGNAL_TYPE_IDS.filter((t) => v.has(t))]));
  return { all: order(all), county: order(county) };
}

const FEEDS = buildCityFeeds();

/**
 * City place slug (as nearestCity gives it) to the record types that city has a live feed for: every enabled Socrata or ArcGIS dataset
 * plus airport status. County feeds land on the nearest city, so see COUNTY_FEEDS before wording a title as "city permits".
 * Hazard signals (weather, storm reports, disasters, quakes) are national and not listed here.
 */
export const CITY_FEEDS: Record<string, SignalTypeId[]> = FEEDS.all;

/** Subset of CITY_FEEDS that comes from a county-level dataset (e.g. DeKalb County permits on the Atlanta page). */
export const COUNTY_FEEDS: Record<string, SignalTypeId[]> = FEEDS.county;
