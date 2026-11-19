import { escapeHtml, contactAddress, type Rendered } from '../email/templates';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { INTENT_LABEL, intentOf } from '../signals/intent';
import { PLAN_LIMITS, TIER_NAMES, type Tier } from '../plan/limits';
// Prices come from the one public price module (lib/plan/public-prices.ts, built from the price table), never from this file.
import { ENTITLEMENT_FOR_TIER, PUBLIC_PRICES } from '../plan/public-prices';
import { WINDOWS } from './select';
import { EMAIL_STYLE, buttonHtml, cardClose, wrapOpen, WRAP_CLOSE as THEME_WRAP_CLOSE } from '../email/theme';

/**
 * The three trial emails. Pure: every number and name in them is passed in or read from the plan tables.
 * Plain and short on purpose: no pressure words, no countdown tricks, nothing the member's own data does not back.
 * Each email has a text part, an HTML part, and a footer with the mailing address and a one-click way to stop these emails.
 */

export interface AlertItem {
  title: string;
  city?: string | null;
  state?: string | null;
  /** ISO timestamp of the record. */
  occurredAt: string;
  kind: string;
  source?: string | null;
  subtype?: string | null;
  /** 1 to 3. Used by the trial-ending ranking only. */
  severity?: number | null;
}

export interface TypeLine {
  /** Already pluralized by the caller, for example "building permits". */
  label: string;
  count: number;
}

