import { relativeTime } from '../time';
import { CADENCE_SHORT } from '../seo/cadence';
import { env, siteUrl } from '../env';
import { HOLLER_REQUEST_SOURCE } from '../signals/request-visibility';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { bidSourceLinkLabel } from '../signals/bid-card';
import { briefFamilyOf, type BriefFamily, type CardBrief } from '../signals/brief';
import { isHundredBlock } from '../signals/site-address';
import { areaListTrades, buildingAddress } from '../lists/core';
import { tradeLabel } from '../check/trades';
import { bidSourceLinkLabelLang, cardBriefLang } from '../signals/brief-i18n';
import { isStageUpdate, stageUpdateLine, stageUpdateMeta, stageUpdateSubject } from '../signals/stage';
import { lowerFirst, t, type Lang } from '../i18n';
import { localizeTitle } from '../signals/title-i18n';
import { orderByLabel, type OpportunityLabel } from '../signals/lead-rules';
import { chipLabel, deadlineLineLang } from '../signals/lead-i18n';
import { TRIAL_DAYS } from '../auth/membership';
import { trialPhraseEs } from '../plan/price-copy-es';
import { expandTradeIds } from '../plan/composite-trades';
import type { CoverageState } from '../check/cells';
import {
  EMAIL_COLORS,
  EMAIL_FONTS,
  EMAIL_STYLE,
  buttonHtml,
  cardButtonHtml,
  cardClose,
  cardTableHtml,
  chipHtml,
  digestDarkModeCss,
  wrapOpen,
  WRAP_CLOSE as THEME_WRAP_CLOSE,
} from './theme';

