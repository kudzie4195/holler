import type { Metadata } from 'next';
import { ButtonLink } from '@/components/button';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
      <h1 className="text-4xl text-ink">We can&apos;t find that page.</h1>
      <p className="mt-3 text-lg text-muted">The link may be old or mistyped. Here are two places to start.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/" size="lg">
          Go home
        </ButtonLink>
        <ButtonLink href="/local" variant="secondary" size="lg">
          Browse local activity
        </ButtonLink>
      </div>
    </main>
  );
}
