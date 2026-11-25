/**
 * Round 33 (SAM): what a stored SAM.gov notice says about itself, in plain words. Pure and client-safe (it imports only the dictionary).
 *
 * Two things are labelled, and only from fields the notice itself carries:
 *  The whole line is behind HOLLER_SAM_LABELS_ENABLED (sam-labels-switch.ts): off, samCardLine returns null.
 *  - EARLY NOTICE. Sources Sought and Presolicitation (and Intent to Bundle) notices are not bids yet: the agency is asking who could do the
 *    work, or says offers will be asked for later. The card says so. Routing already files them as a heads-up (lead-rules.ts rule
 *    soon-bid-not-open reads NOT_YET_BID_RE (re-exported below), so that rule and this label can never disagree); they are never "act now".
 *    Combined Synopsis/Solicitation and Solicitation are the actual bids and get no early-notice line.
 *  - SET-ASIDE. The notice's typeOfSetAside code (stored by the adapter as data.setAside; only the code is kept). Every code the API documents has its own plain wording in EN and ES (lib/i18n/en-sam.ts, es-sam.ts).
 *
 * The line describes the notice. It never says the member is eligible, may bid, or will be chosen: a set-aside limits who can respond and
 * the notice, not Holler, says who that is.
 */
import { t, type DictKey, type Lang } from '@/lib/i18n';
import { NOT_YET_BID_RE } from './lead-rules';
import { isSoleSourceSetAside, samLabelsEnabled } from './sam-labels-switch';

/** Notice types that are not yet open for offers: the one regex routing uses (lead-rules.ts rule soon-bid-not-open). Re-exported so tests can tie the label to it. */
export { NOT_YET_BID_RE };

/** The 18 typeOfSetAside codes of the Get Opportunities API (https://open.gsa.gov/api/get-opportunities-public-api/, checked 2026-11-25). */
export const SAM_SET_ASIDE_CODES = [
  'SBA', // Total small business set-aside (FAR 19.5)
  'SBP', // Partial small business set-aside (FAR 19.5)
  '8A', // 8(a) set-aside (FAR 19.8)
  '8AN', // 8(a) sole source (FAR 19.8)
  'HZC', // HUBZone set-aside (FAR 19.13)
  'HZS', // HUBZone sole source (FAR 19.13)
  'SDVOSBC', // Service-disabled veteran-owned small business set-aside (FAR 19.14)
  'SDVOSBS', // Service-disabled veteran-owned small business sole source (FAR 19.14)
  'WOSB', // Women-owned small business program set-aside (FAR 19.15)
  'WOSBSS', // Women-owned small business program sole source (FAR 19.15)
  'EDWOSB', // Economically disadvantaged WOSB program set-aside (FAR 19.15)
  'EDWOSBSS', // Economically disadvantaged WOSB program sole source (FAR 19.15)
  'LAS', // Local area set-aside (FAR 26.2)
  'IEE', // Indian Economic Enterprise set-aside (Department of the Interior)
  'ISBEE', // Indian Small Business Economic Enterprise set-aside (Department of the Interior)
  'BICiv', // Buy Indian set-aside (HHS, Indian Health Service)
  'VSA', // Veteran-owned small business set-aside (Department of Veterans Affairs)
  'VSS', // Veteran-owned small business sole source (Department of Veterans Affairs)
] as const;
export type SamSetAsideCode = (typeof SAM_SET_ASIDE_CODES)[number];

const CODE_BY_UPPER = new Map<string, SamSetAsideCode>(SAM_SET_ASIDE_CODES.map((c) => [c.toUpperCase(), c]));
/**
 * A value that says there is NO set-aside: none, n/a, "No Set aside used", "Full and Open Competition", "Unrestricted", "Not Applicable".
 * Matched anywhere in the text, so the API's own phrasing for an open competition never becomes a restriction on a card.
 */
const NONE_RE = /^(?:none|n\/?a|null|undefined|-+)$|no\s+set[- ]?aside|full\s+(?:and|&)\s+open|unrestricted|not\s+applicable|open\s+(?:market|competition)|no\s+restriction/i;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** The documented code a raw typeOfSetAside value stands for ("sba", "SBA", " 8A "), or null when it is none or not a documented code. */
export function setAsideCodeOf(raw: unknown): SamSetAsideCode | null {
  return CODE_BY_UPPER.get(text(raw).toUpperCase()) ?? null;
}

/** True when a raw set-aside value (code or description) says there is no set-aside. */
export function isNoSetAside(raw: unknown): boolean {
  const s = text(raw);
  return s === '' || NONE_RE.test(s);
}

/**
 * The code behind the API's own description text ("Total Small Business Set-Aside (FAR 19.5)"). For a notice whose code is missing or not
 * one of the 18. Sole-source wording is checked first, then the narrower program before the wider one (ISBEE before IEE, EDWOSB before
 * WOSB, service-disabled veteran before veteran).
 */
export function setAsideCodeFromDescription(desc: unknown): SamSetAsideCode | null {
  const d = text(desc);
  if (!d || isNoSetAside(d)) return null;
  const sole = /sole[\s-]*source/i.test(d);
  if (/hubzone/i.test(d)) return sole ? 'HZS' : 'HZC';
  if (/\b8\s*\(\s*a\s*\)|\b8a\b/i.test(d)) return sole ? '8AN' : '8A';
  if (/service[\s-]*disabled|sdvosb/i.test(d)) return sole ? 'SDVOSBS' : 'SDVOSBC';
  if (/economically\s+disadvantaged|edwosb/i.test(d)) return sole ? 'EDWOSBSS' : 'EDWOSB';
  if (/women[\s-]*owned|wosb/i.test(d)) return sole ? 'WOSBSS' : 'WOSB';
  if (/veteran/i.test(d)) return sole ? 'VSS' : 'VSA';
  if (/indian\s+small\s+business|isbee/i.test(d)) return 'ISBEE';
  if (/buy\s+indian/i.test(d)) return 'BICiv';
  if (/indian\s+economic|\biee\b/i.test(d)) return 'IEE';
  if (/local\s+area/i.test(d)) return 'LAS';
  if (/partial\s+small\s+business/i.test(d)) return 'SBP';
  if (/small\s+business/i.test(d)) return 'SBA';
  return null;
}

