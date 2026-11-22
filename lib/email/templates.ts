import { relativeTime } from '../time';
import { CADENCE_SHORT } from '../seo/cadence';
import { env, siteUrl } from '../env';
import { HOLLER_REQUEST_SOURCE } from '../signals/request-visibility';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { INTENT_LABEL, intentLine, intentOf } from '../signals/intent';
import { OPPORTUNITY_LABEL, OPPORTUNITY_RANK, type Opportunity } from '../signals/opportunity';
import { TRIAL_DAYS } from '../auth/membership';
import { EMAIL_COLORS, EMAIL_STYLE, buttonHtml, cardClose, wrapOpen, WRAP_CLOSE as THEME_WRAP_CLOSE } from './theme';

export interface DigestItem {
  kind: string;
  /** Source id and data.subtype of the record. Used for the intent label; without them the label comes from the kind alone. */
  source?: string | null;
  subtype?: string | null;
  title: string;
  place?: string | null;
  occurredAt: string;
  sourceUrl?: string | null;
  /** Resident requests only: the filtered description, read with the service role for this member's own match. Plain text. */
  detail?: string | null;
  /**
   * One organization the record names, in plain words (see lib/outreach/plan.ts emailContact). Name and role only: the email never
   * carries an address, phone number or email address. Absent when the record names no organization.
   */
  contact?: { name: string; role: string } | null;
  /** One short AI line on why this record may matter to the member's trade (lib/ai notesFor). Plain text, checked when written. */
  note?: string | null;
  /**
   * The record's opportunity for this member (lib/signals/member-opportunity.ts): label, why, next step and what is not known. When
   * set it replaces the intent label and line. The instant digest carries only 'act' and 'soon' items (Act now first); 'intel' and
   * 'context' items passed here are left out.
   */
  opportunity?: { label: Opportunity; why: string; next: string; uncertain: string } | null;
}

/** Labels the instant digest shows, in order. Market insights are in the feed only; context is never an alert. */
export const DIGEST_OPPORTUNITIES: readonly Opportunity[] = ['act', 'soon'];

/**
 * Digest order: items with an opportunity label first, Act now before Coming soon (input order kept inside each label), then items
 * without one (older callers). Items labelled 'intel' or 'context' are dropped. Pure.
 */
export function digestOrder<T extends Pick<DigestItem, 'opportunity'>>(items: readonly T[]): T[] {
  const kept = items.filter((it) => !it.opportunity || DIGEST_OPPORTUNITIES.includes(it.opportunity.label));
  const rank = (it: T) => (it.opportunity ? OPPORTUNITY_RANK[it.opportunity.label] : -1);
  return kept
    .map((it, i) => ({ it, i }))
    .sort((a, b) => rank(b.it) - rank(a.it) || a.i - b.i)
    .map((x) => x.it);
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const KIND_LABELS: Record<string, string> = {
  ask: 'Someone is asking',
  alert: 'Weather alert',
  report: 'Storm report',
  permit: 'Building permit',
  civic: 'City data',
  contract: 'Federal contract',
  event: 'Big event',
  disaster: 'Disaster declaration',
  quake: 'Earthquake',
  travel: 'Airport delays',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? 'Local signal';
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) URLs are allowed into href attributes. */
function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : null;
}

/**
 * A resident request links to Holler's own /request page (lib/requests/signal.ts), not to a public source, so its link says
 * "Open the request". Known by its source id, or by a link to this site's /request page when the source is not passed.
 */
