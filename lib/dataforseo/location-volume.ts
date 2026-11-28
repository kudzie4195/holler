import { CATEGORIES } from '@/lib/signals/categories';
import { PRICE_TABLE, credentials, dfsCall, estimateUsd, getDb, monthKey, type Db, type DfsDeps } from './client';
import { CALL_SPACING_MS, LANGUAGE_CODE, LOCATION_CODE, MIN_CALL_BUDGET_MS, normalizeKeyword } from './volume';

/**
 * Round 35: location-targeted monthly search volume for a small set of suburbs, stored in holler_keyword_volume.
 *
 * Owner direction: search volume is small but interesting for someone deciding where to expand or market, and Google only gives city level
 * volume (a ZIP returns nothing). So this mode asks the opposite question to volume.ts: plain trade words ("lawn care") with the CITY as the
 * location, not in the keyword text. One Live request per city carries every trade word for it.
 *
 * Endpoint: POST /v3/keywords_data/google_ads/search_volume/live, the same one volume.ts documents:
 *   https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
 *   `location_name` is "City,State,United States" (a name from the DataForSEO location list; `location_code` may be sent instead).
 *   Result items: `keyword`, `search_volume`, and `monthly_searches` ([{ year, month, search_volume }], the last 12 months).
 * Price: 0.075 USD a task whatever the keyword count (PRICE_TABLE.searchVolumeLive), so a city costs the same with 4 words or 400.
 * Unverified (the docs were not read this round: web access was off): that every name below exists in the location list, that result items
 * echo `location_code`, and that `monthly_searches` is always present. The code does not depend on them: an unknown location answers a
 * task error 40501 and that city is marked empty for the month (free, no retry); a missing `monthly_searches` just stores no trend; a
 * missing `location_code` is stored as 0.
 *
 * Storage without a new column (holler_keyword_volume today has keyword, location_code, month, volume, fetched_at, primary key over the
 * first three): the stored keyword is "<plain trade word> @ <location name lowercased>", for example
 * "lawn care @ marietta,georgia,united states". The "@" can never appear in a national keyword (normalizeKeyword keeps a-z, 0-9 and spaces),
 * and location_code is never 2840 here, so priority.ts and the national refresh, which read location_code 2840 only, never see these rows.
 * Migration 0040 (optional) adds location_name and monthly_searches; the code writes them when they exist and drops them when they do not.
 */

/** The trades Holler is marketed for (lib/seo/public-copy.ts, round 23): landscaping, lawn care, gutter and pressure washing crews. */
export interface LocationTrade {
  /** Stable id used in the owner report. */
  id: string;
  /** The category the trade sits in (lib/signals/categories.ts); pressure washing sits in house cleaning today. */
  categoryId: string;
  label: string;
  /** What people type. Plain words, lowercase, no city. */
  term: string;
}

export const LOCATION_TRADES: readonly LocationTrade[] = [
  { id: 'landscaping', categoryId: 'landscaping', label: 'Landscaping', term: 'landscaping' },
  { id: 'lawn-care', categoryId: 'lawn-care', label: 'Lawn care', term: 'lawn care' },
  { id: 'gutters', categoryId: 'siding-gutters', label: 'Gutters', term: 'gutter installation' },
  { id: 'pressure-washing', categoryId: 'cleaning', label: 'Pressure washing', term: 'pressure washing' },
];

export interface LocationPlace {
  /** City name exactly as the DataForSEO location list spells it. */
  name: string;
  /** The metro's core city (included so a suburb can be compared with it). */
  core?: boolean;
}

export interface LocationMetro {
  id: string;
  label: string;
  state: string;
  stateName: string;
  places: readonly LocationPlace[];
}

/**
 * The four launch metros (Atlanta, Austin, Charlotte, Raleigh) with the core city and nine suburbs each: 10 requests a metro, 40 a month.
 * Suburbs are towns of 20,000 and up that sit inside the metro and have their own Google Ads city location. Edit here to change the set;
 * the cost is places x 0.075 USD.
 */
