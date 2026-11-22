'use client';

import { usePathname } from 'next/navigation';
import { esPair } from '@/lib/i18n/seo';

/**
 * In the footer of the English sign-up, log-in and password pages: "Español", to the Spanish twin of the page the visitor is on
 * (lib/i18n/seo.ts ES_PAIRS). Renders nothing on a page that has no Spanish twin. A client component so the auth layout stays static.
 */
export function AuthLanguageLink() {
  const pathname = usePathname();
  const pair = pathname ? esPair(pathname) : null;
  if (!pair || pair.en !== pathname) return null;
  return (
    <a href={pair.es} lang="es" hrefLang="es" className="inline-flex min-h-11 min-w-11 items-center underline decoration-1 underline-offset-4 hover:text-ink">
      Español
    </a>
  );
}
