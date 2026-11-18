import type { Guide, GuideSection } from './types';

/** Every block of reader text in a section, in page order: paragraphs, table caption and cells, list items, worked example. */
export function sectionTexts(s: GuideSection): string[] {
  return [
    ...s.paragraphs,
    ...(s.table ? [s.table.caption, ...s.table.head, ...s.table.rows.flat()] : []),
    ...(s.bullets ?? []),
    ...(s.example ? [s.example.title, ...s.example.lines] : []),
  ];
}

/** Prose only (no table cells): the text the sentence measures read. Tables are figures, not sentences. */
export function sectionProse(s: GuideSection): string[] {
  return [...s.paragraphs, ...(s.bullets ?? []), ...(s.example ? s.example.lines : [])];
}

/** All text that can hold a link: section text plus "How Holler helps". */
export function linkableTexts(g: Guide): string[] {
  return [...g.sections.flatMap(sectionTexts), g.howHolerHelps];
}
