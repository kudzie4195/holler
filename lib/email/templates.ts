import { relativeTime } from '../time';
import { CADENCE_SHORT } from '../seo/cadence';
import { env, siteUrl } from '../env';
import { HOLLER_REQUEST_SOURCE } from '../signals/request-visibility';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { bidSourceLinkLabel } from '../signals/bid-card';
import { sourceLine, type CardBrief } from '../signals/brief';
import { bidSourceLinkLabelLang, cardBriefLang, sourceLineLang } from '../signals/brief-i18n';
import { t, type Lang } from '../i18n';
import { localizeTitle } from '../signals/title-i18n';
import { orderByLabel, type OpportunityLabel } from '../signals/lead-rules';
import { chipLabel, deadlineLineLang } from '../signals/lead-i18n';
import { TRIAL_DAYS } from '../auth/membership';
import { EMAIL_COLORS, EMAIL_STYLE, buttonHtml, cardClose, wrapOpen, WRAP_CLOSE as THEME_WRAP_CLOSE } from './theme';

export interface DigestItem {
  kind: string;
  /** Source id and data.subtype of the record. Used for the brief (why it matters, source link). */
  source?: string | null;
  subtype?: string | null;
  title: string;
  /** The record's own summary (SPC remarks, NWS text). Used by the brief only, to say what the record itself says about damage. */
  summary?: string | null;
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
   * The record's opportunity label for this member (lib/signals/lead-rules.ts). Act Now items are listed first and carry the deadline
   * line. Absent counts as coming_soon (no chip shown for an item without a label, so older callers render as before).
   */
  label?: OpportunityLabel | null;
  /** ISO date by which something has to happen (a fix-by, due or response date), when the record publishes one. Act Now items only. */
  deadline?: string | null;
  /** An open city bid only: "Buyer: X. Due Dec 10, 2026, 19 days left." (lib/signals/bid-card.ts bidCardLine). */
  bidLine?: string | null;
  /** The member's trade this record is shown under (lib/signals/brief.ts tradeForRecord). Makes "Why it matters" trade-specific. */
  trade?: string | null;
  /** NYC no-heat items only: data.managerName / data.managerRole (company names only, checked again by cardBrief). */
  managerName?: string | null;
  managerRole?: string | null;
  /** Permits: data.jobValue, the project value the city published (a number or its text form). The summary's "$N job value" is the fallback. */
  jobValue?: unknown;
}

