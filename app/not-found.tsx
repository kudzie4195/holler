import type { Metadata } from 'next';
import { ButtonLink } from '@/components/button';
import { MainStreet } from '@/components/illustrations/main-street';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main" className="hero-paper flex w-full flex-1 flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-5 py-16">
        <MainStreet className="h-auto w-full max-w-xs" />
        <h1 className="mt-8 text-4xl text-ink">We can&apos;t find that page.</h1>
        <p className="mt-3 text-lg text-muted">The link may be old or mistyped. Here are two places to start.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/" size="lg">
            Go home
          </ButtonLink>
          <ButtonLink href="/local" variant="secondary" size="lg">
            Browse local activity
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
