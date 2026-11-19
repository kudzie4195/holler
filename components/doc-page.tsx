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
      <main id="main" className="w-full flex-1">
        <div className="hero-paper border-b border-line">
          <div className="mx-auto w-full max-w-2xl px-5 pb-10 pt-12 md:pb-14 md:pt-16">
            <h1 className="text-4xl text-ink md:text-[2.75rem]">{title}</h1>
            {intro ? <p className="mt-4 text-lg text-muted">{intro}</p> : null}
            {updated ? <p className="mt-2 text-sm text-muted">Last updated {updated}</p> : null}
          </div>
        </div>
        <div className="doc mx-auto mt-10 flex w-full max-w-2xl flex-col gap-10 px-5 pb-20 md:mt-12">{children}</div>
      </main>
      <Footer />
    </>
  );
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-base text-ink/90 [&_a]:font-medium [&_a]:text-brand-text [&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        {children}
      </div>
    </section>
  );
}
