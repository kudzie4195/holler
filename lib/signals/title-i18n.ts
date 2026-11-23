import { t, hasKey, type DictKey, type Lang } from '@/lib/i18n';
import { CATEGORIES } from '@/lib/signals/categories';

/**
 * Record titles in the member's language (round 17, unit ES, redo 1).
 *
 * Most titles are not source text: Holler's adapters compose them from fixed English templates ("Roof permit in Chicago", "1.75 inch hail
 * reported near X", "Federal bid in Fort Worth, TX: <text>"). The record keeps that English title (it is stored, matched and parsed by the brief
 * code), so a Spanish member's card and email rebuild it at display time: the template is recognised, its data fields (place, number, buyer
 * text) are carried over untouched, and the words around them come from the dictionary (title.*, plabel.*, tfix.*, civic.*, nws.*).
 *
 * Rules:
 *  - English ('en') and anything this module does not recognise come back as the same string. A title copied from a source (a Bluesky post, a
 *    city bid name, a business name) is never rewritten.
 *  - Weather never claims damage. SPC's "Wind damage reported near X" becomes "Viento fuerte reportado cerca de X (daño no confirmado)".
 *  - Pure and total: no I/O, never throws.
 */

type Fields = Record<string, string>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Lower-cased English permit label ("roof", "hvac", "window") to its dictionary key. Labels come from lib/signals/mapping/permit.ts and permit-privacy.ts. */
const PERMIT_LABEL_KEY: Record<string, DictKey> = Object.fromEntries(
  [
    'roof', 'hvac', 'plumbing', 'electrical', 'solar', 'pool', 'water heater', 'new home', 'new construction', 'demolition', 'tree removal', 'fence',
    'retaining wall', 'landscaping', 'concrete', 'window', 'door', 'siding', 'gutter', 'flooring', 'sign', 'painting', 'damage repair', 'deck', 'porch',
    'accessory building', 'addition', 'tenant fit-out', 'masonry', 'dumpster', 'remodel', 'repair', 'structural', 'site work', 'building',
  ].map((l) => [l, `plabel.${l === 'tenant fit-out' ? 'fit-out' : slug(l)}` as DictKey]),
);

/** The English permit labels this module can say in Spanish (a test checks every label the adapters can print is here). */
export function knownPermitLabels(): string[] {
  return Object.keys(PERMIT_LABEL_KEY);
}

/**
 * "Roof, HVAC and plumbing" gives "techo, HVAC y plomería". Null when any part is not one of Holler's own labels (a permit type a city
 * printed itself, such as "Residential Alteration", is that city's text: the caller keeps it as it is).
 */
export function permitLabelLang(label: string, lang: Lang): string | null {
  const parts = label.split(/,\s*|\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const words: string[] = [];
  for (const p of parts) {
    const k = PERMIT_LABEL_KEY[p.toLowerCase()];
    if (!k) return null;
    words.push(t(lang, k));
  }
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')}${lang === 'es' ? ' y ' : ' and '}${words[words.length - 1]}`;
}

/** English trade label ("Plumbing", "Heating and air (HVAC)") to the trade id, or null. */
const TRADE_BY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.label, c.id]));

/** Holler's English trade label in the language, or null when the text is not one of the trade labels. */
export function tradeLabelFromEnglish(label: string, lang: Lang): string | null {
  const id = TRADE_BY_LABEL[label];
  if (!id) return null;
  const k = `trade.${id}`;
  return hasKey(k) ? t(lang, k) : null;
}

/** The trade id behind an English trade label ("Plumbing" gives "plumbing"), or null. Used by the brief for the work a contract names. */
export function tradeIdFromEnglishLabel(label: string): string | null {
  return TRADE_BY_LABEL[label.trim()] ?? null;
}

const FIXED_KEYS: Record<string, DictKey> = {
  'service request': 'tfix.service_request',
  'property violation': 'tfix.property_violation',
  'special event': 'tfix.special_event',
  business: 'tfix.business',
  'federal award': 'tfix.federal_award',
  'food establishment': 'tfix.food_establishment',
  'your area': 'tfix.your_area',
};

