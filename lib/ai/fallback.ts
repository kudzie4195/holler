import { hasKey, t, type Lang } from '@/lib/i18n';
import { ES_BANNED_DRAFT_WORDS, spanishProblems } from '@/lib/i18n/rules';

export const BANNED_WORDS = [
  'unlock', 'supercharge', 'seamless', 'elevate', 'game-changer', 'game changer', 'revolutionize',
  'leverage', 'empower', 'cutting-edge', 'robust', 'harness', 'delve', 'effortless', 'journey',
  "in today's",
];

export interface DraftInput {
  businessName: string;
  categories: string[];
  title: string;
  summary?: string | null;
  city?: string | null;
  /** The member's language (profile.language). 'es' writes the fallback and checks the model text as Spanish. Default English. */
  lang?: Lang;
}

function humanize(cat: string): string {
  return cat.replace(/-/g, ' ');
}

/** Trade labels are capitalised in the dictionary; a sentence wants the first letter lower ("HVAC" stays as it is). */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function fallbackDraftEs(i: DraftInput): string {
  const lang: Lang = 'es';
  const id = i.categories[0];
  const key = id ? (`trade.${id}` as const) : null;
  const label = key && hasKey(key) ? lowerFirst(t(lang, key)) : id ? id.replace(/-/g, ' ') : t(lang, 'draft.trade_fallback');
  const where = i.city ? t(lang, 'draft.where_city', { city: i.city }) : t(lang, 'draft.where_nearby');
  return t(lang, 'draft.fallback', { business: i.businessName, trade: label, where });
}

export function fallbackDraft(i: DraftInput): string {
  if (i.lang === 'es') return fallbackDraftEs(i);
  const trade = i.categories[0] ? humanize(i.categories[0]) : 'local work';
  const where = i.city ? ` around ${i.city}` : ' nearby';
  return (
    `Hi, I saw your post and wanted to help. I run ${i.businessName}, and we do ${trade}${where}. ` +
    `Happy to answer questions or give you a straight price, just reply here and tell me a bit more about what you need.`
  ).replace(/—/g, '-');
}

/** True when text breaks the draft rules: URLs, em dashes, banned words, emoji, or bad length. */
export function violatesDraftRules(text: string, lang: Lang = 'en'): boolean {
  const t = text.toLowerCase();
  if (lang === 'es' && (ES_BANNED_DRAFT_WORDS.some((w) => t.includes(w)) || spanishProblems(text).length > 0)) return true;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|app|ca|us)\b/i.test(text)) return true;
  if (text.includes('—')) return true;
  if (/\p{Extended_Pictographic}/u.test(text)) return true;
  if (BANNED_WORDS.some((w) => t.includes(w))) return true;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  return sentences < 1 || sentences > 4 || text.length > 700;
}
