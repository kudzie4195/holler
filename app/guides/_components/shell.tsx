import Link from 'next/link';
import type { ReactNode } from 'react';
import { Footer, TopNav } from '@/components';
import { parseInline, isExternal } from '@/lib/seo/guides/inline';
import { jsonLdString } from '@/lib/seo/serialize';

/** Shared frame for /guides, /faq and /data: nav, one main landmark, footer. */
export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <>
      <TopNav />
      <main id="main" className={`mx-auto w-full ${wide ? 'max-w-3xl' : 'max-w-2xl'} px-5 pb-20 pt-10 md:pt-14`}>
        {children}
      </main>
      <Footer />
    </>
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

export function Crumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
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

export const proseLink = 'font-medium text-accent-text underline underline-offset-2 hover:text-ink';

/** Text with [label](href) links. "/" links stay on the site, "https://" links open the official source. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) => {
        if (!p.href) return <span key={i}>{p.text}</span>;
        if (isExternal(p.href)) {
          return (
            <a key={i} href={p.href} target="_blank" rel="noopener" className={proseLink}>
              {p.text}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          );
        }
        return (
          <Link key={i} href={p.href} className={proseLink}>
            {p.text}
          </Link>
        );
      })}
    </>
  );
}

export function fmtReviewed(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
