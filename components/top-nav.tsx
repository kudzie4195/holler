import Link from 'next/link';
import { Logo } from './logo';
import { ButtonLink } from './button';
import { PAGE_BOX } from './grid';

/** Section links in the bar on wide screens. Everything else (trades, cities, guides, FAQ, data, about, requests) is in the footer. */
export const NAV_LINKS = [
  { href: '/check', label: 'Check your area' },
  { href: '/#how', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
] as const;

const linkCls = 'h-link shrink-0 whitespace-nowrap px-1 text-[0.9375rem] font-medium text-on-brand';

/**
 * Marketing and public-page header: one green bar, 64 px tall at the default text size, so it stays sticky without eating a phone
 * screen. Static: never reads the session, so pages stay prerenderable. No client JavaScript.
 *
 * md (48rem, 768 px) and up: logo, the three section links, Log in, Start free.
 * Phones: logo, Log in, Start free. Log in hides under 22.5rem (360 px) so the row never wraps at 320 px; it is still in the page
 * body of /signup and the footer is one scroll away. At 360 px the gap between Log in and Start free is 12 px, so Start free ends
 * on the grid edge (review 1 N-P2-1).
 * Breakpoints are in rem and the bar may grow: with a larger browser text size (32 px on a 390 px window) Log in stays hidden and
 * Start free wraps under the logo instead of pushing the page sideways (review 2b P2-7).
 * Focus rings are signal (the .on-brand class), 9.7:1 on brand.
 */
export function TopNav({ ctaHref = '/signup', showStart = true }: { ctaHref?: string; /** Round 24: false on a page whose answer is waitlist (no sign-up link anywhere on it). */ showStart?: boolean }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-signal focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <header className="on-brand sticky top-0 z-40 bg-brand">
        <div className={`${PAGE_BOX} flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2`}>
          <Logo size={32} />
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-6">
            <nav aria-label="Main" className="hidden md:block">
              <ul className="flex items-center gap-4 lg:gap-6">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={linkCls}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <Link href="/login" className={`${linkCls} hidden min-[22.5rem]:inline-flex`}>
              Log in
            </Link>
            {showStart ? (
              <ButtonLink href={ctaHref} variant="outline-signal" className="shrink-0 max-[22.5rem]:px-4">
                Start free
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </header>
    </>
  );
}
