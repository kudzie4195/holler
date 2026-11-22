import type { Metadata } from 'next';
import { LangSync } from '@/components/es/lang-sync';

/**
 * Spanish public pages (/es and /es/check). The root layout (app/layout.tsx) is shared with the English site and writes
 * <html lang="en">, so these pages carry their language three ways: this wrapper's lang="es" (in the server HTML), LangSync (sets
 * document.documentElement.lang in the browser), and the Content-Language header (next.config.ts). Titles use the root template.
 */
export const metadata: Metadata = {
  openGraph: { locale: 'es_US', siteName: 'Holler', type: 'website' },
};

export default function EsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="es" className="flex min-h-screen flex-col">
      <LangSync lang="es" />
      {children}
    </div>
  );
}
