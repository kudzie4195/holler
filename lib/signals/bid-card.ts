/**
 * Wording for an open city bid card: "Open bid", the buyer, the due date with the days left, and the "Open the source" link (the link
 * itself is drawn by the feed). Pure and client-safe.
 *
 * The card says what the record says: a solicitation is open and has a due date. It never says the member can win it, may bid on it,
 * is eligible, or is being chosen: a source can name a bid without saying who is allowed to answer it.
 */
export const BID_LABEL = 'Open bid';
export const BID_SOURCE_LINK_LABEL = 'Open the source';
/** Baton Rouge rows link to the City-Parish bid portal, not to a page for that solicitation, so the link says so. */
export const BID_PORTAL_LINK_LABEL = 'Open the bid portal';
const PORTAL_LINK_SOURCES = new Set(['bids-batonrouge']);
/** Text of the source link on a bid card: "Open the bid portal" where the link is a portal, otherwise "Open the source". */
export function bidSourceLinkLabel(source: string | null | undefined): string {
  return source && PORTAL_LINK_SOURCES.has(source) ? BID_PORTAL_LINK_LABEL : BID_SOURCE_LINK_LABEL;
}
export const NO_DUE_DATE_TEXT = 'No due date published';

const DAY_MS = 86_400_000;

/** "2026-12-10" -> "Dec 10, 2026". Null for anything that is not a plain date. */
export function formatDueDate(dueDate: string | null | undefined): string | null {
  if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const d = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** "19 days left", "1 day left", "closes within 24 hours" or "closed". Null when the bid has no due instant. */
export function daysLeftText(expiresAt: string | null | undefined, now: Date): string | null {
  if (typeof expiresAt !== 'string' || !expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  const ms = t - now.getTime();
  if (ms <= 0) return 'closed';
  if (ms < DAY_MS) return 'closes within 24 hours';
  const days = Math.ceil(ms / DAY_MS);
  return days === 1 ? '1 day left' : `${days} days left`;
}

/** "Due Dec 10, 2026, 19 days left" or "No due date published". */
export function bidDueText(b: { dueDate?: string | null; expiresAt?: string | null }, now: Date): string {
  const date = formatDueDate(b.dueDate);
  const left = daysLeftText(b.expiresAt, now);
  if (!date && !left) return NO_DUE_DATE_TEXT;
  return ['Due ' + (date ?? ''), left].filter((p) => p && p !== 'Due ').join(', ');
}

/** The one line under the label on a bid card: "Buyer: Water & Power. Due Dec 10, 2026, 19 days left." */
export function bidCardLine(b: { buyer?: string | null; dueDate?: string | null; expiresAt?: string | null }, now: Date): string {
  const buyer = typeof b.buyer === 'string' && b.buyer.trim() ? `Buyer: ${b.buyer.trim()}. ` : '';
  return `${buyer}${bidDueText(b, now)}.`;
}
