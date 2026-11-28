import type { Db } from '@/lib/dataforseo/client';
import { LOCATION_TRADES, buildLocationPlan, cleanMonthly, isMissingColumn, parseStoredKeyword, type MonthlySearch, type PlannedLocation } from '@/lib/dataforseo/location-volume';
import { LOCATION_CODE } from '@/lib/dataforseo/volume';

/**
 * Owner-only marketing view (round 35): per trade, the cities with the most Google searches a month, and each city's 12 month trend.
 * Reads the rows location mode stored (lib/dataforseo/location-volume.ts). Pure shaping lives in buildKeywordVolumeReport so tests need no database.
 *
 * Trend: Google's own last 12 months (`monthly_searches`) when migration 0040 is applied, else the monthly volumes this job stored in earlier
 * months (one point per month the job ran, so it grows from one point). `trendSource` says which.
 * Volume is Google Ads monthly average searches for the plain trade word in that city. Google reports city level only; a ZIP returns nothing.
 * A null volume means Google had no data (not zero). No person, address or business is read or returned.
 */

export interface StoredVolumeRow {
  keyword: string;
  location_code: number;
  month: string;
  volume: number | null;
  monthly_searches?: unknown;
}

export interface TrendPoint {
  /** YYYY-MM */
  month: string;
  searches: number | null;
}

export interface CityVolume {
  city: string;
  state: string;
  metro: string;
  core: boolean;
  /** Monthly searches in the newest month stored; null when Google had no data. */
  monthlySearches: number | null;
  /** The month the job stored it (YYYY-MM-01). */
  fetchedMonth: string;
  trend: TrendPoint[];
  trendSource: 'google_12_months' | 'stored_months';
  /** Mean of the trend points that have a number, rounded; null with none. */
  trendAverage: number | null;
}

export interface TradeVolume {
  trade: string;
  label: string;
  term: string;
  /** Top cities by monthlySearches, biggest first (cities with no data are left out). */
  cities: CityVolume[];
  citiesWithData: number;
  citiesAsked: number;
}

export interface KeywordVolumeReport {
  generatedAt: string;
  /** Newest month with any stored row, or null before the first run. */
  latestMonth: string | null;
  rowsRead: number;
  limit: number;
  trades: TradeVolume[];
  notes: string[];
}

const NOTES = [
  'Monthly searches are Google Ads averages for the plain trade word with the city as the location. Google gives city level only; a ZIP returns nothing.',
  'A city missing from a trade had no Google data that month. That is not the same as zero.',
  'Volume is a planning signal for where to market or expand, not a count of customers.',
];

const ym = (m: string) => m.slice(0, 7);

function trendFor(history: StoredVolumeRow[], newest: StoredVolumeRow): Pick<CityVolume, 'trend' | 'trendSource' | 'trendAverage'> {
  const google: MonthlySearch[] | null = cleanMonthly(newest.monthly_searches);
  let trend: TrendPoint[];
  let trendSource: CityVolume['trendSource'];
  if (google && google.length >= 2) {
    trend = google.map((g) => ({ month: `${g.year}-${String(g.month).padStart(2, '0')}`, searches: g.search_volume }));
    trendSource = 'google_12_months';
  } else {
    trend = [...history].sort((a, b) => a.month.localeCompare(b.month)).slice(-12).map((r) => ({ month: ym(r.month), searches: r.volume }));
    trendSource = 'stored_months';
  }
  const nums = trend.map((t) => t.searches).filter((n): n is number => typeof n === 'number');
  return { trend, trendSource, trendAverage: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null };
}

