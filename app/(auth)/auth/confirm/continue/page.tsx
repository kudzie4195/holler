import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, AuthCardSkeleton } from '@/components/auth-card';
import { Button, ButtonLink } from '@/components/button';
import { isConfirmType } from '@/lib/auth/otp';
import { safeNext } from '@/lib/auth/redirect';

export const metadata: Metadata = {
  title: 'Reset your password',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function ConfirmContinuePage({ searchParams }: Props) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Continue searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Step one of the two-step link: nothing is verified here. The button POSTs the token to /auth/confirm,
 * so email link scanners that only GET the link cannot use up the single-use token.
 */
async function Continue({ searchParams }: Props) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' ? v : undefined;
  };
  const tokenHash = one('token_hash');
  const type = one('type');
  const next = safeNext(one('next'), '/app');

  if (!tokenHash || !isConfirmType(type)) {
    return (
      <AuthCard title="That link isn't valid" subtitle="Reset links work once and don't last long. Ask for a fresh one.">
        <ButtonLink href="/forgot" full size="lg">
          Get a new link
        </ButtonLink>
      </AuthCard>
    );
  }

  const recovery = type === 'recovery';
  return (
    <AuthCard
      title={recovery ? 'Reset your password' : 'Confirm to continue'}
      subtitle={recovery ? 'Press the button to choose a new password.' : 'Press the button to finish signing in.'}
    >
      <form method="POST" action="/auth/confirm">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <Button type="submit" full size="lg">
          {recovery ? 'Reset your password' : 'Continue'}
        </Button>
      </form>
    </AuthCard>
  );
}
