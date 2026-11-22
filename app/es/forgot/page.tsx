import type { Metadata } from 'next';
import { ForgotBody } from '@/components/auth-pages';
import { EsAuthPage, esAuthMetadata } from '@/components/es/auth-page';
import { ES_PAIRS } from '@/lib/i18n/seo';

const PAIR = ES_PAIRS[5];

export const metadata: Metadata = esAuthMetadata(PAIR, 'auth.meta.forgot.title', 'auth.meta.forgot.desc');

/** /es/forgot: the Spanish twin of /forgot. Same body and logic (components/auth-pages.tsx), in Spanish. */
export default function ForgotPageEs(props: PageProps<'/es/forgot'>) {
  return <EsAuthPage pair={PAIR}><ForgotBody searchParams={props.searchParams} lang="es" /></EsAuthPage>;
}
