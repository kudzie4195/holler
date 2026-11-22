import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Logo } from '@/components/logo';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { FormSkeleton, OnboardingForm } from '@/components/onboarding-body';
import { t } from '@/lib/i18n';

const L = 'es' as const;

export const metadata: Metadata = {
  title: t(L, 'onb.meta.title'),
  description: t(L, 'onb.meta.desc'),
  robots: { index: false, follow: false },
};

/** /es/onboarding: the Spanish twin of /onboarding, where a sign-up from /es/signup lands. Same form and logic (components/onboarding-body.tsx). */
export default function OnboardingPageEs(props: PageProps<'/es/onboarding'>) {
  return (
    <>
      <header className="on-brand bg-brand">
        <div className={`${PAGE_BOX} flex h-16 items-center`}>
          <Logo href="/es" ariaLabel={t(L, 'nav.home')} />
        </div>
      </header>
      <main id="main" className={`${PAGE_BOX} flex-1 pb-16 pt-6 sm:pt-10 ${BODY_TEXT}`}>
        <div className="mx-auto max-w-2xl">
          <h1 className="break-words text-4xl text-ink">{t(L, 'onb.h1')}</h1>
          <p className="mt-3 text-lg text-muted">{t(L, 'onb.sub')}</p>
          <Suspense fallback={<FormSkeleton />}>
            <OnboardingForm searchParams={props.searchParams} lang={L} />
          </Suspense>
        </div>
      </main>
    </>
  );
}
