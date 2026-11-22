import Link from 'next/link';
import { Logo } from '../logo';
import { ButtonLink } from '../button';
import { PAGE_BOX } from '../grid';
import { t } from '@/lib/i18n';

const L = 'es' as const;
const linkCls = 'h-link shrink-0 whitespace-nowrap px-1 text-[0.9375rem] font-medium text-on-brand';

/**
 * Header of the Spanish public pages (/es and /es/check). Same bar as components/top-nav.tsx, with its words from the dictionary.
 * The sign-up, log-in and pricing pages are in English, so they are linked as they are; the language link goes to the English
 * counterpart of the page the visitor is on (`englishHref`).
 */
export function TopNavEs({ englishHref = '/' }: { englishHref?: string }) {
  const links = [
    { href: '/es/check', label: t(L, 'nav.check'), english: false },
    { href: '/es#how', label: t(L, 'nav.how'), english: false },
    { href: '/pricing', label: t(L, 'nav.pricing'), english: true },
  ];
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-signal focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-ink"
      >
        {t(L, 'nav.skip')}
      </a>
      <header className="on-brand sticky top-0 z-40 bg-brand">
        <div className={`${PAGE_BOX} flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2`}>
          <Logo size={32} href="/es" ariaLabel={t(L, 'nav.home')} />
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-6">
            <nav aria-label={t(L, 'nav.main')} className="hidden md:block">
              <ul className="flex items-center gap-4 lg:gap-6">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={linkCls} {...(l.english ? { hrefLang: 'en' } : {})}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <a href={englishHref} hrefLang="en" lang="en" className={linkCls}>
              {t(L, 'nav.other_language')}
            </a>
            <Link href="/login" hrefLang="en" className={`${linkCls} hidden min-[28rem]:inline-flex`}>
              {t(L, 'nav.login')}
            </Link>
            <ButtonLink href="/signup" hrefLang="en" variant="outline-signal" className="shrink-0 max-[22.5rem]:px-4">
              {t(L, 'nav.start')}
            </ButtonLink>
          </div>
        </div>
      </header>
    </>
  );
}
