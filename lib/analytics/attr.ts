/**
 * Pure helpers shared by the browser component and the server: cleaning of campaign values, the two cookies, the privacy signals.
 * No server-only imports, no Next imports, no storage of anything but what these functions return.
 *
 * Cookies (both first party, 30 days, SameSite=Lax, path /):
 *   holler_src  "<source>.<medium>.<campaign>", each part lowercase letters, digits, dash, underscore, at most 40 characters, may be empty.
 *               First touch wins: written once, never overwritten.
 *   holler_sid  "<random id>.<day>": a random 22 character url-safe id and the UTC day number (days since 1970) of the last visit counted.
 */
export const SRC_COOKIE = 'holler_src';
export const SID_COOKIE = 'holler_sid';
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
export const TOKEN_MAX = 40;
export const PATH_MAX = 80;

export interface Attribution {
  source: string;
  medium: string | null;
  campaign: string | null;
}

/**
 * One campaign value cleaned to [a-z0-9_-], at most 40 characters, or null when nothing usable is left.
 * Accents are folded (cafe from cafe with an accent), spaces and other characters become a dash, runs of dashes collapse, and leading and
 * trailing dashes go. Characters from other scripts are dropped, so an all-unicode value comes out null.
 */
export function cleanToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Cap the input first so a megabyte of hostile text costs nothing.
  const s = value
    .slice(0, 400)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, TOKEN_MAX)
    .replace(/[-_]+$/g, '');
  return s.length > 0 ? s : null;
}

/** Known shortcuts: ?ref=ig|x|tt|appstore|play. */
export const REF_SHORTCUTS: Readonly<Record<string, Attribution>> = {
  ig: { source: 'instagram', medium: 'social', campaign: null },
  x: { source: 'x', medium: 'social', campaign: null },
  tt: { source: 'tiktok', medium: 'social', campaign: null },
  appstore: { source: 'appstore', medium: 'store', campaign: null },
  play: { source: 'play', medium: 'store', campaign: null },
};

/** Attribution carried by a query string, or null. utm_source wins over ref. */
export function attributionFromSearch(search: string): Attribution | null {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search.slice(0, 2000));
  } catch {
    return null;
  }
  const source = cleanToken(p.get('utm_source'));
  if (source) return { source, medium: cleanToken(p.get('utm_medium')), campaign: cleanToken(p.get('utm_campaign')) };
  const ref = (p.get('ref') ?? '').trim().toLowerCase();
  const hit = Object.prototype.hasOwnProperty.call(REF_SHORTCUTS, ref) ? REF_SHORTCUTS[ref] : null;
  return hit ? { ...hit } : null;
}

export function encodeSrc(a: Attribution): string {
  return `${a.source}.${a.medium ?? ''}.${a.campaign ?? ''}`;
}

/** Parses a holler_src value. Anything that is not exactly three clean parts with a source is null (and is overwritten by the next capture). */
export function parseSrc(value: string | null | undefined): Attribution | null {
  if (!value || value.length > 130) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [s, m, c] = parts;
  const ok = (x: string) => x === '' || (cleanToken(x) === x);
  if (s === '' || !ok(s) || !ok(m) || !ok(c)) return null;
  return { source: s, medium: m || null, campaign: c || null };
}

const SID_RE = /^[A-Za-z0-9_-]{22,40}$/;
export const isSessionId = (v: unknown): v is string => typeof v === 'string' && SID_RE.test(v);

export interface SidCookie {
  sid: string;
  /** UTC day number of the last counted visit, 0 when unknown. */
  day: number;
}

export function parseSid(value: string | null | undefined): SidCookie | null {
  if (!value || value.length > 60) return null;
  const [sid, day, extra] = value.split('.');
  if (extra !== undefined || !isSessionId(sid)) return null;
  if (day === undefined || day === '') return { sid, day: 0 };
  if (!/^\d{1,6}$/.test(day)) return null;
  return { sid, day: Number(day) };
}

export const encodeSid = (c: SidCookie): string => `${c.sid}.${c.day}`;
export const utcDay = (ms: number): number => Math.floor(ms / 86_400_000);

/** 16 random bytes as 22 url-safe characters. */
export function newSessionId(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** One cookie out of a Cookie header or document.cookie string. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function cookieString(name: string, value: string, secure: boolean): string {
  return `${name}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export function expiredCookieString(name: string, secure: boolean): string {
  return `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Global Privacy Control or Do Not Track from the browser object (navigator). Any one of them on means: set nothing, send nothing. */
export function privacySignalOn(nav: { globalPrivacyControl?: unknown; doNotTrack?: unknown; msDoNotTrack?: unknown } | null | undefined, win?: { doNotTrack?: unknown } | null): boolean {
  const on = (v: unknown) => v === true || v === '1' || v === 1 || v === 'yes';
  return on(nav?.globalPrivacyControl) || on(nav?.doNotTrack) || on(nav?.msDoNotTrack) || on(win?.doNotTrack);
}

/** The same two signals as request headers: Sec-GPC: 1 and DNT: 1. */
export function privacyHeaderOn(get: (name: string) => string | null | undefined): boolean {
  return get('sec-gpc')?.trim() === '1' || get('dnt')?.trim() === '1';
}

/** A page path only. Anything with a character outside [A-Za-z0-9/_.-], a query string, a fragment or more than 80 characters is null. */
export function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > PATH_MAX) return null;
  return /^\/[A-Za-z0-9/_.-]*$/.test(value) ? value : null;
}

const BOT_UA = /bot|crawl|spider|slurp|headless|phantom|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|node-fetch|undici|axios|go-http|java\/|libwww|httpclient|scrapy|facebookexternalhit|selenium|puppeteer|playwright|jsdom/i;
/** Obvious automation by user agent or client hint. The value is only inspected, never stored. */
export function looksAutomated(userAgent: string | null | undefined, secChUa?: string | null): boolean {
  if (!userAgent || userAgent.length < 10) return true;
  if (BOT_UA.test(userAgent.slice(0, 300))) return true;
  return !!secChUa && /headless/i.test(secChUa.slice(0, 300));
}