/** "Act now" for an act_now item, plus its deadline line; "Coming soon" and "Market insight" for those; nothing for no label. */
export function chipText(it: Pick<DigestItem, 'label' | 'deadline'>, lang: Lang = 'en'): string | null {
  if (!it.label || it.label === 'context') return null;
  return it.label === 'act_now' ? `${chipLabel('act_now', lang)}. ${deadlineLineLang(it.deadline, lang)}` : chipLabel(it.label, lang);
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

export function kindLabel(kind: string, lang: Lang = 'en'): string {
  if (lang !== 'en') return t(lang, kind in KIND_LABELS ? (`email.kind.${kind}` as Parameters<typeof t>[1]) : 'email.kind.unknown');
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
 * "Open the request form" (a request has no page of its own). Known by its source id, or by a link to this site's /request page when the source is not passed.
 */
export function isResidentRequest(it: Pick<DigestItem, 'source' | 'sourceUrl'>, base: string = siteUrl): boolean {
  if (it.source === HOLLER_REQUEST_SOURCE) return true;
  if (!it.sourceUrl) return false;
  return it.sourceUrl.replace(/[?#].*$/, '').replace(/\/$/, '') === `${base.replace(/\/$/, '')}/request`;
}

/** Label of the link under a digest item. */
export function digestLinkLabel(it: Pick<DigestItem, 'source' | 'sourceUrl'>, base: string = siteUrl, lang: Lang = 'en'): string {
  if (lang !== 'en') return isResidentRequest(it, base) ? t(lang, 'brief.link.request') : bidSourceLinkLabelLang(it.source, lang);
  return isResidentRequest(it, base) ? 'Open the request form' : bidSourceLinkLabel(it.source);
}

/** The brief (parts 2 to 5) for a digest item. The link is the record's own page, else the dataset's home page: never no link. */
export function digestBrief(it: DigestItem, base: string = siteUrl, lang: Lang = 'en'): CardBrief & { href: string | null; linkText: string } {
  const b = cardBriefLang({ source: it.source ?? '', kind: it.kind, subtype: it.subtype, title: it.title, summary: it.summary, label: it.label, trade: it.trade, url: it.sourceUrl, occurredAt: it.occurredAt, base, managerName: it.managerName, managerRole: it.managerRole, jobValue: it.jobValue }, lang);
  const own = safeUrl(it.sourceUrl);
  // The link label keeps the digest's own rule: "Open the request form" for a resident request (known by source or by its /request link).
  return { ...b, href: safeUrl(b.source.href), linkText: own ? digestLinkLabel(it, base, lang) : b.source.linkText };
}

/** Text we show must never contain an em dash (house copy rule), including text from sources. */
function noDash(s: string): string {
  return s.replace(/—/g, '-');
}

export function timeAgo(iso: string, now: Date = new Date(), lang: Lang = 'en'): string {
  return relativeTime(iso, now.getTime(), 'email', lang);
}

/** "Contact: Acme Roofing LLC (General contractor on this permit)". Plain text; callers escape it for HTML. */
export function contactLine(c: { name: string; role: string }, lang: Lang = 'en'): string {
  return noDash(t(lang, 'email.contact', { name: c.name, role: c.role }));
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

function contactHtml(lang: Lang = 'en'): string {
  const a = contactAddress();
  return a ? ` ${t(lang, 'email.questions')} <a href="mailto:${escapeHtml(a)}" style="${S.mutedLink}">${t(lang, 'email.contact_us')}</a>.` : '';
}

function contactText(lang: Lang = 'en'): string {
  const a = contactAddress();
  return a ? `\n${t(lang, 'email.questions')} ${t(lang, 'email.contact_us')}: ${a}\n` : '';
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
  /** The member's language (profiles.language, migration 0024). 'en' (the default) is the digest as it always was. */
  lang?: Lang;
}): Rendered {
  const lang: Lang = opts.lang ?? 'en';
  const now = opts.now ?? new Date();
  const total = opts.totalCount ?? opts.items.length;
  const more = Math.max(0, total - opts.items.length);
  const subject = noDash(
    total === 1
      ? t(lang, 'email.subject.one', { title: opts.items[0] ? localizeTitle(opts.items[0].title, lang, opts.items[0].source) : t(lang, 'email.subject.fallback_title') }).slice(0, 120)
      : t(lang, 'email.subject.many', { n: total }),
  );

  // Act Now first (item 0.3); inside a label the order the caller gave is kept.
  const items = orderByLabel(opts.items, (it) => it.label ?? 'coming_soon');
  const kindText = (it: DigestItem) => (it.subtype === 'bid' ? t(lang, 'bid.label') : kindLabel(it.kind, lang));

  const htmlItems = items
    .map((it) => {
      const meta = [kindText(it), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now, lang)]
        .filter(Boolean)
        .map((m) => escapeHtml(m as string))
        .join(' &middot; ');
      const chip = chipText(it, lang);
      const chipHtml = chip ? `<div style="font-size:14px;font-weight:700;margin:2px 0;color:${EMAIL_COLORS.ink}">${escapeHtml(chip)}</div>` : '';
      const bidHtml = it.bidLine ? `<div style="font-size:14px;margin:2px 0">${escapeHtml(noDash(it.bidLine))}</div>` : '';
      const detail = it.detail ? `<div style="font-size:14px;margin:2px 0">${escapeHtml(noDash(it.detail))}</div>` : '';
      // The one-line AI note is written in English by the model, so a Spanish digest leaves it out (the brief below says the same in Spanish).
      const note = it.note && lang === 'en' ? `<div style="font-size:14px;margin:2px 0"><strong>${t(lang, 'brief.h.note')}:</strong> ${escapeHtml(noDash(it.note))}</div>` : '';
      const contact = it.contact?.name
        ? `<div style="font-size:14px;margin:2px 0">${escapeHtml(contactLine(it.contact, lang))}</div>`
        : '';
      const br = digestBrief(it, siteUrl, lang);
      const valueHtml = br.valueLine ? `<div style="font-size:14px;margin:6px 0 0 0">${escapeHtml(noDash(br.valueLine))}</div>` : '';
      const briefHtml =
        valueHtml +
        `<div style="font-size:14px;margin:6px 0 2px 0"><strong>${t(lang, 'brief.h.why')}:</strong> ${escapeHtml(noDash(br.why))}</div>` +
        `<div style="font-size:14px;margin:2px 0"><strong>${t(lang, 'brief.h.next')}:</strong> ${escapeHtml(noDash(br.next))}</div>` +
        (br.managedBy ? `<div style="font-size:14px;margin:2px 0">${escapeHtml(noDash(br.managedBy))}</div>` : '') +
        `<div style="font-size:14px;margin:2px 0"><strong>${t(lang, 'brief.h.source')}:</strong> ${escapeHtml(noDash(br.source.label))}${br.source.dateText ? ` &middot; ${escapeHtml(br.source.dateText)}` : ''}${
          br.href ? ` &middot; <a href="${escapeHtml(br.href)}" style="${S.link};font-size:14px">${escapeHtml(br.linkText)}</a>` : ''
        }</div>` +
        `<div style="font-size:14px;margin:2px 0 4px 0"><strong>${t(lang, 'brief.h.uncertain')}:</strong> ${escapeHtml(noDash(br.uncertain))}</div>`;
      return `<li style="margin:0 0 16px 0;padding:0;list-style:none"><div style="${S.small}">${meta}</div>${chipHtml}<div style="font-size:16px;font-weight:600;margin:2px 0">${escapeHtml(noDash(localizeTitle(it.title, lang, it.source)))}</div>${bidHtml}${note}${detail}${contact}${briefHtml}</li>`;
    })
    .join('');

  const html =
    (lang === 'en' ? WRAP_OPEN : wrapOpen(560, lang)) +
    `<p style="margin:0 0 6px 0;${S.eyebrow}">${escapeHtml(t(lang, 'email.eyebrow', { name: noDash(opts.businessName) }))}</p>` +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 20px 0">${escapeHtml(subject)}</h1>` +
    `<ul style="margin:0;padding:0">${htmlItems}</ul>` +
    (more > 0 ? `<p style="${S.mutedLink}">${escapeHtml(t(lang, 'email.plus_more', { n: more }))}</p>` : '') +
    button(opts.appUrl, t(lang, 'email.open_feed')) +
    `<p style="${S.small};margin-top:32px">${t(lang, 'email.footer.why')} <a href="${escapeHtml(opts.unsubscribeUrl)}" style="${S.mutedLink}">${t(lang, 'email.footer.off')}</a>.${contactHtml(lang)}</p>` +
    cardClose() +
    postalFooterHtml(lang) +
    WRAP_CLOSE;

  const textItems = items
    .map((it) => {
      const br = digestBrief(it, siteUrl, lang);
      const meta = [kindText(it), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now, lang)]
        .filter(Boolean)
        .join(' | ');
      const chip = chipText(it, lang);
      const sourceText = lang === 'en' ? sourceLine(br.source) : sourceLineLang(br.source, lang);
      return `${meta}${chip ? `\n${chip}` : ''}\n${noDash(localizeTitle(it.title, lang, it.source))}${it.bidLine ? `\n${noDash(it.bidLine)}` : ''}${it.note && lang === 'en' ? `\n${t(lang, 'brief.h.note')}: ${noDash(it.note)}` : ''}${it.detail ? `\n${noDash(it.detail)}` : ''}${it.contact?.name ? `\n${contactLine(it.contact, lang)}` : ''}${br.valueLine ? `\n${noDash(br.valueLine)}` : ''}\n${t(lang, 'brief.h.why')}: ${noDash(br.why)}\n${t(lang, 'brief.h.next')}: ${noDash(br.next)}${br.managedBy ? `\n${noDash(br.managedBy)}` : ''}\n${noDash(sourceText)}${br.href ? `\n${br.linkText}: ${br.href}` : ''}\n${t(lang, 'brief.h.uncertain')}: ${noDash(br.uncertain)}`;
    })
    .join('\n\n');
  const text =
    `${t(lang, 'email.eyebrow', { name: noDash(opts.businessName) })}\n\n${subject}\n\n${textItems}\n\n` +
    (more > 0 ? `${t(lang, 'email.plus_more', { n: more })}\n\n` : '') +
    `${t(lang, 'email.open_feed')}: ${opts.appUrl}\n\n${t(lang, 'email.footer.off')}: ${opts.unsubscribeUrl}\n${contactText(lang)}\n${postalFooterText(lang)}\n`;

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
