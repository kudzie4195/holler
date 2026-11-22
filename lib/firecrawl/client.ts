/**
 * Firecrawl client (server code only: it reads FIRECRAWL_API_KEY and must never reach a browser bundle; no 'use client' file imports it,
 * tests/firecrawl/client.test.ts checks that, and it throws if it is ever run where `window` exists).
 *
 * Facts below were read on 2026-11-22 from docs.firecrawl.dev through WebFetch (the shell has no route to Firecrawl):
 *   POST https://api.firecrawl.dev/v2/scrape, header "Authorization: Bearer <key>"            https://docs.firecrawl.dev/features/scrape
 *   formats: [ "markdown", { type: "json", schema, prompt }, { type: "changeTracking", tag } ]  (changeTracking needs markdown beside it)
 *   response { success, data: { markdown, json, changeTracking: { changeStatus, previousScrapeAt }, metadata: { statusCode }, warning } }
 *   "Each scrape consumes 1 credit." "JSON mode costs 4 additional credits per page." "Cached results still cost 1 credit per page."
 *     https://docs.firecrawl.dev/features/scrape and https://docs.firecrawl.dev/billing
 *   change tracking (changeStatus new | same | changed | removed): "No extra cost (standard scrape credits)"   https://docs.firecrawl.dev/features/change-tracking
 *   The single-scrape response carries no credits-used field (only batch does), so credits are ESTIMATED from the formula above and the
 *   live balance is read from GET /v2/team/credit-usage (data.remainingCredits, data.planCredits)          https://docs.firecrawl.dev/api-reference/endpoint/credit-usage
 *   errors: JSON { success: false, error: string }; retryable 408, 429, 500, 502, 503, 504 with backoff and Retry-After; not 400, 401, 402, 403, 404, 409, 413
 *     https://docs.firecrawl.dev/api-reference/errors.md
 *   Free plan: 1,000 credits a month, 10 scrape requests a minute, 2 concurrent browsers                   https://www.firecrawl.dev/pricing , https://docs.firecrawl.dev/rate-limits
 *
 * What this file never does: log the key, log a response body, or put either in an error message. Errors carry the HTTP status, a short
 * code and at most 120 characters of Firecrawl's own `error` string (scrubbed of anything that looks like a key).
 */

export const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';

/** Credits, from the docs quoted above. */
export const CREDITS = { scrape: 1, jsonExtra: 4 } as const;

export type FirecrawlErrorCode =
  | 'no_key'
  | 'unauthorized'
  | 'insufficient_credits'
  | 'forbidden'
  | 'bad_request'
  | 'rate_limited'
  | 'timeout'
  | 'server_error'
  | 'target_error'
  | 'bad_response'
  | 'network';

export class FirecrawlError extends Error {
  readonly status: number | null;
  readonly code: FirecrawlErrorCode;
  readonly retryable: boolean;
  /** HTTP attempts made before giving up. */
  readonly attempts: number;
  constructor(code: FirecrawlErrorCode, status: number | null, message: string, retryable: boolean, attempts = 1) {
    super(message);
    this.name = 'FirecrawlError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.attempts = attempts;
  }
}

export type ScrapeFormat =
  | 'markdown'
  | { type: 'json'; schema: Record<string, unknown>; prompt?: string }
  | { type: 'changeTracking'; tag?: string; modes?: Array<'git-diff' | 'json'> };

export interface ScrapeRequest {
  url: string;
  formats: ScrapeFormat[];
  /** Per-attempt client timeout (ms). Default 25 000. */
  timeoutMs?: number;
  /** Firecrawl's cache window in ms (default 2 days on their side; change tracking ignores it). */
  maxAgeMs?: number;
  /** Absolute wall-clock limit (epoch ms) for the whole call including retries. */
  deadlineMs?: number;
}

export type ChangeStatus = 'new' | 'same' | 'changed' | 'removed';

export interface ScrapeResult {
  markdown: string | null;
  json: unknown;
  changeStatus: ChangeStatus | null;
  /** The target page's own HTTP status as Firecrawl saw it. */
  pageStatus: number | null;
  /** Firecrawl's `warning` text (for example change tracking not available), at most 200 characters. */
  warning: string | null;
  /** Credits the API itself reported, when it did (it does not for a single scrape). */
  creditsReported: number | null;
  /** Credits this call is expected to cost from the documented formula. 0 when the call did not succeed. */
  creditsEstimated: number;
  /** HTTP attempts it took. */
  attempts: number;
}

export interface CreditUsage {
  remainingCredits: number | null;
  planCredits: number | null;
  billingPeriodEnd: string | null;
}

