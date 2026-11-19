import { absoluteUrl } from '../canonical';
import { articleLd, breadcrumbLd, faqLd, itemListLd } from '../jsonld';
import { FAQ_ITEMS } from '../faq';
import { GUIDES, guidePath, type Guide } from './index';
import { TRIAL_PHRASE } from '@/lib/plan/price-copy';

/** Date the first guides went live. A constant, like lastReviewed. */
export const GUIDES_PUBLISHED = '2026-11-17';

export interface PageMeta {
  title: string;
  description: string;
  path: string;
}

export const GUIDES_HUB_META: PageMeta = {
  title: 'Guides for Local Service Businesses | Holler',
  description:
    'Eight plain guides on finding local work from public data: permits, storm reports, 311 requests, business licenses, federal contracts and how to reply fast.',
  path: '/guides',
};

export const FAQ_META: PageMeta = {
  title: 'Holler FAQ: Pricing, Data and Requests',
  description:
    `Answers about what Holler is, where its data comes from, what it costs after the ${TRIAL_PHRASE} and how resident requests and privacy work.`,
  path: '/faq',
};

export const DATA_META: PageMeta = {
  title: 'Local Public Records in Numbers | Holler',
  description:
    'Original counts of the public records Holler has read: how many are dated in the last 7 and 30 days, by type, with the cities and trades that have the most.',
  path: '/data',
};

export function guideMeta(g: Guide): PageMeta {
  return { title: g.metaTitle, description: g.description, path: guidePath(g.slug) };
}

/** Article + BreadcrumbList + FAQPage for one guide. The FAQ text is the text shown on the page. */
export function guideJsonLd(g: Guide): Record<string, unknown>[] {
  const path = guidePath(g.slug);
  return [
    articleLd({ headline: g.title, description: g.description, path, datePublished: GUIDES_PUBLISHED, dateModified: g.lastReviewed }),
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Guides', path: '/guides' },
      { name: g.title, path },
    ]),
    faqLd(g.faq),
  ];
}

export function hubJsonLd(): Record<string, unknown>[] {
  return [
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Guides', path: '/guides' },
    ]),
    itemListLd(
      'Holler guides',
      GUIDES.map((g) => ({ name: g.title, url: absoluteUrl(guidePath(g.slug)) })),
    ),
  ];
}

export function faqPageJsonLd(): Record<string, unknown>[] {
  return [
    faqLd(FAQ_ITEMS),
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'FAQ', path: '/faq' },
    ]),
  ];
}
