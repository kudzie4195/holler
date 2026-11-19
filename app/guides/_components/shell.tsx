import Link from 'next/link';
import type { ReactNode } from 'react';
import { Footer, TopNav } from '@/components';
import { parseInline, isExternal } from '@/lib/seo/guides/inline';
import { jsonLdString } from '@/lib/seo/serialize';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { WIDTH } from '@/components/page-header';

/**
 * Shared frame for /guides, /faq and /data: nav, one main landmark, footer. `header` is the green title band (a PageHeader) at full
 * width; the text column below starts at the same left edge (components/grid.ts). Reading pages keep a 60 to 75 character measure (max-w-2xl at 16 px).
 */
export function Shell({ children, header, wide = false }: { children: ReactNode; header?: ReactNode; wide?: boolean }) {
  return (
    <>
      <TopNav />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT}`}>
        {header}
        <div className={`${PAGE_BOX} pb-20 pt-10 md:pt-12`}>
          <div className={wide ? WIDTH.base : WIDTH.narrow}>{children}</div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

export { Crumbs, PageHeader } from '@/components/page-header';

/** Link inside running text on light: brand-text, 6.57:1 or better on every light surface. */
export const proseLink = 'font-medium text-brand-text underline decoration-1 underline-offset-4 hover:text-ink';

/** The same link inside a green (.on-brand) block: on-brand text, 11.3:1 on brand. */
export const proseLinkOnBrand = 'font-medium text-on-brand underline decoration-1 underline-offset-4 hover:text-signal';

/** Text with [label](href) links. "/" links stay on the site, "https://" links open the official source. */
export function Inline({ text, onBrand = false }: { text: string; onBrand?: boolean }) {
  const cls = onBrand ? proseLinkOnBrand : proseLink;
  return (
    <>
      {parseInline(text).map((p, i) => {
        if (!p.href) return <span key={i}>{p.text}</span>;
        if (isExternal(p.href)) {
          return (
            <a key={i} href={p.href} target="_blank" rel="noopener" className={cls}>
              {p.text}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          );
        }
        return (
          <Link key={i} href={p.href} className={cls}>
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
