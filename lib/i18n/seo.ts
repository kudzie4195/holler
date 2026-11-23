/**
 * Spanish public pages and their English twins. Each pair is one page in two languages: both carry the same hreflang set (en, es and
 * x-default pointing at the English page) and each Spanish page is its own canonical. Only these pages have a Spanish version; no other
 * page is translated, so no other page gets a hreflang. The order is fixed (code reads ES_PAIRS[0] for the home and [1] for the check).
 *
 * Round 18 (ES) added pricing and the four account pages. The English sign-up, log-in and password pages are noindex (app/(auth)/layout.tsx)
 * and stay that way; their Spanish twins are indexed, except /es/reset, which only works from a reset link (noindex, not in the sitemap).
 */
export const ES_PAIRS = [
  { en: '/', es: '/es' },
  { en: '/check', es: '/es/check' },
  { en: '/pricing', es: '/es/pricing' },
  { en: '/signup', es: '/es/signup' },
  { en: '/login', es: '/es/login' },
  { en: '/forgot', es: '/es/forgot' },
  { en: '/reset', es: '/es/reset' },
] as const;

/** The pair for an English or Spanish path. */
export function esPair(path: string): EsPair | null {
  return ES_PAIRS.find((p) => p.en === path || p.es === path) ?? null;
}

/** Spanish pages that are not indexed (a page that only works from an emailed link). Their pair still carries hreflang. */
export const ES_NOINDEX: readonly string[] = ['/es/reset'];

/**
 * Round 24 FIX2 (review P3-7): the Spanish account pages whose English twins are noindex, nofollow (app/(auth)/layout.tsx). They get the
 * same robots. Kept apart from ES_NOINDEX on purpose, so the sitemap is unchanged in this round (an owner follow-up may drop them from it).
 */
export const ES_AUTH_NOINDEX: readonly string[] = ['/es/signup', '/es/login', '/es/forgot'];

/** The Spanish pages listed in the sitemap: every pair except the noindex ones. */
export const ES_SITEMAP_PAIRS: readonly EsPair[] = ES_PAIRS.filter((p) => !ES_NOINDEX.includes(p.es));

export type EsPair = (typeof ES_PAIRS)[number];

/** Next metadata `alternates` for one page of a pair: its own canonical plus the en/es/x-default hreflang links. */
export function pairAlternates(pair: EsPair, self: 'en' | 'es'): { canonical: string; languages: Record<string, string> } {
  return {
    canonical: pair[self],
    languages: { en: pair.en, es: pair.es, 'x-default': pair.en },
  };
}

/**
 * Only the hreflang set, for an English page that has no canonical of its own (the noindex sign-up, log-in and password pages): adding
 * the language links must not add a canonical those pages never had.
 */
export function pairLanguages(pair: EsPair): { languages: Record<string, string> } {
  return { languages: { en: pair.en, es: pair.es, 'x-default': pair.en } };
}

/** The paths of every Spanish page that has an English twin. */
export const ES_PATHS: readonly string[] = ES_PAIRS.map((p) => p.es);

/**
 * next.config.ts headers() rules for the Spanish pages. The root layout writes <html lang="en"> for the whole site, so the response says
 * Content-Language: es for /es and everything under it. Relative import in next.config.ts: this file imports nothing.
 */
export function contentLanguageRules(): { source: string; headers: { key: string; value: string }[] }[] {
  // '/es/:path*' also matches '/es' itself (checked against next/dist/compiled/path-to-regexp), so one rule covers the home and /es/check.
  return [{ source: '/es/:path*', headers: [{ key: 'Content-Language', value: 'es' }] }];
}
