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
}

function humanize(cat: string): string {
  return cat.replace(/-/g, ' ');
}

export function fallbackDraft(i: DraftInput): string {
  const trade = i.categories[0] ? humanize(i.categories[0]) : 'local work';
  const where = i.city ? ` around ${i.city}` : ' nearby';
  return (
    `Hi, I saw your post and wanted to help. I run ${i.businessName}, and we do ${trade}${where}. ` +
    `Happy to answer questions or give you a straight price, just reply here and tell me a bit more about what you need.`
  ).replace(/—/g, '-');
}

/** True when text breaks the draft rules: URLs, em dashes, banned words, emoji, or bad length. */
export function violatesDraftRules(text: string): boolean {
  const t = text.toLowerCase();
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|app|ca|us)\b/i.test(text)) return true;
  if (text.includes('—')) return true;
  if (/\p{Extended_Pictographic}/u.test(text)) return true;
  if (BANNED_WORDS.some((w) => t.includes(w))) return true;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  return sentences < 1 || sentences > 4 || text.length > 700;
}
