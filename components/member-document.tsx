'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * For a Spanish member in /app (round 18 ES, review P2-2 and P2-3): sets <html lang> and the tab title in the member's language after
 * hydration and on every client navigation. The first paint is already right: the inline script in the static header (APP_LANG_SCRIPT,
 * components/app-header.tsx) does the same from the language hint cookie. The page metadata itself stays static English in the <head>,
 * exactly as before, so nothing streams in the body and noindex is in the first bytes. Rendered only for a Spanish member.
 */
export function MemberDocument({ lang, titles }: { lang: string; titles: Record<string, string> }) {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = lang;
    const title = titles[pathname];
    if (title) document.title = title;
    return () => {
      root.lang = before && before !== lang ? before : 'en';
    };
  }, [lang, pathname, titles]);
  return null;
}
