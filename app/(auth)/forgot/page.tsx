import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard, AuthCardSkeleton } from '@/components/auth-card';
import { ForgotForm } from '@/components/auth-forms';

export const metadata: Metadata = {
  title: 'Reset your password',
};

export default function ForgotPage(props: PageProps<'/forgot'>) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Forgot searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Forgot({ searchParams }: { searchParams: PageProps<'/forgot'>['searchParams'] }) {
  const sp = await searchParams;
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link."
      footer={
        <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center font-semibold text-brand-text underline">
          Back to log in
        </Link>
      }
    >
      <ForgotForm linkExpired={sp.error === 'link'} />
    </AuthCard>
  );
}
