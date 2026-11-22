import Link from 'next/link';
import { Logo } from '@/components/logo';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { t, type Lang } from '@/lib/i18n';

const footLink = 'inline-flex min-h-11 min-w-11 items-center underline decoration-1 underline-offset-4 hover:text-ink';

/**
 * The frame of the sign-up, log-in and password pages: green top bar with the wordmark, one centred column, and a short footer.
 * English: app/(auth)/layout.tsx renders it with `lang` 'en' (the markup it always had, plus `languageLink` when given). Spanish: the
 * /es account pages render it with `lang` 'es'; privacy and terms are English pages, and the links say so. `languageLink` is the link to
 * the same page in the other language.
 */
export function AuthShell({ lang = 'en', children, languageLink }: { lang?: Lang; children: React.ReactNode; languageLink?: React.ReactNode }) {
  const es = lang === 'es';
  return (
    <>
      {/* Green top bar, as the site nav: the HOLLER wordmark takes on-brand from .on-brand (11.3:1), focus ring signal. */}
      <header className="on-brand bg-brand">
        <div className={`${PAGE_BOX} flex h-16 items-center`}>
          {es ? <Logo href="/es" ariaLabel={t(lang, 'nav.home')} /> : <Logo />}
        </div>
      </header>
      {/*
        The one centred exception to the page grid (commander decision after round 9 review): title, lead, form card and the line
        under it sit in one centred column the width of the card, text left-aligned inside it. The logo above stays on the grid edge.
      */}
      <main id="main" className={`${PAGE_BOX} flex flex-1 flex-col pb-16 pt-6 sm:pt-12 ${BODY_TEXT}`}>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</div>
      </main>
      {/* Spanish labels are longer ("Privacidad (en inglés)"): they wrap as whole links, never inside one (review P3-7). */}
      <footer className={es ? `${PAGE_BOX} flex flex-wrap justify-center gap-x-4 pb-8 text-sm text-muted` : `${PAGE_BOX} flex justify-center gap-4 pb-8 text-sm text-muted`}>
        {es ? (
          <>
            <Link href="/privacy" hrefLang="en" className={`${footLink} whitespace-nowrap`}>
              {t(lang, 'footer.privacy')}
            </Link>
            <Link href="/terms" hrefLang="en" className={`${footLink} whitespace-nowrap`}>
              {t(lang, 'footer.terms')}
            </Link>
          </>
        ) : (
          <>
        <Link href="/privacy" className={footLink}>
          Privacy
        </Link>
        <Link href="/terms" className={footLink}>
          Terms
        </Link>
          </>
        )}
        {languageLink}
      </footer>
    </>
  );
}
