import type { Metadata } from 'next';
import { SignupBody, signupWaitMeta } from '@/components/auth-pages';
import { EsAuthPage, esAuthMetadata } from '@/components/es/auth-page';
import { ES_PAIRS } from '@/lib/i18n/seo';

const PAIR = ES_PAIRS[3];

export async function generateMetadata(props: PageProps<'/es/signup'>): Promise<Metadata> {
  const base = esAuthMetadata(PAIR, 'auth.meta.signup.title', 'auth.meta.signup.desc');
  // Round 24 FIX2 (review D2): no trial pitch for a waitlist city, in the title and description too. Canonical, hreflang and robots as before.
  const wait = signupWaitMeta((await props.searchParams).city, 'es');
  if (!wait) return base;
  return { ...base, title: { absolute: wait.title }, description: wait.description, openGraph: { ...base.openGraph, title: wait.title, description: wait.description } };
}

/** /es/signup: the Spanish twin of /signup. Same body and logic (components/auth-pages.tsx), in Spanish. */
export default function SignupPageEs(props: PageProps<'/es/signup'>) {
  return <EsAuthPage pair={PAIR}><SignupBody searchParams={props.searchParams} lang="es" /></EsAuthPage>;
}