export interface FirecrawlClient {
  scrape(req: ScrapeRequest): Promise<ScrapeResult>;
  creditUsage(opts?: { timeoutMs?: number }): Promise<CreditUsage>;
}

export interface ClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Total HTTP attempts per call, first try included. Default 3. */
  maxAttempts?: number;
  /** First backoff in ms; doubles each retry, with jitter. Default 1000. */
  baseDelayMs?: number;
  /** Longest single wait (also caps Retry-After). Default 15 000. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1 random source, for tests. */
  random?: () => number;
  now?: () => number;
  /** Concurrent requests this process may have open. Free plan allows 2 concurrent browsers. Default 2. */
  concurrency?: number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** The key, trimmed, or null when unset or blank. Read only from the environment you pass in. */
export function firecrawlApiKey(e: Record<string, string | undefined> = process.env): string | null {
  const k = (e.FIRECRAWL_API_KEY ?? '').trim();
  return k ? k : null;
}

/** Documented cost of one scrape from its formats: 1, +4 for a json format, +5 for change tracking in json mode (not used here). */
export function estimateCredits(formats: ScrapeFormat[]): number {
  let n: number = CREDITS.scrape;
  for (const f of formats) {
    if (typeof f === 'object' && f.type === 'json') n += CREDITS.jsonExtra;
  }
  return n;
}

