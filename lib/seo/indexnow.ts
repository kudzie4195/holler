import { cityBySlug, cityPath } from '@/lib/geo';
import { env as appEnv } from '@/lib/env';
import { absoluteUrl } from './canonical';
import { isIndexable } from './threshold';
import { isWeekIndexable, mondayOf, isoDay, weekPath } from './week';
import { excludeBidsInQuery } from '@/lib/signals/bid-sources';
import { bidCountsByPlace, minusBids } from './bid-counts';

/**
 * IndexNow pings (https://www.indexnow.org/documentation, https://www.indexnow.org/faq).
 *
 * Sourced from those pages:
 *  - bulk submit: POST https://api.indexnow.org/indexnow (FAQ: "Submit your POST request to"), Content-Type "application/json; charset=utf-8",
 *    body { host, key, keyLocation, urlList }. A submission to one endpoint is shared with all IndexNow search engines.
 *  - "You can submit up to 10,000 URLs per post, mixing http and https URLs if needed."
 *  - key: 8 to 128 characters, a-z, A-Z, 0-9 and dashes. The key file is UTF-8 text containing exactly the key. With a key file outside the
 *    web root, keyLocation says where it is, and it only covers URLs under its own directory. We serve it at /indexnow-key.txt (the root).
 *  - responses: 200 OK, 202 accepted (key validation pending), 400 bad request, 403 key invalid, 422 URLs not on the host or key schema
 *    mismatch, 429 too many requests (potential spam).
 *  - FAQ: submit only changed URLs, and avoid sending the same URL many times a day. recentlyPinged below keeps one warm server from
 *    repeating a URL within an hour. (ASSUMED limit: serverless instances do not share that memory.)
 */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_KEY_PATH = '/indexnow-key.txt';
/** Protocol limit per POST. */
export const INDEXNOW_MAX_URLS_PER_POST = 10_000;
/** Our cap per scan run. */
export const INDEXNOW_RUN_CAP = 200;
/** A ping never holds the scan longer than this. */
export const INDEXNOW_TIMEOUT_MS = 5_000;
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;
/** Do not send the same URL twice inside this window (per server instance). */
export const INDEXNOW_REPEAT_MS = 60 * 60_000;

export function isValidKey(key: string | undefined | null): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

export interface IndexNowConfig {
  key: string;
  host: string;
  /** https://host, no trailing slash: the base for every URL that is sent, so they always match `host` */
  origin: string;
  keyLocation: string;
}

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h === '0.0.0.0';
}

/** null (skip silently) when the key is missing or malformed, or the site URL is missing, unparseable or localhost. */
export function indexNowConfig(e: { INDEXNOW_KEY?: string; NEXT_PUBLIC_SITE_URL?: string } = appEnv): IndexNowConfig | null {
  const key = e.INDEXNOW_KEY?.trim();
  const site = e.NEXT_PUBLIC_SITE_URL?.trim();
  if (!isValidKey(key) || !site) return null;
  let u: URL;
  try {
    u = new URL(site);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || isLocalHost(u.hostname)) return null;
  return { key, host: u.host, origin: u.origin, keyLocation: `${u.origin}${INDEXNOW_KEY_PATH}` };
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export function buildPayload(cfg: IndexNowConfig, urls: string[]): IndexNowPayload {
  return { host: cfg.host, key: cfg.key, keyLocation: cfg.keyLocation, urlList: urls };
}

export interface PlaceTouch {
  /** at least one new row is dated in the current UTC week, so the current weekly page changed */
  currentWeek: boolean;
}

/**
 * Pure URL selection. For each place that got new rows: its city page when it is indexable (60 day count meets the threshold) and, when a
 * new row falls in the current week, the current weekly page when that week has 10 or more records. City pages come first, then weekly
 * pages, in slug order, and the list is cut at `cap`.
 */
export function selectPingUrls(input: {
  touched: Map<string, PlaceTouch>;
  counts60: Record<string, number>;
  weekCounts: Record<string, number>;
  nowMs: number;
  cap?: number;
  /** override for tests; defaults to absoluteUrl */
  url?: (path: string) => string;
}): string[] {
  const cap = input.cap ?? INDEXNOW_RUN_CAP;
  const url = input.url ?? absoluteUrl;
  const monday = isoDay(mondayOf(input.nowMs));
  const slugs = [...input.touched.keys()].sort();
  const cityUrls: string[] = [];
  const weekUrls: string[] = [];
  for (const slug of slugs) {
    const city = cityBySlug(slug);
    if (!city) continue;
    if (isIndexable(input.counts60[slug] ?? 0)) cityUrls.push(url(cityPath(city)));
    if (input.touched.get(slug)?.currentWeek && isWeekIndexable(input.weekCounts[slug] ?? 0)) weekUrls.push(url(weekPath(cityPath(city), monday)));
  }
  return [...cityUrls, ...weekUrls].slice(0, cap);
}

export type PingOutcome =
  | { status: 'skipped'; reason: 'unconfigured' | 'nothing-to-send' }
  | { status: 'sent'; urls: number; httpStatus: number }
  | { status: 'failed'; urls: number; error: string };

const STATUS_MEANING: Record<number, string> = {
  400: 'bad request',
  403: 'key invalid or key file not found at keyLocation',
  422: 'URLs not on the host, or key does not match the schema',
  429: 'too many requests (potential spam)',
};

/**
 * POST one batch (at most 10,000 URLs) to IndexNow. Never throws. 200 and 202 count as sent. Everything else is returned as failed and logged;
 * the caller decides nothing from it, so a failed ping can never fail a scan.
 */
export async function postUrls(
  cfg: IndexNowConfig,
  urls: string[],
  opts: { fetchImpl?: typeof fetch; log?: (m: string) => void; timeoutMs?: number } = {},
): Promise<PingOutcome> {
  const log = opts.log ?? ((m: string) => console.error(m));
  if (urls.length === 0) return { status: 'skipped', reason: 'nothing-to-send' };
  const batch = urls.slice(0, INDEXNOW_MAX_URLS_PER_POST);
  try {
    const res = await (opts.fetchImpl ?? fetch)(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(buildPayload(cfg, batch)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? INDEXNOW_TIMEOUT_MS),
    });
    if (res.status === 200 || res.status === 202) return { status: 'sent', urls: batch.length, httpStatus: res.status };
    const error = `HTTP ${res.status}${STATUS_MEANING[res.status] ? ` (${STATUS_MEANING[res.status]})` : ''}`;
    log(`[indexnow] ping failed: ${error}`);
    return { status: 'failed', urls: batch.length, error };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`[indexnow] ping failed: ${error}`);
    return { status: 'failed', urls: batch.length, error };
  }
}

