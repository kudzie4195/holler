import { sourceLabelLang } from './source-label-i18n';
import { permitLabelLang, tradeIdFromEnglishLabel } from './title-i18n';
import { hasKey, t, localizeDate, type Lang, type DictKey } from '@/lib/i18n';
import {
  BRIEF_FAMILIES,
  briefFamilyOf,
  briefFor,
  briefSource,
  awardWorkOf,
  cardBrief,
  damagePhraseOf,
  permitTypeOf,
  violationOrderOf,
  MAX_WHY,
  TRADE_WORK,
  type Brief,
  type BriefFamily,
  type BriefInput,
  type BriefLabel,
  type BriefSource,
  type CardBrief,
  type CardBriefInput,
} from './brief';
import { BID_LIST_LINK_LABEL, BID_PORTAL_LINK_LABEL, bidSourceLinkLabel } from './bid-card';
import { isResidentialHeatTitle, companyNameOf } from './managed-by';
import { formatMoney, jobValueOf } from './permit-value';
import { routeParts } from './permit-routing';
import { formatRecordDate } from './lead-rules';

/**
 * The brief card (PLAN-2.0 item 0.4) in a language other than English, built from the SAME facts as lib/signals/brief.ts: the family, the
 * label, the trade, the permit type, the damage words. Only the words come from the dictionary (lib/i18n). No model, no translation call.
 * briefFromDict(input, 'en') gives exactly what briefFor gives (tests/i18n/brief.test.ts checks every family, label, trade and variant),
 * so the template logic here cannot drift from the English one. Data fields from a source (a permit type, a violation order, a contract's
 * work, a source name) are printed as the source wrote them.
 */

/** Spanish sentences run longer than English ones; the English limit is MAX_WHY (80). Checked for every (family, label, trade) in tests. */
export const MAX_WHY_BY_LANG: Record<Lang, number> = { en: MAX_WHY, es: 112 };

const INSPECTION_REPAIR_TRADES: ReadonlySet<string> = new Set(['plumbing', 'hvac', 'electrical', 'general-contractor', 'handyman', 'painting', 'flooring', 'windows-doors']);

const DAMAGE_KEY: Record<string, DictKey> = {
  'trees down': 'brief.damage.trees',
  'power lines down': 'brief.damage.lines',
  'power poles down': 'brief.damage.poles',
  'roof damage': 'brief.damage.roof',
  damage: 'brief.damage.damage',
  destruction: 'brief.damage.destruction',
  flooding: 'brief.damage.flood',
  injuries: 'brief.damage.injuries',
  debris: 'brief.damage.debris',
};

const NOUN_KEY: Record<string, DictKey> = {
  'A roof permit': 'brief.noun.roof',
  'A new-home permit': 'brief.noun.new_home',
  'A new-construction permit': 'brief.noun.new_construction',
  'A remodel permit': 'brief.noun.remodel',
  'An addition permit': 'brief.noun.addition',
  'A solar permit': 'brief.noun.solar',
  'A demolition permit': 'brief.noun.demolition',
  'A tenant fit-out permit': 'brief.noun.fit_out',
  'A commercial permit': 'brief.noun.commercial',
  'An apartment permit': 'brief.noun.apartment',
};

function key(k: string): DictKey {
  return k as DictKey;
}

/** What a trade does, in the language ("work you do" for no trade or a trade this table does not know). */
export function workForLang(trade: string | null | undefined, lang: Lang): string {
  const k = trade ? `brief.work.${trade}` : '';
  return t(lang, k && hasKey(k) ? key(k) : 'brief.work.generic');
}

const hasDictKey = hasKey;

interface Ctx {
  trade: string | null;
  permitType: string | null | undefined;
  awardWork: string | null | undefined;
  violation: string | null;
}

/**
 * The permit type a title names ("Roof", "HVAC and plumbing"), in the language. The type is Holler's own English label (permit-privacy.ts), so
 * Spanish says it with the dictionary. A type a city printed itself ("Residential Alteration") has no Spanish form here: it gives undefined,
 * which is the generic sentence with no claim about the type. null and undefined keep their meaning (the title names no type / no title).
 */
function permitTypeInLang(type: string | null | undefined, lang: Lang): string | null | undefined {
  if (typeof type !== 'string' || lang === 'en') return type;
  return permitLabelLang(type, lang) ?? undefined;
}

