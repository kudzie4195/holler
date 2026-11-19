import {
  attributionFromSearch,
  cleanPath,
  cookieString,
  encodeSid,
  encodeSrc,
  expiredCookieString,
  newSessionId,
  parseSid,
  parseSrc,
  privacySignalOn,
  readCookie,
  SID_COOKIE,
  SRC_COOKIE,
  utcDay,
} from './attr';

/** What the browser gives the tracker. Injected so tests run without a DOM. */
export interface ClientEnv {
  getCookie: () => string;
  setCookie: (value: string) => void;
  navigator: { globalPrivacyControl?: unknown; doNotTrack?: unknown; msDoNotTrack?: unknown; webdriver?: unknown; sendBeacon?: (url: string, data: Blob) => boolean };
  win?: { doNotTrack?: unknown } | null;
  search: string;
  pathname: string;
  secure: boolean;
  now: () => number;
  randomBytes: () => Uint8Array;
  native: boolean;
  fetchFn?: (url: string, init: RequestInit) => Promise<unknown>;
}

export type ClientResult = 'off' | 'no-cookies' | 'counted' | 'already';

export const EVENT_URL = '/api/e';

/**
 * Runs once per full page load from components/analytics.tsx.
 *  1. Global Privacy Control or Do Not Track on: set no cookie, send nothing, and remove the two cookies if they are already there.
 *  2. First touch: a utm_source or ?ref= shortcut with no holler_src cookie yet sets it. Never overwritten.
 *  3. One visit beacon per session per UTC day. holler_sid carries the random id and the day of the last counted visit.
 */
export function runAnalytics(env: ClientEnv): ClientResult {
  if (privacySignalOn(env.navigator, env.win)) {
    const have = readCookie(env.getCookie(), SRC_COOKIE) !== null || readCookie(env.getCookie(), SID_COOKIE) !== null;
    if (have) {
      env.setCookie(expiredCookieString(SRC_COOKIE, env.secure));
      env.setCookie(expiredCookieString(SID_COOKIE, env.secure));
    }
    return 'off';
  }
  // Automated browsers announce themselves with navigator.webdriver. They get nothing and send nothing.
  if (env.navigator.webdriver === true) return 'off';

  if (!parseSrc(readCookie(env.getCookie(), SRC_COOKIE))) {
    const a = attributionFromSearch(env.search);
    if (a) env.setCookie(cookieString(SRC_COOKIE, encodeSrc(a), env.secure));
  }

  const today = utcDay(env.now());
  const existing = parseSid(readCookie(env.getCookie(), SID_COOKIE));
  if (existing && existing.day === today) return 'already';
  const sid = existing?.sid ?? newSessionId(env.randomBytes());
  env.setCookie(cookieString(SID_COOKIE, encodeSid({ sid, day: today }), env.secure));
  // A browser that refuses cookies cannot keep a session: count nothing.
  if (!parseSid(readCookie(env.getCookie(), SID_COOKIE))) return 'no-cookies';

  const body = JSON.stringify({ name: env.native ? 'app_open' : 'visit', path: cleanPath(env.pathname) ?? '/' });
  try {
    const ok = env.navigator.sendBeacon ? env.navigator.sendBeacon(EVENT_URL, new Blob([body], { type: 'application/json' })) : false;
    if (!ok && env.fetchFn) {
      void Promise.resolve(env.fetchFn(EVENT_URL, { method: 'POST', body, keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json' } })).catch(() => {});
    }
  } catch {
    // Never let analytics break a page.
  }
  return 'counted';
}
