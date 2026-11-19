import Link from 'next/link';
import { COMPANY } from '@/lib/legal/company';
import { contactAddress } from '@/lib/email/templates';
import { Logo } from './logo';

type FooterLink = { href: string; label: string };

/** Trade pages linked from the footer, by category id in lib/signals/categories.ts. */
export const FOOTER_TRADES: FooterLink[] = [
  { href: '/for/roofing', label: 'Roofing' },
  { href: '/for/plumbing', label: 'Plumbing' },
  { href: '/for/hvac', label: 'HVAC' },
  { href: '/for/electrical', label: 'Electrical' },
  { href: '/for/tree-service', label: 'Tree service' },
  { href: '/for/restoration', label: 'Restoration' },
  { href: '/for', label: 'All trades' },
];

function groups(contact: string | null): { title: string; links: FooterLink[] }[] {
  return [
    {
      title: 'Product',
      links: [
        { href: '/check', label: 'Check your area' },
        { href: '/pricing', label: 'Pricing' },
        { href: '/#how', label: 'How it works' },
        { href: '/storms', label: 'Storm reports' },
        { href: '/request', label: 'Request a service' },
      ],
    },
    { title: 'Trades', links: FOOTER_TRADES },
    {
      title: 'Learn',
      links: [
        { href: '/local', label: 'By city' },
        { href: '/guides', label: 'Guides' },
        { href: '/faq', label: 'FAQ' },
        { href: '/data', label: 'Public records in numbers' },
        { href: '/about', label: 'About' },
      ],
    },
    {
      title: 'Company',
      links: [
        // Same address the emails use: SUPPORT_EMAIL, else the address in EMAIL_FROM. Left out when neither is set.
        ...(contact ? [{ href: `mailto:${contact}`, label: 'Email support' }] : []),
        { href: '/privacy', label: 'Privacy' },
        { href: '/terms', label: 'Terms' },
        { href: '/delete-account', label: 'Delete account' },
      ],
    },
  ];
}

/**
 * Site footer on ink. Brand lockup first, then four link groups: two columns on a phone, four from md up.
 * Text on ink: on-brand 15.2:1, on-brand-faint 8.5:1; group titles in signal 13.2:1. Focus rings are signal (.on-brand).
 */
export function Footer() {
  const contact = contactAddress();
  return (
    <footer className="on-brand mt-auto bg-ink">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-8 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:gap-12">
        <div className="flex max-w-xs flex-col gap-3">
          <Logo size={34} className="self-start" />
          <p className="text-[15px] text-on-brand-faint">Public records near you, sorted for your trade.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4">
          {groups(contact).map((g) => (
            <div key={g.title} className="min-w-0">
              <h2 className="eyebrow">{g.title}</h2>
              <ul className="mt-1 flex flex-col">
                {g.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith('mailto:') ? (
                      <a href={l.href} className="h-link text-[15px] text-on-brand">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="h-link text-[15px] leading-snug text-on-brand">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto w-full max-w-6xl px-5 pb-10 sm:px-6">
        <div className="flex flex-col gap-2 border-t border-brand-raised pt-6 text-sm text-on-brand-faint">
          <p>
            Data comes from public government records and can be late or wrong, and Holler is not affiliated with or endorsed by any
            government agency. Check the source before you act.
          </p>
          {/* Mailing address: the one place it is set is lib/legal/company.ts. */}
          <address className="not-italic">
            {COMPANY.brand} is run by {COMPANY.legalName}, {COMPANY.addressLine}.
          </address>
        </div>
      </div>
    </footer>
  );
}
