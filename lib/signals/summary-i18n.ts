import { t, type DictKey, type Lang } from '@/lib/i18n';
import { naicsSectorLang, permitLabelLang } from '@/lib/signals/title-i18n';

/**
 * Record summaries in the member's language (round 17, unit ES, redo 2). Same approach as title-i18n.ts.
 *
 * A summary is either text a source wrote (SPC remarks, NWS headline and description, a permit's type and class, a business name, a buyer) or
 * a sentence Holler composed from fields in an adapter (FEMA, FAA, USGS, the "$N job value" part, "due DATE", "responses due DATE", "by AGENCY",
 * Ticketmaster's "starts ..."). Holler's own sentences are recognised and rebuilt from the same fields with the dictionary (sum.*); a part a
 * source wrote is carried over as it is. English ('en') returns the summary unchanged. Pure and total: nothing here throws.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-11-30" gives "30 nov 2026". Anything else comes back as it is. */
function dayEs(iso: string): string {
  const m = ISO_DAY.exec(iso);
  if (!m) return iso;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${Number(m[3])} ${MONTHS_ES[mo - 1]} ${m[1]}` : iso;
}

/** "1 hour and 15 minutes" gives "1 hora y 15 minutos". The FAA writes durations in this shape; other text comes back as it is. */
function durationLang(text: string, lang: Lang): string {
  return text
    .replace(/\b(\d+) hours?\b/g, (_w, n: string) => `${n} ${t(lang, n === '1' ? 'sum.dur.hour' : 'sum.dur.hours')}`)
    .replace(/\b(\d+) minutes?\b/g, (_w, n: string) => `${n} ${t(lang, n === '1' ? 'sum.dur.minute' : 'sum.dur.minutes')}`)
    .replace(/ and (?=\d)/g, t(lang, 'sum.dur.and'));
}

const FEMA_INCIDENTS: Record<string, DictKey> = {
  hurricane: 'fema.inc.hurricane',
  flood: 'fema.inc.flood',
  fire: 'fema.inc.fire',
  tornado: 'fema.inc.tornado',
  'severe storm': 'fema.inc.severe-storm',
  'severe storm(s)': 'fema.inc.severe-storms',
  'severe storms': 'fema.inc.severe-storms',
  'severe ice storm': 'fema.inc.severe-ice-storm',
  snow: 'fema.inc.snow',
  'winter storm': 'fema.inc.winter-storm',
  'coastal storm': 'fema.inc.coastal-storm',
  earthquake: 'fema.inc.earthquake',
  drought: 'fema.inc.drought',
  freezing: 'fema.inc.freezing',
  typhoon: 'fema.inc.typhoon',
  tsunami: 'fema.inc.tsunami',
  'mud/landslide': 'fema.inc.mud-landslide',
  disaster: 'fema.inc.disaster',
};

/** The FEMA incident types this module says in Spanish; any other type is named in English inside a Spanish sentence. */
export function knownFemaIncidents(): string[] {
  return Object.keys(FEMA_INCIDENTS);
}

const FAA_LABELS: Record<string, DictKey> = {
  'Ground stop': 'faa.stop',
  'Ground delay program': 'faa.gdp',
  'Airport closure': 'faa.closure',
  'Flight delays': 'faa.delay',
};

interface Parsed {
  key: DictKey;
  vars: Record<string, string>;
}

function parseWhole(summary: string, lang: Lang, source: string | null | undefined): Parsed | null {
  let m: RegExpExecArray | null;
  const src = source ?? '';

  // FEMA: "FEMA declared <incident> (DR-4000) for GA: 3 areas designated (A, B, C, and more)." or " (statewide)."
  if ((src === 'fema' || !src) && (m = /^FEMA declared (.+?) (?:\(([A-Z]{2}-\d+)\) )?for ([A-Z]{2})((?:: \d+ areas? designated(?: \(.*\))?)| \(statewide\))\.$/.exec(summary))) {
    const [, incident, code, state, tail] = m;
    const known = FEMA_INCIDENTS[incident];
    const head = known ? (code ? 'sum.fema_head_typed' : 'sum.fema_head') : code ? 'sum.fema_head_other_typed' : 'sum.fema_head_other';
    // English keeps the incident as FEMA's type text lower-cased (the adapter's own words); Spanish names it from the table.
    const inc = known && lang !== 'en' ? t(lang, known) : incident;
    let out = t(lang, head, { incident: inc, code: code ?? '', state });
    if (tail === ' (statewide)') out += t(lang, 'sum.fema_statewide');
    else {
      const a = /^: (\d+) areas? designated(?: \((.*?)(, and more)?\))?$/.exec(tail);
      if (a) {
        out += a[1] === '1' ? t(lang, 'sum.fema_areas_one') : t(lang, 'sum.fema_areas_many', { n: a[1] });
        if (a[2]) out += t(lang, a[3] ? 'sum.fema_list_more' : 'sum.fema_list', { shown: a[2] });
      } else out += tail;
    }
    return { key: 'sum.fema_head', vars: { __done: `${out}.` } };
  }

  // USGS: "Magnitude 5.2 earthquake 9 km SW of Ridgecrest, CA, depth 8 km."
  if ((src === 'usgs' || !src) && (m = /^Magnitude (\d+\.\d) earthquake (.*?)(?:, depth (\d+) km)?\.$/.exec(summary))) {
    return m[3] ? { key: 'sum.quake_depth', vars: { mag: m[1], place: m[2], km: m[3] } } : { key: 'sum.quake', vars: { mag: m[1], place: m[2] } };
  }

  // FAA: "Flight delays at ATL, Atlanta: WEATHER / WIND. Delays up to 1 hour and 15 minutes."
  if ((src === 'faa' || !src) && (m = /^(Ground stop|Ground delay program|Airport closure|Flight delays) at ([A-Z0-9]{3,4}), (.+?): (.+?)(?:\. (Expected to end .+|Average delay .+|Delays up to .+))?\.$/.exec(summary))) {
    const [, label, code, city, whyRaw, detailRaw] = m;
    const why = whyRaw === 'airport closed per NOTAM' ? t(lang, 'sum.faa.closed') : whyRaw === 'unspecified' ? t(lang, 'sum.faa.unspecified') : whyRaw;
    const vars: Record<string, string> = { label: t(lang, FAA_LABELS[label]), code, city, why };
    if (!detailRaw) return { key: 'sum.faa', vars };
    let d: RegExpExecArray | null;
    if ((d = /^Expected to end (.+)$/.exec(detailRaw))) vars.detail = t(lang, 'sum.faa.end', { when: d[1] });
    else if ((d = /^Average delay (.+?), up to (.+)$/.exec(detailRaw))) vars.detail = t(lang, 'sum.faa.avg_max', { avg: durationLang(d[1], lang), max: durationLang(d[2], lang) });
    else if ((d = /^Average delay (.+)$/.exec(detailRaw))) vars.detail = t(lang, 'sum.faa.avg', { avg: durationLang(d[1], lang) });
    else if ((d = /^Delays up to (.+)$/.exec(detailRaw))) vars.detail = t(lang, 'sum.faa.delays', { max: durationLang(d[1], lang) });
    else return null;
    return { key: 'sum.faa_detail', vars };
  }
  return null;
}

/** One " | " part, or one ", " part of USAspending and Ticketmaster summaries. Holler's own words are said in the language; source text is kept. */
function partLang(part: string, lang: Lang, source: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^(\$[\d,]+) job value$/.exec(part))) return t(lang, 'sum.job_value', { amount: m[1] });
  if ((m = /^responses due (\d{4}-\d{2}-\d{2})$/.exec(part))) return t(lang, 'sum.resp_due', { date: dayEs(m[1]) });
  if ((m = /^due (\d{4}-\d{2}-\d{2})$/.exec(part))) return t(lang, 'sum.due', { date: dayEs(m[1]) });
  if (part === 'no due date published') return t(lang, 'sum.no_due');
  if (part === 'Mechanical') return t(lang, 'sum.part_mechanical');
  if (part === 'Residential building') return t(lang, 'sum.part_res_building');
  if (part === 'Commercial building') return t(lang, 'sum.part_com_building');
  const labelEs = permitLabelLang(part, lang);
  if (labelEs && /^(?:Electrical|Plumbing|Fence|Tree removal|Demolition|Sign)$/.test(part)) return labelEs.charAt(0).toUpperCase() + labelEs.slice(1);
  const sector = naicsSectorLang(part, lang);
  if (sector) return sector;
  if (source === 'usaspending' && (m = /^by (.+)$/.exec(part))) return t(lang, 'sum.by', { agency: m[1] });
  if (source === 'ticketmaster') {
    if ((m = /^starts (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) local time$/.exec(part))) return t(lang, 'sum.starts_local', { date: dayEs(m[1]), time: m[2] });
    if ((m = /^starts (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC$/.exec(part))) return t(lang, 'sum.starts_utc', { date: dayEs(m[1]), time: m[2] });
    if ((m = /^starts (\d{4}-\d{2}-\d{2})$/.exec(part))) return t(lang, 'sum.starts', { date: dayEs(m[1]) });
    if ((m = /^(Sports|Music)(?: \/ (.+))?$/.exec(part))) return `${t(lang, m[1] === 'Sports' ? 'sum.seg.sports' : 'sum.seg.music')}${m[2] ? ` / ${m[2]}` : ''}`;
  }
  return part;
}

/**
 * A record's summary as the member should read it. English returns it unchanged. Spanish rebuilds the sentences Holler composed and the fixed
 * parts it adds ("$14,500 job value", "due 2026-11-30", "by AGENCY", "starts ..."); everything a source wrote stays as the source wrote it.
 * A summary a source wrote in full (SPC remarks, an NWS headline and description, a bluesky post) is not touched.
 */
export function localizeSummary(summary: string | null | undefined, lang: Lang, source?: string | null): string | null | undefined {
  if (lang === 'en' || typeof summary !== 'string' || !summary) return summary;
  if (source && /^(?:bluesky|websearch|nws|spc)/i.test(source)) return summary;
  try {
    const whole = parseWhole(summary, lang, source);
    if (whole) return whole.vars.__done ?? t(lang, whole.key, whole.vars);
    const src = source ?? '';
    // USAspending and Ticketmaster join their parts with ", ", every other source with " | "
    const sep = src === 'usaspending' || src === 'ticketmaster' ? ', ' : ' | ';
    const parts = summary.split(sep);
    const out = parts.map((p) => partLang(p, lang, src));
    return out.join(sep === ', ' && src === 'ticketmaster' ? ', ' : sep);
  } catch {
    return summary;
  }
}

/**
 * The same summary rebuilt in English from its parts: the tests compare it with the adapter's own text, so a Spanish template cannot drift
 * from an English one. Null when the summary is not one of Holler's whole-sentence templates.
 */
export function rebuildEnglishSummary(summary: string, source?: string | null): string | null {
  const p = parseWhole(summary, 'en', source);
  if (!p) return null;
  return p.vars.__done ?? t('en', p.key, p.vars);
}