const CIVIC_KEYS: Record<string, DictKey> = {
  roof: 'civic.roof',
  'plumbing or leak': 'civic.plumbing',
  'heating or cooling': 'civic.hvac',
  electrical: 'civic.electrical',
  pests: 'civic.pests',
  'trash or debris': 'civic.trash',
  'overgrown yard': 'civic.yard',
  trees: 'civic.trees',
  'windows or doors': 'civic.windows',
  'siding or gutters': 'civic.siding',
  fence: 'civic.fence',
  'paint or graffiti': 'civic.paint',
  pavement: 'civic.pavement',
  floors: 'civic.floors',
  pool: 'civic.pool',
  'water or fire damage': 'civic.water_fire',
  vehicle: 'civic.vehicle',
  'building condition': 'civic.building',
};

/**
 * The text after a title's colon. Only Holler's own fixed words are translated ("service request", "roof and plumbing or leak",
 * "property violation"); anything else is the record's own text and comes back as it is.
 */
export function fixedTextLang(text: string, lang: Lang): string {
  const fixed = FIXED_KEYS[text] ?? NAICS_SECTOR_KEYS[text];
  if (fixed) return t(lang, fixed);
  const parts = text.split(' and ');
  if (parts.length >= 1 && parts.length <= 2 && parts.every((p) => CIVIC_KEYS[p])) return parts.map((p) => t(lang, CIVIC_KEYS[p])).join(t(lang, 'civic.and'));
  return text;
}

const FEMA_KEYS: Record<string, DictKey> = {
  'Major disaster declaration': 'fema.major',
  'Emergency declaration': 'fema.emergency',
  'Fire management assistance declaration': 'fema.fire',
  'Disaster declaration': 'fema.disaster',
};

const FAA_KEYS: Record<string, DictKey> = {
  'Ground stop': 'faa.stop',
  'Ground delay program': 'faa.gdp',
  'Airport closure': 'faa.closure',
  'Flight delays': 'faa.delay',
};

const NWS_HAZARDS: Record<string, DictKey> = {
  tornado: 'nws.hazard.tornado',
  'severe thunderstorm': 'nws.hazard.severe-thunderstorm',
  'flash flood': 'nws.hazard.flash-flood',
  flood: 'nws.hazard.flood',
  'coastal flood': 'nws.hazard.coastal-flood',
  'lakeshore flood': 'nws.hazard.lakeshore-flood',
  'winter storm': 'nws.hazard.winter-storm',
  'winter weather': 'nws.hazard.winter-weather',
  'ice storm': 'nws.hazard.ice-storm',
  blizzard: 'nws.hazard.blizzard',
  'heavy snow': 'nws.hazard.heavy-snow',
  'lake effect snow': 'nws.hazard.lake-effect-snow',
  'snow squall': 'nws.hazard.snow-squall',
  'high wind': 'nws.hazard.high-wind',
  'extreme wind': 'nws.hazard.extreme-wind',
  wind: 'nws.hazard.wind',
  'brisk wind': 'nws.hazard.brisk-wind',
  'lake wind': 'nws.hazard.lake-wind',
  gale: 'nws.hazard.gale',
  heat: 'nws.hazard.heat',
  'excessive heat': 'nws.hazard.excessive-heat',
  'extreme heat': 'nws.hazard.extreme-heat',
  freeze: 'nws.hazard.freeze',
  'hard freeze': 'nws.hazard.hard-freeze',
  frost: 'nws.hazard.frost',
  'extreme cold': 'nws.hazard.extreme-cold',
  'cold weather': 'nws.hazard.cold-weather',
  'wind chill': 'nws.hazard.wind-chill',
  hurricane: 'nws.hazard.hurricane',
  'tropical storm': 'nws.hazard.tropical-storm',
  typhoon: 'nws.hazard.typhoon',
  'storm surge': 'nws.hazard.storm-surge',
  'red flag': 'nws.hazard.red-flag',
  'fire weather': 'nws.hazard.fire-weather',
  'dense fog': 'nws.hazard.dense-fog',
  'high surf': 'nws.hazard.high-surf',
  'rip current': 'nws.hazard.rip-current',
  'small craft': 'nws.hazard.small-craft',
  'special weather': 'nws.hazard.special-weather',
};

