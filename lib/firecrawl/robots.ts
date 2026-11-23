/**
 * robots.txt check before any agency page is read: by Firecrawl (lib/firecrawl/pipeline.ts) and by the round 20 plain-fetch page watch
 * (lib/signals/adapters/page-watch.ts). Pure parser plus one small fetch helper.
 *
 * Rules follow RFC 9309: the most specific user-agent group wins over "*", the longest matching path wins, Allow beats Disallow on a tie,
 * `*` and `$` work in paths. A group applies to us only when one of its user-agent tokens IS one of our product tokens (or that token
 * followed by "/version"): "hollerith-bot" is not "holler". Firecrawl reads the page from its own servers as FirecrawlAgent, so the
 * Firecrawl path matches FIRECRAWL_AGENTS; a plain fetch is Holler itself and matches HOLLER_AGENTS only (Firecrawl's groups never
 * grant a plain fetch anything).
 *
 * Fail closed (round 20 review P1-1): only a 404 or 410 means "no robots.txt, everything allowed". A 401, 403, 429, any 5xx, a network
 * error, a redirect to another host, an HTML answer (a login page, a bot challenge, a soft 404) or any body that is not plain text means
 * "cannot tell": the page is not fetched this run. A redirect to the same host (or its www. twin) is followed once.
 *
 * Crawl-delay is read from the chosen group. A caller that fetches pages records each fetch (noteFetch) and asks before the next one
 * (crawlDelayWaitMs): the run is skipped when the delay since the last fetch of that origin is not met. The robots.txt request itself is
 * the protocol's own request and does not count.
 */

import { HOLLER_UA } from '@/lib/user-agent';

export { HOLLER_UA };
/** Product tokens a plain Holler fetch answers to. */
export const HOLLER_AGENTS: readonly string[] = ['holler'];
/** Product tokens for a page Firecrawl reads for Holler (its own agent first). */
export const FIRECRAWL_AGENTS: readonly string[] = ['firecrawlagent', 'firecrawl', 'holler'];

