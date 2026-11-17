import type { SectionId } from './sections';
import type { PlaceData } from './summarize';
import { WINDOW_DAYS } from './threshold';
import { CITY_FEEDS, COUNTY_FEEDS } from '@/lib/signals/capabilities';
import { SIGNAL_PHRASES } from './signal-types';

/**
 * Search-intent titles for city pages. A title names only record types the city actually has in the
 * last 60 days, in this priority order, at most three. Nothing here may promise a type with no data.
 */
export const TITLE_PRIORITY: { id: SectionId; phrase: string }[] = [
  { id: 'permits', phrase: 'building permits' },
  { id: 'storm', phrase: 'storm reports' },
  { id: 'alerts', phrase: 'weather alerts' },
  { id: 'requests311', phrase: '311 requests' },
  { id: 'inspections', phrase: 'inspections' },
  { id: 'business', phrase: 'new businesses' },
  { id: 'violations', phrase: 'code violations' },
  { id: 'contracts', phrase: 'federal contracts' },
  { id: 'events', phrase: 'events' },
];

export const MAX_TITLE_TYPES = 3;
/** Titles longer than this drop the " | Holler" suffix so they are not cut off in results. */
const TITLE_SUFFIX_MAX = 66;

export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface TitleCity {
  name: string;
  state: string;
  /** City slug. When the city's records of a type come from a county dataset, the title says "area" instead of implying a city feed. */
  slug?: string;
}

/** Section ids whose records can come from a county dataset (CityFeeds subtype). */
const COUNTY_SUBTYPE: Partial<Record<SectionId, 'permit' | '311' | 'inspection' | 'business' | 'violation'>> = {
  permits: 'permit',
  requests311: '311',
  inspections: 'inspection',
  business: 'business',
  violations: 'violation',
};

/** True when this city's records of the section's type come from a county dataset, so wording should say "area". */
export function isCountyFeed(id: SectionId, slug?: string): boolean {
  const sub = COUNTY_SUBTYPE[id];
  return !!sub && !!slug && (COUNTY_FEEDS[slug] ?? []).includes(sub);
}

/** Record-type phrases to put in the title: present in the window, priority order, at most three. */
export function titleTypes(data: PlaceData, slug?: string): string[] {
  if (!data.ok || data.total === 0) return [];
  const out: string[] = [];
  const county = slug ? (COUNTY_FEEDS[slug] ?? []) : [];
  for (const t of TITLE_PRIORITY) {
    const sub = COUNTY_SUBTYPE[t.id];
    if ((data.windowCounts[t.id] ?? 0) > 0) out.push(sub && county.includes(sub) ? `area ${t.phrase}` : t.phrase);
    if (out.length === MAX_TITLE_TYPES) break;
  }
  return out;
}

/** True when every named type also has a record in the last 7 days, so "this week" is honest. */
function allThisWeek(data: PlaceData): boolean {
  const named = TITLE_PRIORITY.filter((t) => (data.windowCounts[t.id] ?? 0) > 0).slice(0, MAX_TITLE_TYPES);
  return named.length > 0 && named.every((t) => (data.weekCounts[t.id] ?? 0) > 0);
}

export function neutralTitle(city: TitleCity): string {
  return `What's happening in ${city.name}, ${city.state}`;
}

/** Document title, e.g. "Chicago, IL building permits, 311 requests and storm reports this week | Holler". */
export function buildTitle(city: TitleCity, data: PlaceData): string {
  const types = titleTypes(data, city.slug);
  if (!types.length) return `${neutralTitle(city)} | Holler`;
  const when = allThisWeek(data) ? 'this week' : `in the last ${WINDOW_DAYS} days`;
  const base = `${city.name}, ${city.state} ${joinList(types)} ${when}`;
  return base.length + 9 <= TITLE_SUFFIX_MAX ? `${base} | Holler` : base;
}

/** On-page H1: the same record types, phrased as what the page lists. */
export function buildH1(city: TitleCity, data: PlaceData): string {
  const types = titleTypes(data, city.slug);
  if (!types.length) return neutralTitle(city);
  const list = joinList(types);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} in ${city.name}, ${city.state}`;
}

/**
 * Description opener for a city with no records to count yet. Weather alerts and storm reports are national, so they are always
 * true. City record types are named only when CITY_FEEDS says the city has a live feed for them (at most two, airports left out
 * because they are not a city record), and county feeds say "area". Otherwise the wording stays neutral.
 */
function neutralFallback(city: TitleCity): string {
  const feeds = (city.slug ? (CITY_FEEDS[city.slug] ?? []) : []).filter((t) => t !== 'airport').slice(0, 2);
  const county = city.slug ? (COUNTY_FEEDS[city.slug] ?? []) : [];
  const named = feeds.map((t) => (county.includes(t) ? `area ${SIGNAL_PHRASES[t]}` : SIGNAL_PHRASES[t]));
  const list = joinList(['weather alerts', 'storm reports', ...named, 'other public records']);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
}

/** Meta description (max 155 chars) that states what is on the page, with real counts. */
export function buildSearchDescription(city: TitleCity, data: PlaceData): string {
  const place = `${city.name}, ${city.state}`;
  const types = titleTypes(data, city.slug);
  let d: string;
  if (types.length && data.total > 0) {
    const n = data.total.toLocaleString('en-US');
    d = `Latest ${joinList(types)} for ${place}: ${n} public ${data.total === 1 ? 'record' : 'records'} from the last ${WINDOW_DAYS} days, each linked to its source.`;
  } else if (data.ok && data.total > 0) {
    d = `Recent public records for ${place} from the last ${WINDOW_DAYS} days, each linked to its source.`;
  } else {
    d = `${neutralFallback(city)} for ${place}, each with its source.`;
  }
  return d.length <= 155 ? d : `${d.slice(0, 152).trimEnd()}...`;
}
