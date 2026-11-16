import Link from 'next/link';
import { Logo } from './logo';
import { ButtonLink } from './button';

/** Marketing and public-page header. Static: never reads the session, so pages stay prerenderable. */
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
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-5">
          <Logo />
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/local"
              className="hidden min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted hover:text-ink md:inline-flex"
            >
              City pages
            </Link>
            <Link
              href="/about"
              className="hidden min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted hover:text-ink md:inline-flex"
            >
              About
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink hover:bg-ink/5"
            >
              Log in
            </Link>
            <ButtonLink href={ctaHref} size="sm">
              Start free
            </ButtonLink>
          </nav>
        </div>
      </header>
    </>
  );
}
