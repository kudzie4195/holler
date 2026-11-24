import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCardSkeleton } from '@/components/auth-card';
import { SignupBody, signupWaitMeta, signupWaitShare } from '@/components/auth-pages';
import { ES_PAIRS, pairLanguages } from '@/lib/i18n/seo';
import { TRIAL_PHRASE } from '@/lib/plan/price-copy';

export async function generateMetadata(props: PageProps<'/signup'>): Promise<Metadata> {
  // Round 24 FIX2 (review D2): a sign-up link from a waitlist city carries no trial pitch, in the title and description too.
  const wait = signupWaitMeta((await props.searchParams).city, 'en');
  return {
    title: wait?.title ?? 'Start your free trial',
    description: wait?.description ?? `Create a Holler account. ${TRIAL_PHRASE}, no card.`,
    // hreflang pair with /es/signup (round 18 ES). No canonical is added: this page is noindex, as before.
    alternates: pairLanguages(ES_PAIRS[3]),
    // Round 24 FIX3 (review-FIX2 F5): the share preview of a waitlist city carries the waitlist words, not the layout's price line.
    ...(wait ? signupWaitShare(wait, '/signup') : {}),
  };
}

export default function SignupPage(props: PageProps<'/signup'>) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SignupBody searchParams={props.searchParams} />
    </Suspense>
  );
}
