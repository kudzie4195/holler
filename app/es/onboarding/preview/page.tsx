import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/button';
import { Logo } from '@/components/logo';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { RecentActivity } from '@/components/feed/recent-activity';
import { getProfile, getUser } from '@/lib/auth/session';
import { t } from '@/lib/i18n';

const L = 'es' as const;

export const metadata: Metadata = {
  title: t(L, 'onb.preview.title'),
  description: t(L, 'onb.preview.desc'),
  robots: { index: false, follow: false },
};

/** /es/onboarding/preview: the Spanish twin of /onboarding/preview. The recent block reads the member's language from the profile. */
export default function OnboardingPreviewPageEs() {
  return (
    <>
      <header className="on-brand bg-brand">
        <div className={`${PAGE_BOX} flex h-16 items-center`}>
          <Logo href="/es" ariaLabel={t(L, 'nav.home')} />
        </div>
      </header>
      <main id="main" className={`${PAGE_BOX} flex-1 pb-16 pt-6 sm:pt-10 ${BODY_TEXT}`}>
        <div className="mx-auto max-w-2xl">
          <h1 className="break-words text-4xl text-ink">{t(L, 'onb.preview.h1')}</h1>
          <p className="mt-3 text-lg text-muted">{t(L, 'onb.preview.sub')}</p>
          <Suspense fallback={<div aria-hidden="true" className="skeleton mt-8 h-40 w-full" />}>
            <Preview />
          </Suspense>
          <ButtonLink href="/app" size="lg" className="mt-8">
            {t(L, 'onb.preview.cta')}
          </ButtonLink>
        </div>
      </main>
    </>
  );
}

async function Preview() {
  const user = await getUser();
  if (!user) redirect(`/es/login?next=${encodeURIComponent('/es/onboarding/preview')}`);
  // No profile yet: the setup form comes first.
  if (!(await getProfile(user.id))) redirect('/es/onboarding');
  return (
    <div className="mt-8">
      <RecentActivity userId={user.id} />
    </div>
  );
}
