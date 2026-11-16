import { siteUrl } from '@/lib/env';

/** Absolute URL for a site path, e.g. absoluteUrl('/local') */
export function absoluteUrl(path: string): string {
  if (!path || path === '/') return siteUrl;
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export const SITE_NAME = 'Holler';
