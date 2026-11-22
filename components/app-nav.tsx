'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Lists (round 18, unit LISTS) shows from 375 px up (checked at 360, 375 and 390 px), so the logo, two links and Sign out still fit in one row
// at 320 px; the /app page links to it at every width. The nav labels are English-only today, as Matches and Settings are.
const links = [
  { href: '/app', label: 'Matches', wide: false },
  { href: '/app/lists', label: 'Lists', wide: true },
  { href: '/app/settings', label: 'Settings', wide: false },
];

export function AppNavLinks() {
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
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
