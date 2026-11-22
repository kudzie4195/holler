'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/app', label: 'Matches' },
  { href: '/app/settings', label: 'Settings' },
];

/**
 * The two app links. `labels` (round 18 ES) gives their words in the member's language, in the order of `links`; without it they are
 * the English words they always were.
 */
export function AppNavLinks({ labels, hints }: { labels?: readonly [string, string]; /** Spanish words for the static fallback's inline script (data-es). */ hints?: readonly [string, string] } = {}) {
  const pathname = usePathname();
  return (
    <>
      {links.map((l, i) => {
        const active = l.href === '/app' ? pathname === '/app' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            {...(hints ? { 'data-es': hints[i], suppressHydrationWarning: true } : {})}
            className={`inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium min-[400px]:px-3 ${
              active ? 'bg-sand text-ink underline decoration-2 underline-offset-[6px]' : 'text-muted hover:bg-sand hover:text-ink'
            }`}
          >
            {labels?.[i] ?? l.label}
          </Link>
        );
      })}
    </>
  );
}
