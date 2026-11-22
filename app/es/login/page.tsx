import type { Metadata } from 'next';
import { LoginBody } from '@/components/auth-pages';
import { EsAuthPage, esAuthMetadata } from '@/components/es/auth-page';
import { ES_PAIRS } from '@/lib/i18n/seo';

const PAIR = ES_PAIRS[4];

export const metadata: Metadata = esAuthMetadata(PAIR, 'auth.meta.login.title', 'auth.meta.login.desc');

/** /es/login: the Spanish twin of /login. Same body and logic (components/auth-pages.tsx), in Spanish. */
export default function LoginPageEs(props: PageProps<'/es/login'>) {
  return <EsAuthPage pair={PAIR}><LoginBody searchParams={props.searchParams} lang="es" /></EsAuthPage>;
}
