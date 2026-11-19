import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ButtonLink } from '@/components/button';
import { Logo } from '@/components/logo';
import { PAGE_BOX } from '@/components/grid';
import { RecentActivity } from '@/components/feed/recent-activity';
import { getProfile, requireUser } from '@/lib/auth/session';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'What Holler watches near you',
  robots: { index: false, follow: false },
};

export default function OnboardingPreviewPage() {
  return (
    <>
      <header className="on-brand bg-brand">
        <div className={`${PAGE_BOX} flex h-16 items-center`}>
          <Logo />
        </div>
      </header>
      <main id="main" className={`${PAGE_BOX} flex-1 pb-16 pt-6 sm:pt-10`}>
        <div className="max-w-2xl">
        <h1 className="text-4xl text-ink">You are set up.</h1>
        <p className="mt-3 text-lg text-muted">Here is what Holler watches in your area and trades.</p>
        <Suspense fallback={<div aria-hidden="true" className="skeleton mt-8 h-40 w-full" />}>
          <Preview />
        </Suspense>
        <ButtonLink href="/app" size="lg" className="mt-8">
          Continue to my feed
        </ButtonLink>
        </div>
      </main>
    </>
  );
}

async function Preview() {
  const user = await requireUser('/onboarding/preview');
  // No profile yet: the setup form comes first.
  if (!(await getProfile(user.id))) redirect('/onboarding');
  return (
    <div className="mt-8">
      <RecentActivity userId={user.id} />
    </div>
  );
}
