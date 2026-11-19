import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Green top bar, as the site nav: the HOLLER wordmark takes on-brand from .on-brand (11.3:1), focus ring signal. */}
      <header className="on-brand bg-brand">
        <div className={`${PAGE_BOX} flex h-16 items-center`}>
          <Logo />
        </div>
      </header>
      {/*
        The one centred exception to the page grid (commander decision after round 9 review): title, lead, form card and the line
        under it sit in one centred column the width of the card, text left-aligned inside it. The logo above stays on the grid edge.
      */}
      <main id="main" className={`${PAGE_BOX} flex flex-1 flex-col pb-16 pt-6 sm:pt-12 ${BODY_TEXT}`}>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</div>
      </main>
      <footer className={`${PAGE_BOX} flex justify-center gap-4 pb-8 text-sm text-muted`}>
        <Link href="/privacy" className="inline-flex min-h-11 min-w-11 items-center underline decoration-1 underline-offset-4 hover:text-ink">
          Privacy
        </Link>
        <Link href="/terms" className="inline-flex min-h-11 min-w-11 items-center underline decoration-1 underline-offset-4 hover:text-ink">
          Terms
        </Link>
      </footer>
    </>
  );
}
