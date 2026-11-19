import Link from 'next/link';
import { Logo } from './logo';
import { ButtonLink } from './button';

/** Order matters on a phone, where the row scrolls: what a visitor most often wants comes first. */
const links = [
  { href: '/check', label: 'Check your area' },
  { href: '/request', label: 'Request a service' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/for', label: 'By trade' },
  { href: '/local', label: 'By city' },
  { href: '/guides', label: 'Guides' },
  { href: '/faq', label: 'FAQ' },
  { href: '/data', label: 'Data' },
  { href: '/about', label: 'About' },
];

/**
 * Wide screens: four top-level items. "Browse" and "Learn" are real links to their hub pages, and each also opens a small menu
 * on hover or keyboard focus (CSS only), so every item works by touch, mouse and keyboard with no client JavaScript.
 */
type Item = { href: string; label: string; menu?: { href: string; label: string }[] };
const desktop: Item[] = [
  { href: '/check', label: 'Check your area' },
  {
    href: '/local',
    label: 'Browse',
    menu: [
      { href: '/local', label: 'By city' },
      { href: '/for', label: 'By trade' },
    ],
  },
  { href: '/pricing', label: 'Pricing' },
  {
    href: '/guides',
    label: 'Learn',
    menu: [
      { href: '/guides', label: 'Guides' },
      { href: '/faq', label: 'FAQ' },
      { href: '/data', label: 'Public records' },
      { href: '/about', label: 'About' },
    ],
  },
];

const linkCls =
  'inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-medium text-muted transition-colors duration-150 hover:bg-sand hover:text-ink';
/** The phone row sits on bg-sand, so its hover fill is the lighter surface color or it would not show. */
const rowLinkCls = linkCls.replace('hover:bg-sand', 'hover:bg-surface');
const menuCls =
  'invisible absolute left-0 top-full z-50 min-w-48 translate-y-1 rounded-card border border-line bg-surface p-2 opacity-0 shadow-lift transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100';
const menuLinkCls =
  'flex min-h-11 items-center rounded-control px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-sand';

function Chevron() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-1 opacity-70">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Marketing and public-page header. Static: never reads the session, so pages stay prerenderable.
 * Wide screens (lg and up) show four grouped items in the bar. Narrower screens get a second row under the bar that scrolls sideways,
 * so phone users reach every page with no menu to open, no client JavaScript and no layout shift.
 */
export function TopNav({ ctaHref = '/signup' }: { ctaHref?: string }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-5">
          <Logo />
          <div className="flex items-center gap-1">
            <nav aria-label="Main" className="hidden lg:block">
              <ul className="flex items-center">
                {desktop.map((item) => (
                  <li key={item.label} className={item.menu ? 'group relative' : undefined}>
                    <Link href={item.href} className={linkCls} aria-haspopup={item.menu ? 'true' : undefined}>
                      {item.label}
                      {item.menu ? <Chevron /> : null}
                    </Link>
                    {item.menu ? (
                      <ul className={menuCls}>
                        {item.menu.map((m) => (
                          <li key={m.href + m.label}>
                            <Link href={m.href} className={menuLinkCls}>
                              {m.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </nav>
            <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line lg:block" />
            <Link href="/request" className={linkCls.replace('inline-flex', 'hidden lg:inline-flex')}>
              Request a service
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-sand"
            >
              Log in
            </Link>
            <ButtonLink href={ctaHref} size="sm" className="shrink-0">
              Start free
            </ButtonLink>
          </div>
        </div>
      </header>
      <nav aria-label="Sections" className="relative border-b border-line bg-sand lg:hidden">
        {/* py-1.5 leaves room for the 2px focus ring plus its 2px offset above and below each 44px link, which overflow would clip. */}
        <ul className="nav-scroll mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto py-1.5 pl-3 pr-14 sm:pl-4">
          {links.map((l) => (
            <li key={l.href} className="shrink-0">
              <Link href={l.href} className={rowLinkCls}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        {/* Visible cue that the row scrolls: a fade with an arrow. The row keeps 3.5rem of padding after the last link, so the cue never covers it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end bg-gradient-to-l from-sand from-40% to-transparent pr-3 text-muted"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </nav>
    </>
  );
}
