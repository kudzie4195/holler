import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo/canonical';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/app/', '/api/'] }],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