const NWS_LEVELS: Record<string, DictKey> = {
  warning: 'nws.level.warning',
  watch: 'nws.level.watch',
  advisory: 'nws.level.advisory',
  statement: 'nws.level.statement',
  emergency: 'nws.level.emergency',
};

/** The NWS event names this module says in Spanish (every hazard x level the table can build is a real NWS product name or a rare one that still reads right). */
export function knownNwsHazards(): string[] {
  return Object.keys(NWS_HAZARDS);
}

const NAICS_SECTOR_KEYS: Record<string, DictKey> = {
  'Farming and fishing': 'naics.farming',
  'Mining and oil and gas': 'naics.mining',
  Utilities: 'naics.utilities',
  Construction: 'naics.construction',
  Manufacturing: 'naics.manufacturing',
  'Wholesale trade': 'naics.wholesale',
  Retail: 'naics.retail',
  'Transportation and warehousing': 'naics.transport',
  'Information and media': 'naics.information',
  'Finance and insurance': 'naics.finance',
  'Real estate and rental': 'naics.realestate',
  'Professional, scientific and technical services': 'naics.professional',
  'Company management': 'naics.management',
  'Administrative and support services': 'naics.admin',
  Education: 'naics.education',
  'Health care and social assistance': 'naics.health',
  'Arts, entertainment and recreation': 'naics.arts',
  'Food service and lodging': 'naics.food',
  'Other services': 'naics.other',
  'Public administration': 'naics.public',
};

/** A NAICS sector name Holler printed ("Food service and lodging") in the language, or null when the text is not one of them. */
export function naicsSectorLang(text: string, lang: Lang): string | null {
  const k = NAICS_SECTOR_KEYS[text];
  return k ? t(lang, k) : null;
}

/** The English NAICS sector names (socrata-datasets.ts NAICS_SECTORS) this module says in Spanish. */
export function knownNaicsSectors(): string[] {
  return Object.keys(NAICS_SECTOR_KEYS);
}

interface Parsed {
  key: DictKey;
  vars: Fields;
}

/** Sources whose title is the author's own text (a social post, a web search hit). */
const FREE_TEXT_SOURCES = /^(?:bluesky|websearch)/i;

const lc = (s: string) => s.toLowerCase();