/** Group stored rows into the per-trade report. Rows that are not location mode rows, or name a place or trade not in the plan, are ignored. */
export function buildKeywordVolumeReport(rows: readonly StoredVolumeRow[], now: Date, opts: { limit?: number; trade?: string; metro?: string; plan?: PlannedLocation[] } = {}): KeywordVolumeReport {
  const limit = Math.min(50, Math.max(1, Math.trunc(opts.limit ?? 10)));
  const plan = opts.plan ?? buildLocationPlan();
  const placeByLocation = new Map(plan.map((p) => [p.locationName.toLowerCase(), p]));
  const tradeByTerm = new Map(LOCATION_TRADES.map((t) => [t.term, t]));

  // trade id -> location name -> rows of that pair
  const grouped = new Map<string, Map<string, StoredVolumeRow[]>>();
  let latest: string | null = null;
  let used = 0;
  for (const r of rows) {
    if (r.location_code === LOCATION_CODE) continue;
    const parsed = parseStoredKeyword(r.keyword);
    if (!parsed) continue;
    const trade = tradeByTerm.get(parsed.term);
    const place = placeByLocation.get(parsed.location);
    if (!trade || !place) continue;
    if (opts.trade && trade.id !== opts.trade) continue;
    if (opts.metro && place.metro !== opts.metro) continue;
    used++;
    if (!latest || r.month > latest) latest = r.month;
    const byLoc = grouped.get(trade.id) ?? new Map<string, StoredVolumeRow[]>();
    const list = byLoc.get(place.locationName.toLowerCase()) ?? [];
    list.push(r);
    byLoc.set(place.locationName.toLowerCase(), list);
    grouped.set(trade.id, byLoc);
  }

  const trades: TradeVolume[] = [];
  for (const t of LOCATION_TRADES) {
    if (opts.trade && t.id !== opts.trade) continue;
    const byLoc = grouped.get(t.id) ?? new Map<string, StoredVolumeRow[]>();
    const cities: CityVolume[] = [];
    for (const [loc, history] of byLoc) {
      const place = placeByLocation.get(loc);
      if (!place) continue;
      const newest = [...history].sort((a, b) => b.month.localeCompare(a.month))[0];
      if (newest.volume === null) continue;
      cities.push({ city: place.city, state: place.state, metro: place.metro, core: place.core, monthlySearches: newest.volume, fetchedMonth: newest.month, ...trendFor(history, newest) });
    }
    cities.sort((a, b) => (b.monthlySearches ?? 0) - (a.monthlySearches ?? 0) || a.city.localeCompare(b.city));
    trades.push({ trade: t.id, label: t.label, term: t.term, cities: cities.slice(0, limit), citiesWithData: cities.length, citiesAsked: byLoc.size });
  }
  return { generatedAt: now.toISOString(), latestMonth: latest, rowsRead: used, limit, trades, notes: NOTES };
}

/** Read every location mode row (paged) and build the report. Retries without monthly_searches when migration 0040 is not applied. Throws on a read error. */
export async function loadKeywordVolumeReport(db: Db, now: Date, opts: { limit?: number; trade?: string; metro?: string } = {}): Promise<KeywordVolumeReport> {
  const read = async (cols: string): Promise<StoredVolumeRow[]> => {
    const out: StoredVolumeRow[] = [];
    for (let page = 0; page < 20; page++) {
      const { data, error } = await db
        .from('holler_keyword_volume')
        .select(cols)
        .neq('location_code', LOCATION_CODE)
        .order('month', { ascending: false })
        .order('keyword', { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) {
        const e = new Error(error.message) as Error & { missingColumn?: boolean };
        e.missingColumn = isMissingColumn(error);
        throw e;
      }
      const got = (data ?? []) as unknown as StoredVolumeRow[];
      out.push(...got);
      if (got.length < 1000) break;
    }
    return out;
  };
  let rows: StoredVolumeRow[];
  try {
    rows = await read('keyword, location_code, month, volume, monthly_searches');
  } catch (e) {
    if (!(e as { missingColumn?: boolean }).missingColumn) throw e;
    rows = await read('keyword, location_code, month, volume');
  }
  return buildKeywordVolumeReport(rows, now, opts);
}
