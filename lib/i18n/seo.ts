/**
 * Spanish public pages and their English twins. Each pair is one page in two languages: both carry the same hreflang set (en, es and
 * x-default pointing at the English page), each is its own canonical, and both are in the sitemap. Only these two pages have a Spanish
 * version; no other page is translated, so no other page gets a hreflang.
 */
export const ES_PAIRS = [
  { en: '/', es: '/es' },
  { en: '/check', es: '/es/check' },
] as const;

export type EsPair = (typeof ES_PAIRS)[number];

/** Next metadata `alternates` for one page of a pair: its own canonical plus the en/es/x-default hreflang links. */
export function pairAlternates(pair: EsPair, self: 'en' | 'es'): { canonical: string; languages: Record<string, string> } {
  return {
    canonical: pair[self],
    languages: { en: pair.en, es: pair.es, 'x-default': pair.en },
  };
}

/** The paths of every Spanish page, for the sitemap. */
export const ES_PATHS: readonly string[] = ES_PAIRS.map((p) => p.es);

/**
 * next.config.ts headers() rules for the Spanish pages. The root layout writes <html lang="en"> for the whole site, so the response says
 * Content-Language: es for /es and everything under it. Relative import in next.config.ts: this file imports nothing.
 */
export function contentLanguageRules(): { source: string; headers: { key: string; value: string }[] }[] {
  // '/es/:path*' also matches '/es' itself (checked against next/dist/compiled/path-to-regexp), so one rule covers the home and /es/check.
  return [{ source: '/es/:path*', headers: [{ key: 'Content-Language', value: 'es' }] }];
}