/**
 * The work a federal contract title names, in the language: Holler's English trade label ("Plumbing") becomes the same words the brief uses for
 * that trade ("trabajo de plomería"). A label that is not one of Holler's trades ("federal award") gives null, the sentence with no work named.
 */
function awardWorkInLang(work: string | null | undefined, lang: Lang): string | null | undefined {
  if (typeof work !== 'string' || lang === 'en') return work;
  const id = tradeIdFromEnglishLabel(work);
  return id ? workForLang(id, lang) : null;
}

/** The "why it matters" sentence: the same choice tree as briefFor, with the dictionary's words. */
function whyFromDict(input: BriefInput & { label: BriefLabel; trade?: string | null }, family: BriefFamily, ctx: Ctx, lang: Lang): string {
  const label = input.label;
  const trade = ctx.trade;
  const work = workForLang(trade, lang);
  const max = MAX_WHY_BY_LANG[lang];
  const routedParts = family === 'permit' && label === 'coming_soon' ? routeParts(input.title, trade, { summary: input.summary, source: input.source }) : null;
  if (routedParts) {
    const noun = t(lang, NOUN_KEY[routedParts.noun]);
    const homes = routedParts.kind === 'new-build' && trade === 'cleaning' && routedParts.noun === 'A new-home permit';
    return t(lang, key(`brief.route.${routedParts.kind}|${trade}${homes ? '.homes' : ''}`), { permit: noun });
  }
  const override = `brief.override.${label}|${family}|${trade}`;
  if (trade && hasDictKey(override)) return t(lang, key(override));

  const v = { work };
  switch (family) {
    case 'permit':
      if (label === 'coming_soon') {
        const typed = ctx.permitType ? t(lang, 'brief.why.permit.coming_soon_typed', { type: ctx.permitType, work }) : null;
        return typed && typed.length <= max ? typed : t(lang, 'brief.why.permit.coming_soon', v);
      }
      if (label === 'market_insight') {
        if (ctx.permitType === null) return t(lang, 'brief.why.permit.market_insight_untyped');
        const typed = ctx.permitType ? t(lang, 'brief.why.permit.market_insight_typed', { type: ctx.permitType }) : null;
        return typed && typed.length <= max ? typed : t(lang, 'brief.why.permit.market_insight');
      }
      break;
    case 'violation':
      if (label === 'act_now') return ctx.violation ? t(lang, 'brief.why.violation.act_now_quoted', { order: ctx.violation }) : t(lang, 'brief.why.violation.act_now', v);
      break;
    case 'inspection': {
      const repairs = !!trade && INSPECTION_REPAIR_TRADES.has(trade);
      if (label === 'act_now') return repairs ? t(lang, 'brief.why.inspection.act_now_repair', v) : t(lang, 'brief.why.inspection.neutral');
      if (label === 'coming_soon') return repairs ? t(lang, 'brief.why.inspection.coming_soon_repair', v) : t(lang, 'brief.why.inspection.neutral');
      break;
    }
    case 'federal-award':
      if (label === 'market_insight') {
        if (ctx.awardWork === null) return t(lang, 'brief.why.federal-award.market_insight_unnamed');
        const named = ctx.awardWork ? t(lang, 'brief.why.federal-award.market_insight_named', { work: ctx.awardWork }) : null;
        return named && named.length <= max ? named : t(lang, 'brief.why.federal-award.market_insight');
      }
      break;
    default:
      break;
  }
  const plain = `brief.why.${family}.${label}`;
  if (hasDictKey(plain)) return t(lang, key(plain), v);
  return t(lang, key(`brief.why.fallback.${label}`), v);
}

/** The brief for one record, one label and one trade, in `lang`. For 'en' this is briefFor. Pure, total: any input gives a complete brief. */
export function briefForLang(input: BriefInput & { label: BriefLabel; trade?: string | null }, lang: Lang): Brief {
  return lang === 'en' ? briefFor(input) : briefFromDict(input, lang);
}

