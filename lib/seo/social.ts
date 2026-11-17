import type { Metadata } from 'next';
import { absoluteUrl, SITE_NAME } from './canonical';

/**
 * Open Graph and Twitter values for a public page. A page that sets `openGraph` replaces the whole object from app/layout.tsx,
 * so every field is repeated here: title, description, url, siteName, type and the share image. `title` is the full title as it
 * should appear when shared (the same text as the page title, including " | Holler" where the page title has it).
 */
export const OG_IMAGE = { url: '/og.png', width: 1200, height: 630, alt: 'Holler: know when your town needs you' };

export function socialMeta(opts: { title: string; description: string; path: string; type?: 'website' | 'article' }): Pick<Metadata, 'openGraph' | 'twitter'> {
  const { title, description, path, type = 'website' } = opts;
  return {
    openGraph: { title, description, url: absoluteUrl(path), siteName: SITE_NAME, type, images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  };
}
