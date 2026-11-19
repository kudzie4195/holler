import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/logo';
import { Card } from '@/components/card';
import { ProfileForm } from '@/components/profile-form';
import { getProfile, requireUser } from '@/lib/auth/session';
import { cleanCitySlug } from '@/lib/auth/redirect';
import { CATEGORIES } from '@/lib/signals/categories';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { cityBySlug } from '@/lib/geo';
import { completeOnboarding } from './actions';

export const metadata: Metadata = {
  title: 'Set up your alerts',
  robots: { index: false, follow: false },
};

export default function OnboardingPage(props: PageProps<'/onboarding'>) {
  return (
    <>
      <header className="on-brand bg-brand">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center px-5">
          <Logo />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-5 pb-16 pt-6 sm:pt-10">
        <h1 className="text-4xl text-ink">Tell us what you do and where.</h1>
        <p className="mt-3 text-lg text-muted">Three quick things. You can change them any time in Settings.</p>
        <Suspense fallback={<FormSkeleton />}>
          <Onboarding searchParams={props.searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function Onboarding({ searchParams }: { searchParams: PageProps<'/onboarding'>['searchParams'] }) {
  const user = await requireUser('/onboarding');
  // Already set up: editing lives in Settings.
  if (await getProfile(user.id)) redirect('/app');

  const sp = await searchParams;
  const slug = cleanCitySlug(typeof sp.city === 'string' ? sp.city : null);
  const city = slug ? cityBySlug(slug) : null;
  // F-19: lib/geo only maps ZIP to place (lookupZip), never city to ZIP, and a city has many ZIPs. So the city only changes
  // the hint text and the ZIP field stays empty. Never guess a ZIP.

  return (
    <Card className="mt-8">
      <ProfileForm
        action={completeOnboarding}
        categories={CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: (c as unknown as { group?: string }).group, comingSoon: tradeComingSoon(c.id) }))}
        defaults={{ business_name: '', categories: [], zip: '', radius: 25, alert_email: true }}
        submitLabel="Start my free trial"
        // The free trial uses Solo (`starter`) limits; the Pro fields show locked with a link to the plans.
        tier="starter"
        upgradeHref="/pricing"
        zipHint={
          city
            ? `You came from the ${city.name}, ${city.state} page. Enter the ZIP you work out of.`
            : 'The center of where you work.'
        }
      />
    </Card>
  );
}

function FormSkeleton() {
  return (
    <div aria-hidden="true" className="mt-8 rounded-card border border-line bg-surface p-6">
      <div className="skeleton h-11 w-full" />
      <div className="mt-7 flex flex-wrap gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton h-11 w-24 !rounded-control" />
        ))}
      </div>
      <div className="skeleton mt-7 h-11 w-full" />
    </div>
  );
}
