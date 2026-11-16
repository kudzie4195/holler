'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/app', label: 'Matches' },
  { href: '/app/settings', label: 'Settings' },
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
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium ${
              active ? 'bg-ink/5 text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
