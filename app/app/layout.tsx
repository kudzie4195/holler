import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Logo } from '@/components/logo';
import { PAGE_BOX } from '@/components/grid';
import { Button } from '@/components/button';
import { AppNavLinks } from '@/components/app-nav';

export const metadata: Metadata = {
  title: { default: 'Your matches', template: '%s | Holler' },
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-signal focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
        <div className={`${PAGE_BOX} flex h-16 items-center justify-between gap-2`}>
          {/* Under 480 px the wordmark hides (the link keeps its "Holler home" name) so the logo, two links and Sign out fit in one row at 320 px. */}
          <Logo href="/app" className="max-[479px]:[&>span]:hidden" />
          <nav aria-label="App" className="flex items-center gap-0.5 sm:gap-1">
            <AppNavLinks />
            <form action="/api/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="sm" className="text-muted max-[399px]:px-2.5">
                Sign out
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main id="main" className={`${PAGE_BOX} flex-1 pb-20 pt-8`}>
        {/* Everything below reads the session, so it streams in behind this boundary. The column starts under the logo. */}
        <div className="max-w-3xl">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </div>
      </main>
    </>
  );
}

function PageSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton h-9 w-2/3" />
      <div className="skeleton mt-3 h-5 w-1/2" />
      <div className="mt-8 flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface p-5">
            <div className="skeleton h-5 w-1/3" />
            <div className="skeleton mt-4 h-6 w-4/5" />
            <div className="skeleton mt-3 h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
