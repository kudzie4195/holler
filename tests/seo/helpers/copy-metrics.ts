import { stripLinks } from '../../../lib/seo/guides/inline';

/** Split plain text into sentences. A line break also ends a sentence, so list items count one each. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])["')\]]*\s+(?=[A-Z0-9"'(])/))
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z0-9]/.test(s));
}

export function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9$%][A-Za-z0-9$%'’.,/:-]*/g) ?? []).length;
}

export interface CopyStats {
  sentences: number;
  words: number;
  mean: number;
  shortShare: number;
  cv: number;
}

/** Mean sentence length, the share of sentences under 8 words, and stdev/mean of the sentence lengths. */
export function copyStats(text: string): CopyStats {
  const lens = sentences(stripLinks(text)).map(wordCount);
  const n = lens.length;
  const words = lens.reduce((a, b) => a + b, 0);
  const mean = words / n;
  const variance = lens.reduce((a, l) => a + (l - mean) ** 2, 0) / n;
  return {
    sentences: n,
    words,
    mean,
    shortShare: lens.filter((l) => l < 8).length / n,
    cv: Math.sqrt(variance) / mean,
  };
}

export const BANNED = [
  'delve', 'seamless', 'robust', 'comprehensive', 'holistic', 'elevate', 'unlock', 'unleash', 'empower', 'journey', 'landscape',
  'realm', 'game-changer', 'leverage', 'utilize', 'moreover', 'furthermore', 'effortless', 'supercharge', 'revolutionize',
];

export function bannedHits(text: string): string[] {
  const t = text.toLowerCase();
  return BANNED.filter((w) => new RegExp(`\\b${w.replace('-', '[- ]?')}`).test(t));
}

export function hasEmDash(text: string): boolean {
  return /—/.test(text);
}
