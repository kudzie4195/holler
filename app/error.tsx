'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/button';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[holler] render error', error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className={`on-brand flex w-full flex-1 flex-col justify-center bg-brand ${BODY_TEXT}`}>
      <div className={`${PAGE_BOX} py-16 md:py-24`}>
        <h1 className="max-w-[18ch] break-words text-5xl sm:text-6xl">Something went wrong on our side.</h1>
        <p className="mt-4 max-w-xl text-lg text-on-brand-muted">
          Your account and data are fine. Try again, and if it keeps happening, check back in a few minutes.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={() => reset()} variant="signal" size="lg">
            Try again
          </Button>
          <ButtonLink href="/" variant="outline-signal" size="lg">
            Go home
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
