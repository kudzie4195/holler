import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { AuthCardSkeleton } from '@/components/auth-card';
import { AuthShell } from '@/components/auth-shell';
import { t, type DictKey } from '@/lib/i18n';
import { ES_NOINDEX, pairAlternates, type EsPair } from '@/lib/i18n/seo';

const L = 'es' as const;

/**
 * Metadata of a Spanish account page (/es/signup, /es/login, /es/forgot, /es/reset): its own Spanish title and description, its own
 * canonical, the hreflang pair with the English page (x-default English, as on /es), and Spanish Open Graph. Indexed, except the pages in
 * ES_NOINDEX (/es/reset only works from an emailed link).
 */
export function esAuthMetadata(pair: EsPair, titleKey: DictKey, descKey: DictKey): Metadata {
  const title = t(L, titleKey);
  const description = t(L, descKey);
  const noindex = ES_NOINDEX.includes(pair.es);
  return {
    // The titles already name Holler, so the site template does not add a second "| Holler".
    title: { absolute: title },
    description,
    alternates: pairAlternates(pair, 'es'),
    openGraph: { type: 'website', siteName: 'Holler', locale: 'es_US', title, description, url: pair.es, images: [{ url: '/og.png', width: 1200, height: 630, alt: title }] },
    robots: noindex ? { index: false, follow: true } : { index: true, follow: true },
  };
}

/** The frame of a Spanish account page, with the link to the English page in the footer. The body streams in behind Suspense. */
export function EsAuthPage({ pair, children }: { pair: EsPair; children: ReactNode }) {
  return (
    <AuthShell
      lang={L}
      languageLink={
        <a href={pair.en} hrefLang="en" lang="en" className="inline-flex min-h-11 min-w-11 items-center underline decoration-1 underline-offset-4 hover:text-ink">
          {t(L, 'nav.other_language')}
        </a>
      }
    >
      <Suspense fallback={<AuthCardSkeleton />}>{children}</Suspense>
    </AuthShell>
  );
}