/** The template a title was built from, with its fields. `lang` decides only how Holler's own words inside the fields are said. */
function parse(title: string, lang: Lang, source: string | null | undefined): Parsed | null {
  let m: RegExpExecArray | null;

  // Storm Prediction Center reports
  if ((m = /^(\d+\.\d{2}) inch hail reported near (.+)$/.exec(title))) return { key: 'title.hail', vars: { inches: m[1], where: m[2] } };
  if ((m = /^(\d+) mph wind gust reported near (.+)$/.exec(title))) return { key: 'title.wind_gust', vars: { mph: m[1], where: m[2] } };
  if ((m = /^Wind damage reported near (.+)$/.exec(title))) return { key: 'title.wind_damage', vars: { where: m[1] } };
  if ((m = /^Tornado reported near (.+)$/.exec(title))) return { key: 'title.tornado', vars: { where: m[1] } };

  // Federal contracts and bids
  if ((m = /^Federal contract(?: \((\$[\d.]+[KMB]?)\))? in (.+?): (.*)$/.exec(title))) {
    const label = awardLabelLang(m[3], lang);
    return m[1] ? { key: 'title.fed_contract_amount', vars: { amount: m[1], place: m[2], label } } : { key: 'title.fed_contract', vars: { place: m[2], label } };
  }
  if ((m = /^Federal bid in (.+?): (.*)$/.exec(title))) return { key: 'title.fed_bid', vars: { place: m[1], text: m[2] } };
  if ((m = /^Open bid in (.+?): (.*)$/.exec(title))) return { key: 'title.open_bid', vars: { place: placeLang(m[1], lang), text: m[2] } };
  // Round 20 page watch: "Bid: <title> (<agency>)". The title and the agency's name are the agency's own words and stay as printed.
  if ((m = /^Bid: (.+) \(([^()]+)\)$/.exec(title))) return { key: 'title.page_watch_bid', vars: { text: m[1], agency: m[2] } };

  // City records
  if ((m = /^Failed inspection in (.+?): (.*)$/.exec(title))) return { key: 'title.inspection', vars: { city: m[1], text: fixedTextLang(m[2], lang) } };
  if ((m = /^311 request in (.+?): (.*)$/.exec(title))) return { key: 'title.311', vars: { city: m[1], text: fixedTextLang(m[2], lang) } };
  if ((m = /^New business license in (.+?): (.*)$/.exec(title))) return { key: 'title.business_license', vars: { city: m[1], text: fixedTextLang(m[2], lang) } };
  if ((m = /^New business license in ([^:]+)$/.exec(title))) return { key: 'title.business_license_plain', vars: { city: m[1] } };
  if ((m = /^New business in (.+?): (.*)$/.exec(title))) return { key: 'title.business', vars: { city: m[1], text: fixedTextLang(m[2], lang) } };
  if ((m = /^Code violation in (.+?): (.*)$/.exec(title))) return { key: 'title.violation', vars: { city: m[1], text: fixedTextLang(m[2], lang) } };
  if ((m = /^Permitted event in (.+?): (.*)$/.exec(title))) {
    const rest = m[2];
    const at = rest.lastIndexOf(' at ');
    if (at > 0) return { key: 'title.event_at', vars: { city: m[1], text: fixedTextLang(rest.slice(0, at), lang), address: rest.slice(at + 4) } };
    return { key: 'title.event', vars: { city: m[1], text: fixedTextLang(rest, lang) } };
  }

  // A resident's request through Holler: "Service request in Atlanta: Roofing"
  if ((m = /^Service request in (.+?): (.*)$/.exec(title))) {
    const trade = tradeLabelFromEnglish(m[2], lang) ?? m[2];
    return { key: 'title.request', vars: { city: fixedTextLang(m[1], lang), trade } };
  }

  // Permits: "<labels> permit in <city>", "Permit in <city>"
  if ((m = /^Permit in (.+)$/.exec(title))) return { key: 'title.permit_plain', vars: { city: m[1] } };
  if ((m = /^(.+?) permit in (.+)$/.exec(title))) {
    // English keeps the label as the adapter wrote it (the English path rebuilds, it does not translate)
    const label = lang === 'en' ? m[1] : permitLabelLang(m[1], lang);
    if (label) return { key: 'title.permit', vars: { label, city: m[2] } };
    // A label Holler does not know is a type the city printed. Say it that way only for a record with a known source: a title with none could be a post.
    if (source && lang !== 'en') return { key: 'title.permit_other', vars: { label: m[1], city: m[2] } };
    return lang === 'en' ? { key: 'title.permit_other', vars: { label: m[1], city: m[2] } } : null;
  }

  // FEMA, FAA, USGS
  if ((m = /^(Major disaster declaration|Emergency declaration|Fire management assistance declaration|Disaster declaration): (.+) \(([A-Za-z]{2})\)$/.exec(title))) {
    return { key: 'title.fema', vars: { label: t(lang, FEMA_KEYS[m[1]]), name: m[2], state: m[3] } };
  }
  if ((m = /^(Ground stop|Ground delay program|Airport closure|Flight delays) at (.+) \(([A-Z0-9]{3,4})\)$/.exec(title))) {
    return { key: 'title.faa', vars: { label: t(lang, FAA_KEYS[m[1]]), airport: m[2], code: m[3] } };
  }
  if ((m = /^M(\d+\.\d) earthquake (.+)$/.exec(title))) return { key: 'title.quake', vars: { mag: m[1], place: m[2] } };
  if ((m = /^M(\d+\.\d) earthquake$/.exec(title))) return { key: 'title.quake_plain', vars: { mag: m[1] } };

  // National Weather Service: "<Hazard> <Level>: <areas>". The hazards and levels in the tables are said in Spanish; any other NWS event keeps
  // its English name inside a Spanish frame, so a Spanish title never starts with English. The areas are the NWS's own text.
  if ((m = /^(.+?) (Warning|Watch|Advisory|Statement|Emergency)(?:: (.*))?$/.exec(title))) {
    const hk = NWS_HAZARDS[lc(m[1])];
    if (hk) {
      const vars = { hazard: t(lang, hk), level: t(lang, NWS_LEVELS[lc(m[2])]), area: m[3] ?? '' };
      return { key: m[3] ? 'title.nws' : 'title.nws_plain', vars };
    }
  }
  if (source && /^nws/i.test(source) && (m = /^([^:]+)(?:: (.*))?$/.exec(title))) {
    return { key: m[2] ? 'title.nws_other' : 'title.nws_other_plain', vars: { event: m[1], area: m[2] ?? '' } };
  }

  // Ticketmaster: "<event> at <venue>, <city> <ST>"; only for that source, since another source's title can hold " at " itself.
  if (source === 'ticketmaster') {
    const at = title.lastIndexOf(' at ');
    if (at > 0) return { key: 'title.venue', vars: { name: title.slice(0, at), venue: title.slice(at + 4) } };
  }
  return null;
}

