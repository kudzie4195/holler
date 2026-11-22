import { CATEGORIES, classifyText, type CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { CITIES, type City } from '@/lib/geo';
import { env } from '@/lib/env';

/**
 * Licensed web-search adapters for public "anyone recommend a ___ in ___" asks.
 *
 * Brave Search API (confirmed 2026-11-17 from api-dashboard.search.brave.com/app/documentation/web-search/get-started and
 * .../api-reference/web/search/get):
 *   GET https://api.search.brave.com/res/v1/web/search?q=&count=(max 20, default 20)&freshness=pd|pw|pm|py|YYYY-MM-DDtoYYYY-MM-DD&country=US&search_lang=en
 *   header X-Subscription-Token; response web.results[] {type:"search_result", title, url, description (string|null), page_age (string|null, the
 *   page's published or modified date), age (string|null, human readable such as "2 days ago")}, query.more_results_available.
 *   Errors 404/422/429 share {type:"ErrorResponse", error:{id,status,detail,meta,code(INTERNAL|QUOTA_LIMITED|RATE_LIMITED|...)},time}; 401 has no documented schema.
 *   The documented pages do not show a verbatim response, so web.results is confirmed by field table, not by a captured payload.
 *   A query with no web hits returns no `web` key (not documented, standard behaviour), so a missing key is only an error when every response lacks it.
 * Serper (confirmed 2026-11-17 by two independent sources: the OpenAPI listing at apis.io/apis/serper/serper-search-api and the Rust client
 *   docs.rs/crate/spider_agent/2.51.6/source/src/search/serper.rs; response keys also from the sample JSON on serper.dev):
 *   POST https://google.serper.dev/search, header X-API-KEY (+ Content-Type: application/json), body {q (required), gl (default us), hl (default en),
 *   num (1..100, default 10), page (>=1), tbs (qdr:h|d|w|m|y), autocorrect}; response organic[] {title, link, snippet, position, date?, sitelinks?, attributes?},
 *   plus searchParameters, knowledgeGraph, answerBox, peopleAlsoAsk, relatedSearches. Errors 400, 401, 429 (rate limit or credits exhausted) with {message}.
 *   `tbs: 'qdr:w'` is therefore valid (the primary serper.dev docs page itself is a JS app and could not be read).
 *
 * Two adapters, one per key, because Adapter.requiresEnv is "all of". The Serper adapter steps aside when a Brave key
 * is set so we never pay for both. With neither key the engine reports skipped(env) for each.
 * Only title, snippet and URL are stored. Nothing is scraped; we never fetch the result pages.
 * Brave's entry plan allows about 1 request per second, so the Brave adapter runs its queries one at a time, about 1.1 s apart, and
 * caps a run at 20 queries. Worst case it stops starting queries after BRAVE_START_DEADLINE_MS (24 s) and each request times out
 * after 8 s, so the whole adapter ends inside the engine's 40 s per-adapter timeout (DEFAULT_ADAPTER_TIMEOUT_MS in run.ts) with a margin.
 * Serper has no such limit and keeps its parallel batches of 4.
 */

const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';
export const QUERY_BUDGET = 40;
export const TOP_CITY_COUNT = 25;
const RUN_DEADLINE_MS = 35_000;
/** Brave pacing. Mutable only so tests can turn the delay off; production values are the defaults. */
export const BRAVE_QUERY_CAP = 20;
export const braveTuning = { spacingMs: 1100, startDeadlineMs: 24_000, requestTimeoutMs: 8000 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Request-pattern filter ---------------------------------------------------------------------

const ASK_PATTERNS: RegExp[] = [
  /\b(anyone|anybody|someone|any one|does anyone|can anyone|could anyone|do y'?all|do you guys)\b[^.?!]{0,40}\b(recommend|know of|know a|know any|have a|got a|use|using|suggest)/i,
  /\b(please|pls|can you|could you|would you|can someone|any)\s+(recommend|suggest)/i,
  /\brecommendations?\s+(for|on|please|needed|wanted)\b/i,
  /\b(need|want|looking for|seeking)\b[^.?!]{0,25}\b(recommendations?|recs)\b/i,
  /\blooking for (a|an|some|the best|good|reliable|affordable|honest|recommendations)\b/i,
  /\b(i|we)(?:'m|'re| am| are)? (?:need|needs|want to hire|need to hire|need to find)\b/i,
  /\bneed (a|an|someone|to find|to hire)\b/i,
  /\bwho (do you|would you|should i|can i|did you|is a good|'s a good|do y'?all)\b/i,
];
const BEST_IN = /\bbest\s+[\w\s&-]{2,40}\s+(in|near|around)\s/i;

const PROMO =
  /(call (us|now|today)|free (quote|estimate|consultation)|we (offer|provide|specialize|are a)|our (team|services|company)|licensed (and|&) insured|book (now|online|today)|now hiring|\bhiring\b|\bjobs?\b|\bfor sale\b|\bdiscount\b|\bcoupon\b|visit our|contact us|\bour\b.*\bservices\b)/i;
const ANSWER = /\b(highly recommend|i recommend|we recommend|would recommend|can recommend|definitely recommend|always recommend|i use|we used)\b/i;
const LISTICLE = /\b(top\s*\d+|\d+\s+best|best\s+\d+|ranked|updated 20\d\d|reviews?)\b|\bin 20\d\d\b/i;

/** True when the text reads like a person asking for a recommendation, not an ad, answer or listicle. */
export function looksLikeRequest(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 12) return false;
  if (PROMO.test(t) || ANSWER.test(t)) return false;
  if (ASK_PATTERNS.some((re) => re.test(t))) return true;
  return BEST_IN.test(t) && t.includes('?') && !LISTICLE.test(t);
}

// --- Place resolution ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  'new york': 'new-york-city-ny',
  nyc: 'new-york-city-ny',
  'new york city': 'new-york-city-ny',
};
const BIG_CITY_POP = 250_000;
const STATE_CODES = new Set(CITIES.map((c) => c.state));

interface PlaceIndex {
  byName: Map<string, City[]>;
  re: RegExp;
  reWithState: RegExp;
}
let placeIndex: PlaceIndex | null = null;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPlaceIndex(): PlaceIndex {
  if (placeIndex) return placeIndex;
  const byName = new Map<string, City[]>();
  for (const c of CITIES) {
    const k = c.name.toLowerCase();
    const l = byName.get(k);
    if (l) l.push(c);
    else byName.set(k, [c]);
  }
  // Exact-case names for every city; lowercase spellings only for big cities ("in houston").
  const exact = new Set<string>(['NYC', 'New York']);
  const lower = new Set<string>(['nyc', 'new york']);
  for (const c of CITIES) {
    exact.add(c.name);
    if (c.population >= BIG_CITY_POP) lower.add(c.name.toLowerCase());
  }
  const alt = [...exact, ...lower].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  placeIndex = {
    byName,
    re: new RegExp(`\\b(?:[Ii]n|[Nn]ear|[Nn]earby|[Aa]round|[Oo]utside|[Ff]rom)\\s+(${alt})\\b(?:,?\\s+([A-Z]{2})\\b)?`, 'g'),
    reWithState: new RegExp(`\\b(${[...exact].sort((a, b) => b.length - a.length).map(escapeRe).join('|')}),\\s*([A-Z]{2})\\b`, 'g'),
  };
  return placeIndex;
}

function pick(idx: PlaceIndex, nameRaw: string, stRaw?: string): City | null {
  const key = nameRaw.toLowerCase();
  const aliasSlug = ALIASES[key];
  if (aliasSlug) return CITIES.find((c) => c.slug === aliasSlug) ?? null;
  const list = idx.byName.get(key);
  if (!list?.length) return null;
  const st = stRaw && STATE_CODES.has(stRaw) ? stRaw : undefined;
  if (st) return list.find((c) => c.state === st) ?? null; // explicit, valid state that does not match: reject
  return list[0] ?? null; // CITIES is population sorted: biggest wins for bare names
}

/**
 * Finds "in Atlanta", "near Marietta GA", "Austin, TX" in text. Needs a preposition or a ", ST" so words like
 * "Orange" or "Mesa" in ordinary prose do not resolve. Returns null when nothing resolves.
 */
export function resolveCityFromText(text: string): City | null {
  if (!text) return null;
  const idx = getPlaceIndex();
  for (const re of [idx.reWithState, idx.re]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const city = pick(idx, m[1], m[2]);
      if (city) return city;
    }
  }
  return null;
}