export const LOCATION_METROS: readonly LocationMetro[] = [
  {
    id: 'atlanta',
    label: 'Atlanta',
    state: 'GA',
    stateName: 'Georgia',
    places: [{ name: 'Atlanta', core: true }, { name: 'Marietta' }, { name: 'Roswell' }, { name: 'Alpharetta' }, { name: 'Johns Creek' }, { name: 'Sandy Springs' }, { name: 'Smyrna' }, { name: 'Kennesaw' }, { name: 'Woodstock' }, { name: 'Duluth' }],
  },
  {
    id: 'austin',
    label: 'Austin',
    state: 'TX',
    stateName: 'Texas',
    places: [{ name: 'Austin', core: true }, { name: 'Round Rock' }, { name: 'Cedar Park' }, { name: 'Georgetown' }, { name: 'Pflugerville' }, { name: 'San Marcos' }, { name: 'Leander' }, { name: 'Kyle' }, { name: 'Buda' }, { name: 'Lakeway' }],
  },
  {
    id: 'charlotte',
    label: 'Charlotte',
    state: 'NC',
    stateName: 'North Carolina',
    places: [{ name: 'Charlotte', core: true }, { name: 'Concord' }, { name: 'Huntersville' }, { name: 'Matthews' }, { name: 'Mint Hill' }, { name: 'Gastonia' }, { name: 'Cornelius' }, { name: 'Mooresville' }, { name: 'Indian Trail' }, { name: 'Waxhaw' }],
  },
  {
    id: 'raleigh',
    label: 'Raleigh',
    state: 'NC',
    stateName: 'North Carolina',
    places: [{ name: 'Raleigh', core: true }, { name: 'Cary' }, { name: 'Durham' }, { name: 'Apex' }, { name: 'Wake Forest' }, { name: 'Holly Springs' }, { name: 'Garner' }, { name: 'Fuquay-Varina' }, { name: 'Morrisville' }, { name: 'Chapel Hill' }],
  },
];

export const LOCATION_NAME_SEP = ' @ ';

export interface PlannedLocation {
  metro: string;
  metroLabel: string;
  city: string;
  state: string;
  core: boolean;
  /** The request's location_name. */
  locationName: string;
  /** Plain trade words sent as `keywords`. */
  keywords: string[];
  /** The keyword text stored for each word, same order. */
  storedKeywords: string[];
}

export function locationNameFor(city: string, stateName: string): string {
  return `${city},${stateName},United States`;
}

export function storedKeywordFor(term: string, locationName: string): string {
  return `${normalizeKeyword(term)}${LOCATION_NAME_SEP}${locationName.toLowerCase()}`;
}

/** Split a stored keyword back into the trade word and the lowercased location name. Null for a national keyword or anything else. */
export function parseStoredKeyword(stored: string): { term: string; location: string } | null {
  const i = stored.indexOf(LOCATION_NAME_SEP);
  if (i <= 0) return null;
  const term = stored.slice(0, i);
  const location = stored.slice(i + LOCATION_NAME_SEP.length);
  return term && location ? { term, location } : null;
}

/** Stable plan: metros in list order, core city first. Every trade word for a city is one request. */
export function buildLocationPlan(metros: readonly LocationMetro[] = LOCATION_METROS, trades: readonly LocationTrade[] = LOCATION_TRADES): PlannedLocation[] {
  const out: PlannedLocation[] = [];
  const seen = new Set<string>();
  for (const m of metros) {
    for (const p of m.places) {
      const locationName = locationNameFor(p.name, m.stateName);
      if (seen.has(locationName)) continue;
      seen.add(locationName);
      const keywords = trades.map((t) => normalizeKeyword(t.term));
      out.push({
        metro: m.id,
        metroLabel: m.label,
        city: p.name,
        state: m.state,
        core: p.core === true,
        locationName,
        keywords,
        storedKeywords: trades.map((t) => storedKeywordFor(t.term, locationName)),
      });
    }
  }
  return out;
}

/** Expected cost of a full month: one Live task per city. */
export function expectedLocationCostUsd(plan: PlannedLocation[] = buildLocationPlan()): { cities: number; keywords: number; tasks: number; usd: number } {
  return {
    cities: plan.length,
    keywords: plan.reduce((n, c) => n + c.keywords.length, 0),
    tasks: plan.length,
    usd: Math.round(plan.length * estimateUsd('searchVolumeLive') * 1000) / 1000,
  };
}

/** The category labels exist: guards the trade list against a renamed category id. */
export function tradesMatchCategories(trades: readonly LocationTrade[] = LOCATION_TRADES): boolean {
  const ids = new Set(CATEGORIES.map((c) => c.id as string));
  return trades.every((t) => ids.has(t.categoryId));
}