/** A regional portal's place reads "Los Angeles area" (city-bids.ts placeLabel): "área de Los Angeles" in Spanish. */
function placeLang(place: string, lang: Lang): string {
  const m = /^(.+) area$/.exec(place);
  return m ? t(lang, 'title.area', { place: m[1] }) : place;
}

/** "Plumbing (NAICS 238220)" gives "Plomería (NAICS 238220)"; "NAICS 238220" and "federal award" are Holler's fixed words. */
function awardLabelLang(label: string, lang: Lang): string {
  let m: RegExpExecArray | null;
  if ((m = /^(.+) \(NAICS (\d{2,6})\)$/.exec(label))) {
    const trade = tradeLabelFromEnglish(m[1], lang);
    return trade ? t(lang, 'title.award_label', { label: trade, code: m[2] }) : label;
  }
  if ((m = /^NAICS (\d{2,6})$/.exec(label))) return t(lang, 'title.award_code', { code: m[1] });
  if (label === 'federal award') return t(lang, 'tfix.federal_award');
  return tradeLabelFromEnglish(label, lang) ?? label;
}

/**
 * A record's title as the member should read it. English returns the title unchanged. Spanish rebuilds Holler's own templates and returns any
 * other title (one a source wrote) unchanged.
 */
export function localizeTitle(title: string, lang: Lang, source?: string | null): string {
  if (lang === 'en' || typeof title !== 'string' || !title) return title;
  // A post or a search hit is somebody's own text: it is never matched against Holler's templates.
  if (source && FREE_TEXT_SOURCES.test(source)) return title;
  try {
    const p = parse(title, lang, source);
    return p ? t(lang, p.key, p.vars) : title;
  } catch {
    return title;
  }
}

/**
 * The same template rebuilt in English from its parts. The tests use it to prove the English dictionary says what the adapters print, so a
 * Spanish template cannot drift from an English one it was copied from.
 */
export function rebuildEnglishTitle(title: string, source?: string | null): string | null {
  const p = parse(title, 'en', source);
  return p ? t('en', p.key, p.vars) : null;
}

/**
 * The parts of a title that are the record's own data (a place, a number, the text a source wrote), as opposed to the words Holler put around
 * them. Used by the tests to separate "English that belongs to the source" from "English Holler forgot to translate". Empty when the title is
 * not one of Holler's templates (then the whole title is the source's).
 */
export function titleDataFields(title: string, source?: string | null): string[] {
  const p = parse(title, 'es', source);
  if (!p) return [];
  return Object.values(p.vars).filter((v) => v.length > 0 && title.includes(v));
}