// --- Query plan ---------------------------------------------------------------------------------

/** The noun people actually type for each category. Verified in tests to classify back to its own category. */
export const ASK_TERMS: Record<CategoryId, string> = {
  roofing: 'roofer',
  hvac: 'hvac company',
  plumbing: 'plumber',
  electrical: 'electrician',
  'tree-service': 'tree removal service',
  landscaping: 'landscaper',
  'lawn-care': 'lawn care service',
  'snow-removal': 'snow removal service',
  'pest-control': 'exterminator',
  cleaning: 'house cleaner',
  restoration: 'water damage restoration company',
  'general-contractor': 'general contractor',
  painting: 'painter',
  'pool-spa': 'pool service',
  solar: 'solar installer',
  'auto-glass': 'windshield repair',
  'auto-body': 'auto body shop',
  towing: 'tow truck',
  'auto-repair': 'mechanic',
  moving: 'moving company',
  'junk-removal': 'junk removal service',
  locksmith: 'locksmith',
  'real-estate': 'real estate agent',
  insurance: 'insurance agent',
  'food-truck': 'food truck',
  catering: 'caterer',
  'event-services': 'event planner',
  'rideshare-delivery': 'delivery driver',
  childcare: 'babysitter',
  beauty: 'hair stylist',
  'janitorial-commercial': 'commercial cleaning company',
  security: 'security camera installer',
  fencing: 'fence company',
  'concrete-paving': 'concrete contractor',
  'windows-doors': 'window replacement company',
  'siding-gutters': 'gutter installer',
  flooring: 'flooring installer',
  handyman: 'handyman',
  'signs-printing': 'sign shop',
  'business-services': 'bookkeeper',
  'public-adjuster': 'public adjuster',
};

