import Link from 'next/link';
import { COMPANY } from '@/lib/legal/company';
import { contactAddress } from '@/lib/email/templates';
import { Logo } from './logo';

const groups = [
  {
    title: 'Product',
    links: [
      { href: '/check', label: 'Check your area' },
      { href: '/for', label: 'By trade' },
      { href: '/local', label: 'By city' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/request', label: 'Request a service' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { href: '/guides', label: 'Guides' },
      { href: '/faq', label: 'FAQ' },
      { href: '/data', label: 'Local public records in numbers' },
      { href: '/about', label: 'About' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/delete-account', label: 'Delete account' },
    ],
  },
];

export function Footer() {
  // Same address the emails use: SUPPORT_EMAIL, else the address in EMAIL_FROM. Hidden when neither is set.
  const contact = contactAddress();
  return (
    <footer className="mt-auto border-t border-line bg-sand">
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 pb-8 pt-12 md:grid-cols-[1.3fr_2fr] md:gap-12 md:pt-14">
        <div className="max-w-sm">
          <Logo />
          {/* Kept short: residents reach /request from "Request a service" in the Product links. */}
          <p className="mt-3 text-sm text-muted">Local alerts built on public data. We never post for you.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title}>
              <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink">{g.title}</h2>
              <ul className="mt-2 flex flex-col">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="inline-flex min-h-11 items-center text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 border-t border-line px-5 py-6 text-sm text-muted">
        <p>
          Data comes from public government records and can be late or wrong, and Holler is not affiliated with or endorsed by any
          government agency. Check the source before you act.
        </p>
        {contact ? (
          <p>
            Questions?{' '}
            <a href={`mailto:${contact}`} className="font-medium text-ink underline underline-offset-2 hover:text-brand-text">
              {contact}
            </a>
          </p>
        ) : null}
        {/* Mailing address: the one place it is set is lib/legal/company.ts. */}
        <address className="not-italic">
          {COMPANY.brand} is run by {COMPANY.legalName}, {COMPANY.addressLine}.
        </address>
      </div>
    </footer>
  );
}
