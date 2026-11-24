import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses } from '@/components/button';
import { Footer } from '@/components/footer';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
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
 *
 * `withAside` (trade, city and storm index pages, review 2b P2-10): from 1024 px (64rem) up, the text column keeps at most 768 px
 * and the right 320 px of the 1152 px content box holds the page's closing card (wrap it in <Aside>), sticky under the bar.
 * The card stays where it is in the page source, so under 1024 px the order and the look do not change.
 */
export function Page({
  header,
  children,
  width = 'base',
  withAside = false,
  showStart = true,
}: {
  header?: ReactNode;
  children: ReactNode;
  width?: Width;
  withAside?: boolean;
  /** Round 24: false on a waitlist page, which carries no sign-up link anywhere (lib/check/cells.ts). */
  showStart?: boolean;
}) {
  return (
    <>
      <TopNav showStart={showStart} />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT} text-ink`}>
        {header}
        <div className={`${PAGE_BOX} pb-20 pt-10 md:pt-14`}>
          {withAside ? (
            // 384 px = the 320 px aside plus a 64 px gap. The aside is positioned against this box. The minimum height keeps the
            // tallest closing card (the storm index one, 390 px at 1280) inside the box when the text column is short, such as
            // the empty storm list, so the card never runs into the footer.
            <div className="lg:relative lg:min-h-[26rem] lg:pr-96">
              <div className={WIDTH[width]}>{children}</div>
            </div>
          ) : (
            <div className={WIDTH[width]}>{children}</div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

/**
 * The right-hand column of a `withAside` page. Under 1024 px it is a plain block in the page flow, exactly where the page puts it.
 * From 1024 px up it is taken out of the flow into the 320 px column on the right, as tall as the text column, and its content
 * sticks 96 px from the top (under the 64 px bar). No new content: it wraps the card the page already has. From 1024 px up every
 * button in it takes the full card width, so one card or two stacked buttons share one right edge (final review B P2-2).
 */
export function Aside({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div data-aside="" className={`lg:absolute lg:inset-y-0 lg:right-0 lg:w-80 lg:[&_a]:w-full ${className}`.trim()}>
      <div className="lg:sticky lg:top-24">{children}</div>
    </div>
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
 * no agency affiliation, and how to get one fixed or removed (SUPPORT_EMAIL when set, always the Terms link). No rule above it: on
 * trade and city pages the last ledger row already draws one (final review B P2-3).
 */
export function PublicRecordsNote() {
  const support = env.SUPPORT_EMAIL?.trim() || null;
  return (
    <p className="mt-10 text-xs text-muted">
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