export interface PlannedQuery {
  q: string;
  category: CategoryId;
  city: City;
}

/** Every (category x top city) pair in a fixed order, cities varying fastest so a slice spreads across the country. */
export function allCombos(topCities: number = TOP_CITY_COUNT): { category: CategoryId; city: City }[] {
  const cities = CITIES.slice(0, topCities);
  const combos: { category: CategoryId; city: City }[] = [];
  for (const cat of CATEGORIES) for (const city of cities) combos.push({ category: cat.id, city });
  return combos;
}

/**
 * Deterministic rotation: slot = floor(now / cadence); each run takes the next `budget` combos, wrapping around.
 * Same run time always yields the same plan; consecutive runs never overlap until the whole list is covered.
 */
export function planQueries(now: Date, cadenceMinutes: number, budget: number = QUERY_BUDGET): PlannedQuery[] {
  const combos = allCombos();
  if (combos.length === 0) return [];
  const slot = Math.floor(now.getTime() / (cadenceMinutes * 60_000));
  const start = (slot * budget) % combos.length;
  const out: PlannedQuery[] = [];
  for (let i = 0; i < Math.min(budget, combos.length); i++) {
    const { category, city } = combos[(start + i) % combos.length];
    out.push({ q: `anyone recommend a ${ASK_TERMS[category]} in ${city.name} ${city.state}`, category, city });
  }
  return out;
}

// --- Parsing ------------------------------------------------------------------------------------

const BLOCKED_HOSTS =
  /(^|\.)(facebook\.com|fb\.com|linkedin\.com|nextdoor\.com|craigslist\.org|instagram\.com|yelp\.com|angi\.com|angieslist\.com|thumbtack\.com|homeadvisor\.com|yellowpages\.com|bbb\.org|mapquest\.com|porch\.com|expertise\.com|houzz\.com)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function clean(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  const t = text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  date?: string | null;
}

