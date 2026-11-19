import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses } from '@/components/button';
import { Footer } from '@/components/footer';
import { PAGE_BOX } from '@/components/grid';
import { WIDTH, type Width } from '@/components/page-header';
import { TopNav } from '@/components/top-nav';
import { env } from '@/lib/env';

/*
  Shared parts of the /local, /for and /storms pages. Tokens from app/globals.css, page header from components/page-header.
  Light content: ink text, muted secondary (5.15:1 or better), brand-text links (6.57:1 or better). Green parts use .on-brand.
*/

export { Crumbs, FamilyMark, FamilyDot, Ledger, ClosingBand, PageHeader, type Family } from '@/components/page-header';

/**
 * Shared shell: TopNav (skip link targets #main), one main landmark, Footer. `header` is the green band (a PageHeader) and spans
 * the full width; the content column below it sits in the same page grid, so the left edges line up.
 */
export function Page({ header, children, width = 'base' }: { header?: ReactNode; children: ReactNode; width?: Width }) {
  return (
    <>
      <TopNav />
      <main id="main" className="w-full flex-1 text-base text-ink">
        {header}
        <div className={`${PAGE_BOX} pb-20 pt-10 md:pt-14`}>
          <div className={WIDTH[width]}>{children}</div>
        </div>
      </main>
      <Footer />
    </>
  );
}

/** Section head on a marketing page: display uppercase. */
export function H2({ children, id, className = '' }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={`text-3xl text-ink md:text-4xl ${className}`.trim()}>
      {children}
    </h2>
  );
}

/** A plain block with a heading and a ruled body, no box. Replaces the round 8 white cards. */
export function Block({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={className}>
      {children}
    </section>
  );
}

/** Labels such as the city CTA can be long, so the button may wrap on a phone instead of overflowing. */
const ctaWrap = (cls: string) => `${cls.replace('whitespace-nowrap', 'whitespace-normal')} py-2.5 text-center`;

/** Filled call to action. On light: brand fill (11.2:1). Inside a green band (`onBrand`): signal fill, ink text (13.2:1). */
export function PrimaryLink({ href, children, onBrand = false }: { href: string; children: ReactNode; onBrand?: boolean }) {
  return (
    <Link href={href} className={ctaWrap(buttonClasses({ size: 'lg', variant: onBrand ? 'signal' : 'primary' }))}>
      {children}
    </Link>
  );
}

/** The quieter partner of PrimaryLink. On light: surface with a line-strong edge. On green: a signal outline. */
export function SecondaryLink({ href, children, onBrand = false }: { href: string; children: ReactNode; onBrand?: boolean }) {
  return (
    <Link href={href} className={ctaWrap(buttonClasses({ variant: onBrand ? 'outline-signal' : 'secondary', size: 'lg' }))}>
      {children}
    </Link>
  );
}

/** Text link on a light surface: ink text, underlined, brand-text on hover. Focus ring comes from globals.css. */
export const linkClass = 'underline decoration-1 underline-offset-4 hover:text-brand-text';

/** A whole ledger row that is a link: no underline at rest (the row rule marks it), underline on hover. */
export const rowLinkClass = 'decoration-1 underline-offset-4 hover:underline hover:text-brand-text';

/**
 * One-line public-records note for city, weekly and trade pages (legal.md (d), kept to one sentence): where the records come from,
 * no agency affiliation, and how to get one fixed or removed (SUPPORT_EMAIL when set, always the Terms link).
 */
export function PublicRecordsNote() {
  const support = env.SUPPORT_EMAIL?.trim() || null;
  return (
    <p className="mt-10 border-t border-line pt-4 text-xs text-muted">
      Most records here come from public government records, which can be late or wrong; Holler is not affiliated with any agency, and to
      fix or remove a record,{' '}
      {support ? (
        <>
          email{' '}
          <a href={`mailto:${support}`} className="underline underline-offset-2 hover:text-ink">
            {support}
          </a>{' '}
          with the page link or see our{' '}
        </>
      ) : (
        <>see our </>
      )}
      <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
        Terms
      </Link>
      .
    </p>
  );
}