interface Common {
  businessName: string;
  /** Absolute links. The button and unsubscribe links are built by the caller from siteUrl. */
  feedUrl: string;
  plansUrl: string;
  unsubscribeUrl: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MAX_TITLE_CHARS = 110;

/** House rule: no em or en dashes in anything we show, including text from public records. */
export function plain(s: string): string {
  return s.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

function clip(s: string, n: number): string {
  const t = plain(s);
  return t.length <= n ? t : `${t.slice(0, n - 3).trimEnd()}...`;
}

/** "Nov 17", in UTC so the same record reads the same everywhere. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function placeOf(i: AlertItem): string {
  // Place names come from public records too, so they get the same dash rule as titles.
  return [i.city ? plain(i.city) : '', i.state ? plain(i.state) : ''].filter(Boolean).join(', ');
}

function metaOf(i: AlertItem): string {
  const label = INTENT_LABEL[intentOf({ kind: i.kind, subtype: i.subtype, source: i.source ?? '' })];
  return [placeOf(i), shortDate(i.occurredAt), label].filter(Boolean).join(', ');
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// ---- layout (same look as lib/email/templates.ts: every color and font comes from lib/email/theme.ts) ---------------------------
const WRAP_OPEN = wrapOpen();
const WRAP_CLOSE = THEME_WRAP_CLOSE;
const S = EMAIL_STYLE;
const P = 'margin:0 0 12px 0';

function button(href: string, label: string): string {
  return buttonHtml(escapeHtml(href), escapeHtml(label));
}

function para(s: string): string {
  return `<p style="${P}">${escapeHtml(s)}</p>`;
}

function itemsHtml(items: AlertItem[]): string {
  const li = items
    .map(
      (i) =>
        `<li style="margin:0 0 12px 0;padding:0;list-style:none"><strong style="font-size:16px">${escapeHtml(clip(i.title, MAX_TITLE_CHARS))}</strong> <small style="${S.small}">(${escapeHtml(metaOf(i))})</small></li>`,
    )
    .join('');
  return `<ul style="margin:0 0 8px 0;padding:0">${li}</ul>`;
}

function itemsText(items: AlertItem[]): string {
  return items.map((i) => `${clip(i.title, MAX_TITLE_CHARS)} (${metaOf(i)})`).join('\n');
}

const FOOTER_REASON =
  'You get this because you started a free trial on Holler, and these emails are a short series about the trial that is separate from your alert emails.';

function footerHtml(c: Common): string {
  const a = contactAddress();
  const contact = a ? ` Questions? <a href="mailto:${escapeHtml(a)}" style="${S.mutedLink}">Contact us</a>.` : '';
  return (
    `<p style="${S.small};margin-top:32px">${escapeHtml(FOOTER_REASON)} ` +
    `<a href="${escapeHtml(c.unsubscribeUrl)}" style="${S.mutedLink}">Stop these emails</a>.${contact}</p>` +
    cardClose() +
    postalFooterHtml()
  );
}

function footerText(c: Common): string {
  const a = contactAddress();
  return (
    `${FOOTER_REASON}\n` +
    `Stop these emails: ${c.unsubscribeUrl}\n` +
    (a ? `Questions? Contact us: ${a}\n` : '') +
    `\n${postalFooterText()}\n`
  );
}

function shell(c: Common, subject: string, body: string, bodyText: string): Rendered {
  const html =
    WRAP_OPEN +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 16px 0"><small style="display:block;margin:0 0 6px 0;${S.eyebrow};font-weight:400;line-height:1.5">Holler for ${escapeHtml(plain(c.businessName))}</small>${escapeHtml(subject)}</h1>` +
    body +
    footerHtml(c) +
    WRAP_CLOSE;
  const text = `Holler for ${plain(c.businessName)}: ${subject}\n\n${bodyText}\n${footerText(c)}`;
  return { subject, html, text };
}

// ---- welcome ----------------------------------------------------------------------------------------------------------------
export const WELCOME_SUBJECT = 'What we found near you';

export interface WelcomeMatches extends Common {
  /** Every match the member has, after filtering. Always at least 1. */
  total: number;
  /** True when the count is a floor (more rows existed than were read). */
  capped?: boolean;
  /** Up to 5, newest first. */
  items: AlertItem[];
}

export function renderWelcomeMatches(o: WelcomeMatches): Rendered {
  const items = o.items.slice(0, 5);
  const num = count(o.total, 'record', 'records');
  const verb = o.total === 1 && !o.capped ? 'matches' : 'match';
  const lead = `Your account is a day old, and ${o.capped ? 'at least ' : ''}${num} already ${verb} the trades and area you saved in your profile.`;
  const shown = items.length === 0 ? '' : items.length === 1 && o.total === 1 ? 'Here it is.' : `Here are the newest ${items.length}.`;
  const caveat =
    'A record shows that something happened, but it does not show that anyone needs work or that a job is still open. Treat each one as a starting point.';
  const source =
    'These come from public sources such as city permit offices, the National Weather Service and city 311 systems, so every line is something an agency already published.';
  const tail = o.total > items.length ? 'The rest are in your feed.' : '';
  const body =
    para(lead) +
    (shown ? para(shown) : '') +
    (items.length ? itemsHtml(items) : '') +
    para(source) +
    para(caveat) +
    (tail ? para(tail) : '') +
    button(o.feedUrl, 'Open your feed');
  const bodyText =
    `${lead}\n\n${shown ? `${shown}\n\n` : ''}${items.length ? `${itemsText(items)}\n\n` : ''}${source}\n\n${caveat}\n\n${tail ? `${tail}\n\n` : ''}Open your feed: ${o.feedUrl}\n`;
  return shell(o, WELCOME_SUBJECT, body, bodyText);
}

export interface WelcomeQuiet extends Common {
  /** Real 90-day counts from lib/preview/recent.ts, biggest first. At least one line, every count at least 1. */
  lines: TypeLine[];
  total: number;
  capped?: boolean;
  days: number;
}

export function renderWelcomeQuiet(o: WelcomeQuiet): Rendered {
  const lines = o.lines.slice(0, 4);
  const floor = o.capped ? 'at least ' : '';
  const lead = 'Your account is a day old, and nothing has matched your trades and area yet.';
  const parts = lines.map((l) => `${l.label} (${l.count.toLocaleString('en-US')})`);
  const verb = o.total === 1 && !o.capped ? 'fits' : 'fit';
  const only = lines.length === 1 && lines[0].count === o.total;
  const list = lines.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : '';
  const detail = only
    ? o.total === 1
      ? `, and it is ${/^[aeiou]/i.test(lines[0].label) ? 'an' : 'a'} ${lines[0].label}`
      : `, and all of them are ${lines[0].label}`
    : lines.length > 1
      ? `, which includes ${list}`
      : '';
  const watch = `Holler watches the public records near you, and in the last ${o.days} days, ${floor}${count(o.total, 'public record', 'public records')} ${verb} your trades and area${detail}.`;
  const how = 'New ones show up as agencies publish them. To see more, add a trade or widen your radius in settings.';
  const body = para(lead) + para(watch) + para(how) + button(o.feedUrl, 'Open your feed');
  const bodyText = `${lead}\n\n${watch}\n\n${how}\n\nOpen your feed: ${o.feedUrl}\n`;
  return shell(o, WELCOME_SUBJECT, body, bodyText);
}

// ---- trial-ending ----------------------------------------------------------------------------------------------------------------
/** Whole days the trial-ending email talks about: the middle of its window (36 to 60 hours before the end) is 48 hours. Not a trial length. */
export const TRIAL_ENDING_DAYS = Math.round((WINDOWS.trial_ending.from + WINDOWS.trial_ending.to) / 2 / 24);
export const TRIAL_ENDING_SUBJECT = `Your trial ends in ${TRIAL_ENDING_DAYS} days`;

export interface PlanLine {
  tier: Tier;
  name: string;
  monthly: string;
  yearly: string;
  areas: number;
  trades: number;
  keywords: number;
}

/** Both plans, with prices from the price table and limits from the plan table. */
export function planLines(): PlanLine[] {
  return (['starter', 'pro'] as const).map((tier) => ({
    tier,
    name: TIER_NAMES[tier],
    monthly: PUBLIC_PRICES.plans[ENTITLEMENT_FOR_TIER[tier]].monthly.display,
    yearly: PUBLIC_PRICES.plans[ENTITLEMENT_FOR_TIER[tier]].annual.display,
    areas: PLAN_LIMITS[tier].areas,
    trades: PLAN_LIMITS[tier].trades,
    keywords: PLAN_LIMITS[tier].keywords,
  }));
}

function planSentence(p: PlanLine): string {
  const kw = p.keywords > 0 ? `, plus ${count(p.keywords, 'keyword watch', 'keyword watches')}` : '';
  return `${p.name} covers ${count(p.areas, 'area', 'areas')} and up to ${count(p.trades, 'trade', 'trades')}${kw}, and it costs ${p.monthly} a month or ${p.yearly} a year.`;
}

export interface TrialEnding extends Common {
  /** The member's best alerts, already ranked, at most 3. May be empty. */
  items: AlertItem[];
  plans?: PlanLine[];
}

export function renderTrialEnding(o: TrialEnding): Rendered {
  const items = o.items.slice(0, 3);
  const plans = o.plans ?? planLines();
  const lead = `Your free trial ends in about ${TRIAL_ENDING_DAYS} days, and after that your alerts stop unless you pick a plan.`;
  const found =
    items.length === 0
      ? 'Holler has not matched anything to your trades and area yet, and it will keep watching until the trial ends.'
      : items.length === 1
        ? 'Here is the alert that looks strongest for your trades so far.'
        : `Here are the ${items.length} alerts that look strongest for your trades so far, picked from what Holler matched to you. Judge them for yourself.`;
  const plansIntro = 'There are two plans.';
  const renew = 'Both renew until you cancel in Settings. Otherwise, you do not need to do anything.';
  const body =
    para(lead) +
    para(found) +
    (items.length ? itemsHtml(items) : '') +
    para(plansIntro) +
    plans.map((p) => para(planSentence(p))).join('') +
    para(renew) +
    button(o.plansUrl, 'Pick a plan');
  const bodyText =
    `${lead}\n\n${found}\n\n${items.length ? `${itemsText(items)}\n\n` : ''}${plansIntro}\n\n${plans.map(planSentence).join('\n\n')}\n\n${renew}\n\nPick a plan: ${o.plansUrl}\n`;
  return shell(o, TRIAL_ENDING_SUBJECT, body, bodyText);
}

// ---- trial-ended ----------------------------------------------------------------------------------------------------------------
export const TRIAL_ENDED_SUBJECT = 'Your alerts are paused';

export interface TrialEnded extends Common {
  /** New public records that match the member's trades and area since the trial ended. Zero is fine. */
  missed: number;
  capped?: boolean;
}

export function renderTrialEnded(o: TrialEnded): Rendered {
  const lead = 'Your free trial has ended, so Holler has paused your alerts, and a plan is all it takes to turn them back on.';
  const since =
    o.missed > 0
      ? `Since then, ${o.capped ? 'at least ' : ''}${count(o.missed, 'new public record has', 'new public records have')} matched your trades and area, based on what you saved in your profile.`
      : '';
  const body = para(lead) + (since ? para(since) : '') + button(o.plansUrl, 'Pick a plan');
  const bodyText = `${lead}\n\n${since ? `${since}\n\n` : ''}Pick a plan: ${o.plansUrl}\n`;
  return shell(o, TRIAL_ENDED_SUBJECT, body, bodyText);
}
