import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard, AuthCardSkeleton } from '@/components/auth-card';
import { LoginForm } from '@/components/auth-forms';
import { safeNext } from '@/lib/auth/redirect';

export const metadata: Metadata = {
  title: 'Log in',
};

export default function LoginPage(props: PageProps<'/login'>) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Login searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Login({ searchParams }: { searchParams: PageProps<'/login'>['searchParams'] }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null, '/app');
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to see what's nearby."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="inline-flex min-h-11 min-w-11 items-center font-semibold text-brand-text underline">
            Start your free trial
          </Link>
        </>
      }
    >
      <LoginForm next={next} linkExpired={sp.error === 'link'} />
    </AuthCard>
  );
}