/** The dictionary-built brief, for any language including 'en' (the tests compare 'en' with briefFor). */
export function briefFromDict(input: BriefInput & { label: BriefLabel; trade?: string | null }, lang: Lang): Brief {
  // The English brief supplies what does not depend on words: the family, the confidence, whether a title is typed.
  const base = briefFor(input);
  const family = briefFamilyOf(input);
  const ctx: Ctx = {
    trade: input.trade ?? null,
    permitType: family === 'permit' ? permitTypeInLang(permitTypeOf(input.title), lang) : undefined,
    awardWork: family === 'federal-award' ? awardWorkInLang(awardWorkOf(input.title), lang) : undefined,
    violation: family === 'violation' ? violationOrderOf(input.title) : null,
  };
  const label = input.label;
  const knownKey = `brief.known.${family}.${label}`;
  const unknownKey = `brief.unknown.${family}.${label}`;
  const known = t(lang, hasDictKey(knownKey) ? key(knownKey) : key(`brief.known.${family}`));
  let unknown = t(lang, hasDictKey(unknownKey) ? key(unknownKey) : key(`brief.unknown.${family}`));
  // Damage: a storm report or quake whose own text reports damage says what it mentions, as unconfirmed (same rule as briefFor).
  if (family === 'storm-report' || family === 'quake') {
    const text = [input.title, input.summary].filter((x): x is string => typeof x === 'string' && !!x.trim()).join('. ');
    const phrase = text ? damagePhraseOf(text) : null;
    if (phrase && DAMAGE_KEY[phrase]) unknown = t(lang, 'brief.uncertain.mention', { phrase: t(lang, DAMAGE_KEY[phrase]) });
  }
  if (family === 'permit' && ctx.permitType === null) unknown = t(lang, 'brief.uncertain.no_work');
  return {
    ...base,
    why: whyFromDict(input, family, ctx, lang),
    next: t(lang, key(`brief.next.${family}`)),
    uncertain: t(lang, 'brief.uncertain.format', { confidence: t(lang, key(`brief.confidence.${base.confidence}`)), known, unknown }),
  };
}

/** Text of the link under a brief: "Open the request form", the bid portal or list wording, or "Open the source". */
export function bidSourceLinkLabelLang(source: string | null | undefined, lang: Lang): string {
  const en = bidSourceLinkLabel(source);
  if (en === BID_PORTAL_LINK_LABEL) return t(lang, 'brief.link.portal');
  if (en === BID_LIST_LINK_LABEL) return t(lang, 'brief.link.list');
  return t(lang, 'brief.link.source');
}

function httpOrRelative(u: string | null | undefined, base: string | null): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  const v = u.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return base ? `${base.replace(/\/$/, '')}${v}` : v;
  return null;
}

/** Part 4 in a language. Holler's name for the source ("Chicago open data: food inspections"), the link wording, the request label and the date are in `lang`. */
export function briefSourceLang(input: { source: string; url?: string | null; occurredAt?: string | null; base?: string | null }, lang: Lang): BriefSource {
  const en = briefSource(input);
  if (lang === 'en') return en;
  const request = typeof input.source === 'string' && input.source.trim().toLowerCase() === 'holler-request';
  const own = httpOrRelative(input.url, input.base ?? null);
  return {
    ...en,
    label: request ? t(lang, 'brief.request_label') : (sourceLabelLang(input.source, lang) ?? en.label),
    linkText: request ? t(lang, 'brief.link.request') : own ? bidSourceLinkLabelLang(input.source, lang) : t(lang, 'brief.link.home'),
    dateText: localizeDate(formatRecordDate(input.occurredAt ?? null, input.source), lang),
  };
}

/** The one line for part 4 in plain text: "Fuente: Chicago open data: food inspections. Fecha del registro: 20 nov 2026." */
export function sourceLineLang(s: Pick<BriefSource, 'label' | 'dateText'>, lang: Lang): string {
  const date = s.dateText ? t(lang, 'brief.record_date', { date: s.dateText }) : t(lang, 'brief.record_date_none');
  return t(lang, 'brief.source_line', { label: s.label, date });
}

/** "Valor del trabajo en el permiso: $12,500". Null when the record has no value. */
export function jobValueLineLang(src: Parameters<typeof jobValueOf>[0], lang: Lang): string | null {
  const v = jobValueOf(src);
  return v === null ? null : t(lang, 'brief.job_value', { amount: formatMoney(v) });
}

