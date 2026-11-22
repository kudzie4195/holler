'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t, type Lang } from '@/lib/i18n';

// Lists (round 18, unit LISTS) shows from 375 px up (checked at 360, 375 and 390 px), so the logo, two links and Sign out still fit in one row
// at 320 px; the /app page links to it at every width. Its word comes from lib/i18n ('app.nav.lists': "Lists" / "Listas", round 18
// integration); Matches and Settings are still English here until the Spanish app shell (round 18 ES) gives every link its word.
const links = [
  { href: '/app', label: 'Matches', wide: false },
  { href: '/app/lists', label: null, wide: true },
  { href: '/app/settings', label: 'Settings', wide: false },
];

/** The words of the links in `lang`, keyed by href. Only the Lists link has a dictionary word so far. */
export function appNavLabel(href: string, lang: Lang = 'en'): string {
  const l = links.find((x) => x.href === href);
  return l?.label ?? t(lang, 'app.nav.lists');
}

export function AppNavLinks({ lang = 'en' }: { lang?: Lang } = {}) {
  const pathname = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = l.href === '/app' ? pathname === '/app' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`${l.wide ? 'hidden min-[375px]:inline-flex' : 'inline-flex'} min-h-11 items-center rounded-control px-2 text-sm font-medium min-[400px]:px-3 ${
              active ? 'bg-sand text-ink underline decoration-2 underline-offset-[6px]' : 'text-muted hover:bg-sand hover:text-ink'
            }`}
          >
            {appNavLabel(l.href, lang)}
          </Link>
        );
      })}
    </>
  );
}
