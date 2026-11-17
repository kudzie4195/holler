import Link from 'next/link';
import { Logo } from './logo';

const links = [
  { href: '/check', label: 'Check your area' },
  { href: '/for', label: 'By trade' },
  { href: '/local', label: 'By city' },
  { href: '/about', label: 'About' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-2 text-sm text-muted">
            Local alerts for people with a truck, a van, or a ladder. Built on public data. We never post for you.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-2 gap-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="mx-auto w-full max-w-5xl px-5 pb-8 text-sm text-muted">
        Data comes from public sources and can be late or wrong. Check the source before you act.
      </div>
    </footer>
  );
}
