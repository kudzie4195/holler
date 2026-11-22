'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSpanishHint } from './hint-text';

const links = [
  { href: '/app', label: 'Matches' },
  { href: '/app/settings', label: 'Settings' },
];

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
            className={`inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium min-[400px]:px-3 ${
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