/** "Administrado por: Acme LLC (según el registro de edificios de la ciudad)". Null when the stored name is not a company. */
export function managedByLineFromLang(name: unknown, role: unknown, lang: Lang): string | null {
  const n = companyNameOf(name);
  if (!n) return null;
  return t(lang, 'brief.managed.line', { role: t(lang, role === 'owner' ? 'brief.managed.owner' : 'brief.managed.agent'), name: n });
}

/** The whole card brief in a language. For 'en' it is cardBrief, byte for byte. */
export function cardBriefLang(input: CardBriefInput, lang: Lang): CardBrief {
  if (lang === 'en') return cardBrief(input);
  const label = input.label ?? 'coming_soon';
  const family = briefFamilyOf(input);
  return {
    ...briefForLang({ ...input, label }, lang),
    source: briefSourceLang(input, lang),
    managedBy: family === '311' && isResidentialHeatTitle(input.title) ? managedByLineFromLang(input.managerName, input.managerRole, lang) : null,
    valueLine: family === 'permit' ? jobValueLineLang({ jobValue: input.jobValue, summary: input.summary }, lang) : null,
  };
}

/**
 * Every brief input the wording tests probe: each family with each label and trade (a generic record), plus the record-aware variants the
 * title and summary can trigger (permit types, violation orders, contract work, damage words).
 */
export function briefProbeInputs(): Array<BriefInput & { label: BriefLabel; trade: string | null }> {
  const out: Array<BriefInput & { label: BriefLabel; trade: string | null }> = [];
  const labels: BriefLabel[] = ['act_now', 'coming_soon', 'market_insight', 'context'];
  const trades: (string | null)[] = [null, ...Object.keys(TRADE_WORK)];
  for (const label of labels) {
    for (const trade of trades) {
      for (const family of BRIEF_FAMILIES) out.push({ source: FAMILY_SOURCE[family] ?? 'unknown-source', label, trade });
      for (const title of ['Permit in X', 'Roof permit in X', 'HVAC permit in X', 'Window and door permit in X', 'New home permit in X', 'Solar permit in X', 'Demolition permit in X', 'Remodel permit in X', 'Tenant fit-out permit in X', 'New construction permit in X', 'Addition permit in X']) {
        out.push({ source: 'socrata-chicago-permits', label, trade, title });
      }
      for (const title of ['Code violation in X: REPAIR GUTTER & DOWNSPOUT', 'Code violation in X: Overgrown weeds', 'Code violation in X: property violation']) {
        out.push({ source: 'socrata-chicago-violations', label, trade, title });
      }
      for (const title of ['Federal contract ($1K) in X: NAICS 562991', 'Federal contract ($1K) in X: Plumbing (NAICS 238220)']) {
        out.push({ source: 'usaspending', label, trade, title });
      }
      for (const src of ['nws', 'spc', 'usgs']) {
        for (const summary of [undefined, 'Nothing else.', 'Trees down on homes.', 'Power lines down.', 'Power poles down.', 'Roof damage.', 'Some damage.', 'Destroyed.', 'Flooding.', 'Injuries.', 'Debris.']) {
          out.push({ source: src, label, trade, title: 'T', summary });
        }
      }
    }
  }
  return out;
}

/** Every string a localized brief can show, for the wording tests. */
export function allBriefStringsLang(lang: Lang): string[] {
  const out: string[] = BRIEF_FAMILIES.map((f) => t(lang, key(`brief.next.${f}`)));
  for (const input of briefProbeInputs()) {
    const b = briefForLang(input, lang);
    out.push(b.why, b.uncertain);
  }
  return out;
}

const FAMILY_SOURCE: Partial<Record<BriefFamily, string>> = {
  'weather-alert': 'nws',
  'storm-report': 'spc',
  disaster: 'fema',
  quake: 'usgs',
  airport: 'faa',
  permit: 'socrata-chicago-permits',
  '311': 'socrata-chicago-311',
  violation: 'socrata-chicago-violations',
  inspection: 'socrata-chicago-inspections',
  business: 'socrata-chicago-business',
  'event-permit': 'socrata-chicago-events',
  'big-event': 'ticketmaster',
  'federal-bid': 'sam-gov',
  'federal-award': 'usaspending',
  'city-bid': 'bids-sf',
  'public-post': 'bluesky',
  'resident-request': 'holler-request',
};
