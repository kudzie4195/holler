import type { Metadata } from 'next';
import { SignupBody } from '@/components/auth-pages';
import { EsAuthPage, esAuthMetadata } from '@/components/es/auth-page';
import { ES_PAIRS } from '@/lib/i18n/seo';

const PAIR = ES_PAIRS[3];

export const metadata: Metadata = esAuthMetadata(PAIR, 'auth.meta.signup.title', 'auth.meta.signup.desc');

/** /es/signup: the Spanish twin of /signup. Same body and logic (components/auth-pages.tsx), in Spanish. */
export default function SignupPageEs(props: PageProps<'/es/signup'>) {
  return <EsAuthPage pair={PAIR}><SignupBody searchParams={props.searchParams} lang="es" /></EsAuthPage>;
}