export function isResidentRequest(it: Pick<DigestItem, 'source' | 'sourceUrl'>, base: string = siteUrl): boolean {
  if (it.source === HOLLER_REQUEST_SOURCE) return true;
  if (!it.sourceUrl) return false;
  return it.sourceUrl.replace(/[?#].*$/, '').replace(/\/$/, '') === `${base.replace(/\/$/, '')}/request`;
}

/** Label of the link under a digest item. */
export function digestLinkLabel(it: Pick<DigestItem, 'source' | 'sourceUrl'>, base: string = siteUrl): string {
  return isResidentRequest(it, base) ? 'Open the request' : 'Open the source';
}

/** Text we show must never contain an em dash (house copy rule), including text from sources. */
function noDash(s: string): string {
  return s.replace(/—/g, '-');
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  return relativeTime(iso, now.getTime(), 'email');
}

/** "Contact: Acme Roofing LLC (General contractor on this permit)". Plain text; callers escape it for HTML. */
export function contactLine(c: { name: string; role: string }): string {
  return noDash(`Contact: ${c.name} (${c.role})`);
}

// Look comes from lib/email/theme.ts (one place for every color and font).
const WRAP_OPEN = wrapOpen();
const WRAP_CLOSE = THEME_WRAP_CLOSE;
const S = EMAIL_STYLE;

/**
 * Where a reader can reach a person. SUPPORT_EMAIL when set, otherwise the address inside EMAIL_FROM
 * ("Holler <alerts@x.com>" gives alerts@x.com). Null when neither is set, in which case no contact line is shown.
 */
export function contactAddress(): string | null {
  const support = env.SUPPORT_EMAIL?.trim();
  if (support) return support;
  const from = env.EMAIL_FROM?.trim();
  if (!from) return null;
  const m = from.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (m) return m[1];
  return /^[^\s<>@]+@[^\s<>@]+$/.test(from) ? from : null;
}

function contactHtml(): string {
  const a = contactAddress();
  return a ? ` Questions? <a href="mailto:${escapeHtml(a)}" style="${S.mutedLink}">Contact us</a>.` : '';
}

function contactText(): string {
  const a = contactAddress();
  return a ? `\nQuestions? Contact us: ${a}\n` : '';
}

function button(href: string, label: string): string {
  return buttonHtml(escapeHtml(href), escapeHtml(label));
}

export function renderDigest(opts: {
  businessName: string;
  items: DigestItem[];
  totalCount?: number;
  appUrl: string;
  unsubscribeUrl: string;
  now?: Date;
}): Rendered {
  const now = opts.now ?? new Date();
  const items = digestOrder(opts.items);
  const total = Math.max(opts.totalCount ?? items.length, items.length);
  const more = Math.max(0, total - items.length);
  const subject = noDash(
    total === 1
      ? `1 new thing near you: ${items[0]?.title ?? 'local signal'}`.slice(0, 120)
      : `${total} new things near you`,
  );

  // One heading per label group (Act now, Coming soon) when the items carry labels.
  const headingFor = (i: number): Opportunity | null => {
    const l = items[i].opportunity?.label ?? null;
    if (!l) return null;
    return i === 0 || items[i - 1].opportunity?.label !== l ? l : null;
  };
  const htmlItems = items
    .map((it, i) => {
      const src = safeUrl(it.sourceUrl);
      const meta = [kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)]
        .filter(Boolean)
        .map((m) => escapeHtml(m as string))
        .join(' &middot; ');
      const sig = { kind: it.kind, subtype: it.subtype, source: it.source ?? '' };
      const o = it.opportunity;
      const intentHtml = o
        ? `<div style="${S.small};margin:2px 0"><strong style="color:${EMAIL_COLORS.ink}">${escapeHtml(OPPORTUNITY_LABEL[o.label])}.</strong> ${escapeHtml(noDash(o.why))}</div>` +
          `<div style="font-size:14px;margin:2px 0"><strong>Next step:</strong> ${escapeHtml(noDash(o.next))}</div>` +
          `<div style="${S.small};margin:2px 0">Not known: ${escapeHtml(noDash(o.uncertain))}</div>`
        : `<div style="${S.small};margin:2px 0"><strong style="color:${EMAIL_COLORS.ink}">${escapeHtml(INTENT_LABEL[intentOf(sig)])}.</strong> ${escapeHtml(intentLine(sig))}</div>`;
      const h = headingFor(i);
      const heading = h ? `<li style="margin:8px 0 8px 0;padding:0;list-style:none"><h2 style="${S.h1};font-size:18px;margin:0">${escapeHtml(OPPORTUNITY_LABEL[h])}</h2></li>` : '';
      const detail = it.detail ? `<div style="font-size:14px;margin:2px 0">${escapeHtml(noDash(it.detail))}</div>` : '';
      const note = it.note ? `<div style="font-size:14px;margin:2px 0"><strong>Why it may matter:</strong> ${escapeHtml(noDash(it.note))}</div>` : '';
      const contact = it.contact?.name
        ? `<div style="font-size:14px;margin:2px 0">${escapeHtml(contactLine(it.contact))}</div>`
        : '';
      return `${heading}<li style="margin:0 0 16px 0;padding:0;list-style:none"><div style="${S.small}">${meta}</div><div style="font-size:16px;font-weight:600;margin:2px 0">${escapeHtml(noDash(it.title))}</div>${intentHtml}${note}${detail}${contact}${
        src ? `<a href="${escapeHtml(src)}" style="${S.link};font-size:14px">${digestLinkLabel(it)}</a>` : ''
      }</li>`;
    })
    .join('');

  const html =
    WRAP_OPEN +
    `<p style="margin:0 0 6px 0;${S.eyebrow}">Holler for ${escapeHtml(noDash(opts.businessName))}</p>` +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 20px 0">${escapeHtml(subject)}</h1>` +
    `<ul style="margin:0;padding:0">${htmlItems}</ul>` +
    (more > 0 ? `<p style="${S.mutedLink}">Plus ${more} more in your feed.</p>` : '') +
    button(opts.appUrl, 'Open your feed') +
    `<p style="${S.small};margin-top:32px">You get this because email alerts are on for your Holler account. <a href="${escapeHtml(opts.unsubscribeUrl)}" style="${S.mutedLink}">Turn off email alerts</a>.${contactHtml()}</p>` +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;

  const textItems = items
    .map((it, i) => {
      const src = safeUrl(it.sourceUrl);
      const meta = [kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)]
        .filter(Boolean)
        .join(' | ');
      const sig = { kind: it.kind, subtype: it.subtype, source: it.source ?? '' };
      const o = it.opportunity;
      const label = o
        ? `${OPPORTUNITY_LABEL[o.label]}. ${noDash(o.why)}\nNext step: ${noDash(o.next)}\nNot known: ${noDash(o.uncertain)}`
        : `${INTENT_LABEL[intentOf(sig)]}. ${intentLine(sig)}`;
      const h = headingFor(i);
      return `${h ? `== ${OPPORTUNITY_LABEL[h]} ==\n\n` : ''}${meta}\n${noDash(it.title)}\n${label}${it.note ? `\nWhy it may matter: ${noDash(it.note)}` : ''}${it.detail ? `\n${noDash(it.detail)}` : ''}${it.contact?.name ? `\n${contactLine(it.contact)}` : ''}${src ? `\n${src}` : ''}`;
    })
    .join('\n\n');
  const text =
    `Holler for ${noDash(opts.businessName)}\n\n${subject}\n\n${textItems}\n\n` +
    (more > 0 ? `Plus ${more} more in your feed.\n\n` : '') +
    `Open your feed: ${opts.appUrl}\n\nTurn off email alerts: ${opts.unsubscribeUrl}\n${contactText()}\n${postalFooterText()}\n`;

  return { subject, html, text };
}

