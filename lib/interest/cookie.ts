import { FEATURE_IDS, isFeatureId, type FeatureId } from './features';

/**
 * The `holler_picked` cookie: a comma list of feature ids this browser has picked, for example "gov-bids,spanish".
 * It holds no identifier. First party, 180 days, SameSite=Lax. Readable by script on purpose: /pricing stays static and reads it
 * after mount, so the buttons can show "Picked".
 */
export const PICKED_COOKIE = 'holler_picked';
export const PICKED_MAX_AGE = 180 * 24 * 60 * 60;

/** Feature ids found in a cookie value. Unknown ids are dropped, duplicates removed, order follows the feature list. */
export function parsePicked(value: string | null | undefined): FeatureId[] {
  if (!value) return [];
  const found = new Set(value.split(',').map((s) => s.trim()).filter(isFeatureId));
  return FEATURE_IDS.filter((id) => found.has(id));
}

/** Pulls the holler_picked value out of a Cookie header or document.cookie string. */
export function pickedFromCookieString(cookie: string | null | undefined): FeatureId[] {
  if (!cookie) return [];
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== PICKED_COOKIE) continue;
    try {
      return parsePicked(decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      return [];
    }
  }
  return [];
}

/** The Set-Cookie header value for a new list of picks. */
export function pickedSetCookie(ids: readonly FeatureId[], secure: boolean): string {
  const list = FEATURE_IDS.filter((id) => ids.includes(id)).join(',');
  return `${PICKED_COOKIE}=${encodeURIComponent(list)}; Max-Age=${PICKED_MAX_AGE}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}
