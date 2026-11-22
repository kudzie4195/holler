'use client';

import { useEffect } from 'react';

/**
 * The root layout is shared by the whole site and writes <html lang="en">. On the Spanish pages this sets the document language to
 * Spanish once the page is running, and puts it back when the visitor leaves (client-side navigation keeps the same <html>). The
 * server-rendered HTML still says lang="en" on <html>; the page's own wrapper element carries lang="es" for it (app/es/layout.tsx).
 */
export function LangSync({ lang }: { lang: 'es' | 'en' }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = lang;
    return () => {
      root.lang = before || 'en';
    };
  }, [lang]);
  return null;
}
