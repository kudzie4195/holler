import type { Guide } from './types';
import { permits } from './permits';
import { storms } from './storms';
import { requests311 } from './311';
import { dataSources } from './sources';
import { payPerLead } from './pricing-models';
import { federal } from './federal';
import { licenses } from './licenses';
import { respond } from './respond';

export type { Guide, GuideSection, GuideLink, GuideFaq } from './types';

/** Hub order. Every guide is listed here and nowhere else. */
export const GUIDES: Guide[] = [permits, storms, requests311, dataSources, payPerLead, federal, licenses, respond];

export const GUIDE_SLUGS: string[] = GUIDES.map((g) => g.slug);

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function guidePath(slug: string): string {
  return `/guides/${slug}`;
}
