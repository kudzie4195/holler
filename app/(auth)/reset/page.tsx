import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, AuthCardSkeleton } from '@/components/auth-card';
import { ResetForm } from '@/components/auth-forms';
import { ButtonLink } from '@/components/button';
import { getUser } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Choose a new password',
};

export default function ResetPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Reset />
    </Suspense>
  );
}

async function Reset() {
  // /auth/confirm (type=recovery) signs the user in; without that session there is nothing to reset.
  const user = await getUser();
  if (!user) {
    return (
      <AuthCard title="That link has expired" subtitle="Reset links work once and don't last long. Ask for a fresh one.">
        <ButtonLink href="/forgot" full size="lg">
          Get a new link
        </ButtonLink>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="Use at least 8 characters.">
      <ResetForm />
    </AuthCard>
  );
}
