import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { MAX_REPLIES_PER_REQUEST } from '../requests/constants';
import { contactAddress, escapeHtml, type Rendered } from './templates';
import { EMAIL_STYLE, buttonHtml, cardClose, wrapOpen, WRAP_CLOSE as THEME_WRAP_CLOSE } from './theme';

/**
 * Emails for resident service requests. Same look as lib/email/templates.ts (styles from lib/email/theme.ts, helpers imported).
 * None of these ever contains the resident's email address: it is only ever the `to` of the confirm and reply emails.
 */

const WRAP_OPEN = wrapOpen();
const WRAP_CLOSE = THEME_WRAP_CLOSE;
const S = EMAIL_STYLE;
const MUTED = S.muted;

function button(href: string, label: string): string {
  return buttonHtml(escapeHtml(href), escapeHtml(label));
}

/** No em dashes in anything we send (house rule), no line breaks in one-line values, and a sane length. */
function oneLine(s: string, max = 120): string {
  return s.replace(/[—–]/g, '-').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function noDash(s: string): string {
  return s.replace(/[—–]/g, '-');
}
/** Escaped multi-line text with line breaks kept. */
function paragraphs(s: string): string {
  return escapeHtml(noDash(s)).replace(/\r?\n/g, '<br>');
}
/**
 * A business name as it may appear in a subject line or a heading (review P2-7): Unicode folded (NFKC), control, format and bidi
 * characters and line breaks removed, links, web addresses and email addresses removed, spaces collapsed, at most 80 characters.
 * Empty -> "A business". HTML escaping still happens where it is used.
 */
export function cleanBusinessName(raw: string | null | undefined): string {
  const s = String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\p{C}\u2028\u2029]/gu, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ')
    .replace(/\bwww\b\S*/gi, ' ')
    .replace(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)*/g, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,24}\b(?:\/\S*)?/gi, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, '');
  return s || 'A business';
}

/** A business reply as plain text: Unicode folded, invisible and control characters removed (line breaks kept). Escaped where shown. */
export function plainReply(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F-\u009F]/gu, '')
    .trim();
}

function quote(html: string): string {
  return `<blockquote style="margin:16px 0;padding:12px 16px;${S.quote}">${html}</blockquote>`;
}

export function renderRequestConfirm(opts: {
  confirmUrl: string;
  tradeLabel: string;
  place: string;
  summary: string | null;
  openDays: number;
  confirmDays: number;
}): Rendered {
  const subject = 'Confirm your request on Holler';
  const shown = opts.summary ?? '(no description, only the service and your city)';
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">Confirm your request</h1>` +
    `<p>You asked for ${escapeHtml(oneLine(opts.tradeLabel))} in ${escapeHtml(oneLine(opts.place))}. Nothing is shared until you press the button.</p>` +
    button(opts.confirmUrl, 'Confirm my request') +
    `<p>After you confirm, Holler's public pages show only the service and your city. Matching businesses near you see this:</p>` +
    quote(`<strong>${escapeHtml(oneLine(opts.tradeLabel))} in ${escapeHtml(oneLine(opts.place))}</strong><br>${escapeHtml(noDash(shown))}`) +
    `<p>A filter took out phone numbers, emails, links, street addresses and names. It can miss things. Businesses reply by email through Holler. They never see your address unless you answer them. Your request stays open ${opts.openDays} days.</p>` +
    `<p style="${MUTED}">${notYou(opts.confirmDays)}${contactLine()}</p>` +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text =
    `Confirm your request\n\nYou asked for ${oneLine(opts.tradeLabel)} in ${oneLine(opts.place)}. Nothing is shared until you open this link and press the button:\n\n${opts.confirmUrl}\n\n` +
    `After you confirm, Holler's public pages show only the service and your city. Matching businesses near you see this:\n\n${oneLine(opts.tradeLabel)} in ${oneLine(opts.place)}\n${noDash(shown)}\n\n` +
    `A filter took out phone numbers, emails, links, street addresses and names. It can miss things. Businesses reply by email through Holler. They never see your address unless you answer them. Your request stays open ${opts.openDays} days.\n\n` +
    `${notYou(opts.confirmDays)}\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}

export function renderRequestReply(opts: {
  businessName: string;
  businessPlace: string | null;
  message: string;
  tradeLabel: string;
  place: string;
  closeUrl: string;
  /** Support address for "report this reply". Omitted when no address is configured. */
  reportAddress: string | null;
  replyRef: string;
}): Rendered {
  const name = cleanBusinessName(opts.businessName);
  const subject = `${name} replied to your request on Holler`;
  const place = opts.businessPlace ? cleanBusinessName(opts.businessPlace) : null;
  const from = place && place !== 'A business' ? `${name}, ${place}` : name;
  const message = plainReply(opts.message);
  const report = opts.reportAddress
    ? `mailto:${opts.reportAddress}?subject=${encodeURIComponent(`Report reply ${opts.replyRef}`)}`
    : null;
  const html =
    WRAP_OPEN +
    `<p style="margin:0 0 4px 0;${MUTED}">Your request: ${escapeHtml(oneLine(opts.tradeLabel))} in ${escapeHtml(oneLine(opts.place))}</p>` +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">${escapeHtml(subject)}</h1>` +
    quote(paragraphs(message)) +
    `<p>From <strong>${escapeHtml(from)}</strong>.</p>` +
    `<p>Reply to this email to answer them. Your reply goes straight to the business, so they will see your email address then.</p>` +
    `<p style="${MUTED}">Holler does not check businesses or their work. Ask for a license and insurance where your state needs them.</p>` +
    `<p style="${MUTED}">Got what you need? <a href="${escapeHtml(opts.closeUrl)}" style="${S.mutedLink}">Close my request</a>. Closed requests get no more replies.` +
    (report ? ` Something wrong with this reply? <a href="${escapeHtml(report)}" style="${S.mutedLink}">Report this reply</a>.` : '') +
    `</p>` +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text =
    `Your request: ${oneLine(opts.tradeLabel)} in ${oneLine(opts.place)}\n\n${subject}\n\n${noDash(message)}\n\nFrom ${from}.\n\n` +
    `Reply to this email to answer them. Your reply goes straight to the business, so they will see your email address then.\n\n` +
    `Holler does not check businesses or their work. Ask for a license and insurance where your state needs them.\n\n` +
    `Got what you need? Close my request: ${opts.closeUrl}\n` +
    (report ? `Something wrong with this reply? Report it: ${opts.reportAddress} (subject: Report reply ${opts.replyRef})\n` : '') +
    `\n${postalFooterText()}\n`;
  return { subject, html, text };
}

