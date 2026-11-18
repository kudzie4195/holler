/**
 * Typed content for /guides. One module per guide, listed in index.ts.
 *
 * Text fields may hold links in the form [label](href). Hrefs that start with "/" are Holler pages, hrefs that start with
 * "https://" are official sources. inline.ts parses them for the page and for the tests. No other markup is allowed.
 */
export interface GuideSection {
  /** A question, as the reader would type it. Also the anchor id. */
  heading: string;
  paragraphs: string[];
  /** Optional list shown after the paragraphs. Each item is read as one sentence by the copy tests. */
  bullets?: string[];
  /** Show the list as a numbered list (steps in order) instead of bullets. */
  ordered?: boolean;
  /** Optional small table shown after the paragraphs and before the list. Cells may hold links. */
  table?: GuideTable;
  /** Optional worked example, shown as a boxed list after everything else in the section. */
  example?: GuideExample;
}

export interface GuideTable {
  /** Read aloud by screen readers and shown above the table. */
  caption: string;
  head: string[];
  /** Every row has as many cells as head. */
  rows: string[][];
}

export interface GuideExample {
  title: string;
  /** Each line is one sentence or one figure. */
  lines: string[];
}

export interface GuideLink {
  href: string;
  label: string;
}

export interface GuideFaq {
  q: string;
  a: string;
}

export interface Guide {
  slug: string;
  /** The h1. */
  title: string;
  /** Under 60 characters, unique. */
  metaTitle: string;
  /** 120 to 160 characters, unique. */
  description: string;
  /** 40 to 60 words, shown right under the h1. */
  directAnswer: string;
  /** 4 to 7 sections of about 120 to 180 words. */
  sections: GuideSection[];
  /** Short, honest, small. */
  howHolerHelps: string;
  /** 3 to 4 questions answered on the page. */
  faq: GuideFaq[];
  /** 2 to 4 Holler pages. */
  related: GuideLink[];
  /** The day a person last checked every fact and link in this guide. A constant, never computed. */
  lastReviewed: string;
}