/** Turns normalized search hits into ask signals. Request filter, trade match and place resolution all must pass. */
export function hitsToSignals(
  hits: SearchHit[],
  opts: { source: string; queryCity?: City | null; queryCategory?: CategoryId | null; now?: Date },
): SignalInput[] {
  const now = opts.now ?? new Date();
  const out: SignalInput[] = [];
  for (const h of hits) {
    try {
      if (!h.url || !/^https?:\/\//i.test(h.url)) continue;
      if (BLOCKED_HOSTS.test(hostOf(h.url))) continue;
      const title = clean(h.title, 140);
      const snippet = clean(h.snippet, 280);
      const text = `${title}. ${snippet}`;
      if (!looksLikeRequest(text)) continue;
      const categories = classifyText(text);
      if (categories.length === 0) continue;
      let city = resolveCityFromText(text);
      if (!city && opts.queryCity && text.toLowerCase().includes(opts.queryCity.name.toLowerCase())) city = opts.queryCity;
      if (!city) continue;
      const when = h.date ? new Date(h.date) : null;
      out.push({
        source: opts.source,
        externalId: h.url,
        kind: 'ask',
        title: title || snippet.slice(0, 140),
        summary: snippet || null,
        url: h.url,
        lat: city.lat,
        lon: city.lon,
        city: city.name,
        state: city.state,
        categories,
        severity: 1,
        occurredAt: when && !Number.isNaN(when.getTime()) && when <= now ? when.toISOString() : now.toISOString(),
        data: { host: hostOf(h.url), approxLocation: true },
      });
    } catch {
      // skip malformed hit
    }
  }
  return out;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Brave: web.results[] {title,url,description,page_age|age}. */
export function parseBrave(raw: unknown, opts?: { queryCity?: City | null; now?: Date }): SignalInput[] {
  try {
    const results = isObj(raw) && isObj(raw.web) ? raw.web.results : null;
    if (!Array.isArray(results)) return [];
    const hits: SearchHit[] = [];
    for (const r of results) {
      if (!isObj(r)) continue;
      hits.push({
        title: typeof r.title === 'string' ? r.title : '',
        url: typeof r.url === 'string' ? r.url : '',
        snippet: typeof r.description === 'string' ? r.description : '',
        date: typeof r.page_age === 'string' ? r.page_age : null,
      });
    }
    return hitsToSignals(hits, { source: 'websearch-brave', queryCity: opts?.queryCity, now: opts?.now });
  } catch {
    return [];
  }
}

/** Serper: organic[] {title,link,snippet,date}. */
export function parseSerper(raw: unknown, opts?: { queryCity?: City | null; now?: Date }): SignalInput[] {
  try {
    const results = isObj(raw) ? raw.organic : null;
    if (!Array.isArray(results)) return [];
    const hits: SearchHit[] = [];
    for (const r of results) {
      if (!isObj(r)) continue;
      hits.push({
        title: typeof r.title === 'string' ? r.title : '',
        url: typeof r.link === 'string' ? r.link : '',
        snippet: typeof r.snippet === 'string' ? r.snippet : '',
        date: typeof r.date === 'string' ? r.date : null,
      });
    }
    return hitsToSignals(hits, { source: 'websearch-serper', queryCity: opts?.queryCity, now: opts?.now });
  } catch {
    return [];
  }
}

/** Structural counts for the silent-empty check: result rows that carry a title and a url, across one response. */
export function braveRowStats(raw: unknown): { rows: number; usable: number } | null {
  const results = isObj(raw) && isObj(raw.web) ? raw.web.results : null;
  if (!Array.isArray(results)) return null;
  let usable = 0;
  for (const r of results) if (isObj(r) && typeof r.title === 'string' && typeof r.url === 'string') usable++;
  return { rows: results.length, usable };
}

export function serperRowStats(raw: unknown): { rows: number; usable: number } | null {
  const results = isObj(raw) ? raw.organic : null;
  if (!Array.isArray(results)) return null;
  let usable = 0;
  for (const r of results) if (isObj(r) && typeof r.title === 'string' && typeof r.link === 'string') usable++;
  return { rows: results.length, usable };
}

// --- Adapters -----------------------------------------------------------------------------------

export type WebSearchProvider = 'brave' | 'serper' | 'skipped(env)';

export function websearchProvider(e: Record<string, string | undefined>): WebSearchProvider {
  if (e.BRAVE_SEARCH_API_KEY) return 'brave';
  if (e.SERPER_API_KEY) return 'serper';
  return 'skipped(env)';
}

/** Longest reason text kept from an error response body. */
export const ERROR_DETAIL_MAX = 200;
/** Bytes read from an error body before the reason is picked out (the rest is never read). */
const ERROR_BODY_READ = 2000;

/**
 * Anything that looks like a key or token is removed from an error reason before it is logged: the exact key in use (when known),
 * "key=...", "api_key": "...", "Bearer ...", "sk-..." style prefixes and any long unbroken token (24+ letters, digits, "_" or "-").
 */
export function redactSecrets(text: string, knownKeys: Array<string | undefined> = []): string {
  let t = text;
  for (const k of knownKeys) if (k && k.length >= 4) t = t.split(k).join('[removed]');
  return t
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]{6,}/gi, '$1 [removed]')
    .replace(/((?:api[_-]?key|x-api-key|x-subscription-token|token|secret|authorization|key)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1[removed]')
    .replace(/\b(?:sk|pk|rk|key|tok|brave|ser)[-_][A-Za-z0-9_-]{8,}/gi, '[removed]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[removed]');
}

/**
 * The reason an API gave for a non-2xx answer, at most ERROR_DETAIL_MAX characters, or '' when there is none. Reads only the first
 * ERROR_BODY_READ bytes of the body. A JSON body gives its message / error / detail field ("Not enough credits"); anything else
 * gives its first text with whitespace collapsed; an HTML page gives nothing. Secrets are stripped (redactSecrets). Never throws.
 */
export async function errorDetail(res: Response, knownKeys: Array<string | undefined> = []): Promise<string> {
  let raw = '';
  try {
    const reader = res.body?.getReader();
    if (reader) {
      const dec = new TextDecoder();
      let bytes = 0;
      while (bytes < ERROR_BODY_READ) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        bytes += value.length;
        raw += dec.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    } else {
      raw = (await res.text()).slice(0, ERROR_BODY_READ);
    }
  } catch {
    return '';
  }
  raw = raw.slice(0, ERROR_BODY_READ).trim();
  if (!raw || /^</.test(raw)) return '';
  let reason = raw;
  try {
    const j: unknown = JSON.parse(raw);
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
    if (isObj(j)) {
      const err = isObj(j.error) ? j.error : undefined;
      reason = str(j.message) ?? str(j.error) ?? str(j.detail) ?? str(j.description) ?? str(err?.detail) ?? str(err?.message) ?? str(err?.code) ?? str(j.code) ?? raw;
    }
  } catch {
    // not JSON: the raw text is the reason
  }
  return redactSecrets(reason.replace(/\s+/g, ' ').trim(), knownKeys).slice(0, ERROR_DETAIL_MAX).trim();
}

/** Statuses that mean "this key or request is refused": two of them in the first two queries end the run. */
const REFUSED = new Set([400, 401, 403]);

/**
 * Runs queries in small parallel batches (rate limits), stops on 401/403/429 or when the run deadline passes.
 * Every failure mode logs an "error:" line (run.ts turns error-like logs into status error when nothing was parsed).
 * Most search hits are not asks, so "parsed 0" is normal; the silent-empty check therefore looks at structure: hits with no
 * title/url at all, or responses that never contain the results array.
 */
async function runQueries(
  ctx: AdapterContext,
  id: string,
  keyName: string,
  queries: PlannedQuery[],
  call: (q: PlannedQuery) => Promise<Response>,
  parse: (json: unknown, q: PlannedQuery) => SignalInput[],
  stats: (json: unknown) => { rows: number; usable: number } | null,
  pace?: { spacingMs: number; startDeadlineMs: number },
): Promise<SignalInput[]> {
  const started = Date.now();
  const out: SignalInput[] = [];
  const seen = new Set<string>();
  const BATCH = pace ? 1 : 4;
  let responses = 0;
  let lastStart = 0;
  let withResults = 0;
  let rows = 0;
  let usable = 0;
  /** Status of each of the first two queries (by position): both 400, 401 or 403 means the key or plan is refused, so the run stops. */
  const firstTwo: Array<number | undefined> = [undefined, undefined];
  const knownKey = ctx.env[keyName];
  let step = BATCH;
  for (let i = 0; i < queries.length; i += step) {
    // The first batch is a probe of two queries, so a refused key costs two requests, not a full batch.
    step = i === 0 ? Math.min(BATCH, 2) : BATCH;
    if (pace && i > 0) {
      // Start-to-start spacing: wait out whatever is left of the gap since the previous request began.
      const wait = lastStart + pace.spacingMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    if (Date.now() - started > (pace ? pace.startDeadlineMs : RUN_DEADLINE_MS)) {
      ctx.log(`${id}: deadline reached after ${i} of ${queries.length} queries`);
      break;
    }
    const batch = queries.slice(i, i + step);
    lastStart = Date.now();
    const settled = await Promise.all(
      batch.map(async (q, bi) => {
        try {
          const res = await call(q);
          if (i + bi < 2) firstTwo[i + bi] = res.status;
          if (res.status === 429) {
            const why = await errorDetail(res, [knownKey]);
            ctx.log(`error: ${id} rate limited (HTTP 429${why ? `: ${why}` : ''}), quota or per-second limit reached`);
            return { stop: true, signals: [] as SignalInput[] };
          }
          if (res.status === 401 || res.status === 403) {
            const why = await errorDetail(res, [knownKey]);
            ctx.log(`error: ${id} HTTP ${res.status}${why ? `: ${why}` : ''}, check ${keyName}`);
            return { stop: true, signals: [] as SignalInput[] };
          }
          if (!res.ok) {
            const why = await errorDetail(res, [knownKey]);
            ctx.log(`error: ${id} HTTP ${res.status}${why ? `: ${why}` : ''}`);
            return { stop: false, signals: [] as SignalInput[] };
          }
          const text = await res.text();
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            ctx.log(`error: ${id} ${/^\s*</.test(text) ? 'returned an HTML page instead of JSON' : 'returned non-JSON text'}`);
            return { stop: false, signals: [] as SignalInput[] };
          }
          responses++;
          const st = stats(json);
          if (st) {
            withResults++;
            rows += st.rows;
            usable += st.usable;
          }
          return { stop: false, signals: parse(json, q) };
        } catch (e) {
          ctx.log(`error: ${id} ${e instanceof Error ? e.message : String(e)}`);
          return { stop: false, signals: [] as SignalInput[] };
        }
      }),
    );
    for (const r of settled) {
      for (const s of r.signals) {
        if (seen.has(s.externalId)) continue;
        seen.add(s.externalId);
        out.push(s);
      }
    }
    if (settled.some((r) => r.stop)) break;
    // The first two queries both refused (400, 401 or 403): the rest would fail the same way and cost credits. Stop and say so once.
    if (firstTwo.every((c) => c !== undefined && REFUSED.has(c)) && queries.length > 2) {
      ctx.log(`error: ${id} first 2 queries both refused (HTTP ${firstTwo.join(' and ')}), stopped the run, ${queries.length - 2} queries not sent`);
      break;
    }
  }
  if (responses >= 3 && withResults === 0) {
    ctx.log(`error: ${id} none of ${responses} responses contained the results array, wrapper key may have changed`);
  } else if (rows > 0 && usable === 0) {
    ctx.log(`error: ${id} parsed 0 of ${rows} rows, shape may have changed`);
  }
  return out;
}

const CADENCE = 360;

const brave: Adapter = {
  id: 'websearch-brave',
  label: 'People asking for recommendations (web search)',
  kind: 'ask',
  cadenceMinutes: CADENCE,
  requiresEnv: ['BRAVE_SEARCH_API_KEY'],
  sourceUrl: 'https://search.brave.com/',
  async fetch(ctx) {
    try {
      const key = ctx.env.BRAVE_SEARCH_API_KEY ?? env.BRAVE_SEARCH_API_KEY;
      if (!key) {
        ctx.log('websearch-brave: skipped(env) BRAVE_SEARCH_API_KEY missing');
        return [];
      }
      const plan = planQueries(new Date(), CADENCE, BRAVE_QUERY_CAP);
      return await runQueries(
        ctx,
        'websearch-brave',
        'BRAVE_SEARCH_API_KEY',
        plan,
        (q) =>
          ctx.fetch(
            `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: q.q, count: '10', freshness: 'pw', country: 'US', search_lang: 'en' })}`,
            { headers: { Accept: 'application/json', 'X-Subscription-Token': key, 'User-Agent': UA }, signal: AbortSignal.timeout(braveTuning.requestTimeoutMs) },
          ),
        (json, q) => parseBrave(json, { queryCity: q.city }),
        braveRowStats,
        { spacingMs: braveTuning.spacingMs, startDeadlineMs: braveTuning.startDeadlineMs },
      );
    } catch (e) {
      ctx.log(`error: websearch-brave ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

const serper: Adapter = {
  id: 'websearch-serper',
  label: 'People asking for recommendations (web search)',
  kind: 'ask',
  cadenceMinutes: CADENCE,
  requiresEnv: ['SERPER_API_KEY'],
  sourceUrl: 'https://serper.dev/',
  async fetch(ctx) {
    try {
      const key = ctx.env.SERPER_API_KEY ?? env.SERPER_API_KEY;
      if (!key) {
        ctx.log('websearch-serper: skipped(env) SERPER_API_KEY missing');
        return [];
      }
      if (ctx.env.BRAVE_SEARCH_API_KEY ?? env.BRAVE_SEARCH_API_KEY) {
        ctx.log('websearch-serper: Brave key present, Brave adapter handles web search');
        return [];
      }
      const plan = planQueries(new Date(), CADENCE);
      return await runQueries(
        ctx,
        'websearch-serper',
        'SERPER_API_KEY',
        plan,
        (q) =>
          ctx.fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': key, 'User-Agent': UA },
            body: JSON.stringify({ q: q.q, gl: 'us', hl: 'en', num: 10, tbs: 'qdr:w' }),
            signal: AbortSignal.timeout(15000),
          }),
        (json, q) => parseSerper(json, { queryCity: q.city }),
        serperRowStats,
      );
    } catch (e) {
      ctx.log(`error: websearch-serper ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [brave, serper];
