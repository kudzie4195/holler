import Link from 'next/link';
import { COMPANY } from '@/lib/legal/company';
import { contactAddress } from '@/lib/email/templates';
import { PAGE_BOX } from './grid';
import { Logo } from './logo';

type FooterLink = { href: string; label: string; /** Set on a link to a page in another language: the label is read in that language and the link says what it points to. */ lang?: string; hrefLang?: string };

/**
 * Trade pages linked from the footer, by category id in lib/signals/categories.ts. Round 24 (review P1-3, decision e): the trades the
 * launch markets come first (landscaping, lawn care, gutters and siding, pressure washing), then fencing, painting and cleaning. Pressure
 * washing is not a category: its keywords live in House cleaning, so it links to that page, as cleaning does.
 */
export const FOOTER_TRADES: FooterLink[] = [
  { href: '/for/landscaping', label: 'Landscaping' },
  { href: '/for/lawn-care', label: 'Lawn care' },
  { href: '/for/siding-gutters', label: 'Gutters and siding' },
  { href: '/for/cleaning', label: 'Pressure washing' },
  { href: '/for/fencing', label: 'Fencing' },
  { href: '/for/painting', label: 'Painting' },
  { href: '/for/cleaning', label: 'Cleaning' },
  { href: '/for', label: 'All trades' },
];

function groups(contact: string | null, spanishHref: string): { title: string; links: FooterLink[] }[] {
  return [
    {
      title: 'Product',
      links: [
        { href: '/check', label: 'Check your area' },
        { href: '/pricing', label: 'Pricing' },
        { href: '/#how', label: 'How it works' },
        { href: '/storms', label: 'Storm reports' },
        { href: '/request', label: 'Request a service' },
        { href: spanishHref, label: 'Español', lang: 'es', hrefLang: 'es' },
      ],
    },
    { title: 'Trades', links: FOOTER_TRADES },
    {
      title: 'Learn',
      links: [
        { href: '/local', label: 'By city' },
        { href: '/guides', label: 'Guides' },
        { href: '/faq', label: 'FAQ' },
        { href: '/data', label: 'Local public records in numbers' },
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
 * `spanishHref`: where the "Español" link goes. The Spanish home by default; a page with a Spanish twin (/pricing) passes the twin.
 */
export function Footer({ spanishHref = '/es' }: { spanishHref?: string } = {}) {
  const contact = contactAddress();
  return (
    <footer className="on-brand mt-auto bg-ink">
      <div className={`${PAGE_BOX} grid gap-10 pb-8 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:gap-12`}>
        <div className="flex max-w-sm flex-col gap-3">
          <Logo size={34} className="self-start" />
          <p className="text-balance text-[0.9375rem] text-on-brand-faint">See where the work is near you this week.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-1 gap-x-5 gap-y-8 min-[18rem]:grid-cols-2 md:grid-cols-4">
          {groups(contact, spanishHref).map((g) => (
            <div key={g.title} className="min-w-0">
              <h2 className="eyebrow">{g.title}</h2>
              <ul className="mt-1 flex flex-col">
                {g.links.map((l) => (
                  <li key={`${l.href} ${l.label}`}>
                    {l.href.startsWith('mailto:') ? (
                      <a href={l.href} className="h-link text-[0.9375rem] text-on-brand">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} {...(l.lang ? { lang: l.lang, hrefLang: l.hrefLang } : {})} className="h-link text-[0.9375rem] leading-snug text-on-brand">
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
      <div className={`${PAGE_BOX} pb-10`}>
        <div className="flex flex-col gap-2 border-t border-brand-raised pt-6 text-sm text-on-brand-faint">
          <p className="text-pretty">
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