export interface DigestItem {
  kind: string;
  /**
   * holler_matches.id of this member's own match row. Round 23: the card's own action deep-links to this card in the member's feed
   * (`/app#card-<id>`, the anchor components/feed.tsx puts on every card). Absent: the action opens the feed itself.
   */
  matchId?: number | null;
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
   * One organization the record names, in plain words (see lib/outreach/plan.ts emailContact). Name and role: the email never carries
   * the record's address, phone number or email address. Round 18: `listing` adds the phone and website of the business's own public
   * listing when one was found, labelled as such. Absent when the record names no organization.
   */
  contact?: { name: string; role: string; listing?: { phone: string | null; website: { href: string; text: string } | null; note: string } | null } | null;
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
  /** Permits: data.permitStage and data.permitStageAt of a stage update (migration 0025 feature). */
  permitStage?: unknown;
  permitStageAt?: string | null;
  /** Permits: data.permitStageUpdate, true on a record whose stage changed after it was stored. The item then reads "Stage update", never "new". */
  permitStageUpdate?: unknown;
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
  const b = cardBriefLang({ source: it.source ?? '', kind: it.kind, subtype: it.subtype, title: it.title, summary: it.summary, label: it.label, trade: it.trade, url: it.sourceUrl, occurredAt: it.occurredAt, base, managerName: it.managerName, managerRole: it.managerRole, jobValue: it.jobValue, permitStage: it.permitStage, permitStageAt: it.permitStageAt }, lang);
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

type ListingForEmail = NonNullable<NonNullable<DigestItem['contact']>['listing']>;

/** The listing's website only when it is an https link; a phone stays even when the website is dropped. */
function httpsSite(l: ListingForEmail): ListingForEmail['website'] {
  return l.website && /^https:\/\//.test(l.website.href) ? l.website : null;
}

/** "Contact: Acme Roofing LLC (General contractor on this permit)". Plain text; callers escape it for HTML. */
export function contactLine(c: { name: string; role: string }, lang: Lang = 'en'): string {
  // The role is a capitalised label ("Aparece en este permiso"); inside the parentheses Spanish writes it in lower case.
  return noDash(t(lang, 'email.contact', { name: c.name, role: lang === 'en' ? c.role : lowerFirst(c.role) }));
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

/** True for an item that is a stage update (see lib/signals/stage.ts isStageUpdate). */
function isUpdateItem(it: DigestItem): boolean {
  return isStageUpdate({ permitStage: it.permitStage, permitStageAt: it.permitStageAt, permitStageUpdate: it.permitStageUpdate });
}

/** Act Now first; inside a label a stage update first, then the order the caller gave (a stable sort). The feed's own order. */
export function digestOrder(items: readonly DigestItem[]): DigestItem[] {
  return orderByLabel([...items.filter(isUpdateItem), ...items.filter((it) => !isUpdateItem(it))], (it) => it.label ?? 'coming_soon');
}

/**
 * The digest subject (round 23): what happened and where, on the strongest card, with the count of the rest. "Permit at 5900 SPARROW
 * WAY (+3)" reads on a lock screen; the old "4 new things near you" did not. A long street can push it past 45 characters, so it is
 * cut at 120 as before and never mid-address.
 *
 * Unchanged for stage updates: one reads "Update: final inspection on a permit near you"; updates only read "N permit updates near
 * you"; a mix says how many are updates. Never "new" for a stage update. Empty week: "Nothing near you this week".
 */
export function digestSubject(items: readonly DigestItem[], total: number, lang: Lang = 'en'): string {
  const updates = items.filter(isUpdateItem);
  if (updates.length === 0) {
    if (items.length === 0) return t(lang, 'email.subject.empty');
    const best = digestOrder(items)[0];
    const place = digestPlace(best, lang);
    const rest = Math.max(0, total - 1);
    // No address and no place: the title alone, which already says what happened ("Roof permit in Norfolk").
    const line =
      place.kind === 'title'
        ? rest > 0
          ? t(lang, 'email.subject.plain_more', { title: place.text, n: rest })
          : t(lang, 'email.subject.plain', { title: place.text })
        : rest > 0
          ? t(lang, 'email.subject.card_more', { what: digestWhat(best, lang), place: place.text, n: rest })
          : t(lang, 'email.subject.card', { what: digestWhat(best, lang), place: place.text });
    return line.slice(0, 120);
  }
  if (total === 1 && updates.length === 1) return stageUpdateSubject(updates[0].permitStage, lang) ?? t(lang, 'stage.update.subject_fallback');
  if (updates.length === items.length && total === items.length) return t(lang, 'stage.update.subject_only', { n: total });
  return t(lang, 'stage.update.subject_mixed', { n: total, u: updates.length });
}

/** The time part of an item's meta line: a stage update shows the date of the change, never "N days ago" as if the permit were fresh. */
function metaTime(it: DigestItem, now: Date, lang: Lang = 'en'): string {
  if (isUpdateItem(it)) {
    const meta = stageUpdateMeta(it.permitStageAt, lang);
    if (meta) return meta;
  }
  return timeAgo(it.occurredAt, now, lang);
}

// ---- the alert digest, round 23 -----------------------------------------------------------------------------------------------------
//
// One card is five rows at most: the chip, the place (loudest), one meta line, one reason, one action. "Source" and "What is uncertain"
// no longer repeat on every card: the link is the word "public source" in the meta line, and the honesty line sits once at the end of
// the email. A weather, storm, disaster or earthquake card keeps its own uncertainty line, because for those the words "damage is not
// confirmed" are part of what the card says, not a footnote.

/** The families whose card keeps its "What is uncertain" line: an event that is never, on its own, proof of damage. */
const DAMAGE_FAMILIES: readonly BriefFamily[] = ['weather-alert', 'storm-report', 'disaster', 'quake'];

function familyOf(it: DigestItem): BriefFamily {
  return briefFamilyOf({ source: it.source ?? '', kind: it.kind, subtype: it.subtype, title: it.title, summary: it.summary });
}

/**
 * True for a place name ("Atlanta, GA", "Cobb County"), false for a sentence. `place` is sometimes an approximate-location note
 * ("This alert covers a county or zone, not a point", lib/signals/approx-location.ts), which is honest but is not a heading: a card
 * whose only place is such a note falls back to its own title and keeps the note on the meta line.
 */
function looksLikePlace(s: string): boolean {
  if (s.length > 44 || /[.;:]/.test(s)) return false;
  return s.split(/\s+/).every((w) => {
    const core = w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
    return core.replace(/\P{L}/gu, '').length < 2 || /^[\p{Lu}\d]/u.test(core);
  });
}

/** "7800 block of S AVALON AVE" in English, "cuadra 7800 de S AVALON AVE" in Spanish. Null when the part is not a hundred-block. */
function blockPhrase(part: string, lang: Lang): string | null {
  const m = /^\s*(\d+|0-99)\s*(?:block of|blk\.?|block)\s+(.+?)\s*$/i.exec(part);
  return m ? t(lang, 'sum.sale_block', { n: m[1], street: m[2] }) : null;
}

/**
 * The loudest line of a card: where it is.
 *
 * Privacy (VERDICT section 5): an EXACT street address is printed only for a building permit. For anything else, a violation, a 311
 * request or a home sale, the card prints the hundred-block the record itself carries, and nothing finer. The check is made here as
 * well as upstream, so a record whose summary ever carried a house number could still not be printed as an address by this email.
 * No record of any family ever prints a person's name: the only names a card can print are the business contact lines, which come
 * from lib/contacts already checked for personal names.
 */
export function digestPlace(it: DigestItem, lang: Lang = 'en'): { text: string; exact: boolean; kind: 'address' | 'block' | 'place' | 'title' } {
  const parts = (it.summary ?? '').split(' | ').map((p) => p.trim()).filter(Boolean);
  if (familyOf(it) === 'permit') {
    const exact = buildingAddress(it.summary);
    if (exact) return { text: exact, exact: true, kind: 'address' };
  }
  for (const p of parts) {
    if (!isHundredBlock(p)) continue;
    const phrase = blockPhrase(p, lang);
    if (phrase) return { text: phrase, exact: false, kind: 'block' };
  }
  if (it.place && looksLikePlace(noDash(it.place))) return { text: noDash(it.place), exact: false, kind: 'place' };
  // A record with neither an address nor a place of its own: its own title is the loudest thing the card can say.
  return { text: noDash(localizeTitle(it.title, lang, it.source)), exact: false, kind: 'title' };
}

/** The chip's words: "Act now" on its own, or "Act now . Deadline: Dec 5, 2026" when the record published one. No chip without a label. */
export function digestChip(it: Pick<DigestItem, 'label' | 'deadline'>, lang: Lang = 'en'): { text: string; strong: boolean } | null {
  if (!it.label || it.label === 'context') return null;
  const label = chipLabel(it.label, lang);
  if (it.label !== 'act_now') return { text: label, strong: false };
  const d = it.deadline ? deadlineLineLang(it.deadline, lang) : null;
  return { text: d ? `${label} · ${d}` : label, strong: true };
}

/** Short words for the subject line: what kind of thing happened. One phrase per brief family, with a word for a new-home permit. */
export function digestWhat(it: DigestItem, lang: Lang = 'en'): string {
  if (it.subtype === 'bid') return t(lang, 'email.what.bid');
  const fam = familyOf(it);
  if (fam === 'permit') {
    return /\bnew (?:home|construction)\b/i.test(it.title) ? t(lang, 'email.what.new_home') : t(lang, 'email.what.permit');
  }
  const key = {
    'weather-alert': 'email.what.weather',
    'storm-report': 'email.what.storm',
    'disaster': 'email.what.disaster',
    'quake': 'email.what.quake',
    'airport': 'email.what.airport',
    'permit': 'email.what.permit',
    '311': 'email.what.311',
    'violation': 'email.what.violation',
    'inspection': 'email.what.inspection',
    'business': 'email.what.business',
    'event-permit': 'email.what.event_permit',
    'big-event': 'email.what.event',
    'federal-bid': 'email.what.bid',
    'city-bid': 'email.what.bid',
    'federal-award': 'email.what.award',
    'public-post': 'email.what.post',
    'resident-request': 'email.what.request',
    'sale': 'email.what.sale',
    'other': 'email.what.other',
  }[fam] as Parameters<typeof t>[1];
  return t(lang, key);
}

export interface DigestAction {
  href: string;
  label: string;
}

/**
 * The one action of a card. First rule that fits wins:
 *
 *  1. a resident request    reply to it in the feed (the only place a member can answer one)
 *  2. a block-level card whose trade has a neighborhood list (lib/lists)   print that list
 *  3. any other block-level card                                          print a door hanger (the storm version after weather)
 *  4. a card with an exact address                                        open that card in the feed
 *
 * Rule 2 and 3 follow the strategy's "where to hang and flyer this week": a block is something to walk, not an address to write to.
 * Every href is a route that exists today (app/app, app/app/lists/*) plus a query or anchor that route already reads.
 */
export function digestAction(it: DigestItem, appUrl: string, lang: Lang = 'en'): DigestAction {
  const base = appUrl.replace(/\/$/, '');
  const card = typeof it.matchId === 'number' && Number.isSafeInteger(it.matchId) ? `${base}#card-${it.matchId}` : base;
  const fam = familyOf(it);
  if (fam === 'resident-request') return { href: card, label: t(lang, 'email.act.reply') };
  if (!digestPlace(it, lang).exact) {
    // Round 24: a trade is resolved through the sign-up form's composite "Pressure washing" chip first (lib/plan/composite-trades.ts),
    // so the link always names a real trade the area-list page accepts: never the chip's own id, which no profile ever saves.
    const trade = it.trade ? (areaListTrades(expandTradeIds([it.trade]))[0] ?? null) : null;
    if (trade) {
      return { href: `${base}/lists/area?trade=${encodeURIComponent(trade)}`, label: t(lang, 'email.act.area_list', { trade: lowerFirst(tradeLabel(trade, lang)) }) };
    }
    return DAMAGE_FAMILIES.includes(fam)
      ? { href: `${base}/lists/door-hanger?storm=1`, label: t(lang, 'email.act.storm_hanger') }
      : { href: `${base}/lists/door-hanger`, label: t(lang, 'email.act.hanger') };
  }
  return { href: card, label: t(lang, 'email.act.open_card') };
}

/**
 * The reason a card gives: one line, or two on the few permits whose stage moved (the stage line is the news, and the line under it
 * says why that matters to this trade). The AI note (lib/ai, English only) is preferred over the brief's generic "why", because it is
 * written for this record and this trade; both are checked for wording before they get here.
 */
function digestReasons(it: DigestItem, br: CardBrief, lang: Lang): string[] {
  const stage = isUpdateItem(it) ? stageUpdateLine(it.permitStage, it.permitStageAt, lang) : br.stageLine;
  const why = it.note && lang === 'en' ? noDash(it.note) : noDash(br.why);
  return stage ? [noDash(stage), why] : [why];
}

/** The contact line of a card, folded into one row: the business, its role, and the phone and site of its own public listing. */
function contactParts(it: DigestItem, lang: Lang): { text: string; website: ListingForEmail['website'] } | null {
  if (!it.contact?.name) return null;
  const l = it.contact.listing ?? null;
  const website = l ? httpsSite(l) : null;
  const phone = l?.phone ? noDash(t(lang, 'listing.phone', { value: l.phone })) : null;
  return { text: [contactLine(it.contact, lang), phone].filter(Boolean).join(' · '), website };
}

/** The member's own cell in the site's coverage gate, as the quiet-week email needs it: the state, and the trades that are in it. */
export interface DigestCoverage {
  state: CoverageState;
  /** The member's trades (real ids) that sit at `state`. Empty for 'live'. */
  trades: string[];
}

/** "lawn care", "lawn care and fencing", "lawn care, fencing and painting", in the member's language. */
function tradeList(ids: readonly string[], lang: Lang): string {
  const names = ids.map((id) => lowerFirst(tradeLabel(id, lang)));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t(lang, 'life.and')} ${names[names.length - 1]}` : (names[0] ?? '');
}

/**
 * The quiet-week email's one honest line (round 24). A member whose trade and city the site calls 'limited' is told what the /check page
 * tells a visitor ("few records for this trade here yet"); a member in a 'waitlist' cell is told what the waitlist card says ("lately
 * none of them has been work for this trade"). Only a 'live' cell, or a member the gate has never measured, reads "quiet weeks happen".
 */
function emptyBody(coverage: DigestCoverage | null, lang: Lang): string {
  if (coverage && coverage.trades.length > 0) {
    if (coverage.state === 'limited') return t(lang, 'email.empty.limited', { trades: tradeList(coverage.trades, lang) });
    if (coverage.state === 'waitlist') return t(lang, 'email.empty.waitlist', { trades: tradeList(coverage.trades, lang) });
  }
  return t(lang, 'email.empty.body');
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
  /**
   * Round 24: the member's own cell in the site's coverage gate (lib/check/cells.ts, built by lib/email/coverage.ts digestCoverage).
   * Read by the quiet-week email only: in a 'limited' or 'waitlist' cell it says so in the site's own terms instead of "quiet weeks
   * happen", which would imply a full week elsewhere. Absent or 'live': the quiet-week email as written in round 23.
   */
  coverage?: DigestCoverage | null;
}): Rendered {
  const lang: Lang = opts.lang ?? 'en';
  const now = opts.now ?? new Date();
  const total = opts.totalCount ?? opts.items.length;
  const more = Math.max(0, total - opts.items.length);
  const subject = noDash(digestSubject(opts.items, total, lang));
  const open = wrapOpen(560, lang, true);
  const eyebrow = `<p style="margin:0 0 6px 0;${S.eyebrow}">${escapeHtml(t(lang, 'email.eyebrow', { name: noDash(opts.businessName) }))}</p>`;
  const h1 = (text: string) => `<h1 class="h-h1" style="${S.h1};font-size:24px;margin:0 0 16px 0">${escapeHtml(text)}</h1>`;
  const legal =
    `<p class="h-small" style="${S.small};margin:28px 0 0 0">${t(lang, 'email.footer.why')} <a class="h-link" href="${escapeHtml(opts.unsubscribeUrl)}" style="${S.mutedLink}">${t(lang, 'email.footer.off')}</a>.${contactHtml(lang)}</p>`;
  // CAN-SPAM (round 24, FIXLIST row 17): the plain-text part carries the same three things as the HTML: why you got this, the opt-out
  // link and the postal address. Before round 24 the text part had no reason line.
  const legalText = `${t(lang, 'email.footer.why')}\n${t(lang, 'email.footer.off')}: ${opts.unsubscribeUrl}\n${contactText(lang)}\n${postalFooterText(lang)}\n`;

  // A quiet week is not an empty email (item 7): one honest line about why, and the two things that are still worth doing.
  if (opts.items.length === 0) {
    const base = opts.appUrl.replace(/\/$/, '');
    const quietBody = emptyBody(opts.coverage ?? null, lang);
    const html =
      digestDarkModeCss() +
      open +
      eyebrow +
      h1(t(lang, 'email.empty.h')) +
      `<p class="h-why" style="font-size:15px;margin:0 0 10px 0;color:${EMAIL_COLORS.ink}">${escapeHtml(quietBody)}</p>` +
      `<p class="h-meta" style="${S.muted};margin:0">${escapeHtml(t(lang, 'email.empty.next'))}</p>` +
      cardButtonHtml(escapeHtml(`${base}/lists/door-hanger`), escapeHtml(t(lang, 'email.act.hanger'))) +
      `<p style="margin:14px 0 0 0"><a class="h-link" href="${escapeHtml(`${base}/lists`)}" style="${S.link};font-size:15px">${escapeHtml(t(lang, 'email.act.lists'))}</a></p>` +
      legal +
      cardClose() +
      postalFooterHtml(lang) +
      WRAP_CLOSE;
    const text =
      `${t(lang, 'email.eyebrow', { name: noDash(opts.businessName) })}\n\n${t(lang, 'email.empty.h')}\n\n` +
      `${quietBody}\n\n${t(lang, 'email.empty.next')}\n\n` +
      `${t(lang, 'email.act.hanger')}: ${base}/lists/door-hanger\n${t(lang, 'email.act.lists')}: ${base}/lists\n\n${legalText}`;
    return { subject, html, text };
  }

  const items = digestOrder(opts.items);
  const anyListing = items.some((it) => it.contact?.listing && (it.contact.listing.phone || httpsSite(it.contact.listing)));
  const honesty = [t(lang, 'email.honesty'), anyListing ? t(lang, 'email.honesty.listing') : null].filter(Boolean).join(' ');

  /** Everything one card shows, built once and rendered twice (html and plain text). */
  const cards = items.map((it) => {
    const br = digestBrief(it, siteUrl, lang);
    const place = digestPlace(it, lang);
    const title = noDash(localizeTitle(it.title, lang, it.source));
    // The meta line: the record's own title, then only what helps a decision. "City data" and the dataset's name are gone.
    // The place is dropped when the headline is already that place, or when the record's own title names the town ("... in Chicago").
    const city = it.place ? noDash(it.place).split(',')[0].trim() : '';
    const showPlace = !!it.place && noDash(it.place) !== place.text && !(city.length > 2 && title.includes(city));
    // One time segment: how long ago, with the date the record itself carries in brackets. A stage update's meta already names its
    // date, so it is not repeated. The record date stays on the card (a permit read in March wants the day, not "4 months ago").
    const ago = metaTime(it, now, lang);
    const date = br.source.dateText;
    const when = date && !isUpdateItem(it) ? `${ago} (${date})` : ago;
    const bidLabel = it.subtype === 'bid' && !title.includes(t(lang, 'bid.label')) ? t(lang, 'bid.label') : null;
    const meta = [
      bidLabel,
      place.kind === 'title' ? null : title,
      showPlace ? noDash(it.place as string) : null,
      when,
      br.valueLine ? noDash(br.valueLine) : null,
      it.bidLine ? noDash(it.bidLine) : null,
    ].filter((x): x is string => !!x);
    return {
      it,
      br,
      place,
      title,
      meta,
      chip: digestChip(it, lang),
      reasons: digestReasons(it, br, lang),
      // A request's own words, and the business the record names, are the two things in a card worth more than a sentence of ours.
      detail: it.detail ? noDash(it.detail) : null,
      contact: contactParts(it, lang),
      managedBy: br.managedBy ? noDash(br.managedBy) : null,
      // "Not confirmed" stays on the card only where the event itself is never proof of damage; for the rest it is said once below.
      uncertain: DAMAGE_FAMILIES.includes(familyOf(it)) ? noDash(br.uncertain) : null,
      act: digestAction(it, opts.appUrl, lang),
      // A resident request has no public source page of its own, so it gets no "public source" link (it links to the form instead).
      source: familyOf(it) === 'resident-request' ? null : br.href,
    };
  });

  const htmlItems = cards
    .map((c) => {
      // The first meta segment is the record's own title (or, when the headline is the title, the time): ink, so the eye lands on it.
      const metaHtml =
        `<div class="h-meta" style="font-size:14px;line-height:1.45;margin:5px 0 0 0;color:${EMAIL_COLORS.muted}">` +
        c.meta.map((m, i) => (i === 0 ? `<span class="h-ink" style="color:${EMAIL_COLORS.ink}">${escapeHtml(m)}</span>` : ` &middot; ${escapeHtml(m)}`)).join('') +
        (c.source ? ` &middot; <a class="h-link" href="${escapeHtml(c.source)}" style="${S.link}">${escapeHtml(t(lang, 'email.source_link'))}</a>` : '') +
        '</div>';
      const inner =
        (c.chip ? chipHtml(escapeHtml(c.chip.text), c.chip.strong) + '<div style="height:10px;line-height:10px">&nbsp;</div>' : '') +
        `<div class="h-head" style="font-family:${EMAIL_FONTS.body};font-size:20px;line-height:1.25;font-weight:700;margin:0;color:${EMAIL_COLORS.ink}">${escapeHtml(c.place.text)}</div>` +
        metaHtml +
        c.reasons.map((r) => `<div class="h-why" style="font-size:15px;line-height:1.5;margin:10px 0 0 0;color:${EMAIL_COLORS.ink}">${escapeHtml(r)}</div>`).join('') +
        (c.detail
          ? `<div class="h-quote" style="${S.quote};font-size:15px;line-height:1.5;margin:10px 0 0 0;padding:8px 12px">${escapeHtml(c.detail)}</div>`
          : '') +
        (c.contact
          ? `<div class="h-meta" style="font-size:14px;line-height:1.45;margin:8px 0 0 0;color:${EMAIL_COLORS.muted}">${escapeHtml(c.contact.text)}${
              c.contact.website
                ? ` &middot; ${escapeHtml(noDash(t(lang, 'listing.website', { value: '' }).trimEnd()))} <a href="${escapeHtml(c.contact.website.href)}" rel="noopener noreferrer nofollow" class="h-link" style="${S.link}">${escapeHtml(c.contact.website.text)}</a>`
                : ''
            }</div>`
          : '') +
        (c.managedBy ? `<div class="h-meta" style="font-size:14px;line-height:1.45;margin:8px 0 0 0;color:${EMAIL_COLORS.muted}">${escapeHtml(c.managedBy)}</div>` : '') +
        (c.uncertain ? `<div class="h-small" style="${S.small};line-height:1.45;margin:8px 0 0 0">${escapeHtml(c.uncertain)}</div>` : '') +
        cardButtonHtml(escapeHtml(c.act.href), escapeHtml(c.act.label), c.chip?.strong ? 'primary' : 'secondary');
      return `<li style="margin:0 0 14px 0;padding:0;list-style:none">${cardTableHtml(inner)}</li>`;
    })
    .join('');

  const html =
    digestDarkModeCss() +
    open +
    eyebrow +
    h1(subject) +
    `<ul style="margin:0;padding:0">${htmlItems}</ul>` +
    (more > 0 ? `<p class="h-meta" style="${S.muted};margin:0 0 4px 0">${escapeHtml(t(lang, 'email.plus_more', { n: more }))}</p>` : '') +
    buttonHtml(escapeHtml(opts.appUrl), escapeHtml(t(lang, 'email.open_feed'))) +
    `<p class="h-small" style="${S.small};line-height:1.5;margin:0">${escapeHtml(honesty)}</p>` +
    legal +
    cardClose() +
    postalFooterHtml(lang) +
    WRAP_CLOSE;

  const textItems = cards
    .map((c, i) => {
      const lines = [
        `${i + 1}. ${c.place.text}${c.chip ? ` [${c.chip.text}]` : ''}`,
        `   ${c.meta.join('. ')}`,
        ...c.reasons.map((r) => `   ${r}`),
        ...(c.detail ? [`   "${c.detail}"`] : []),
        ...(c.contact ? [`   ${c.contact.text}${c.contact.website ? ` \u00b7 ${noDash(t(lang, 'listing.website', { value: c.contact.website.href }))}` : ''}`] : []),
        ...(c.managedBy ? [`   ${c.managedBy}`] : []),
        ...(c.uncertain ? [`   ${c.uncertain}`] : []),
        `   ${c.act.label}: ${c.act.href}`,
        ...(c.source ? [`   ${t(lang, 'email.source_link')}: ${c.source}`] : []),
      ];
      return lines.join('\n');
    })
    .join('\n\n');

  const text =
    `${t(lang, 'email.eyebrow', { name: noDash(opts.businessName) })}\n\n${subject}\n\n${textItems}\n\n` +
    (more > 0 ? `${t(lang, 'email.plus_more', { n: more })}\n\n` : '') +
    `${honesty}\n\n${t(lang, 'email.open_feed')}: ${opts.appUrl}\n\n${legalText}`;

  return { subject, html, text };
}

/** How long a verify link works (lib/email/token.ts signs it for 7 days). Said in the verify emails. */
export const VERIFY_LINK_DAYS = 7;

/**
 * The account emails in a language other than English (round 18 ES): password reset, welcome, and welcome plus verify. Same layout,
 * buttons and footer as the English ones below, which are left exactly as they were. Every word comes from the dictionary; the trial
 * length from TRIAL_DAYS through lib/plan/price-copy-es.ts trialPhraseEs.
 */
function accountMail(lang: Lang, o: { subject: string; heading: string; paras: string[]; button: { href: string; label: string }; note: string; noteText?: string; textLink?: string }): Rendered {
  const html =
    wrapOpen(560, lang) +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">${escapeHtml(o.heading)}</h1>` +
    o.paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
    button(o.button.href, o.button.label) +
    `<p style="${S.muted}">${o.note}${contactHtml(lang)}</p>` +
    cardClose() +
    postalFooterHtml(lang) +
    WRAP_CLOSE;
  const text = `${o.heading}\n\n${o.paras.join('\n\n')}\n\n${o.textLink ?? `${o.button.label}: ${o.button.href}`}\n\n${o.noteText ?? o.note}\n${contactText(lang)}\n${postalFooterText(lang)}\n`;
  return { subject: o.subject, html, text };
}

export function renderPasswordReset(opts: { resetUrl: string; lang?: Lang }): Rendered {
  if (opts.lang && opts.lang !== 'en') {
    const lang = opts.lang;
    return accountMail(lang, {
      subject: t(lang, 'mail.reset.subject'),
      heading: t(lang, 'mail.reset.h'),
      paras: [t(lang, 'mail.reset.p')],
      button: { href: opts.resetUrl, label: t(lang, 'mail.reset.button') },
      note: escapeHtml(t(lang, 'mail.reset.ignore')),
      noteText: t(lang, 'mail.reset.ignore'),
      textLink: opts.resetUrl,
    });
  }
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

export function renderWelcome(opts: { businessName: string; appUrl: string; trialDays?: number; lang?: Lang }): Rendered {
  const days = opts.trialDays ?? TRIAL_DAYS;
  if (opts.lang && opts.lang !== 'en') {
    const lang = opts.lang;
    const a = contactAddress();
    const html =
      wrapOpen(560, lang) +
      `<h1 style="${S.h1};font-size:24px;margin:0 0 12px 0">${escapeHtml(t(lang, 'mail.welcome.h', { name: noDash(opts.businessName) }))}</h1>` +
      `<p>${escapeHtml(t(lang, 'mail.welcome.p1', { cadence: t(lang, 'cadence.short') }))}</p>` +
      `<p>${escapeHtml(t(lang, 'mail.welcome.p2', { trial: trialPhraseEs(days) }))}</p>` +
      button(opts.appUrl, t(lang, 'email.open_feed')) +
      (a ? `<p style="${S.muted}">${contactHtml(lang).trim()}</p>` : '') +
      cardClose() +
      postalFooterHtml(lang) +
      WRAP_CLOSE;
    const text = `${t(lang, 'mail.welcome.h', { name: noDash(opts.businessName) })}\n\n${t(lang, 'mail.welcome.p1', { cadence: t(lang, 'cadence.short') })}\n\n${t(lang, 'mail.welcome.p2', { trial: trialPhraseEs(days) })}\n\n${t(lang, 'email.open_feed')}: ${opts.appUrl}\n${contactText(lang)}\n${postalFooterText(lang)}\n`;
    return { subject: t(lang, 'mail.welcome.subject'), html, text };
  }
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
export function renderVerifyEmail(opts: { verifyUrl: string; appUrl: string; trialDays?: number; lang?: Lang }): Rendered {
  const days = opts.trialDays ?? TRIAL_DAYS;
  if (opts.lang && opts.lang !== 'en') {
    const lang = opts.lang;
    const url = escapeHtml(opts.appUrl);
    return accountMail(lang, {
      subject: t(lang, 'mail.verify.subject'),
      heading: t(lang, 'mail.verify.h'),
      paras: [t(lang, 'mail.verify.p1', { trial: trialPhraseEs(days) }), t(lang, 'mail.verify.p2', { days: VERIFY_LINK_DAYS })],
      button: { href: opts.verifyUrl, label: t(lang, 'mail.verify.button') },
      note: `${escapeHtml(t(lang, 'mail.verify.setup'))} <a href="${url}" style="${S.mutedLink}">${url}</a>. ${escapeHtml(t(lang, 'mail.verify.ignore'))}`,
      noteText: `${t(lang, 'mail.verify.setup')} ${opts.appUrl}\n\n${t(lang, 'mail.verify.ignore')}`,
      textLink: opts.verifyUrl,
    });
  }
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

/**
 * "Coming to your area" double opt-in (restored in round 19 from the other branch's lib/email/templates.ts, review defect 1). One
 * email; nothing more is ever sent unless the link is pressed. The link is /waitlist/confirm (a token page: no-referrer).
 */
export function renderWaitlistConfirm(opts: { confirmUrl: string; place: string; lang?: Lang }): Rendered {
  // Round 19 integration: words from lib/i18n (wl.email.*); English is the round 19 text unchanged, Spanish only when asked for.
  const lang = opts.lang ?? 'en';
  const place = noDash(opts.place);
  const subject = t(lang, 'wl.email.subject', { place });
  const h = t(lang, 'wl.email.h');
  const body = t(lang, 'wl.email.body', { place });
  const note = t(lang, 'wl.email.note');
  const button1 = t(lang, 'wl.confirm.button');
  const html =
    (lang === 'en' ? WRAP_OPEN : wrapOpen(560, lang)) +
    `<h1 style="${S.h1};margin:0 0 12px 0">${escapeHtml(h)}</h1>` +
    `<p>${escapeHtml(body)}</p>` +
    button(opts.confirmUrl, button1) +
    `<p style="${S.muted}">${escapeHtml(note)}${contactHtml(lang)}</p>` +
    cardClose() +
    postalFooterHtml(lang) +
    WRAP_CLOSE;
  const text = `${h}\n\n${body}\n\n${button1}: ${opts.confirmUrl}\n\n${note}\n${contactText(lang)}\n${postalFooterText(lang)}\n`;
  return { subject, html, text };
}
