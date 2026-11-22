'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t, type Lang } from '@/lib/i18n';
import { useSpanishHint } from './hint-text';

// Lists (round 18, unit LISTS) shows from 375 px up, so the logo, the links and Sign out fit in one row at 320 px in both languages; the
// /app page links to it at every width. Measured for Spanish (round 18 ES redo 1, logs/ES2-header-below375.log): with "Listas" the bar
// fits from 360 px and overflows at 320 and 340, so 375 px is the safe breakpoint.
const links = [
  { href: '/app', label: 'Matches', wide: false },
  { href: '/app/lists', label: t('en', 'app.nav.lists'), wide: true },
  { href: '/app/settings', label: 'Settings', wide: false },
];

/** The English word of a link (its static label), or the dictionary word in `lang` for the Lists link. */
export function appNavLabel(href: string, lang: Lang = 'en'): string {
  if (href === '/app/lists') return t(lang, 'app.nav.lists');
  return links.find((x) => x.href === href)?.label ?? href;
}

/**
 * The app links. `labels` (round 18 ES) gives their words in the member's language, keyed by href (so a link added later cannot take
 * another link's word); a link with no entry keeps its English word. `hints`: the Spanish words of the static fallback, shown at once on
 * a client navigation when the browser's hint cookie says Spanish (components/hint-text.tsx) and by the inline script on a full load.
 */
export function AppNavLinks({ labels, hints }: { labels?: Readonly<Record<string, string>>; hints?: Readonly<Record<string, string>> } = {}) {
  const pathname = usePathname();
  const spanishHint = useSpanishHint();
  return (
    <>
      {links.map((l) => {
        const active = l.href === '/app' ? pathname === '/app' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            {...(hints?.[l.href] ? { 'data-es': hints[l.href], suppressHydrationWarning: true } : {})}
            className={`${l.wide ? 'hidden min-[375px]:inline-flex' : 'inline-flex'} min-h-11 items-center rounded-control px-2 text-sm font-medium min-[400px]:px-3 ${
              active ? 'bg-sand text-ink underline decoration-2 underline-offset-[6px]' : 'text-muted hover:bg-sand hover:text-ink'
            }`}
          >
            {(hints && spanishHint ? hints[l.href] : labels?.[l.href]) ?? l.label}
          </Link>
        );
      })}
    </>
  );
}