/** Stored keywords of this mode already in the table for a month. Throws on a read error. */
export async function loadDoneLocationKeywords(db: Db, month: string): Promise<Set<string>> {
  const done = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db
      .from('holler_keyword_volume')
      .select('keyword')
      .eq('month', month)
      .neq('location_code', LOCATION_CODE)
      .order('keyword', { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { keyword: string }[];
    for (const r of rows) if (parseStoredKeyword(r.keyword)) done.add(r.keyword);
    if (rows.length < 1000) break;
  }
  return done;
}

export type LocationStatus = 'not_configured' | 'db_unavailable' | 'complete' | 'cap_reached' | 'time_budget' | 'error';

export interface LocationRun {
  status: LocationStatus;
  month: string;
  citiesPlanned: number;
  citiesDone: number;
  citiesRemaining: number;
  requests: number;
  spentUsd: number;
  /** Cities Google had no location for this month (task error 40501): stored as empty, not asked again until next month. */
  unknownLocations: string[];
  /** True when migration 0040 columns were written. */
  extraColumns: boolean;
  detail?: string;
}

export interface LocationOptions {
  deps?: DfsDeps;
  budgetMs?: number;
  plan?: PlannedLocation[];
  trades?: readonly LocationTrade[];
  clock?: () => number;
}

interface VolumeItem {
  keyword?: unknown;
  search_volume?: unknown;
  location_code?: unknown;
  monthly_searches?: unknown;
}

export interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number | null;
}

/** Up to 12 valid { year, month, search_volume } entries, oldest first. Null when there is nothing usable. */
export function cleanMonthly(v: unknown): MonthlySearch[] | null {
  if (!Array.isArray(v)) return null;
  const out: MonthlySearch[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') continue;
    const { year, month, search_volume: sv } = e as { year?: unknown; month?: unknown; search_volume?: unknown };
    if (typeof year !== 'number' || typeof month !== 'number' || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    out.push({ year, month, search_volume: typeof sv === 'number' && Number.isFinite(sv) && sv >= 0 ? Math.trunc(sv) : null });
  }
  if (!out.length) return null;
  out.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  return out.slice(-12);
}

/** PostgREST (PGRST204) or Postgres (42703) says a column does not exist. */
export function isMissingColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST204' || error.code === '42703' || /column .*(does not exist|schema cache)|could not find the .* column/i.test(error.message ?? '');
}

type StoredRow = {
  keyword: string;
  location_code: number;
  month: string;
  volume: number | null;
  fetched_at: string;
  location_name?: string;
  monthly_searches?: MonthlySearch[] | null;
};

/** Upsert with the 0040 columns; if the database does not have them yet, again without. Returns whether the extras were written. */
async function storeRows(db: Db, rows: StoredRow[]): Promise<{ ok: true; extras: boolean } | { ok: false; message: string }> {
  const first = await db.from('holler_keyword_volume').upsert(rows, { onConflict: 'keyword,location_code,month' });
  if (!first.error) return { ok: true, extras: true };
  if (!isMissingColumn(first.error)) return { ok: false, message: first.error.message };
  const plain = rows.map((r) => ({ keyword: r.keyword, location_code: r.location_code, month: r.month, volume: r.volume, fetched_at: r.fetched_at }));
  const second = await db.from('holler_keyword_volume').upsert(plain, { onConflict: 'keyword,location_code,month' });
  return second.error ? { ok: false, message: second.error.message } : { ok: true, extras: false };
}

/**
 * Fetch and store this month's volumes for each planned city not yet stored: one Live request per city, in plan order, as many as the time
 * budget and the monthly spend cap allow. Re-running resumes. The cap is the same one every DataForSEO call counts against.
 */
