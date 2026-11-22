import { en, type DictKey } from './en';
import { es } from './es';

/**
 * Holler's one dictionary module (round 17, unit ES). Two languages: English ('en', the default and the fallback) and Latin American
 * Spanish ('es'). Every member-facing string that has a Spanish version lives in en.ts and es.ts under the SAME key; tests/i18n fails
 * when an es key is missing or empty, when its {placeholders} differ from the English ones, or when it breaks a wording rule
 * (lib/i18n/rules.ts). Client-safe: no server imports, no I/O.
 *
 * Machine-made sentences (the brief card, the digest, the outreach notes, the draft fallback) are built from these templates by the same
 * code for both languages. There is no model call and no translation service in this module.
 */
export type Lang = 'en' | 'es';

export const LANGS: readonly Lang[] = ['en', 'es'];
export const DEFAULT_LANG: Lang = 'en';

export type { DictKey };

const DICTS: Record<Lang, Record<DictKey, string>> = { en, es };

/** A stored or submitted value as a language. Anything that is not exactly 'en' or 'es' (null, a typo, a missing column) is English. */
export function parseLang(v: unknown): Lang {
  return v === 'es' ? 'es' : 'en';
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'es';
}

/** Language of a profile row. A database without migration 0024 has no `language` key: that is English. */
export function langOfProfile(p: { language?: unknown } | null | undefined): Lang {
  return parseLang(p?.language);
}

export type Vars = Record<string, string | number | null | undefined>;

/** Fills {name} placeholders. A placeholder with no value is left as written, so a missing value is visible in tests and never throws. */
export function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** The string for a key in a language, with placeholders filled. A language or key that is not there falls back to English. */
export function t(lang: Lang, key: DictKey, vars?: Vars): string {
  const d = DICTS[lang] ?? en;
  return fill(d[key] ?? en[key], vars);
}

/** True when the key exists (used by code that builds a key from data, such as a trade id). */
export function hasKey(key: string): key is DictKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** Like t(), for a key built at run time. Returns null when no such key exists, so the caller can use its English literal. */
export function tOpt(lang: Lang, key: string, vars?: Vars): string | null {
  return hasKey(key) ? t(lang, key, vars) : null;
}

export function dictionary(lang: Lang): Readonly<Record<DictKey, string>> {
  return DICTS[lang];
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Dec 5, 2026" gives "5 dic 2026" and "Dec 5" gives "5 dic" in Spanish. English text and anything that is not that shape come back unchanged,
 * so a date a source printed in its own words is never rewritten.
 */
export function localizeDate(text: string | null | undefined, lang: Lang): string | null {
  if (text === null || text === undefined) return null;
  if (lang !== 'es') return text;
  const m = /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?$/.exec(text.trim());
  if (!m) return text;
  const i = MONTHS_EN.indexOf(m[1]);
  if (i < 0) return text;
  return `${m[2]} ${MONTHS_ES[i]}${m[3] ? ` ${m[3]}` : ''}`;
}

/** First letter lower-cased, the rest as it is: "Calefacción y aire acondicionado (HVAC)" keeps its acronym. For Spanish text only. */
export function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
