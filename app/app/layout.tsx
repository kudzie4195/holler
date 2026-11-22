import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PAGE_BOX } from '@/components/grid';
import { AppHeaderBar, AppSkipLink, MemberHeaderBar, MemberSkipLink } from '@/components/app-header';

export const metadata: Metadata = {
  title: { default: 'Your matches', template: '%s | Holler' },
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* The skip link and the header bar are in the member's language (round 18 ES). The English ones are the static fallback, so the
          layout stays static; the member's version streams in behind each boundary (components/app-header.tsx). */}
      <Suspense fallback={<AppSkipLink lang="en" />}>
        <MemberSkipLink />
      </Suspense>
      <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
        <div className={`${PAGE_BOX} flex h-16 items-center justify-between gap-2`}>
          <Suspense fallback={<AppHeaderBar lang="en" />}>
            <MemberHeaderBar />
          </Suspense>
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