export async function refreshLocationVolumes(opts: LocationOptions = {}): Promise<LocationRun> {
  const deps = opts.deps ?? {};
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  const month = monthKey(now);
  const clock = opts.clock ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const plan = opts.plan ?? buildLocationPlan(LOCATION_METROS, opts.trades ?? LOCATION_TRADES);
  const base: LocationRun = { status: 'complete', month, citiesPlanned: plan.length, citiesDone: 0, citiesRemaining: plan.length, requests: 0, spentUsd: 0, unknownLocations: [], extraColumns: false };

  if (!credentials(env)) return { ...base, status: 'not_configured' };
  const db = await getDb(deps);
  if (!db) return { ...base, status: 'db_unavailable' };

  let done: Set<string>;
  try {
    done = await loadDoneLocationKeywords(db, month);
  } catch (e) {
    return { ...base, status: 'db_unavailable', detail: e instanceof Error ? e.message : String(e) };
  }
  const isDone = (c: PlannedLocation) => c.storedKeywords.every((k) => done.has(k));
  const run: LocationRun = { ...base, citiesDone: plan.filter(isDone).length };
  run.citiesRemaining = plan.length - run.citiesDone;

  const started = clock();
  const budget = opts.budgetMs ?? 45_000;
  let lastCall: number | null = null;
  for (const city of plan) {
    if (isDone(city)) continue;
    const sinceLast = lastCall !== null ? clock() - lastCall : CALL_SPACING_MS;
    const wait = Math.max(0, CALL_SPACING_MS - sinceLast);
    if (budget - (clock() - started) - wait < MIN_CALL_BUDGET_MS) return { ...run, status: 'time_budget' };
    if (wait) await sleep(wait);
    lastCall = clock();

    const res = await dfsCall(
      PRICE_TABLE.searchVolumeLive.path,
      { keywords: city.keywords, location_name: city.locationName, language_code: LANGUAGE_CODE },
      { kind: 'searchVolumeLive', items: city.keywords.length },
      { ...deps, db, timeoutMs: Math.min(deps.timeoutMs ?? 30_000, Math.max(5000, budget - (clock() - started) - 2000)) },
    );
    const fetchedAt = now.toISOString();
    const rowsFor = (vol: (kw: string) => { volume: number | null; code: number; monthly: MonthlySearch[] | null }): StoredRow[] =>
      city.keywords.map((kw, i) => {
        const v = vol(kw);
        return { keyword: city.storedKeywords[i], location_code: v.code, month, volume: v.volume, fetched_at: fetchedAt, location_name: city.locationName, monthly_searches: v.monthly };
      });

    if (!res.ok) {
      if (res.reason === 'cap_reached') return { ...run, status: 'cap_reached', detail: `cap ${res.capUsd} reached at ${res.spentUsd}` };
      if (res.reason === 'not_configured') return { ...run, status: 'not_configured' };
      // Google has no such location: mark the city empty for the month and go on. Any other failure stops the run (and is asked again next time).
      if (res.reason === 'api_error' && /^40501\b/.test(res.detail ?? '') && /location/i.test(res.detail ?? '')) {
        const stored = await storeRows(db, rowsFor(() => ({ volume: null, code: 0, monthly: null })));
        if (!stored.ok) return { ...run, status: 'error', detail: `store failed: ${stored.message}` };
        for (const k of city.storedKeywords) done.add(k);
        run.unknownLocations.push(city.locationName);
        run.citiesDone += 1;
        run.citiesRemaining -= 1;
        continue;
      }
      return { ...run, status: 'error', detail: `${res.reason}${res.detail ? ': ' + res.detail : ''}` };
    }
    const result = (res.task as { result?: unknown }).result;
    if (!Array.isArray(result)) return { ...run, status: 'error', detail: 'bad_shape: no result array' };
    const byKeyword = new Map<string, VolumeItem>();
    for (const it of result as VolumeItem[]) {
      if (!it || typeof it.keyword !== 'string') continue;
      byKeyword.set(it.keyword.toLowerCase(), it);
    }
    const stored = await storeRows(
      db,
      rowsFor((kw) => {
        const it = byKeyword.get(kw);
        const v = it?.search_volume;
        const code = it?.location_code;
        return {
          volume: typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null,
          code: typeof code === 'number' && Number.isInteger(code) && code > 0 && code !== LOCATION_CODE ? code : 0,
          monthly: cleanMonthly(it?.monthly_searches),
        };
      }),
    );
    if (!stored.ok) return { ...run, status: 'error', detail: `store failed: ${stored.message}` };
    run.extraColumns = stored.extras;
    for (const k of city.storedKeywords) done.add(k);
    run.requests += 1;
    run.spentUsd = Math.round((run.spentUsd + res.cost) * 100_000) / 100_000;
    run.citiesDone += 1;
    run.citiesRemaining -= 1;
  }
  return run;
}
