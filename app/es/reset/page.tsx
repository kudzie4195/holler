import type { Metadata } from 'next';
import { ResetBody } from '@/components/auth-pages';
import { EsAuthPage, esAuthMetadata } from '@/components/es/auth-page';
import { ES_PAIRS } from '@/lib/i18n/seo';

const PAIR = ES_PAIRS[6];

export const metadata: Metadata = esAuthMetadata(PAIR, 'auth.meta.reset.title', 'auth.meta.reset.desc');

/** /es/reset: the Spanish twin of /reset. Same body and logic (components/auth-pages.tsx), in Spanish. */
export default function ResetPageEs() {
  return <EsAuthPage pair={PAIR}><ResetBody lang="es" /></EsAuthPage>;
}
