import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses } from '@/components/button';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
import { env } from '@/lib/env';

/* Plain Tailwind using the tokens from app/globals.css. Buttons come from components/button (ink text on accent, 5.00:1). */

/** Shared shell for /local pages: same TopNav (skip link targets #main) and Footer as the rest of the site. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <TopNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 bg-background px-4 py-8 text-base text-ink sm:py-12">
        {children}
      </main>
      <Footer />
    </>
  );
}

export function Crumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="-mt-2 mb-2 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-x-2">
        {items.map((c, i) => (
          <li key={c.name} className="flex items-center gap-2">
            {c.href ? (
              <Link href={c.href} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-ink">
                {c.name}
              </Link>
            ) : (
              <span aria-current="page" className="inline-flex min-h-11 items-center">
                {c.name}
              </span>
            )}
            {i < items.length - 1 ? <span aria-hidden="true">/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="text-[36px] font-semibold leading-tight tracking-[-0.02em] sm:text-[44px]">{children}</h1>;
}

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-2xl font-semibold tracking-[-0.02em]">
      {children}
    </h2>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface p-5 shadow-soft ${className}`.trim()}>
      {children}
    </section>
  );
}

/**
 * Same filled accent button as the rest of the site (ink on accent, 5.00:1). Labels such as the city CTA can be long, so the
 * button may wrap on a phone instead of overflowing; py-2.5 keeps a one-line button at the 48 px min height.
 */
const ctaWrap = (cls: string) => `${cls.replace('whitespace-nowrap', 'whitespace-normal')} py-2.5 text-center`;

/**
 * Tinted card for a page's first content block, one record family each, matching the home "What Holler watches" band:
 * weather sky with the storm stripe, spending sage with the sage-mark stripe, everything else orange tint with the accent stripe.
 * On all three: ink 14.3 to 15.0, muted 5.74 to 6.02, accent-text links 4.73 to 4.96 to 1.
 */
export type CardFamily = 'weather' | 'spending' | 'civic';
export function tintCardClass(family: CardFamily): string {
  if (family === 'weather') return '!bg-sky border-l-4 border-l-storm';
  if (family === 'spending') return '!bg-sage border-l-4 border-l-sage-mark';
  return '!bg-accent-soft border-l-4 border-l-accent';
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={ctaWrap(buttonClasses({ size: 'lg' }))}>
      {children}
    </Link>
  );
}

/** The quieter partner of PrimaryLink, so a CTA pair has one filled button. */
export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={ctaWrap(buttonClasses({ variant: 'secondary', size: 'lg' }))}>
      {children}
    </Link>
  );
}

export const linkClass =
  'underline underline-offset-2 hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/**
 * One-line public-records note for city, weekly and trade pages (legal.md (d), kept to one sentence): where the records come from,
 * no agency affiliation, and how to get one fixed or removed (SUPPORT_EMAIL when set, always the Terms link).
 */
export function PublicRecordsNote() {
  const support = env.SUPPORT_EMAIL?.trim() || null;
  return (
    <p className="mt-8 text-xs text-muted">
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
