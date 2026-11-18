import { CITIES, type City } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';
import { PRICE_TABLE, credentials, dfsCall, estimateUsd, getDb, monthKey, type Db, type DfsDeps } from './client';

/**
 * Monthly Google search volume for "<trade> <city>" keywords, stored in holler_keyword_volume.
 *
 * Endpoint: POST /v3/keywords_data/google_ads/search_volume/live
 *   https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
 *   Body field `keywords` (up to 1000, 80 characters and 10 words each, lowercased by the API), `location_code`, `language_code`.
 *   Response: tasks[0].result[] with `keyword` and `search_volume` (null when there is no data), top level and task `cost`.
 * Live, not Standard: Standard (task_post then task_get) is cheaper per task, but the difference at 1000 keywords a task is
 * $0.025, about $1 a month for the whole plan, and Standard needs a second phase and stored task ids across runs. Live is one
 * call and fits a 60 second route. Rate limit: 12 Live requests a minute per account, so calls are spaced 5.1 s apart.
 * Location 2840 (United States): the city is part of the keyword text, so the search is national.
 * Unverified: whether Google Ads rejects keywords with punctuation. Keywords are reduced to a-z, 0-9 and single spaces.
 */

export const LOCATION_CODE = 2840;
export const LANGUAGE_CODE = 'en';
export const BATCH_SIZE = 1000;
/** 12 requests a minute on the Google Ads Live endpoints. */
export const CALL_SPACING_MS = 5100;
/** Do not start a call with less than this much of the run budget left. */
export const MIN_CALL_BUDGET_MS = 8000;

/** What people type for each trade. The city is appended. Ids come from CATEGORIES, the repo's one trade list. */
export const SEARCH_TERM: Record<string, string> = {
  roofing: 'roofing',
  hvac: 'hvac',
  plumbing: 'plumber',
  electrical: 'electrician',
  'tree-service': 'tree service',
  landscaping: 'landscaping',
  'lawn-care': 'lawn care',
  'snow-removal': 'snow removal',
  'pest-control': 'pest control',
  cleaning: 'house cleaning',
  restoration: 'water damage restoration',
  'general-contractor': 'general contractor',
  painting: 'painters',
  'pool-spa': 'pool service',
  solar: 'solar installers',
  'auto-glass': 'auto glass repair',
  'auto-body': 'auto body shop',
  towing: 'towing',
  'auto-repair': 'auto repair',
  moving: 'movers',
  'junk-removal': 'junk removal',
  locksmith: 'locksmith',
  'real-estate': 'real estate agent',
  insurance: 'insurance agent',
  'food-truck': 'food truck',
  catering: 'catering',
  'event-services': 'event planner',
  'rideshare-delivery': 'delivery driver',
  childcare: 'daycare',
  beauty: 'hair salon',
  'janitorial-commercial': 'commercial cleaning',
  security: 'security company',
  fencing: 'fence company',
  'concrete-paving': 'concrete contractor',
  'windows-doors': 'window replacement',
  'siding-gutters': 'gutter installation',
  flooring: 'flooring',
  handyman: 'handyman',
  'signs-printing': 'sign company',
  'business-services': 'bookkeeping',
  'public-adjuster': 'public adjuster',
};

export function searchTerm(tradeId: string): string {
  return SEARCH_TERM[tradeId] ?? tradeId.replace(/[-_]+/g, ' ');
}

