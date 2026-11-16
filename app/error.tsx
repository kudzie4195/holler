'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[holler] render error', error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
      <h1 className="text-4xl text-ink">Something went wrong on our side.</h1>
      <p className="mt-3 text-lg text-muted">
        Your account and data are fine. Try again, and if it keeps happening, check back in a few minutes.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={() => reset()} size="lg">
          Try again
        </Button>
        <ButtonLink href="/" variant="secondary" size="lg">
          Go home
        </ButtonLink>
      </div>
    </main>
  );
}
