import { originAllowed } from '@/lib/auth/origin';
import { rateKey, type Limit } from '@/lib/auth/limits';
import {
  cleanPath,
  looksAutomated,
  parseSid,
  parseSrc,
  privacyHeaderOn,
  readCookie,
  SID_COOKIE,
  SRC_COOKIE,
} from './attr';
import { BROWSER_EVENTS, buildEventRow, type BrowserEvent, type EventRow } from './events';

export const MAX_BODY_BYTES = 512;
/** Browser events per IP per 10 minutes. The IP is only hashed into the counter key by the existing limiter; it is never stored here. */
export const EVENT_LIMIT_MAX = 60;
export const EVENT_LIMIT_WINDOW_SECONDS = 600;

export const eventIpLimit = (ip: string): Limit => ({ key: rateKey('event', 'ip', ip), max: EVENT_LIMIT_MAX, windowSeconds: EVENT_LIMIT_WINDOW_SECONDS });

export interface IngestDeps {
  hit: (limits: Limit[]) => Promise<'allowed' | 'limited' | 'error'>;
  insert: (row: EventRow) => Promise<unknown>;
  siteUrl: string;
  ip: (req: Request) => string;
}

export type IngestOutcome =
  | 'stored'
  | 'origin'
  | 'signal'
  | 'body'
  | 'invalid'
  | 'no-cookie'
  | 'bot'
  | 'limited'
  | 'error';

/**
 * Decides whether a beacon becomes a row. The route answers 204 whatever this returns; the outcome exists for tests.
 * Cheap checks run first, so the rate limiter (a database call) only sees requests that would otherwise be stored.
 * The user agent and client hints are inspected for automation and dropped. Nothing about them reaches the row.
 */
export async function ingestBeacon(req: Request, deps: IngestDeps): Promise<IngestOutcome> {
  const h = (n: string) => req.headers.get(n);

  // Same origin only. A browser sends Origin on a same-origin POST; without it, Sec-Fetch-Site must say same-origin.
  const origin = h('origin');
  if (origin) {
    if (!originAllowed(req, deps.siteUrl)) return 'origin';
  } else if (h('sec-fetch-site') !== 'same-origin') return 'origin';
  const fetchSite = h('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return 'origin';

  if (privacyHeaderOn(h)) return 'signal';

  const len = Number(h('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) return 'body';
  let text: string;
  try {
    text = await req.text();
  } catch {
    return 'body';
  }
  if (text.length > MAX_BODY_BYTES) return 'body';
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'body';
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body';
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== 'name' || keys[1] !== 'path') return 'invalid';
  const { name, path } = body as { name: unknown; path: unknown };
  if (typeof name !== 'string' || !(BROWSER_EVENTS as readonly string[]).includes(name)) return 'invalid';

  const cookieHeader = h('cookie');
  const sid = parseSid(readCookie(cookieHeader, SID_COOKIE));
  if (!sid) return 'no-cookie';
  if (looksAutomated(h('user-agent'), h('sec-ch-ua'))) return 'bot';

  const lim = await deps.hit([eventIpLimit(deps.ip(req))]).catch(() => 'error' as const);
  if (lim !== 'allowed') return lim === 'limited' ? 'limited' : 'error';

  const src = parseSrc(readCookie(cookieHeader, SRC_COOKIE));
  const row = buildEventRow(name as BrowserEvent, {
    sessionId: sid.sid,
    source: src?.source,
    medium: src?.medium ?? undefined,
    campaign: src?.campaign ?? undefined,
    path: cleanPath(path) ?? undefined,
  });
  if (!row) return 'invalid';
  try {
    await deps.insert(row);
    return 'stored';
  } catch {
    return 'error';
  }
}