export function renderPasswordReset(opts: { resetUrl: string }): Rendered {
  const subject = 'Reset your Holler password';
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">Reset your password</h1>` +
    `<p>Someone asked to reset the password for this Holler account. If that was you, use the button below. The link works once and expires soon.</p>` +
    button(opts.resetUrl, 'Choose a new password') +
    `<p style="${S.muted}">If you did not ask for this, ignore this email. Your password stays the same.${contactHtml()}</p>` +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text = `Reset your Holler password\n\nSomeone asked to reset the password for this account. If that was you, open this link. It works once and expires soon.\n\n${opts.resetUrl}\n\nIf you did not ask for this, ignore this email. Your password stays the same.\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}

export function renderWelcome(opts: { businessName: string; appUrl: string; trialDays?: number }): Rendered {
  const days = opts.trialDays ?? TRIAL_DAYS;
  const subject = 'Welcome to Holler';
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">Welcome, ${escapeHtml(noDash(opts.businessName))}</h1>` +
    `<p>Holler watches public data near you and emails you when something matches what you do: storms, permits, 311 complaints, service requests people post on Holler. ${CADENCE_SHORT}</p>` +
    `<p>Your ${days}-day free trial has started. No card needed. Holler never posts anything for you.</p>` +
    button(opts.appUrl, 'Open your feed') +
    (contactAddress() ? `<p style="${S.muted}">${contactHtml().trim()}</p>` : '') +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text = `Welcome, ${noDash(opts.businessName)}\n\nHoller watches public data near you and emails you when something matches what you do: storms, permits, 311 complaints, service requests people post on Holler. ${CADENCE_SHORT}\n\nYour ${days}-day free trial has started. No card needed. Holler never posts anything for you.\n\nOpen your feed: ${opts.appUrl}\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}

/** Welcome plus the email-confirmation link sent right after signup (and on resend). */
export function renderVerifyEmail(opts: { verifyUrl: string; appUrl: string; trialDays?: number }): Rendered {
  const days = opts.trialDays ?? TRIAL_DAYS;
  const subject = 'Welcome to Holler: confirm your email';
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">Welcome to Holler</h1>` +
    `<p>Your ${days}-day free trial starts when you finish setting up your alerts. No card needed. Holler never posts anything for you.</p>` +
    `<p>One step left: confirm this email address so we can send you alerts. The link works for 7 days.</p>` +
    button(opts.verifyUrl, 'Confirm my email') +
    `<p style="${S.muted}">You can set up what you do and where you work any time at <a href="${escapeHtml(opts.appUrl)}" style="${S.mutedLink}">${escapeHtml(opts.appUrl)}</a>. If you did not sign up, ignore this email and nothing happens.${contactHtml()}</p>` +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text = `Welcome to Holler\n\nYour ${days}-day free trial starts when you finish setting up your alerts. No card needed. Holler never posts anything for you.\n\nOne step left: confirm this email address so we can send you alerts. The link works for 7 days.\n\n${opts.verifyUrl}\n\nYou can set up what you do and where you work any time: ${opts.appUrl}\n\nIf you did not sign up, ignore this email and nothing happens.\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}
