import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCardSkeleton } from '@/components/auth-card';
import { ForgotBody } from '@/components/auth-pages';
import { ES_PAIRS, pairLanguages } from '@/lib/i18n/seo';

export const metadata: Metadata = {
  title: 'Reset your password',
  // hreflang pair with /es/forgot (round 18 ES). No canonical is added: this page is noindex, as before.
  alternates: pairLanguages(ES_PAIRS[5]),
};

export default function ForgotPage(props: PageProps<'/forgot'>) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <ForgotBody searchParams={props.searchParams} />
    </Suspense>
  );
}
