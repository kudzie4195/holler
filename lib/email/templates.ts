import { relativeTime } from '../time';
import { CADENCE_SHORT } from '../seo/cadence';
import { env, siteUrl } from '../env';
import { HOLLER_REQUEST_SOURCE } from '../signals/request-visibility';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { bidSourceLinkLabel } from '../signals/bid-card';
import { briefFamilyOf, isCommercialSaleTitle, type BriefFamily, type CardBrief } from '../signals/brief';
import { isHundredBlock } from '../signals/site-address';
import { areaListTrades, buildingAddress } from '../lists/core';
import { tradeLabel } from '../check/trades';
import { bidSourceLinkLabelLang, cardBriefLang } from '../signals/brief-i18n';
import { isStageUpdate, stageUpdateLine, stageUpdateMeta, stageUpdateSubject } from '../signals/stage';
import { lowerFirst, t, type DictKey, type Lang } from '../i18n';
import { fixedTextLang, localizeTitle } from '../signals/title-i18n';
import { orderByLabel, type OpportunityLabel } from '../signals/lead-rules';
import { chipLabel, deadlineLineLang } from '../signals/lead-i18n';
import { TRIAL_DAYS } from '../auth/membership';
import { trialPhraseEs } from '../plan/price-copy-es';
import { expandTradeIds } from '../plan/composite-trades';
import { tradeSignupClosed, type CoverageState } from '../check/cells';
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
  return KIND_LABELS[kind] ?? 'Public record';
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

/**
 * Text we show must never contain an em dash (house copy rule), including text from sources. Round 24 (review P3): the bidi override and
 * isolate controls (U+202A to U+202E, U+2066 to U+2069) are dropped too, so a source cannot make "evil" render as "live" on the same line.
 */