/** Per-instance memory of when a URL was last sent. */
const lastSent = new Map<string, number>();

export function recentlyPinged(url: string, nowMs: number, memory: Map<string, number> = lastSent): boolean {
  const t = memory.get(url);
  return t !== undefined && nowMs - t < INDEXNOW_REPEAT_MS;
}

/** Minimal slice of the Supabase client used here, so tests can pass a fake. */
export interface IndexNowDb {
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface PingNewSignalsInput {
  db: IndexNowDb;
  /** place_slug and occurred_at of each row the scan inserted */
  inserted: { place_slug?: string | null; occurred_at: string }[];
  now: Date;
  config?: IndexNowConfig | null;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
  timeoutMs?: number;
  memory?: Map<string, number>;
}

async function readCounts(db: IndexNowDb, slugs: string[], now: Date, timeoutMs: number): Promise<{ counts60: Record<string, number>; weekCounts: Record<string, number> }> {
  const counts60: Record<string, number> = {};
  const weekCounts: Record<string, number> = {};
  const signal = AbortSignal.timeout(timeoutMs);
  // One read of the view: 60 day counts for every place (one row per place).
  const view = await db.from('holler_place_counts').select('place_slug, signals_60d').in('place_slug', slugs).abortSignal(signal);
  if (view.error) throw new Error(view.error.message);
  for (const r of (view.data ?? []) as { place_slug: string; signals_60d: number }[]) counts60[r.place_slug] = r.signals_60d;
  // The view counts stored city bids; while the bids flag is off they are not shown, so they are not counted (review P2-1).
  Object.assign(counts60, minusBids(counts60, await bidCountsByPlace(db, now.getTime())));
  // One read for this week's rows of the touched places (slug column only). 10 is all that matters, so a 1000 row page is plenty.
  const monday = mondayOf(now.getTime());
  const week = await excludeBidsInQuery(
    db
      .from('holler_signals')
      .select('place_slug')
      .in('place_slug', slugs)
      .gte('occurred_at', new Date(monday).toISOString())
      .lt('occurred_at', new Date(now.getTime() + 60_000).toISOString()),
  )
    .limit(1000)
    .abortSignal(signal);
  if (week.error) throw new Error(week.error.message);
  for (const r of (week.data ?? []) as { place_slug: string }[]) weekCounts[r.place_slug] = (weekCounts[r.place_slug] ?? 0) + 1;
  return { counts60, weekCounts };
}

/**
 * After a non-dry scan: one ping per run for the city pages (and the current weekly page) of the places that got new rows.
 * Silent skip when INDEXNOW_KEY or NEXT_PUBLIC_SITE_URL is unset or the site is localhost. Never throws, and gives up after 5 s in total
 * (counting reads and the POST), so it cannot fail or noticeably delay the scan.
 */
export async function pingNewSignals(input: PingNewSignalsInput): Promise<PingOutcome> {
  const cfg = input.config === undefined ? indexNowConfig() : input.config;
  if (!cfg) return { status: 'skipped', reason: 'unconfigured' };
  const log = input.log ?? ((m: string) => console.error(m));
  const timeoutMs = input.timeoutMs ?? INDEXNOW_TIMEOUT_MS;
  const memory = input.memory ?? lastSent;
  const nowMs = input.now.getTime();
  const monday = mondayOf(nowMs);

  const work = (async (): Promise<PingOutcome> => {
    const touched = new Map<string, PlaceTouch>();
    for (const r of input.inserted) {
      if (!r.place_slug) continue;
      const t = Date.parse(r.occurred_at);
      const inWeek = Number.isFinite(t) && t >= monday && t <= nowMs + 60_000;
      const prev = touched.get(r.place_slug);
      touched.set(r.place_slug, { currentWeek: !!prev?.currentWeek || inWeek });
    }
    if (touched.size === 0) return { status: 'skipped', reason: 'nothing-to-send' };
    const slugs = [...touched.keys()].sort().slice(0, 500);
    const { counts60, weekCounts } = await readCounts(input.db, slugs, input.now, timeoutMs);
    const urls = selectPingUrls({ touched, counts60, weekCounts, nowMs, cap: Infinity, url: (p) => `${cfg.origin}${p}` }).filter((u) => !recentlyPinged(u, nowMs, memory)).slice(0, INDEXNOW_RUN_CAP);
    const out = await postUrls(cfg, urls, { fetchImpl: input.fetchImpl, log, timeoutMs });
    if (out.status === 'sent') for (const u of urls) memory.set(u, nowMs);
    return out;
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<PingOutcome>((resolve) => {
    timer = setTimeout(() => {
      log('[indexnow] ping gave up after 5 s');
      resolve({ status: 'failed', urls: 0, error: 'timeout' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, limit]);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`[indexnow] ping failed: ${error}`);
    return { status: 'failed', urls: 0, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