/** Removes anything that looks like a Firecrawl key (fc- followed by 16+ key characters) and the key itself from a text. */
export function scrub(text: string, apiKey?: string): string {
  let t = text.replace(/\bfc-[A-Za-z0-9_-]{8,}/g, '[key]');
  if (apiKey && apiKey.length >= 6) t = t.split(apiKey).join('[key]');
  return t;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function classify(status: number): { code: FirecrawlErrorCode; retryable: boolean } {
  if (status === 401) return { code: 'unauthorized', retryable: false };
  if (status === 402) return { code: 'insufficient_credits', retryable: false };
  if (status === 403) return { code: 'forbidden', retryable: false };
  if (status === 408) return { code: 'timeout', retryable: true };
  if (status === 429) return { code: 'rate_limited', retryable: true };
  if (status >= 500) return { code: 'server_error', retryable: RETRYABLE.has(status) };
  return { code: 'bad_request', retryable: false };
}

/** Tiny counting semaphore: Firecrawl's free plan runs 2 browsers at once, more would only earn 429s. */
class Semaphore {
  private waiters: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** One process-wide gate, so every client made in one scan shares the 2-browser limit. */
let sharedGate: Semaphore | null = null;
function gateFor(concurrency: number): Semaphore {
  if (!sharedGate) sharedGate = new Semaphore(Math.max(1, concurrency));
  return sharedGate;
}
/** Test hook: forget the shared gate. */
export function resetFirecrawlGate(): void {
  sharedGate = null;
}

function retryAfterMs(res: Response): number | null {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const when = Date.parse(v);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
}

export function createFirecrawlClient(opts: ClientOptions): FirecrawlClient {
  if (typeof window !== 'undefined') throw new Error('lib/firecrawl/client is server code and must not run in a browser');
  const apiKey = (opts.apiKey ?? '').trim();
  if (!apiKey) throw new FirecrawlError('no_key', null, 'FIRECRAWL_API_KEY is not set', false, 0);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const baseDelay = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 15_000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const nowFn = opts.now ?? Date.now;
  const gate = gateFor(opts.concurrency ?? 2);

  function backoff(attempt: number, res: Response | null): number {
    const exp = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
    const jittered = exp * (0.5 + random() * 0.5);
    const ra = res ? retryAfterMs(res) : null;
    return Math.min(maxDelay, Math.max(jittered, ra ?? 0));
  }

  /** One call with retries. Returns the parsed JSON body of a 2xx response. */
  async function call(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number, deadlineMs: number | undefined): Promise<{ body: unknown; attempts: number }> {
    let lastErr: FirecrawlError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = deadlineMs === undefined ? Infinity : deadlineMs - nowFn();
      if (remaining <= 500) throw lastErr ?? new FirecrawlError('timeout', null, 'no time left for the Firecrawl call', false, attempt - 1);
      const attemptTimeout = Math.min(timeoutMs, remaining);
      let res: Response | null = null;
      await gate.acquire();
      try {
        res = await fetchImpl(`${FIRECRAWL_BASE_URL}${path}`, {
          method,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Holler/1.0 (+https://holler.app/about)' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(attemptTimeout),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        lastErr = new FirecrawlError(timedOut ? 'timeout' : 'network', null, timedOut ? 'the Firecrawl request timed out' : 'the Firecrawl request could not be sent', true, attempt);
      } finally {
        gate.release();
      }

      if (res) {
        if (res.ok) {
          let parsed: unknown;
          try {
            parsed = await res.json();
          } catch {
            throw new FirecrawlError('bad_response', res.status, 'Firecrawl answered with a body that is not JSON', false, attempt);
          }
          return { body: parsed, attempts: attempt };
        }
        // An error response: read only the short `error` string, never the rest of the body.
        let detail = '';
        try {
          const j: unknown = await res.json();
          if (isObj(j) && typeof j.error === 'string') detail = scrub(j.error, apiKey).replace(/\s+/g, ' ').trim().slice(0, 120);
        } catch {
          /* no usable body */
        }
        const c = classify(res.status);
        lastErr = new FirecrawlError(c.code, res.status, `Firecrawl HTTP ${res.status}${detail ? `: ${detail}` : ''}`, c.retryable, attempt);
        if (!c.retryable) throw lastErr;
      }

      if (attempt >= maxAttempts || !lastErr?.retryable) break;
      const wait = backoff(attempt, res);
      if (deadlineMs !== undefined && nowFn() + wait >= deadlineMs - 500) break; // waiting would eat the whole budget
      await sleep(wait);
    }
    throw lastErr ?? new FirecrawlError('network', null, 'the Firecrawl request failed', true, maxAttempts);
  }

  return {
    async scrape(req: ScrapeRequest): Promise<ScrapeResult> {
      const timeoutMs = req.timeoutMs ?? 25_000;
      const payload: Record<string, unknown> = {
        url: req.url,
        formats: req.formats,
        // Firecrawl's own timeout, a little under ours so its error comes back before our abort.
        timeout: Math.max(1000, Math.min(300_000, timeoutMs - 2000)),
      };
      if (typeof req.maxAgeMs === 'number') payload.maxAge = Math.max(0, Math.floor(req.maxAgeMs));
      const { body, attempts } = await call('POST', '/scrape', payload, timeoutMs, req.deadlineMs);
      if (!isObj(body) || body.success === false || !isObj(body.data)) {
        const err = isObj(body) && typeof body.error === 'string' ? `: ${scrub(body.error, apiKey).slice(0, 120)}` : '';
        throw new FirecrawlError('bad_response', null, `Firecrawl did not return a scrape result${err}`, false, attempts);
      }
      const data = body.data;
      const meta = isObj(data.metadata) ? data.metadata : {};
      const pageStatus = typeof meta.statusCode === 'number' ? meta.statusCode : null;
      if (pageStatus !== null && pageStatus >= 400) {
        // The target page itself refused or was missing: nothing usable, and the rows below would be guesses.
        throw new FirecrawlError('target_error', pageStatus, `the page answered HTTP ${pageStatus} to Firecrawl`, false, attempts);
      }
      const ct = isObj(data.changeTracking) ? data.changeTracking : null;
      const cs = ct && typeof ct.changeStatus === 'string' ? ct.changeStatus : null;
      const changeStatus: ChangeStatus | null = cs === 'new' || cs === 'same' || cs === 'changed' || cs === 'removed' ? cs : null;
      const warning = typeof data.warning === 'string' ? data.warning : typeof body.warning === 'string' ? body.warning : null;
      const reportedRaw = body.creditsUsed ?? data.creditsUsed ?? meta.creditsUsed;
      return {
        markdown: typeof data.markdown === 'string' ? data.markdown : null,
        json: data.json ?? null,
        changeStatus,
        pageStatus,
        warning: warning ? scrub(warning, apiKey).replace(/\s+/g, ' ').slice(0, 200) : null,
        creditsReported: typeof reportedRaw === 'number' && Number.isFinite(reportedRaw) ? reportedRaw : null,
        creditsEstimated: estimateCredits(req.formats),
        attempts,
      };
    },

    async creditUsage(o?: { timeoutMs?: number }): Promise<CreditUsage> {
      const { body } = await call('GET', '/team/credit-usage', undefined, o?.timeoutMs ?? 8000, undefined);
      const d = isObj(body) && isObj(body.data) ? body.data : null;
      if (!d) throw new FirecrawlError('bad_response', null, 'Firecrawl did not return credit usage', false, 1);
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return { remainingCredits: num(d.remainingCredits), planCredits: num(d.planCredits), billingPeriodEnd: typeof d.billingPeriodEnd === 'string' ? d.billingPeriodEnd : null };
    },
  };
}
