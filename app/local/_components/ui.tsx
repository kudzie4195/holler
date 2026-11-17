import Link from 'next/link';
import type { ReactNode } from 'react';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';

/* Plain Tailwind using W1's tokens from app/globals.css. Primary button uses accent-hover (#C94A08) with white text for AA contrast. */

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

export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/.04),0_4px_16px_rgb(0_0_0/.04)]">
      {children}
    </section>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent-hover px-6 py-3 text-lg font-bold text-white hover:bg-[#A83D06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      {children}
    </Link>
  );
}

export const linkClass =
  'underline underline-offset-2 hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
