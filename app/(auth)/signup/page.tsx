import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard, AuthCardSkeleton } from '@/components/auth-card';
import { SignupForm } from '@/components/auth-forms';
import { cleanCitySlug } from '@/lib/auth/redirect';
import { cityBySlug } from '@/lib/geo';
import { TRIAL_DAYS, TRIAL_PHRASE } from '@/lib/plan/price-copy';

export const metadata: Metadata = {
  title: 'Start your free trial',
  description: `Create a Holler account. ${TRIAL_PHRASE}, no card.`,
};

export default function SignupPage(props: PageProps<'/signup'>) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Signup searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Signup({ searchParams }: { searchParams: PageProps<'/signup'>['searchParams'] }) {
  const sp = await searchParams;
  const citySlug = cleanCitySlug(typeof sp.city === 'string' ? sp.city : null);
  const city = citySlug ? cityBySlug(citySlug) : null;
  return (
    <AuthCard
      title="Start your free trial"
      subtitle={
        city
          ? `Alerts for ${city.name}, ${city.state} and the towns around it. No card needed.`
          : `${TRIAL_DAYS} days, no card. Takes about a minute.`
      }
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
            Log in
          </Link>
        </>
      }
    >
      <SignupForm city={city ? citySlug : null} />
    </AuthCard>
  );
}