/** Lowercase, accents removed, only a-z, 0-9 and single spaces. */
export function normalizeKeyword(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PlannedCity {
  slug: string;
  keywords: { keyword: string; tradeId: string }[];
}

/**
 * Stable plan: cities by population (biggest first, slug breaks ties), trades in CATEGORIES order inside each city.
 * A city name shared with another city in the list gets its state code appended so two places never share a keyword.
 * Keywords over 80 characters or 10 words are dropped; a keyword already used is not listed twice.
 */
export function buildKeywordPlan(cities: readonly City[] = CITIES, tradeIds: readonly string[] = CATEGORIES.map((c) => c.id)): PlannedCity[] {
  const nameCount = new Map<string, number>();
  for (const c of cities) {
    const n = normalizeKeyword(c.name);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const ordered = [...cities].sort((a, b) => b.population - a.population || a.slug.localeCompare(b.slug));
  const seen = new Set<string>();
  const plan: PlannedCity[] = [];
  for (const c of ordered) {
    const n = normalizeKeyword(c.name);
    if (!n) continue;
    const place = (nameCount.get(n) ?? 0) > 1 ? `${n} ${c.state.toLowerCase()}` : n;
    const keywords: PlannedCity['keywords'] = [];
    for (const t of tradeIds) {
      const keyword = `${searchTerm(t)} ${place}`;
      if (keyword.length > 80 || keyword.split(' ').length > 10 || seen.has(keyword)) continue;
      seen.add(keyword);
      keywords.push({ keyword, tradeId: t });
    }
    if (keywords.length) plan.push({ slug: c.slug, keywords });
  }
  return plan;
}

/** Whole cities per batch, never more than `size` keywords. Cities whose keywords are all in `done` are skipped. Order is the plan order. */
export function planBatches(plan: PlannedCity[], done: ReadonlySet<string>, size = BATCH_SIZE): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [];
  for (const city of plan) {
    const todo = city.keywords.map((k) => k.keyword).filter((k) => !done.has(k));
    if (!todo.length) continue;
    if (cur.length && cur.length + todo.length > size) {
      batches.push(cur);
      cur = [];
    }
    // A single city is far below the size; the slice only guards a pathological trade list.
    for (let i = 0; i < todo.length; i += size) {
      const part = todo.slice(i, i + size);
      if (cur.length && cur.length + part.length > size) {
        batches.push(cur);
        cur = [];
      }
      cur.push(...part);
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Keywords already stored for a month. Throws on a read error. */
export async function loadDoneKeywords(db: Db, month: string): Promise<Set<string>> {
  const done = new Set<string>();
  for (let page = 0; page < 80; page++) {
    const { data, error } = await db
      .from('holler_keyword_volume')
      .select('keyword')
      .eq('month', month)
      .eq('location_code', LOCATION_CODE)
      .order('keyword', { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { keyword: string }[];
    for (const r of rows) done.add(r.keyword);
    if (rows.length < 1000) break;
  }
  return done;
}

export type VolumeStatus = 'not_configured' | 'db_unavailable' | 'complete' | 'cap_reached' | 'time_budget' | 'error';

export interface VolumeRun {
  status: VolumeStatus;
  month: string;
  keywordsPlanned: number;
  keywordsDone: number;
  keywordsRemaining: number;
  batchesRun: number;
  spentUsd: number;
  detail?: string;
}

export interface VolumeOptions {
  deps?: DfsDeps;
  /** Milliseconds this run may use. Default 45000. */
  budgetMs?: number;
  /** Test hook: a smaller plan. */
  plan?: PlannedCity[];
  clock?: () => number;
}

interface VolumeItem {
  keyword?: unknown;
  search_volume?: unknown;
}

/**
 * Fetch and store this month's volumes for every planned keyword not yet stored, in plan order, as many batches as the time budget
 * and the spend cap allow. Re-running resumes: a keyword already stored for the month is never requested again.
 */
export async function refreshVolumes(opts: VolumeOptions = {}): Promise<VolumeRun> {
  const deps = opts.deps ?? {};
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  const month = monthKey(now);
  const clock = opts.clock ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const plan = opts.plan ?? buildKeywordPlan();
  const planned = plan.reduce((n, c) => n + c.keywords.length, 0);
  const base: VolumeRun = { status: 'complete', month, keywordsPlanned: planned, keywordsDone: 0, keywordsRemaining: planned, batchesRun: 0, spentUsd: 0 };

  if (!credentials(env)) return { ...base, status: 'not_configured' };
  const db = await getDb(deps);
  if (!db) return { ...base, status: 'db_unavailable' };

  let done: Set<string>;
  try {
    done = await loadDoneKeywords(db, month);
  } catch (e) {
    return { ...base, status: 'db_unavailable', detail: e instanceof Error ? e.message : String(e) };
  }
  const inPlan = new Set(plan.flatMap((c) => c.keywords.map((k) => k.keyword)));
  const doneInPlan = [...done].filter((k) => inPlan.has(k)).length;
  const batches = planBatches(plan, done);
  const run: VolumeRun = { ...base, keywordsDone: doneInPlan, keywordsRemaining: planned - doneInPlan };
  if (!batches.length) return run;

  const started = clock();
  const budget = opts.budgetMs ?? 45_000;
  let lastCall: number | null = null;
  for (const batch of batches) {
    const sinceLast = lastCall !== null ? clock() - lastCall : CALL_SPACING_MS;
    const wait = Math.max(0, CALL_SPACING_MS - sinceLast);
    if (budget - (clock() - started) - wait < MIN_CALL_BUDGET_MS) return { ...run, status: 'time_budget' };
    if (wait) await sleep(wait);
    lastCall = clock();

    const res = await dfsCall(
      PRICE_TABLE.searchVolumeLive.path,
      { keywords: batch, location_code: LOCATION_CODE, language_code: LANGUAGE_CODE },
      { kind: 'searchVolumeLive', items: batch.length },
      { ...deps, db, timeoutMs: Math.min(deps.timeoutMs ?? 30_000, Math.max(5000, budget - (clock() - started) - 2000)) },
    );
    if (!res.ok) {
      if (res.reason === 'cap_reached') return { ...run, status: 'cap_reached', detail: `cap ${res.capUsd} reached at ${res.spentUsd}` };
      if (res.reason === 'not_configured') return { ...run, status: 'not_configured' };
      return { ...run, status: 'error', detail: `${res.reason}${res.detail ? ': ' + res.detail : ''}` };
    }
    // A task with no result array tells us nothing: store nothing, so the batch is asked again next run.
    const result = (res.task as { result?: unknown }).result;
    if (!Array.isArray(result)) return { ...run, status: 'error', detail: 'bad_shape: no result array' };
    const byKeyword = new Map<string, number | null>();
    for (const it of result as VolumeItem[]) {
      if (!it || typeof it.keyword !== 'string') continue;
      const v = it.search_volume;
      byKeyword.set(it.keyword.toLowerCase(), typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null);
    }
    const fetchedAt = now.toISOString();
    const rows = batch.map((keyword) => ({ keyword, location_code: LOCATION_CODE, month, volume: byKeyword.get(keyword) ?? null, fetched_at: fetchedAt }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('holler_keyword_volume').upsert(rows.slice(i, i + 500), { onConflict: 'keyword,location_code,month' });
      if (error) return { ...run, status: 'error', detail: `store failed: ${error.message}` };
    }
    for (const k of batch) done.add(k);
    run.batchesRun += 1;
    run.spentUsd = Math.round((run.spentUsd + res.cost) * 100_000) / 100_000;
    run.keywordsDone += batch.length;
    run.keywordsRemaining -= batch.length;
  }
  return run;
}

/** Expected cost of a full month at the default settings: one Live task per batch of whole cities. */
export function expectedVolumeCostUsd(plan: PlannedCity[] = buildKeywordPlan()): { keywords: number; tasks: number; usd: number } {
  const batches = planBatches(plan, new Set());
  return { keywords: plan.reduce((n, c) => n + c.keywords.length, 0), tasks: batches.length, usd: Math.round(batches.length * estimateUsd('searchVolumeLive') * 1000) / 1000 };
}
