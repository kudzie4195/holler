import type { Metadata } from 'next';
import { ConfirmBody } from '@/components/auth-pages';
import { AuthCardSkeleton } from '@/components/auth-card';
import { AuthShell } from '@/components/auth-shell';
import { Suspense } from 'react';
import { t } from '@/lib/i18n';

/**
 * /es/confirm: the Spanish twin of /auth/confirm/continue, for a link from a Spanish email (its next is an /es page). A token page:
 * noindex, not in the sitemap, Referrer-Policy no-referrer (lib/security-headers.ts TOKEN_PAGE_PATHS).
 */
export const metadata: Metadata = {
  title: t('es', 'auth.forgot.h'),
  description: t('es', 'auth.meta.confirm.desc'),
  robots: { index: false, follow: false },
};

export default function ConfirmPageEs(props: PageProps<'/es/confirm'>) {
  return (
    <AuthShell lang="es">
      <Suspense fallback={<AuthCardSkeleton />}>
        <ConfirmBody searchParams={props.searchParams} lang="es" />
      </Suspense>
    </AuthShell>
  );
}
