/**
 * Wording for an open city bid card: "Open bid", the buyer, the due date with the days left, and the "Open the source" link (the link
 * itself is drawn by the feed). Pure and client-safe.
 *
 * The card says what the record says: a solicitation is open and has a due date. It never says the member can win it, may bid on it,
 * is eligible, or is being chosen: a source can name a bid without saying who is allowed to answer it.
 */
import { localizeDate, t, type Lang } from '@/lib/i18n';

export const BID_LABEL = 'Open bid';
export const BID_SOURCE_LINK_LABEL = 'Open the source';
/** Baton Rouge rows link to the City-Parish bid portal, not to a page for that solicitation, so the link says so. */
export const BID_PORTAL_LINK_LABEL = 'Open the bid portal';
const PORTAL_LINK_SOURCES = new Set(['bids-batonrouge']);
/**
 * Rockdale's page has no link per solicitation, so every row links to the county's OWN list page (not a portal): "Open the agency's bid
 * list". The other Firecrawl agency pages link to a bid document or, when a row has none, to their own list page; "Open the source" fits both.
 */
export const BID_LIST_LINK_LABEL = "Open the agency's bid list";
const LIST_LINK_SOURCES = new Set(['bids-rockdale']);
/** Text of the source link on a bid card: "Open the bid portal" where the link is a portal, "Open the agency's bid list" where it is the agency's own list page, otherwise "Open the source". */
export function bidSourceLinkLabel(source: string | null | undefined): string {
  if (source && PORTAL_LINK_SOURCES.has(source)) return BID_PORTAL_LINK_LABEL;
  if (source && LIST_LINK_SOURCES.has(source)) return BID_LIST_LINK_LABEL;
  return BID_SOURCE_LINK_LABEL;
}
export const NO_DUE_DATE_TEXT = 'No due date published';

const DAY_MS = 86_400_000;

/** "2026-12-10" -> "Dec 10, 2026". Null for anything that is not a plain date. */
export function formatDueDate(dueDate: string | null | undefined, lang: Lang = 'en'): string | null {
  if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const d = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const en = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
  return lang === 'en' ? en : localizeDate(en, lang);
}

/** "19 days left", "1 day left", "closes within 24 hours" or "closed". Null when the bid has no due instant. */
export function daysLeftText(expiresAt: string | null | undefined, now: Date, lang: Lang = 'en'): string | null {
  if (typeof expiresAt !== 'string' || !expiresAt) return null;
  const due = Date.parse(expiresAt);
  if (!Number.isFinite(due)) return null;
  const ms = due - now.getTime();
  if (ms <= 0) return t(lang, 'bid.closed');
  if (ms < DAY_MS) return t(lang, 'bid.closes_24');
  const days = Math.ceil(ms / DAY_MS);
  return days === 1 ? t(lang, 'bid.day_left') : t(lang, 'bid.days_left', { n: days });
}

/** "Due Dec 10, 2026, 19 days left" or "No due date published". */
export function bidDueText(b: { dueDate?: string | null; expiresAt?: string | null }, now: Date, lang: Lang = 'en'): string {
  const date = formatDueDate(b.dueDate, lang);
  const left = daysLeftText(b.expiresAt, now, lang);
  if (!date && !left) return t(lang, 'bid.none');
  return [date ? t(lang, 'bid.due', { date }) : null, left].filter((p) => p).join(', ');
}

/** The one line under the label on a bid card: "Buyer: Water & Power. Due Dec 10, 2026, 19 days left." */
export function bidCardLine(b: { buyer?: string | null; dueDate?: string | null; expiresAt?: string | null }, now: Date, lang: Lang = 'en'): string {
  const buyer = typeof b.buyer === 'string' && b.buyer.trim() ? `${t(lang, 'bid.buyer', { buyer: b.buyer.trim() })} ` : '';
  return `${buyer}${bidDueText(b, now, lang)}.`;
}
