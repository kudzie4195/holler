import { KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH } from './limits';

/**
 * Keyword watches (Pro). A watch matches a record whose title or summary contains the whole phrase, any letter case, accents ignored.
 * "Whole phrase" means the words appear together, in order, as whole words: "tree removal" matches "Tree removal at 12 Oak St"
 * and "TREE-REMOVAL permit", but not "street removal" and "roof" does not match "roofing". Punctuation counts as a space, and
 * "cafe" matches "Café".
 */

/**
 * Saved keywords use plain letters (accents are folded away when saved), digits, spaces and four marks: apostrophe, ampersand,
 * hyphen and slash. Keeps the phrase safe inside a PostgREST filter value. Migration 0004 applies the same pattern.
 */
export const KEYWORD_CHARS = /^[A-Za-z0-9 '&/-]+$/;
const HAS_ALNUM = /[A-Za-z0-9]/;

/** Removes accents: "Café" becomes "Cafe", "reparación" becomes "reparacion". */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/** Folds accents, trims and collapses inner spaces. What gets saved. */
export function cleanKeyword(raw: string): string {
  return foldAccents(raw).replace(/\s+/g, ' ').trim();
}

export type KeywordProblem = 'length' | 'chars';

/** Same rules as the 0004 trigger: 3 to 40 characters, the characters above only, at least one letter or digit. */
export function keywordProblem(k: string): KeywordProblem | null {
  if (k.length < KEYWORD_MIN_LENGTH || k.length > KEYWORD_MAX_LENGTH) return 'length';
  if (!KEYWORD_CHARS.test(k) || !HAS_ALNUM.test(k)) return 'chars';
  return null;
}

/**
 * Searchable form of a text: accents folded, lower case, every run of characters that are not letters or digits becomes one space,
 * padded with one space on each side, so a whole-word phrase test is a plain substring test of a padded phrase.
 */
export function foldText(s: string | null | undefined): string {
  if (!s) return '  ';
  return ` ${foldAccents(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

/** Keywords in searchable form (see foldText), blanks dropped. Do this once per profile, not once per record. */
export function preparePhrases(keywords: string[]): string[] {
  const out: string[] = [];
  for (const k of keywords) {
    const p = foldText(k);
    if (p.trim() !== '') out.push(p);
  }
  return out;
}

/**
 * Searchable text of one record: title and summary, each folded and padded. The two pads meet as a double space, so a phrase can
 * never match across the end of the title and the start of the summary. Do this once per record per scan.
 */
export function searchText(signal: { title?: string | null; summary?: string | null }): string {
  return foldText(signal.title) + foldText(signal.summary);
}

/** Index of the first prepared phrase found in a prepared text, or -1. */
export function phraseIndex(text: string, phrases: string[]): number {
  for (let i = 0; i < phrases.length; i++) if (text.includes(phrases[i])) return i;
  return -1;
}

export function containsPhrase(text: string | null | undefined, phrase: string): boolean {
  if (!text) return false;
  const p = foldText(phrase);
  if (p.trim() === '') return false;
  return foldText(text).includes(p);
}

/** First keyword found in the title or summary, or null. */
export function keywordHit(signal: { title?: string | null; summary?: string | null }, keywords: string[]): string | null {
  const text = searchText(signal);
  for (const k of keywords) {
    const p = foldText(k);
    if (p.trim() !== '' && text.includes(p)) return k;
  }
  return null;
}

/** Saved keywords as stored (text[]); non-strings and blanks dropped. */
export function parseKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === 'string').map(cleanKeyword).filter(Boolean);
}
