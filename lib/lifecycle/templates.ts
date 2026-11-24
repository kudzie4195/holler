import { escapeHtml, contactAddress, type Rendered } from '../email/templates';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { INTENT_LABEL, intentOf } from '../signals/intent';
import { OPPORTUNITY_CHIP, type OpportunityLabel } from '../signals/lead-rules';
import { PLAN_LIMITS, TIER_NAMES, type Tier } from '../plan/limits';
// Prices come from the one public price module (lib/plan/public-prices.ts, built from the price table), never from this file.
import { ENTITLEMENT_FOR_TIER, PUBLIC_PRICES } from '../plan/public-prices';
import { WINDOWS } from './select';
import { EMAIL_STYLE, buttonHtml, cardClose, wrapOpen, WRAP_CLOSE as THEME_WRAP_CLOSE } from '../email/theme';
import { hasKey, localizeDate, t, type Lang } from '../i18n';
import { localizeTitle } from '../signals/title-i18n';
import { planNameEs } from '../plan/price-copy-es';

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
  /** This base's label for the member (lib/lifecycle/store.ts matchesOf with trades). Printed as the feed chip ("Act now"). */
  label?: OpportunityLabel | null;
}

export interface TypeLine {
  /** Already pluralized by the caller, for example "building permits". */
  label: string;
  count: number;
  /** The record type (lib/preview/recent.ts byType key). Lets a Spanish email name it in Spanish (recent.type.* keys). Optional. */
  key?: string;
}

