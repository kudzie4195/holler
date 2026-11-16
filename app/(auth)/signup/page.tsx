import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard, AuthCardSkeleton } from '@/components/auth-card';
import { SignupForm } from '@/components/auth-forms';
import { cleanCitySlug } from '@/lib/auth/redirect';
import { cityBySlug } from '@/lib/geo';

export const metadata: Metadata = {
  title: 'Start your free week',
  description: 'Create a Holler account. 7-day free trial, no card.',
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
      title="Start your free week"
      subtitle={
        city
          ? `Alerts for ${city.name}, ${city.state} and the towns around it. No card needed.`
          : 'Seven days, no card. Takes about a minute.'
      }
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-accent-text underline">
            Log in
          </Link>
          <br />
          By creating an account you agree to the{' '}
          <Link href="/terms" className="underline">Terms</Link> and{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </>
      }
    >
      <SignupForm city={city ? citySlug : null} />
    </AuthCard>
  );
}
