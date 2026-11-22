import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCardSkeleton } from '@/components/auth-card';
import { ResetBody } from '@/components/auth-pages';
import { ES_PAIRS, pairLanguages } from '@/lib/i18n/seo';

export const metadata: Metadata = {
  title: 'Choose a new password',
  // hreflang pair with /es/reset (round 18 ES). No canonical is added: this page is noindex, as before.
  alternates: pairLanguages(ES_PAIRS[6]),
};

export default function ResetPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <ResetBody />
    </Suspense>
  );
}
