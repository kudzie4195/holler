import type { ReactNode } from 'react';
import { Footer } from './footer';
import { PAGE_BOX } from './grid';
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
        {/* Title band in field green, continuing the nav bar. The h1 is display; sub-heads below are Inter (h-plain). */}
        <div className="on-brand bg-brand">
          <div className={`${PAGE_BOX} pb-10 pt-8 md:pb-14 md:pt-12`}>
            <div className="max-w-2xl">
              <h1 className="text-5xl md:text-6xl">{title}</h1>
              {intro ? <p className="mt-4 text-lg text-on-brand-muted">{intro}</p> : null}
              {updated ? <p className="eyebrow mt-3">Last updated {updated}</p> : null}
            </div>
          </div>
        </div>
        <div className={`${PAGE_BOX} mt-10 pb-20 md:mt-12`}>
          <div className="doc flex max-w-2xl flex-col gap-10">{children}</div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="h-plain text-2xl text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-base text-ink [&_a]:font-medium [&_a]:text-brand-text [&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        {children}
      </div>
    </section>
  );
}
