import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { AuthLanguageLink } from '@/components/auth-language-link';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The English sign-up, log-in and password pages (noindex). The frame is components/auth-shell.tsx, shared with the Spanish pages under
 * /es; the footer links to the Spanish twin of the page when there is one (round 18 ES).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell languageLink={<AuthLanguageLink />}>{children}</AuthShell>;
}