/**
 * To the resident right after they confirm: the request is live, what happens next, and the close link. Without it a resident whose
 * request gets no reply would have no email with a close link (the confirm page shows it once).
 */
export function renderRequestPublished(opts: {
  tradeLabel: string;
  place: string;
  summary: string | null;
  closeUrl: string;
  openDays: number;
}): Rendered {
  const subject = 'Your request is live on Holler';
  const shown = opts.summary ?? '(no description, only the service and your city)';
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">Your request is live</h1>` +
    `<p>Your request for ${escapeHtml(oneLine(opts.tradeLabel))} in ${escapeHtml(oneLine(opts.place))} is on Holler now. Public pages show only the service and your city. We sent this to matching businesses near you:</p>` +
    quote(`<strong>${escapeHtml(oneLine(opts.tradeLabel))} in ${escapeHtml(oneLine(opts.place))}</strong><br>${escapeHtml(noDash(shown))}`) +
    `<p>Replies come to this inbox from Holler. Up to ${MAX_REPLIES_PER_REQUEST} businesses can reply. It stays open ${opts.openDays} days, then it comes down by itself.</p>` +
    `<p style="${MUTED}">Holler does not check businesses or their work. This is not for emergencies.</p>` +
    `<p>Got what you need? Close it. It leaves Holler's pages within about 15 minutes, and we delete your email address and your description.</p>` +
    button(opts.closeUrl, 'Close my request') +
    `<p style="${MUTED}">Keep this email. The same close link is in every reply we forward.${contactLine()}</p>` +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text =
    `Your request is live\n\nYour request for ${oneLine(opts.tradeLabel)} in ${oneLine(opts.place)} is on Holler now. Public pages show only the service and your city. We sent this to matching businesses near you:\n\n` +
    `${oneLine(opts.tradeLabel)} in ${oneLine(opts.place)}\n${noDash(shown)}\n\n` +
    `Replies come to this inbox from Holler. Up to ${MAX_REPLIES_PER_REQUEST} businesses can reply. It stays open ${opts.openDays} days, then it comes down by itself.\n\n` +
    `Holler does not check businesses or their work. This is not for emergencies.\n\n` +
    `Got what you need? Close it. It leaves Holler's pages within about 15 minutes, and we delete your email address and your description: ${opts.closeUrl}\n\n` +
    `Keep this email. The same close link is in every reply we forward.\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}

/** To the site owner when a request goes live: the full text and a one-click remove link. No resident email address. */
export function renderRequestAdmin(opts: {
  tradeLabel: string;
  place: string;
  zip: string;
  description: string;
  summary: string | null;
  publicId: string;
  removeUrl: string;
}): Rendered {
  const subject = oneLine(`New request on Holler: ${opts.tradeLabel} in ${opts.place}`);
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">${escapeHtml(subject)}</h1>` +
    `<p style="${MUTED}">ZIP ${escapeHtml(oneLine(opts.zip, 10))} &middot; ${escapeHtml(oneLine(opts.publicId, 40))}</p>` +
    `<p><strong>What the resident wrote</strong></p>` +
    quote(paragraphs(opts.description)) +
    `<p><strong>What is public</strong></p>` +
    quote(escapeHtml(noDash(opts.summary ?? '(no summary, title only)'))) +
    `<p>If this breaks the rules, remove it. That takes it off public pages within about 15 minutes, stops replies and deletes the resident's email address and description.</p>` +
    button(opts.removeUrl, 'Remove this request') +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text =
    `${subject}\n\nZIP ${oneLine(opts.zip, 10)} | ${oneLine(opts.publicId, 40)}\n\nWhat the resident wrote:\n${noDash(opts.description)}\n\n` +
    `What is public:\n${noDash(opts.summary ?? '(no summary, title only)')}\n\n` +
    `If this breaks the rules, remove it. That takes it off public pages within about 15 minutes, stops replies and deletes the resident's email address and description.\n\n${opts.removeUrl}\n\n${postalFooterText()}\n`;
  return { subject, html, text };
}

/** The confirm email's "not me" line (round 3, P2-5/P2-6). */
function notYou(confirmDays: number): string {
  return `If this was not you, ignore this email. Nothing is posted and the request is deleted in ${confirmDays} days.`;
}

function contactLine(): string {
  const a = contactAddress();
  return a ? ` Questions? <a href="mailto:${escapeHtml(a)}" style="${S.mutedLink}">Contact us</a>.` : '';
}
function contactText(): string {
  const a = contactAddress();
  return a ? `\nQuestions? Contact us: ${a}\n` : '';
}
