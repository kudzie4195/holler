import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCardSkeleton } from '@/components/auth-card';
import { SignupBody } from '@/components/auth-pages';
import { ES_PAIRS, pairLanguages } from '@/lib/i18n/seo';
import { TRIAL_PHRASE } from '@/lib/plan/price-copy';

export const metadata: Metadata = {
  title: 'Start your free trial',
  description: `Create a Holler account. ${TRIAL_PHRASE}, no card.`,
  // hreflang pair with /es/signup (round 18 ES). No canonical is added: this page is noindex, as before.
  alternates: pairLanguages(ES_PAIRS[3]),
};

export default function SignupPage(props: PageProps<'/signup'>) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SignupBody searchParams={props.searchParams} />
    </Suspense>
  );
}
