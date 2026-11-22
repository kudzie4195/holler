import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCardSkeleton } from '@/components/auth-card';
import { ConfirmBody } from '@/components/auth-pages';

export const metadata: Metadata = {
  title: 'Reset your password',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Step one of the two-step link (components/auth-pages.tsx ConfirmBody): nothing is verified here. The button POSTs the token to
 * /auth/confirm, so email link scanners that only GET the link cannot use up the single-use token.
 */
export default function ConfirmContinuePage({ searchParams }: Props) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <ConfirmBody searchParams={searchParams} />
    </Suspense>
  );
}
