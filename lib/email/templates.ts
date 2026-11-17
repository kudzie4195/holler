import { relativeTime } from '../time';
import { CADENCE_SHORT } from '../seo/cadence';
import { env } from '../env';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';

export interface DigestItem {
  kind: string;
  title: string;
  place?: string | null;
  occurredAt: string;
  sourceUrl?: string | null;
  /** Resident requests only: the filtered description, read with the service role for this member's own match. Plain text. */
  detail?: string | null;
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

/** Text we show must never contain an em dash (house copy rule), including text from sources. */
function noDash(s: string): string {
  return s.replace(/—/g, '-');
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  return relativeTime(iso, now.getTime(), 'email');
}

const WRAP_OPEN =
  '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#191714;background:#FAF6EE;line-height:1.5">';
const WRAP_CLOSE = '</div>';

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
  return a ? ` Questions? <a href="mailto:${escapeHtml(a)}" style="color:#5C574F">Contact us</a>.` : '';
}

function contactText(): string {
  const a = contactAddress();
  return a ? `\nQuestions? Contact us: ${a}\n` : '';
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:#E8590C;color:#191714;text-decoration:none;padding:12px 20px;border-radius:999px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>`;
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
  const total = opts.totalCount ?? opts.items.length;
  const more = Math.max(0, total - opts.items.length);
  const subject = noDash(
    total === 1
      ? `1 new thing near you: ${opts.items[0]?.title ?? 'local signal'}`.slice(0, 120)
      : `${total} new things near you`,
  );

  const htmlItems = opts.items
    .map((it) => {
      const src = safeUrl(it.sourceUrl);
      const meta = [kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)]
        .filter(Boolean)
        .map((m) => escapeHtml(m as string))
        .join(' &middot; ');
      const detail = it.detail ? `<div style="font-size:14px;margin:2px 0">${escapeHtml(noDash(it.detail))}</div>` : '';
      return `<li style="margin:0 0 16px 0;padding:0;list-style:none"><div style="font-size:12px;color:#5C574F">${meta}</div><div style="font-size:16px;font-weight:600;margin:2px 0">${escapeHtml(noDash(it.title))}</div>${detail}${
        src ? `<a href="${escapeHtml(src)}" style="color:#AD4205;font-size:14px">Open source</a>` : ''
      }</li>`;
    })
    .join('');

  const html =
    WRAP_OPEN +
    `<p style="margin:0 0 4px 0;font-size:14px;color:#5C574F">Holler for ${escapeHtml(noDash(opts.businessName))}</p>` +
    `<h1 style="font-size:22px;margin:0 0 20px 0">${escapeHtml(subject)}</h1>` +
    `<ul style="margin:0;padding:0">${htmlItems}</ul>` +
    (more > 0 ? `<p style="color:#5C574F">Plus ${more} more in your feed.</p>` : '') +
    button(opts.appUrl, 'Open your feed') +
    `<p style="font-size:12px;color:#5C574F;margin-top:32px">You get this because email alerts are on for your Holler account. <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#5C574F">Turn off email alerts</a>.${contactHtml()}</p>` +
    postalFooterHtml() +
    WRAP_CLOSE;

  const textItems = opts.items
    .map((it) => {
      const src = safeUrl(it.sourceUrl);
      const meta = [kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)]
        .filter(Boolean)
        .join(' | ');
      return `${meta}\n${noDash(it.title)}${it.detail ? `\n${noDash(it.detail)}` : ''}${src ? `\n${src}` : ''}`;
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
    `<h1 style="font-size:22px;margin:0 0 12px 0">Reset your password</h1>` +
    `<p>Someone asked to reset the password for this Holler account. If that was you, use the button below. The link works once and expires soon.</p>` +
    button(opts.resetUrl, 'Choose a new password') +
    `<p style="font-size:14px;color:#5C574F">If you did not ask for this, ignore this email. Your password stays the same.${contactHtml()}</p>` +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text = `Reset your Holler password\n\nSomeone asked to reset the password for this account. If that was you, open this link. It works once and expires soon.\n\n${opts.resetUrl}\n\nIf you did not ask for this, ignore this email. Your password stays the same.\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}

export function renderWelcome(opts: { businessName: string; appUrl: string; trialDays?: number }): Rendered {
  const days = opts.trialDays ?? 7;
  const subject = 'Welcome to Holler';
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:22px;margin:0 0 12px 0">Welcome, ${escapeHtml(noDash(opts.businessName))}</h1>` +
    `<p>Holler watches public data near you and emails you when something matches what you do: storms, permits, 311 complaints, service requests people post on Holler. ${CADENCE_SHORT}</p>` +
    `<p>Your ${days}-day free trial has started. No card needed. Holler never posts anything for you.</p>` +
    button(opts.appUrl, 'Open your feed') +
    (contactAddress() ? `<p style="font-size:14px;color:#5C574F">${contactHtml().trim()}</p>` : '') +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text = `Welcome, ${noDash(opts.businessName)}\n\nHoller watches public data near you and emails you when something matches what you do: storms, permits, 311 complaints, service requests people post on Holler. ${CADENCE_SHORT}\n\nYour ${days}-day free trial has started. No card needed. Holler never posts anything for you.\n\nOpen your feed: ${opts.appUrl}\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}

/** Welcome plus the email-confirmation link sent right after signup (and on resend). */
export function renderVerifyEmail(opts: { verifyUrl: string; appUrl: string; trialDays?: number }): Rendered {
  const days = opts.trialDays ?? 7;
  const subject = 'Welcome to Holler: confirm your email';
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:22px;margin:0 0 12px 0">Welcome to Holler</h1>` +
    `<p>Your ${days}-day free trial starts when you finish setting up your alerts. No card needed. Holler never posts anything for you.</p>` +
    `<p>One step left: confirm this email address so we can send you alerts. The link works for 7 days.</p>` +
    button(opts.verifyUrl, 'Confirm my email') +
    `<p style="font-size:14px;color:#5C574F">You can set up what you do and where you work any time at <a href="${escapeHtml(opts.appUrl)}" style="color:#5C574F">${escapeHtml(opts.appUrl)}</a>. If you did not sign up, ignore this email and nothing happens.${contactHtml()}</p>` +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text = `Welcome to Holler\n\nYour ${days}-day free trial starts when you finish setting up your alerts. No card needed. Holler never posts anything for you.\n\nOne step left: confirm this email address so we can send you alerts. The link works for 7 days.\n\n${opts.verifyUrl}\n\nYou can set up what you do and where you work any time: ${opts.appUrl}\n\nIf you did not sign up, ignore this email and nothing happens.\n${contactText()}\n${postalFooterText()}\n`;
  return { subject, html, text };
}
