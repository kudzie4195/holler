import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCardSkeleton } from '@/components/auth-card';
import { LoginBody } from '@/components/auth-pages';
import { ES_PAIRS, pairLanguages } from '@/lib/i18n/seo';

export const metadata: Metadata = {
  title: 'Log in',
  // hreflang pair with /es/login (round 18 ES). No canonical is added: this page is noindex, as before.
  alternates: pairLanguages(ES_PAIRS[4]),
};

export default function LoginPage(props: PageProps<'/login'>) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <LoginBody searchParams={props.searchParams} />
    </Suspense>
  );
}
