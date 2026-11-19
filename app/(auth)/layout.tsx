import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/logo';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Green top bar, as the site nav: the HOLLER wordmark takes on-brand from .on-brand (11.3:1), focus ring signal. */}
      <header className="on-brand bg-brand">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center px-5">
          <Logo />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-16 pt-6 sm:pt-12">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-md px-5 pb-8 text-center text-sm text-muted">
        <Link href="/privacy" className="inline-flex min-h-11 items-center px-2 underline decoration-1 underline-offset-4 hover:text-ink">
          Privacy
        </Link>
        <Link href="/terms" className="inline-flex min-h-11 items-center px-2 underline decoration-1 underline-offset-4 hover:text-ink">
          Terms
        </Link>
      </footer>
    </>
  );
}