/**
 * The code to store for a notice: the documented code when the API sent one, else the code its description names, else null (no set-aside).
 * An undocumented non-empty code is kept as the API's own text (upper-cased, 12 characters at most) so the card can still say "set aside
 * for certain businesses" instead of dropping it.
 */
export function storedSetAside(rawCode: unknown, rawDesc: unknown): string | null {
  const known = setAsideCodeOf(rawCode);
  if (known) return known;
  const fromDesc = setAsideCodeFromDescription(rawDesc);
  if (fromDesc) return fromDesc;
  const code = text(rawCode);
  if (code && !isNoSetAside(code)) return code.toUpperCase().slice(0, 12);
  const desc = text(rawDesc);
  // A description alone must say it is a set-aside or a sole source before it becomes a restriction on a card.
  if (desc && !isNoSetAside(desc) && /set[- ]?aside|sole[\s-]*source|restricted/i.test(desc)) return 'OTHER';
  return null;
}

/** Dictionary key for a stored set-aside (data.setAside; a description is a fallback for a caller that has one), or null when the notice has none. */
export function setAsideKey(stored: unknown, description?: unknown): DictKey | null {
  const s = text(stored);
  if (isNoSetAside(s) && isNoSetAside(description)) return null;
  const code = setAsideCodeOf(s) ?? setAsideCodeFromDescription(description) ?? setAsideCodeFromDescription(s);
  if (code) return `sam.setaside.${code.toLowerCase()}` as DictKey;
  return 'sam.setaside.other';
}

/** "Set aside for small businesses" in the member's language, or null when the notice has no set-aside. No trailing full stop. */
export function setAsideLabel(stored: unknown, description: unknown, lang: Lang = 'en'): string | null {
  const key = setAsideKey(stored, description);
  return key ? t(lang, key) : null;
}

export { isSoleSourceSetAside };

export type SamNoticeKind = 'sources-sought' | 'presolicitation' | 'bundle' | 'bid' | 'other';

/** What kind of notice a SAM notice type string is. Solicitation and Combined Synopsis/Solicitation are the real bids. */
export function samNoticeKind(type: unknown): SamNoticeKind {
  const s = text(type);
  if (!s) return 'other';
  if (/sources?\s+sought/i.test(s)) return 'sources-sought';
  if (/pre-?\s?solicitation/i.test(s)) return 'presolicitation';
  if (/intent\s+to\s+bundle/i.test(s)) return 'bundle';
  if (/solicitation|synopsis/i.test(s)) return 'bid';
  return 'other';
}

/** True for a notice that is not a bid yet (Sources Sought, Presolicitation, Intent to Bundle). */
export function isEarlyNoticeType(type: unknown): boolean {
  const k = samNoticeKind(type);
  return k === 'sources-sought' || k === 'presolicitation' || k === 'bundle';
}

/** The notice type of a SAM row: the summary's first part (lib/signals/adapters/sam.ts writes it first), unless the caller has data.type. */
export function samTypeOf(summary: string | null | undefined, type?: unknown): string {
  const t0 = text(type);
  if (t0) return t0;
  return (summary ?? '').split(' | ')[0]?.trim() ?? '';
}

/** "Early notice: the agency is asking who could do this work. Not open for offers yet." or null for a bid. */
export function earlyNoticeLine(type: unknown, lang: Lang = 'en'): string | null {
  switch (samNoticeKind(type)) {
    case 'sources-sought':
      return t(lang, 'sam.early.sources_sought');
    case 'presolicitation':
      return t(lang, 'sam.early.presolicitation');
    case 'bundle':
      return t(lang, 'sam.early.bundle');
    default:
      return null;
  }
}

export interface SamCardInput {
  source: string | null | undefined;
  summary?: string | null;
  /** data.type, when the caller selected it. Otherwise the summary's first part is used. */
  type?: unknown;
  /** data.setAside */
  setAside?: unknown;
  /** The API's description text, for a caller that has it (the stored row keeps only the code). */
  setAsideDescription?: unknown;
}

/**
 * The line a federal notice card carries under its label: the early-notice sentence, then the set-aside sentence. Null for any other source
 * and for a notice with neither. The card, the mobile feed and the alert email all print this one string.
 */
export function samCardLine(s: SamCardInput, lang: Lang = 'en', on: boolean = samLabelsEnabled()): string | null {
  // Switch off (HOLLER_SAM_LABELS_ENABLED unset): no line, so every card and email is what it was before round 33.
  if (!on || s.source !== 'sam-gov') return null;
  const early = earlyNoticeLine(samTypeOf(s.summary, s.type), lang);
  const aside = setAsideLabel(s.setAside, s.setAsideDescription, lang);
  const parts = [early, aside ? `${aside}.` : null].filter((p): p is string => !!p);
  return parts.length ? parts.join(' ') : null;
}

/** PostgREST select alias for the stored set-aside code (holler_signals.data.setAside). A missing key reads as null, so no migration is involved. */
export const SAM_SELECT = 'samSetAside:data->>setAside';