interface Group {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
  crawlDelay: number | null;
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], crawlDelay: null };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (cur) cur.rules.push({ allow: key === 'allow', path: val });
    } else if (key === 'crawl-delay') {
      lastWasAgent = false;
      const n = Number(val);
      if (cur && Number.isFinite(n) && n >= 0) cur.crawlDelay = Math.max(cur.crawlDelay ?? 0, Math.min(n, 3600));
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** A group token names one of our agents: exactly, or followed by "/version". */
export function agentTokenMatches(token: string, agent: string): boolean {
  const t = token.trim().toLowerCase();
  return t === agent || t.startsWith(`${agent}/`);
}

function chosenGroups(text: string, agents: readonly string[]): Group[] {
  const groups = parseRobots(text);
  const specific = groups.filter((g) => g.agents.some((t) => t !== '*' && agents.some((a) => agentTokenMatches(t, a))));
  return specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
}

function toRegex(path: string): RegExp {
  const esc = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}`);
}

/** Is `path` (with query, starting with "/") allowed for these agents by this robots.txt text? Default: the Firecrawl agents. */
export function robotsAllows(text: string, path: string, agents: readonly string[] = FIRECRAWL_AGENTS): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosenGroups(text, agents)) {
    for (const r of g.rules) {
      if (r.path === '') continue; // "Disallow:" with nothing allows everything
      const pat = r.path.endsWith('$') ? r.path.slice(0, -1) : r.path;
      const re = r.path.endsWith('$') ? new RegExp(`${toRegex(pat).source}$`) : toRegex(pat);
      if (!re.test(path)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

/** The Crawl-delay (seconds) of the groups that apply to these agents, or null. */
export function robotsCrawlDelay(text: string, agents: readonly string[] = FIRECRAWL_AGENTS): number | null {
  const ds = chosenGroups(text, agents).map((g) => g.crawlDelay).filter((x): x is number => x !== null);
  return ds.length ? Math.max(...ds) : null;
}

export type RobotsVerdict =
  | { allowed: true; checked: boolean; crawlDelaySec: number | null }
  | { allowed: false; reason: 'disallowed' | 'unreachable'; why?: string };

interface CacheHit {
  at: number;
  text: string | null;
  unreachable: boolean;
  why?: string;
}

const cache = new Map<string, CacheHit>();
const lastFetch = new Map<string, number>();
const TTL_MS = 3_600_000;

/** Test hook. */
export function resetRobotsCache(): void {
  cache.clear();
  lastFetch.clear();
}

const sameSite = (a: string, b: string) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

/** A robots.txt answer as text, or why it cannot be used. */
async function readRobots(res: Response): Promise<{ text: string } | { why: string }> {
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (ct && (!/^text\//.test(ct) || /html/.test(ct))) {
    // HTML or anything else (JSON, an image, a PDF) is not a robots.txt.
    return { why: `robots.txt answered ${ct.split(';')[0]}` };
  }
  const text = (await res.text()).slice(0, 500_000);
  if (/^\s*<(?:!doctype|html|head|body)\b/i.test(text) || /\u0000/.test(text)) return { why: 'robots.txt answered a page, not a robots file' };
  return { text };
}

async function fetchRobots(origin: string, fetchImpl: typeof fetch, nowMs: number): Promise<CacheHit> {
  const host = new URL(origin).hostname;
  let url = `${origin}/robots.txt`;
  for (let hop = 0; hop < 2; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': HOLLER_UA, Accept: 'text/plain' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    } catch {
      return { at: nowMs, text: null, unreachable: true, why: 'robots.txt: no answer' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      let next: URL | null = null;
      try {
        next = loc ? new URL(loc, url) : null;
      } catch {
        next = null;
      }
      // One hop, to the same host or its www. twin, to a robots.txt path: anything else cannot be judged here.
      if (hop === 0 && next && next.protocol === 'https:' && sameSite(next.hostname, host) && next.pathname === '/robots.txt') {
        url = next.toString();
        continue;
      }
      return { at: nowMs, text: null, unreachable: true, why: `robots.txt redirects to ${next ? next.hostname : 'nowhere'}` };
    }
    if (res.status === 404 || res.status === 410) return { at: nowMs, text: null, unreachable: false }; // no robots.txt: everything allowed
    if (!res.ok) return { at: nowMs, text: null, unreachable: true, why: `robots.txt HTTP ${res.status}` };
    const r = await readRobots(res);
    return 'text' in r ? { at: nowMs, text: r.text, unreachable: false } : { at: nowMs, text: null, unreachable: true, why: r.why };
  }
  return { at: nowMs, text: null, unreachable: true, why: 'robots.txt redirects too often' };
}

/**
 * Fetches https://host/robots.txt (cached for an hour per origin) and judges the page URL for the given agents (default: Firecrawl's).
 * Any answer that cannot be read as a robots file is "unreachable": the page is not fetched this run.
 */
export async function checkRobots(pageUrl: string, fetchImpl: typeof fetch, nowMs: number = Date.now(), opts: { agents?: readonly string[] } = {}): Promise<RobotsVerdict> {
  const u = new URL(pageUrl);
  const key = u.origin;
  let hit = cache.get(key);
  if (!hit || nowMs - hit.at > TTL_MS) {
    hit = await fetchRobots(u.origin, fetchImpl, nowMs);
    cache.set(key, hit);
  }
  if (hit.unreachable) return { allowed: false, reason: 'unreachable', ...(hit.why ? { why: hit.why } : {}) };
  const agents = opts.agents ?? FIRECRAWL_AGENTS;
  if (hit.text === null) return { allowed: true, checked: false, crawlDelaySec: null };
  if (!robotsAllows(hit.text, `${u.pathname}${u.search}`, agents)) return { allowed: false, reason: 'disallowed' };
  return { allowed: true, checked: true, crawlDelaySec: robotsCrawlDelay(hit.text, agents) };
}

/** Records a page request to this URL's origin (for Crawl-delay). */
export function noteFetch(url: string, nowMs: number = Date.now()): void {
  try {
    lastFetch.set(new URL(url).origin, nowMs);
  } catch {
    /* not a URL */
  }
}

/** How long to wait before the next page request to this origin under a Crawl-delay of `delaySec` (0: go now). */
export function crawlDelayWaitMs(url: string, delaySec: number | null | undefined, nowMs: number = Date.now()): number {
  if (!delaySec) return 0;
  let last: number | undefined;
  try {
    last = lastFetch.get(new URL(url).origin);
  } catch {
    return 0;
  }
  if (last === undefined) return 0;
  return Math.max(0, Math.ceil(delaySec * 1000 - (nowMs - last)));
}
