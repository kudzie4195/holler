import type { ReactNode } from 'react';
import { Footer } from './footer';
import { TopNav } from './top-nav';

/** Shell for plain-language pages (about, privacy, terms). Static, no session read. */
export function DocPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro?: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <>
      <TopNav />
      <main id="main" className="mx-auto w-full max-w-2xl px-5 pb-20 pt-12 md:pt-16">
        <h1 className="text-4xl text-ink">{title}</h1>
        {intro ? <p className="mt-4 text-lg text-muted">{intro}</p> : null}
        {updated ? <p className="mt-2 text-sm text-muted">Last updated {updated}</p> : null}
        <div className="doc mt-10 flex flex-col gap-10">{children}</div>
      </main>
      <Footer />
    </>
  );
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-base text-ink/90 [&_a]:font-medium [&_a]:text-accent-text [&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        {children}
      </div>
    </section>
  );
}
