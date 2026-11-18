/**
 * The one place an outbound link for the "Who to contact" block is built.
 * Every external href starts with a fixed https origin, and user or record text only ever lands inside a percent-encoded query value,
 * so no scheme (javascript:, data:, mailto:) can be injected. The only link a record can influence beyond a query is the website an
 * organisation published itself, and that one is parsed, forced to https and rejected unless it looks like a real host.
 */

/** USPS Every Door Direct Mail route tool. Fetched and confirmed on 2026-11-17 (step 1 is "Search for Routes" by ZIP, city or address). */
export const USPS_EDDM_TOOL_URL = 'https://eddm.usps.com/eddm/select-routes.htm';
/** USPS Every Door Direct Mail overview page (confirmed 2026-11-17). Used if the tool page ever has to be dropped. */
export const USPS_EDDM_OVERVIEW_URL = 'https://www.usps.com/business/every-door-direct-mail.htm';

export const GUIDE_STORMS_PATH = '/guides/storm-damage-leads-from-weather-alerts-and-storm-reports';
export const GUIDE_RESPOND_PATH = '/guides/how-to-respond-to-a-local-lead-fast';

export type LinkSpec =
  | { type: 'search'; org: string; city?: string | null; state?: string | null }
  | { type: 'map'; address: string; city?: string | null; state?: string | null; zip?: string | null }
  | { type: 'eddm' }
  | { type: 'website'; url: string }
  | { type: 'guide'; guide: 'storms' | 'respond' };

export interface OutreachLink {
  href: string;
  /** True for links that leave Holler: they open in a new tab with rel="noopener noreferrer". */
  external: boolean;
  target?: '_blank';
  rel?: 'noopener noreferrer';
}

const MAX_TEXT = 200;

/** One line of plain text: control characters and runs of whitespace become single spaces, capped in length. */
export function cleanText(v: string | null | undefined): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function external(href: string): OutreachLink {
  return { href, external: true, target: '_blank', rel: 'noopener noreferrer' };
}

function query(parts: Array<string | null | undefined>): string {
  return parts.map(cleanText).filter(Boolean).join(' ');
}

/** Parses a website the record published. Returns an https URL or null. */
export function safeWebsite(raw: string | null | undefined): string | null {
  const t = cleanText(raw);
  if (!t || /\s/.test(t)) return null;
  let candidate = t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) {
    if (!/^https?:\/\//i.test(t)) return null;
  } else {
    candidate = `https://${t}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    if (!/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.')) return null;
    // Same rules as the write-time check: no raw IP host, no explicit port, no punycode (xn--) label.
    if (u.port) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || /^\d+$/.test(u.hostname.replace(/\./g, ''))) return null;
    if (u.hostname.split('.').some((l) => /^xn--/i.test(l))) return null;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return null;
  }
}

export function buildLink(spec: LinkSpec): OutreachLink | null {
  switch (spec.type) {
    case 'search': {
      const q = query([spec.org, spec.city, spec.state]);
      return cleanText(spec.org) ? external(`https://www.google.com/search?q=${encodeURIComponent(q)}`) : null;
    }
    case 'map': {
      const q = query([spec.address, spec.city, spec.state, spec.zip]);
      return cleanText(spec.address) ? external(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`) : null;
    }
    case 'eddm':
      return external(USPS_EDDM_TOOL_URL);
    case 'website': {
      const url = safeWebsite(spec.url);
      return url ? external(url) : null;
    }
    case 'guide':
      return { href: spec.guide === 'storms' ? GUIDE_STORMS_PATH : GUIDE_RESPOND_PATH, external: false };
    default:
      return null;
  }
}
