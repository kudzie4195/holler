'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

type Titles = Record<string, string>;
const hintSaysSpanish = () => /(?:^|;\s*)holler_lang=es(?:;|$)/.test(document.cookie);

/**
 * Keeps the document in step with the member's SAVED language (the profile), after hydration and on every client navigation:
 * <html lang>, the tab title, and the holler_lang hint cookie itself. The hint is only a guess for the first paint
 * (components/app-header.tsx APP_LANG_SCRIPT); when it disagrees with the profile this rewrites it, so a wrong hint lasts one page load.
 * Rendered for every Spanish member, and for an English member only when the request's hint wrongly said Spanish.
 */
export function MemberDocument({ lang, es, en }: { lang: 'en' | 'es'; es: Titles; en: Titles }) {
  const pathname = usePathname();
  useEffect(() => {
    if ((lang === 'es') !== hintSaysSpanish()) document.cookie = `holler_lang=${lang}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;
    const root = document.documentElement;
    root.lang = lang;
    const title = (lang === 'es' ? es : en)[pathname];
    if (title && document.title !== title) document.title = title;
    return () => {
      // the member left /app or switched to English in Settings: back to the static English document
      root.lang = 'en';
      if (en[pathname] && document.title === es[pathname]) document.title = en[pathname];
    };
  }, [lang, pathname, es, en]);
  return null;
}