interface Common {
  businessName: string;
  /** Absolute links. The button and unsubscribe links are built by the caller from siteUrl. */
  feedUrl: string;
  plansUrl: string;
  unsubscribeUrl: string;
  /** The member's language (round 18 ES). 'en' or absent: the English emails, exactly as before. */
  lang?: Lang;
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
  // The feed's chip when the member's label is known (round 19 review, defect 9); the record-type wording only for an unlabelled item.
  const label = i.label ? OPPORTUNITY_CHIP[i.label] : INTENT_LABEL[intentOf({ kind: i.kind, subtype: i.subtype, source: i.source ?? '' })];
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

// ---- the same three emails in another language (round 18 ES) --------------------------------------------------------------------
// Same structure, numbers and links as the English emails below, which are left as they were. Titles Holler composed are rebuilt in the
// language (lib/signals/title-i18n.ts); text a source wrote stays as written. Every word from the dictionary (life.* keys).

/** Numbers keep the US grouping in both languages ("1,200"): the prices on the same page are US dollars written the US way. */
const countLang = (_lang: Lang, n: number) => n.toLocaleString('en-US');

function metaOfLang(i: AlertItem, lang: Lang): string {
  // Round 19 integration: the same rule as the English metaOf (review defect 9): the feed's chip in the member's language (chip.* keys,
  // as on the cards) when the label is known, the record-type word only for an unlabelled item.
  const intent = intentOf({ kind: i.kind, subtype: i.subtype, source: i.source ?? '' });
  const chipKey = i.label ? `chip.${i.label}` : '';
  const label = chipKey && hasKey(chipKey) ? t(lang, chipKey) : t(lang, `intent.${intent}`);
  return [placeOf(i), localizeDate(shortDate(i.occurredAt), lang) ?? '', label].filter(Boolean).join(', ');
}

function titleLang(i: AlertItem, lang: Lang): string {
  return clip(localizeTitle(i.title, lang, i.source ?? undefined), MAX_TITLE_CHARS);
}

function itemsHtmlLang(items: AlertItem[], lang: Lang): string {
  const li = items
    .map((i) => `<li style="margin:0 0 12px 0;padding:0;list-style:none"><strong style="font-size:16px">${escapeHtml(titleLang(i, lang))}</strong> <small style="${S.small}">(${escapeHtml(metaOfLang(i, lang))})</small></li>`)
    .join('');
  return `<ul style="margin:0 0 8px 0;padding:0">${li}</ul>`;
}

function itemsTextLang(items: AlertItem[], lang: Lang): string {
  return items.map((i) => `${titleLang(i, lang)} (${metaOfLang(i, lang)})`).join('\n');
}

function shellLang(c: Common, lang: Lang, subject: string, body: string, bodyText: string): Rendered {
  const a = contactAddress();
  const eyebrow = t(lang, 'email.eyebrow', { name: plain(c.businessName) });
  const html =
    wrapOpen(560, lang) +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 16px 0"><small style="display:block;margin:0 0 6px 0;${S.eyebrow};font-weight:400;line-height:1.5">${escapeHtml(eyebrow)}</small>${escapeHtml(subject)}</h1>` +
    body +
    `<p style="${S.small};margin-top:32px">${escapeHtml(t(lang, 'life.footer'))} ` +
    `<a href="${escapeHtml(c.unsubscribeUrl)}" style="${S.mutedLink}">${escapeHtml(t(lang, 'life.stop'))}</a>.` +
    (a ? ` ${escapeHtml(t(lang, 'email.questions'))} <a href="mailto:${escapeHtml(a)}" style="${S.mutedLink}">${escapeHtml(t(lang, 'email.contact_us'))}</a>.` : '') +
    `</p>` +
    cardClose() +
    postalFooterHtml(lang) +
    WRAP_CLOSE;
  const text =
    `${eyebrow}: ${subject}\n\n${bodyText}\n` +
    `${t(lang, 'life.footer')}\n${t(lang, 'life.stop')}: ${c.unsubscribeUrl}\n` +
    (a ? `${t(lang, 'email.questions')} ${t(lang, 'email.contact_us')}: ${a}\n` : '') +
    `\n${postalFooterText(lang)}\n`;
  return { subject, html, text };
}

function welcomeMatchesLang(o: WelcomeMatches, lang: Lang): Rendered {
  const items = o.items.slice(0, 5);
  const floor = o.capped ? t(lang, 'life.at_least') : '';
  const lead = o.total === 1 && !o.capped ? t(lang, 'life.w.open_one') : t(lang, 'life.w.open_many', { floor, n: countLang(lang, o.total) });
  const shown = items.length === 0 ? '' : items.length === 1 && o.total === 1 ? t(lang, 'life.w.here_one') : t(lang, 'life.w.here_many', { n: items.length });
  const caveat = t(lang, 'life.w.caveat');
  const source = t(lang, 'life.w.source');
  const tail = o.total > items.length ? t(lang, 'life.w.tail') : '';
  const open = t(lang, 'email.open_feed');
  const body = para(lead) + (shown ? para(shown) : '') + (items.length ? itemsHtmlLang(items, lang) : '') + para(source) + para(caveat) + (tail ? para(tail) : '') + button(o.feedUrl, open);
  const bodyText = `${lead}\n\n${shown ? `${shown}\n\n` : ''}${items.length ? `${itemsTextLang(items, lang)}\n\n` : ''}${source}\n\n${caveat}\n\n${tail ? `${tail}\n\n` : ''}${open}: ${o.feedUrl}\n`;
  return shellLang(o, lang, t(lang, 'life.w.subject'), body, bodyText);
}

function typeLabelLang(l: TypeLine, lang: Lang): string {
  const k = l.key ? `recent.type.${l.key}.${l.count === 1 ? 'one' : 'many'}` : '';
  return k && hasKey(k) ? t(lang, k) : l.label;
}

function welcomeQuietLang(o: WelcomeQuiet, lang: Lang): Rendered {
  const lines = o.lines.slice(0, 4);
  const floor = o.capped ? t(lang, 'life.at_least') : '';
  const lead = t(lang, 'life.q.first');
  const parts = lines.map((l) => `${typeLabelLang(l, lang)} (${countLang(lang, l.count)})`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${t(lang, 'life.and')} ${parts[parts.length - 1]}` : (parts[0] ?? '');
  const watch = t(lang, o.total === 1 && !o.capped ? 'life.q.watch_one' : 'life.q.watch_many', { days: o.days, floor, n: countLang(lang, o.total), list });
  const how = t(lang, 'life.q.how');
  const open = t(lang, 'email.open_feed');
  const body = para(lead) + para(watch) + para(how) + button(o.feedUrl, open);
  const bodyText = `${lead}\n\n${watch}\n\n${how}\n\n${open}: ${o.feedUrl}\n`;
  return shellLang(o, lang, t(lang, 'life.w.subject'), body, bodyText);
}

function planSentenceLang(p: PlanLine, lang: Lang): string {
  const areas = t(lang, p.areas === 1 ? 'life.p.area_one' : 'life.p.area_many', { n: p.areas });
  const kw = p.keywords > 0 ? t(lang, 'life.p.kw', { n: p.keywords }) : '';
  return t(lang, 'life.p.line', { plan: planNameEs(p.tier), areas, trades: p.trades, kw, monthly: p.monthly, yearly: p.yearly });
}

function trialEndingLang(o: TrialEnding, lang: Lang): Rendered {
  const items = o.items.slice(0, 3);
  const plans = o.plans ?? planLines();
  const subject = t(lang, 'life.e.subject', { n: TRIAL_ENDING_DAYS });
  const lead = t(lang, 'life.e.first', { n: TRIAL_ENDING_DAYS });
  const found = items.length === 0 ? t(lang, 'life.e.none') : items.length === 1 ? t(lang, 'life.e.one') : t(lang, 'life.e.many', { n: items.length });
  const plansIntro = t(lang, 'life.e.plans');
  const renew = t(lang, 'life.e.renew');
  const pick = t(lang, 'app.pick_plan');
  const body = para(lead) + para(found) + (items.length ? itemsHtmlLang(items, lang) : '') + para(plansIntro) + plans.map((p) => para(planSentenceLang(p, lang))).join('') + para(renew) + button(o.plansUrl, pick);
  const bodyText = `${lead}\n\n${found}\n\n${items.length ? `${itemsTextLang(items, lang)}\n\n` : ''}${plansIntro}\n\n${plans.map((p) => planSentenceLang(p, lang)).join('\n\n')}\n\n${renew}\n\n${pick}: ${o.plansUrl}\n`;
  return shellLang(o, lang, subject, body, bodyText);
}

function trialEndedLang(o: TrialEnded, lang: Lang): Rendered {
  const floor = o.capped ? t(lang, 'life.at_least') : '';
  const lead = t(lang, 'life.d.first');
  const since = o.missed > 0 ? t(lang, o.missed === 1 && !o.capped ? 'life.d.since_one' : 'life.d.since_many', { floor, n: countLang(lang, o.missed) }) : '';
  const pick = t(lang, 'app.pick_plan');
  const body = para(lead) + (since ? para(since) : '') + button(o.plansUrl, pick);
  const bodyText = `${lead}\n\n${since ? `${since}\n\n` : ''}${pick}: ${o.plansUrl}\n`;
  return shellLang(o, lang, t(lang, 'life.d.subject'), body, bodyText);
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
  if (o.lang && o.lang !== 'en') return welcomeMatchesLang(o, o.lang);
  const items = o.items.slice(0, 5);
  const num = count(o.total, 'record', 'records');
  const verb = o.total === 1 && !o.capped ? 'matches' : 'match';
  const lead = `Your account is a day old, and ${o.capped ? 'at least ' : ''}${num} already ${verb} the trades and area you saved in your profile.`;
  const shown = items.length === 0 ? '' : items.length === 1 && o.total === 1 ? 'Here it is.' : `Here are the newest ${items.length}.`;
  const caveat =
    'A record shows that something happened, but it does not show that anyone needs work or that a job is still open. Treat each one as a starting point.';
  const source =
    'These come from public sources such as city permit offices, the National Weather Service and city 311 systems, so every line is something an agency already published.';
  const tail = o.total > items.length ? 'The rest are in your account.' : '';
  const body =
    para(lead) +
    (shown ? para(shown) : '') +
    (items.length ? itemsHtml(items) : '') +
    para(source) +
    para(caveat) +
    (tail ? para(tail) : '') +
    button(o.feedUrl, 'See all your matches');
  const bodyText =
    `${lead}\n\n${shown ? `${shown}\n\n` : ''}${items.length ? `${itemsText(items)}\n\n` : ''}${source}\n\n${caveat}\n\n${tail ? `${tail}\n\n` : ''}See all your matches: ${o.feedUrl}\n`;
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
  if (o.lang && o.lang !== 'en') return welcomeQuietLang(o, o.lang);
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
  const how = 'New ones show up as agencies publish them. To see more, add a trade or widen your radius in Settings.';
  const body = para(lead) + para(watch) + para(how) + button(o.feedUrl, 'See all your matches');
  const bodyText = `${lead}\n\n${watch}\n\n${how}\n\nSee all your matches: ${o.feedUrl}\n`;
  return shell(o, WELCOME_SUBJECT, body, bodyText);
}

// ---- trial-ending ----------------------------------------------------------------------------------------------------------------
/** Whole days the trial-ending email normally talks about: it goes at the first hourly run inside its window, 84 to 60 hours out. Not a trial length. */
export const TRIAL_ENDING_DAYS = 3;
/** The days the email states for the hours actually left: 3 from 60 hours up, 2 below (a late send after missed runs). */
export function trialEndingDays(hoursLeft: number): number {
  return hoursLeft >= 60 ? 3 : 2;
}
export const trialEndingSubject = (days: number = TRIAL_ENDING_DAYS) => `Your trial ends in ${days} days`;
export const TRIAL_ENDING_SUBJECT = trialEndingSubject(TRIAL_ENDING_DAYS);
// The window this email is sent in (lib/lifecycle/select.ts); kept here so the copy and the window cannot drift apart unnoticed.
export const TRIAL_ENDING_WINDOW_HOURS = WINDOWS.trial_ending;

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
  /** Whole days left as stated in the email (trialEndingDays). Default TRIAL_ENDING_DAYS. */
  daysLeft?: number;
  plans?: PlanLine[];
}

export function renderTrialEnding(o: TrialEnding): Rendered {
  if (o.lang && o.lang !== 'en') return trialEndingLang(o, o.lang);
  const items = o.items.slice(0, 3);
  const plans = o.plans ?? planLines();
  const days = o.daysLeft ?? TRIAL_ENDING_DAYS;
  const lead = `Your free trial ends in about ${days} days, and after that your alerts stop unless you pick a plan.`;
  const found =
    items.length === 0
      ? 'Holler has not matched anything to your trades and area yet, and it will keep watching until the trial ends.'
      : items.length === 1
        ? 'Here is the alert that looks strongest for your trades so far.'
        : `Here are the ${items.length} alerts that look strongest for your trades so far, picked from what Holler matched to you. Judge them for yourself.`;
  const plansIntro = 'There are two plans.';
  const renew = 'If you added a card, your plan starts when the trial ends and renews until you cancel in Settings. If not, nothing is charged.';
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
  return shell(o, trialEndingSubject(days), body, bodyText);
}

// ---- trial-ended ----------------------------------------------------------------------------------------------------------------
export const TRIAL_ENDED_SUBJECT = 'Your alerts are paused';

export interface TrialEnded extends Common {
  /** New public records that match the member's trades and area since the trial ended. Zero is fine. */
  missed: number;
  capped?: boolean;
}

export function renderTrialEnded(o: TrialEnded): Rendered {
  if (o.lang && o.lang !== 'en') return trialEndedLang(o, o.lang);
  const lead = 'Your free trial has ended, so Holler has paused your alerts, and a plan is all it takes to turn them back on.';
  const since =
    o.missed > 0
      ? `Since then, ${o.capped ? 'at least ' : ''}${count(o.missed, 'new public record has', 'new public records have')} matched your trades and area, based on what you saved in your profile.`
      : '';
  const body = para(lead) + (since ? para(since) : '') + button(o.plansUrl, 'Pick a plan');
  const bodyText = `${lead}\n\n${since ? `${since}\n\n` : ''}Pick a plan: ${o.plansUrl}\n`;
  return shell(o, TRIAL_ENDED_SUBJECT, body, bodyText);
}