function noDash(s: string): string {
  return s.replace(/—/g, '-').replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
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

function contactHtml(lang: Lang = 'en', classed = false): string {
  const a = contactAddress();
  // `classed` (round 24, the alert digest only): the dark-mode hook, so "Contact us" is not muted grey on the dark card (review P2-6).
  // Every other email passes nothing and keeps its exact bytes.
  return a ? ` ${t(lang, 'email.questions')} <a${classed ? ' class="h-link"' : ''} href="mailto:${escapeHtml(a)}" style="${S.mutedLink}">${t(lang, 'email.contact_us')}</a>.` : '';
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

/** The most a subject should run where the record allows it (round 24, review P2-7): a phone lock screen shows about this much. */
export const SUBJECT_TARGET = 50;
/** The hard cap, as before round 24. */
export const SUBJECT_MAX = 120;

/**
 * The longest whole-word start of `part` that, with "…" after it, makes `build(start…)` fit in `max`. Null when even one word is too long
 * (the caller then keeps the part whole: a subject is never cut mid-word).
 */
function fitWords(part: string, build: (p: string) => string, max: number): string | null {
  if (build(part).length <= max) return part;
  const words = part.split(/\s+/);
  for (let n = words.length - 1; n >= 1; n--) {
    const head = words.slice(0, n).join(' ').replace(/[\s,;:.(-]+$/, '');
    if (head && build(`${head}…`).length <= max) return `${head}…`;
  }
  return null;
}

/** One unbroken token longer than the hard cap (no source writes one, but a subject must never pass SUBJECT_MAX): cut it, with "…". */
function lastResort(part: string, build: (p: string) => string): string {
  const room = Math.max(1, SUBJECT_MAX - build('').length - 1);
  const out = build(part);
  return out.length <= SUBJECT_MAX ? out : build(`${part.slice(0, room)}…`);
}

/**
 * The digest subject: what happened and where, on the strongest card, with the count of the rest.
 *
 * Round 24 (review P1-3, P2-7): an exact address or a hundred-block reads "Permit at 5900 SPARROW WAY (+3 more)" and is never shortened
 * (cutting it would cut the address). A place that is not an address reads "Federal bid in Tulsa, OK", never "at". A card headed by its own
 * title ("311 request in San Francisco: Graffiti Private") is shortened at a word to SUBJECT_TARGET characters, with "…" and the
 * "(+N more)" count kept. Whatever the source wrote, the subject is never longer than SUBJECT_MAX and never cut mid-word.
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
    const n = Math.max(0, total - 1);
    const what = digestWhat(best, lang);
    const inPlace = (p: string) => (n > 0 ? t(lang, 'email.subject.card_in_more', { what, place: p, n }) : t(lang, 'email.subject.card_in', { what, place: p }));
    if (place.kind === 'title') {
      const build = (title: string) => (n > 0 ? t(lang, 'email.subject.plain_more', { title, n }) : t(lang, 'email.subject.plain', { title }));
      if (build(place.text).length <= SUBJECT_TARGET) return build(place.text);
      // Too long to read on a lock screen: "Storm report in Longview, TX (+3 more)" when the record has a real place (a town, never a bare
      // state code), else the title cut at a word.
      const town = best.place ? noDash(best.place) : '';
      if (town && looksLikePlace(town) && !isBareState(town) && inPlace(town).length <= SUBJECT_TARGET) return inPlace(town);
      const fit = fitWords(place.text, build, SUBJECT_TARGET) ?? fitWords(place.text, build, SUBJECT_MAX);
      return fit !== null ? build(fit) : lastResort(place.text, build);
    }
    const build =
      place.kind === 'place'
        ? inPlace
        : (p: string) => (n > 0 ? t(lang, 'email.subject.card_more', { what, place: p, n }) : t(lang, 'email.subject.card', { what, place: p }));
    // An address or a block is kept whole up to the hard cap: shortening it to 50 would cut the address.
    const fit = fitWords(place.text, build, SUBJECT_MAX);
    return fit !== null ? build(fit) : lastResort(place.text, build);
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
// One card is a few rows: the chip, the place (loudest), one meta line, one reason, what is uncertain, one action. "Source" is no longer
// a labelled row: the link is the words "public source" in the meta line. Round 24 (review P1-4): every card except a building permit
// keeps its own "what is uncertain" line, and the closing honesty line says one sentence for each kind of card in the email.

/** The families that are never, on their own, proof of damage: their action is the storm door hanger (digestAction). */
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

/** A bare two-letter state code ("CO", "CA"): a weather alert with a polygon is stored with a state and no city (lib/signals/adapters/nws.ts). */
function isBareState(s: string): boolean {
  return /^[A-Z]{2}$/.test(s.trim());
}

/**
 * A house number before a named street ("147 LEE AVENUE"). Only a building permit may print an exact street address (wording rules), so in
 * the title of any other record (an event permit names its street, review P3) the number is printed as its hundred-block. "34 AVENUE" and
 * "93 STREET" (a numbered street with no house number) and an existing "100 block of" are left alone.
 * Round 24 FIX2 (review D4): a number right before a street word ("EAST 147 STREET between ..."), a number after a hyphen (the end of a
 * range, "1801-2011 N. Clark St.", is read with its first number: the 1800 block), and a span through "km", "mi", "between", "and" or "of" ("19 km SW of Toms Place") are not a house.
 */
const HOUSE_ADDRESS_RE =
  /(?<![-\d])\b(\d{1,6})(?:-\d{1,6})?\s+(?!block\b)(?!(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|CT|COURT|LN|LANE|WAY|PL|PLACE)\b)((?:[NSEW]\.?\s+)?(?:(?!(?:km|mi|between|and|of)\b)[A-Za-z][A-Za-z'.-]*\s+){1,4}(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|CT|COURT|LN|LANE|WAY|PL|PLACE|PKWY|PARKWAY|HWY|HIGHWAY|CIR|CIRCLE|TER|TERRACE))\b/gi;
/** Round 24 FIX2 (review D4): families whose titles name a distance or a street span, never a house: their title is never rewritten. */
// Event permits are NOT skipped (the reviewer suggested it): their titles do name house addresses ("33-15 DITMARS BOULEVARD"), and the
// rewrite is what keeps those off a non-permit card. The three guards above fix the garbled event titles instead.
const NO_BLOCK_REWRITE: readonly BriefFamily[] = ['quake'];

/**
 * A title some feeds stored cut short ("...; Western Putnam; S…"): cut back to the last whole item or word, so a heading never ends
 * mid-word (review P3).
 */
function tidyCutTitle(s: string): string {
  const m = /(?:…|\.\.\.)$/.exec(s);
  if (!m) return s;
  const body = s.slice(0, m.index).trimEnd();
  const semi = body.lastIndexOf('; ');
  const at = semi > 10 ? semi : body.lastIndexOf(' ');
  return at > 10 ? `${body.slice(0, at).replace(/[\s,;:]+$/, '')}…` : s;
}

/**
 * A record's own title as the email prints it, in the member's language: no em dash, no bidi controls, no raw underscore codes
 * ("sewage_back-up_discharge", review P3), a stored cut at a whole word, and (anything but a building permit) no house number.
 */
function displayTitle(it: DigestItem, lang: Lang): string {
  let title = tidyCutTitle(noDash(localizeTitle(it.title, lang, it.source)).replace(/_+/g, ' ').replace(/ {2,}/g, ' '));
  const fam = familyOf(it);
  if (fam !== 'permit' && !NO_BLOCK_REWRITE.includes(fam)) {
    title = title.replace(HOUSE_ADDRESS_RE, (_m, num: string, street: string) => {
      const hundred = Math.floor(Number(num) / 100) * 100;
      return t(lang, 'sum.sale_block', { n: hundred > 0 ? String(hundred) : '0-99', street: street.trim() });
    });
  }
  return title;
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
  const title = displayTitle(it, lang);
  // Round 24 (review P1-3): a place that only repeats what the title already says is not a heading. A bare state code ("CO", from a
  // weather alert stored with a polygon) and a city the title names ("311 request in San Francisco: ...") fall through to the title.
  const place = it.place ? noDash(it.place) : '';
  if (place && looksLikePlace(place) && !isBareState(place) && !titleNamesTown(place, [title, noDash(it.title)])) return { text: place, exact: false, kind: 'place' };
  // A record with neither an address nor a place of its own: its own title is the loudest thing the card can say. A record with no title
  // at all (the route cannot send one, review P3 null-safety) says what kind of record it is, so the heading and subject are never empty.
  return { text: title.trim() ? title : digestWhat(it, lang), exact: false, kind: 'title' };
}

/** True when one of the titles already names the town of `place` ("San Francisco, CA" in "311 request in San Francisco: ..."). Any case. */
function titleNamesTown(place: string, titles: readonly string[]): boolean {
  const town = place.split(',')[0].trim().toLowerCase();
  return town.length > 2 && titles.some((x) => x.toLowerCase().includes(town));
}

/** The chip's words: "Act now" on its own, or "Act now . Deadline: Dec 5, 2026" when the record published one. No chip without a label. */
export function digestChip(it: Pick<DigestItem, 'label' | 'deadline'>, lang: Lang = 'en'): { text: string; strong: boolean } | null {
  if (!it.label || it.label === 'context') return null;
  const label = chipLabel(it.label, lang);
  if (it.label !== 'act_now') return { text: label, strong: false };
  const d = it.deadline ? deadlineLineLang(it.deadline, lang) : null;
  return { text: d ? `${label} · ${d}` : label, strong: true };
}

/**
 * Short words for the subject line: what kind of thing happened. One phrase per brief family. Round 24 (review P2-7): "New home permit"
 * only when the title says new home; "New construction permit" for new construction (which is often commercial or apartments); a federal
 * notice is "Federal bid" unless its label says it is open for offers (the act-open-bid rule: a response date, nothing awarded); a
 * commercial sale is "Property sale".
 */
export function digestWhat(it: DigestItem, lang: Lang = 'en'): string {
  const fam = familyOf(it);
  if (fam === 'federal-bid') return t(lang, it.label === 'act_now' ? 'email.what.bid' : 'email.what.federal_bid');
  if (it.subtype === 'bid') return t(lang, 'email.what.bid');
  if (fam === 'permit') {
    if (/\bnew home\b/i.test(it.title)) return t(lang, 'email.what.new_home');
    return /\bnew construction\b/i.test(it.title) ? t(lang, 'email.what.new_build') : t(lang, 'email.what.permit');
  }
  if (fam === 'sale' && isCommercialSaleTitle(it.title)) return t(lang, 'email.what.property_sale');
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
 * The one action of a card (round 24, review P1-1). First rule that fits wins:
 *
 *  1. a resident request                                    reply to it in the feed (the only place a member can answer one)
 *  2. a storm report: print the storm door hanger. A weather alert, a disaster declaration or an earthquake: open its own card
 *     (round 24 FIX2, review D5: none of them is a storm report)
 *  3. a building permit whose address could not be read,   print that trade's address list (that list really is permits:
 *     when the trade has a neighborhood list (lib/lists)      lib/lists/load.ts loadAreaList)
 *  4. a block-level card (violation, 311, sale)             print a door hanger: a block is something to walk
 *  5. anything else                                         open its own card in the feed (a permit with an address, a bid, a new
 *                                                            business, a public post, an award, a 311 row with no block)
 *
 * No card links to something unrelated to it: before round 24 a violation, a 311 row, a sale or even a weather alert sent the member to
 * the trade's PERMIT list. Every href is a route that exists today (app/app, app/app/lists/*) plus a query or anchor it already reads.
 */
export function digestAction(it: DigestItem, appUrl: string, lang: Lang = 'en'): DigestAction {
  const base = appUrl.replace(/\/$/, '');
  const card = typeof it.matchId === 'number' && Number.isSafeInteger(it.matchId) && it.matchId > 0 ? `${base}#card-${it.matchId}` : base;
  const fam = familyOf(it);
  if (fam === 'resident-request') return { href: card, label: t(lang, 'email.act.reply') };
  // Round 24 FIX2 (review D5): only a storm report is a public storm report. The hanger it opens says so ("There was a public storm report
  // in this area. Damage not confirmed."). A weather alert is a forecast, a FEMA declaration and an earthquake are not storm reports: their
  // card opens, and nothing they lead to says a storm report exists.
  if (fam === 'storm-report') return { href: `${base}/lists/door-hanger?storm=1`, label: t(lang, 'email.act.storm_hanger') };
  if (DAMAGE_FAMILIES.includes(fam)) return { href: card, label: t(lang, 'email.act.open_card') };
  const place = digestPlace(it, lang);
  if (fam === 'permit' && !place.exact) {
    // Round 24: a trade is resolved through the sign-up form's composite "Pressure washing" chip first (lib/plan/composite-trades.ts),
    // so the link always names a real trade the area-list page accepts: never the chip's own id, which no profile ever saves.
    const trade = it.trade ? (areaListTrades(expandTradeIds([it.trade]))[0] ?? null) : null;
    if (trade) {
      return { href: `${base}/lists/area?trade=${encodeURIComponent(trade)}`, label: t(lang, 'email.act.area_list', { trade: lowerFirst(tradeLabel(trade, lang)) }) };
    }
  }
  if (place.kind === 'block') return { href: `${base}/lists/door-hanger`, label: t(lang, 'email.act.hanger') };
  return { href: card, label: t(lang, 'email.act.open_card') };
}

/**
 * The reason a card gives: one line, or two on the few permits whose stage moved (the stage line is the news, and the line under it
 * says why that matters to this trade). The AI note (lib/ai, English only) is preferred over the brief's generic "why", because it is
 * written for this record and this trade; both are checked for wording before they get here.
 */
function digestReasons(it: DigestItem, br: CardBrief, lang: Lang): string[] {
  const stage = isUpdateItem(it) ? stageUpdateLine(it.permitStage, it.permitStageAt, lang) : br.stageLine;
  const why = it.note && lang === 'en' ? noDash(it.note) : quotedOrderLang(noDash(br.why), lang);
  return stage ? [noDash(stage), why] : [why];
}

/**
 * Review P2-10: a violation's reason quotes the order the record names ("Se registró una infracción de código cerca: trash or debris and
 * overgrown yard."). When that order is Holler's own words (lib/signals/title-i18n.ts fixedTextLang knows them) it is said in the member's
 * language, as the card's title already is. A city's own text ("CUT OR REMOVE HIGH WEEDS") stays as the city wrote it.
 */
function quotedOrderLang(why: string, lang: Lang): string {
  if (lang === 'en') return why;
  const [pre, post] = t(lang, 'brief.why.violation.act_now_quoted', { order: '\u0000' }).split('\u0000');
  if (post === undefined || !why.startsWith(pre) || !why.endsWith(post) || why.length <= pre.length + post.length) return why;
  const order = why.slice(pre.length, why.length - post.length);
  const said = fixedTextLang(order, lang);
  return said === order ? why : `${pre}${said}${post}`;
}

/**
 * The closing honesty line (round 24, review P1-4): one short sentence for each kind of card in this email, so every kind's caveat is
 * said whenever a card of that kind is present. A permit's caveat is said only here; every other card also keeps its own "what is
 * uncertain" line. When a resident request or a public post is in the email the opening sentence does not claim that every card is a
 * public record with a public source link (a request is a Holler form, a post is somebody's own words).
 */
const HONESTY_KINDS: readonly { key: DictKey; families: readonly BriefFamily[] }[] = [
  { key: 'email.honesty.permit', families: ['permit'] },
  { key: 'email.honesty.violation', families: ['violation', 'inspection'] },
  { key: 'email.honesty.311', families: ['311'] },
  { key: 'email.honesty.bid', families: ['federal-bid', 'city-bid', 'federal-award'] },
  { key: 'email.honesty.business', families: ['business', 'sale'] },
  { key: 'email.honesty.request', families: ['resident-request', 'public-post'] },
  { key: 'email.honesty.weather', families: ['weather-alert', 'storm-report', 'disaster', 'quake'] },
];

export function digestHonesty(items: readonly DigestItem[], lang: Lang = 'en'): string {
  const present = new Set(items.map(familyOf));
  const lead = present.has('resident-request') || present.has('public-post') ? 'email.honesty.opening_mixed' : 'email.honesty.opening';
  const anyListing = items.some((it) => it.contact?.listing && (it.contact.listing.phone || httpsSite(it.contact.listing)));
  return [
    t(lang, lead),
    ...HONESTY_KINDS.filter((k) => k.families.some((f) => present.has(f))).map((k) => t(lang, k.key)),
    anyListing ? t(lang, 'email.honesty.listing') : null,
  ]
    .filter(Boolean)
    .join(' ');
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

/** A trade's name inside a sentence: "lawn care", "cuidado del césped"; an acronym stays as it is ("HVAC", never "hVAC"). */
function tradeWords(id: string, lang: Lang): string {
  const label = tradeLabel(id, lang);
  return /^\p{Lu}{2}/u.test(label) ? label : lowerFirst(label);
}

/** "lawn care", "lawn care and fencing", "lawn care, fencing and painting", in the member's language. */
function tradeList(ids: readonly string[], lang: Lang): string {
  const names = ids.map((id) => tradeWords(id, lang));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t(lang, 'life.and')} ${names[names.length - 1]}` : (names[0] ?? '');
}

/**
 * The quiet-week email's one honest line (round 24). A member whose trade and city the site calls 'limited' is told what the /check page
 * tells a visitor ("few records for this trade here yet"); a member in a 'waitlist' cell is told what the waitlist card says ("lately
 * none of them has been work for this trade"). Only a 'live' cell, or a member the gate has never measured, reads "quiet weeks happen".
 */
function emptyBody(coverage: DigestCoverage | null, matchedLastWeek: number | null, lang: Lang): string {
  // Round 24 (review P1-5): "no public record matched in the last week" (and the limited and waitlist lines, which say the same in the
  // site's terms) is said only when the sender counted this member's matches of the last 7 days and found none. Records that matched but
  // were not alerts (feed only) get their own line; an unknown count gets a line that claims nothing about the week.
  if (matchedLastWeek === null) return t(lang, 'email.empty.unchecked');
  if (matchedLastWeek > 0) return t(lang, 'email.empty.feed_only');
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
  /**
   * Round 24, the quiet-week email only: how many matches this member got in the last 7 days, as counted by the sender
   * (lib/email/quiet-week.ts). 0 lets the email say no public record matched; more than 0 says they are feed only; absent or null (not
   * counted) says only that no new alert came.
   */
  matchedLastWeek?: number | null;
}): Rendered {
  const lang: Lang = opts.lang ?? 'en';
  const now = opts.now ?? new Date();
  const total = opts.totalCount ?? opts.items.length;
  const more = Math.max(0, total - opts.items.length);
  const matchedLastWeek = typeof opts.matchedLastWeek === 'number' && opts.matchedLastWeek >= 0 ? opts.matchedLastWeek : null;
  // A quiet week whose matches were not counted, or were feed only, is not "Nothing near you".
  const quietNotEmpty = opts.items.length === 0 && matchedLastWeek !== 0;
  const subject = quietNotEmpty ? t(lang, 'email.subject.quiet') : noDash(digestSubject(opts.items, total, lang));
  const open = wrapOpen(560, lang, true);
  // Review P2-6: the eyebrow is classed so dark mode lifts it off the dark card (it was brand green on the dark card, 2.09:1).
  const eyebrow = `<p class="h-link" style="margin:0 0 6px 0;${S.eyebrow}">${escapeHtml(t(lang, 'email.eyebrow', { name: noDash(opts.businessName) }))}</p>`;
  const h1 = (text: string) => `<h1 class="h-h1" style="${S.h1};font-size:24px;margin:0 0 16px 0">${escapeHtml(text)}</h1>`;
  const legal =
    `<p class="h-small" style="${S.small};margin:28px 0 0 0">${t(lang, 'email.footer.why')} <a class="h-link" href="${escapeHtml(opts.unsubscribeUrl)}" style="${S.mutedLink}">${t(lang, 'email.footer.off')}</a>.${contactHtml(lang, true)}</p>`;
  // CAN-SPAM (round 24, FIXLIST row 17): the plain-text part carries the same three things as the HTML: why you got this, the opt-out
  // link and the postal address. Before round 24 the text part had no reason line.
  const legalText = `${t(lang, 'email.footer.why')}\n${t(lang, 'email.footer.off')}: ${opts.unsubscribeUrl}\n${contactText(lang)}\n${postalFooterText(lang)}\n`;

  // A quiet week is not an empty email (item 7): one honest line about why, and the two things that are still worth doing.
  if (opts.items.length === 0) {
    const base = opts.appUrl.replace(/\/$/, '');
    const quietBody = emptyBody(opts.coverage ?? null, matchedLastWeek, lang);
    const quietHeading = t(lang, matchedLastWeek === 0 ? 'email.empty.h' : 'email.empty.h_quiet');
    const html =
      digestDarkModeCss() +
      open +
      eyebrow +
      h1(quietHeading) +
      `<p class="h-why" style="font-size:15px;margin:0 0 10px 0;color:${EMAIL_COLORS.ink}">${escapeHtml(quietBody)}</p>` +
      `<p class="h-meta" style="${S.muted};margin:0">${escapeHtml(t(lang, 'email.empty.next'))}</p>` +
      cardButtonHtml(escapeHtml(`${base}/lists/door-hanger`), escapeHtml(t(lang, 'email.act.hanger'))) +
      `<p style="margin:14px 0 0 0"><a class="h-link" href="${escapeHtml(`${base}/lists`)}" style="${S.link};font-size:15px">${escapeHtml(t(lang, 'email.act.lists'))}</a></p>` +
      legal +
      cardClose() +
      postalFooterHtml(lang) +
      WRAP_CLOSE;
    const text =
      `${t(lang, 'email.eyebrow', { name: noDash(opts.businessName) })}\n\n${quietHeading}\n\n` +
      `${quietBody}\n\n${t(lang, 'email.empty.next')}\n\n` +
      `${t(lang, 'email.act.hanger')}: ${base}/lists/door-hanger\n${t(lang, 'email.act.lists')}: ${base}/lists\n\n${legalText}`;
    return { subject, html, text };
  }

  const items = digestOrder(opts.items);
  const honesty = digestHonesty(items, lang);

  /** Everything one card shows, built once and rendered twice (html and plain text). */
  const cards = items.map((it) => {
    const br = digestBrief(it, siteUrl, lang);
    const place = digestPlace(it, lang);
    const title = displayTitle(it, lang);
    // The meta line: the record's own title, then only what helps a decision. "City data" and the dataset's name are gone.
    // The place is dropped when the headline is already that place, or when the record's own title names the town ("... in Chicago").
    // Round 24 (review P2-8): a place that is a sentence (an approximate-location note: the email shows no distance to explain) or a
    // bare state code is never put on the meta line either.
    const rawPlace = it.place ? noDash(it.place) : '';
    const showPlace = !!rawPlace && looksLikePlace(rawPlace) && !isBareState(rawPlace) && rawPlace !== place.text && !titleNamesTown(rawPlace, [title, noDash(it.title)]);
    // One time segment: how long ago, with the date the record itself carries in brackets. A stage update's meta already names its
    // date, so it is not repeated. The record date stays on the card (a permit read in March wants the day, not "4 months ago").
    const ago = metaTime(it, now, lang);
    const date = br.source.dateText;
    const when = date && !isUpdateItem(it) ? `${ago} (${date})` : ago;
    const bidLabel = it.subtype === 'bid' && !title.includes(t(lang, 'bid.label')) ? t(lang, 'bid.label') : null;
    const meta = [
      bidLabel,
      place.kind === 'title' ? null : title,
      showPlace ? rawPlace : null,
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
      // Round 24 (review P1-4): every card but a permit keeps its own "what is uncertain" line. A permit's ("does not mean the owner is
      // choosing a vendor") is said once, in the closing line, whenever a permit card is in the email.
      uncertain: familyOf(it) === 'permit' ? null : noDash(br.uncertain),
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
      // Review P2-9: Outlook on Windows (Word) keeps list indentation and is unreliable with a table inside a list item, so the cards are
      // no longer a <ul>. A role="list" wrapper keeps them a list of N items for a screen reader.
      return `<div role="listitem" style="margin:0 0 14px 0;padding:0">${cardTableHtml(inner)}</div>`;
    })
    .join('');

  const html =
    digestDarkModeCss() +
    open +
    eyebrow +
    h1(subject) +
    `<div role="list" style="margin:0;padding:0">${htmlItems}</div>` +
    (more > 0 ? `<p class="h-meta" style="${S.muted};margin:0 0 4px 0">${escapeHtml(t(lang, 'email.plus_more', { n: more }))}</p>` : '') +
    buttonHtml(escapeHtml(opts.appUrl), escapeHtml(t(lang, 'email.open_feed')), true) +
    `<p class="h-small" style="${S.small};line-height:1.5;margin:0">${escapeHtml(honesty)}</p>` +
    legal +
    cardClose() +
    postalFooterHtml(lang) +
    WRAP_CLOSE;

  const textItems = cards
    .map((c, i) => {
      const lines = [
        `${i + 1}. ${c.place.text}${c.chip ? ` [${c.chip.text}]` : ''}`,
        // Review P2-8: a segment that already ends in a full stop does not get a second one ("shown.. 5 days ago").
        `   ${c.meta.map((m) => m.replace(/\.$/, '')).join('. ')}`,
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
    `<p>Holler reads public records near you and emails you the ones that match your trade: permits, storm reports, 311 complaints and requests people post on Holler. Your address lists and door hanger are under Lists. ${CADENCE_SHORT}</p>` +
    `<p>Your ${days}-day free trial has started. No card needed. Holler never posts anything for you.</p>` +
    button(opts.appUrl, 'See all your matches') +
    (contactAddress() ? `<p style="${S.muted}">${contactHtml().trim()}</p>` : '') +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text = `Welcome, ${noDash(opts.businessName)}\n\nHoller reads public records near you and emails you the ones that match your trade: permits, storm reports, 311 complaints and requests people post on Holler. Your address lists and door hanger are under Lists. ${CADENCE_SHORT}\n\nYour ${days}-day free trial has started. No card needed. Holler never posts anything for you.\n\nSee all your matches: ${opts.appUrl}\n${contactText()}\n${postalFooterText()}\n`;
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
 *
 * Round 24: `trade` is set when the sign-up was for one trade in a place Holler already reads (lib/waitlist/service.ts: the /check cell
 * for that ZIP and trade is 'waitlist' while the ZIP is served). Then the email says the trade ("tell me when Holler has lawn care work
 * near Dallas, TX"), because "when Holler reaches Dallas" would be untrue: Holler is already there. Without it, the round 19 text.
 */
export function renderWaitlistConfirm(opts: { confirmUrl: string; place: string; lang?: Lang; trade?: string | null }): Rendered {
  // Round 19 integration: words from lib/i18n (wl.email.*); English is the round 19 text unchanged, Spanish only when asked for.
  const lang = opts.lang ?? 'en';
  const place = noDash(opts.place);
  const trade = opts.trade ? tradeWords(opts.trade, lang) : null;
  const subject = trade ? t(lang, 'wl.email.subject_trade', { trade, place }) : t(lang, 'wl.email.subject', { place });
  const h = t(lang, 'wl.email.h');
  // A trade sign-up does not take yet ("coming soon", lib/check/cells.ts tradeSignupClosed) is on the list because it is closed, not
  // because the records near this place had none of it: its email says that instead of "lately none of them has been {trade} work".
  const body = trade
    ? t(lang, opts.trade && tradeSignupClosed(opts.trade) ? 'wl.email.body_closed' : 'wl.email.body_trade', { trade, place })
    : t(lang, 'wl.email.body', { place });
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
