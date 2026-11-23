import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Logo } from '@/components/logo';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { FormSkeleton, OnboardingForm } from '@/components/onboarding-body';

export const metadata: Metadata = {
  title: 'Set up your alerts',
  robots: { index: false, follow: false },
};

export default function OnboardingPage(props: PageProps<'/onboarding'>) {
  return (
    <>
      <header className="on-brand bg-brand">
        <div className={`${PAGE_BOX} flex h-16 items-center`}>
          <Logo />
        </div>
      </header>
      <main id="main" className={`${PAGE_BOX} flex-1 pb-16 pt-6 sm:pt-10 ${BODY_TEXT}`}>
        {/* Centred column, like the auth pages (the one exception to the page grid); the logo stays on the grid edge. */}
        <div className="mx-auto max-w-2xl">
        <h1 className="break-words text-4xl text-ink">Tell us what you do and where.</h1>
        <p className="mt-3 text-lg text-muted">Three quick things. You can change them any time in Settings.</p>
        <Suspense fallback={<FormSkeleton />}>
          <OnboardingForm searchParams={props.searchParams} />
        </Suspense>
        </div>
      </main>
    </>
  );
}
