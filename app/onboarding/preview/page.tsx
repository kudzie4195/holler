import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
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
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center px-5">
        <Logo />
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-5 pb-16 pt-6 sm:pt-10">
        <h1 className="text-4xl text-ink">You are set up.</h1>
        <p className="mt-3 text-lg text-muted">Here is what Holler watches in your area and trades.</p>
        <Suspense fallback={<div aria-hidden="true" className="skeleton mt-8 h-40 w-full" />}>
          <Preview />
        </Suspense>
        <Link
          href="/app"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-6 text-base font-semibold text-white"
        >
          Continue to my feed
        </Link>
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
