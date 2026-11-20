import Link from 'next/link';
import type { ReactNode } from 'react';
import { PAGE_BOX } from './grid';

/*
  Round 9 page parts shared by every inner page (unit C). Server components, no client JavaScript.

  Contrast on brand green (WCAG relative luminance, see tests/design/page-parts.test.ts):
  on-brand 11.3:1, on-brand-muted 8.2:1, on-brand-faint 6.3:1; signal focus ring 9.7:1 (from .on-brand).
  Family text on light (storm-ink, sage-ink, civic-ink): 7.0:1 or better on background, sand and surface.
*/

export type Crumb = { name: string; href?: string };

/**
 * Measure of the text column inside the page grid (components/grid.ts). It is nested inside PAGE_BOX, so every column starts at
 * the same left edge as the logo; only the right edge moves.
 */
export const WIDTH = {
  narrow: 'max-w-2xl',
  base: 'max-w-3xl',
  wide: 'max-w-5xl',
} as const;
export type Width = keyof typeof WIDTH;

/**
 * Breadcrumb trail. Mono uppercase, so on a green header it also reads as the page's eyebrow. Every link is 44 px tall; its width
 * is the word, so the gap before each slash is the same 8 px (final review B P2-4). "HOME" is 34 px wide, above the 24 px minimum.
 * `onBrand` (the default, as the trail sits in the header band) uses on-brand-muted links; off the band it uses muted.
 */
export function Crumbs({ items, onBrand = true }: { items: Crumb[]; onBrand?: boolean }) {
  const link = onBrand ? 'text-on-brand-muted hover:text-on-brand' : 'text-muted hover:text-ink';
  const here = onBrand ? 'text-on-brand-faint' : 'text-muted';
  return (
    <nav aria-label="Breadcrumb" className="mb-2 font-mono text-xs uppercase tracking-[0.06em]">
      <ol className="flex flex-wrap items-center gap-x-2">
        {items.map((c, i) => (
          <li key={c.name} className="flex min-w-0 items-center gap-2">
            {c.href ? (
              <Link href={c.href} className={`inline-flex min-h-11 items-center underline decoration-1 underline-offset-4 ${link}`}>
                {c.name}
              </Link>
            ) : (
              <span aria-current="page" className={`inline-flex min-h-11 items-center ${here}`}>
                {c.name}
              </span>
            )}
            {i < items.length - 1 ? (
              <span aria-hidden="true" className={here}>
                /
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Green page header band: breadcrumb or eyebrow, the page's one h1 in display uppercase, a one-line lead, and the page's main
 * form or action. `size` sets the h1 scale: 'lg' for marketing pages with short titles, 'md' for long titles (city weeks, storm
 * days), 'sm' for reading pages and auth, where the band should be no taller than the title needs.
 */
export function PageHeader({
  title,
  crumbs,
  eyebrow,
  lead,
  children,
  width = 'base',
  size = 'lg',
  meta,
}: {
  title: ReactNode;
  crumbs?: Crumb[];
  eyebrow?: ReactNode;
  lead?: ReactNode;
  /** Main form or action, under the lead. */
  children?: ReactNode;
  width?: Width;
  size?: 'lg' | 'md' | 'sm';
  /** Small dated line under the lead (mono), such as "Last reviewed". */
  meta?: ReactNode;
}) {
  const h1 =
    size === 'lg'
      ? 'text-5xl sm:text-6xl md:text-7xl'
      : size === 'md'
        ? 'text-4xl sm:text-5xl md:text-6xl'
        : 'text-4xl sm:text-5xl';
  const pad = size === 'sm' ? 'pb-8 pt-6 md:pb-10 md:pt-8' : 'pb-10 pt-6 md:pb-14 md:pt-10';
  // The current-page crumb adds nothing when it repeats the h1 word for word (a guide's long title twice on a phone): drop it.
  // The BreadcrumbList JSON-LD is built separately and keeps every level.
  const last = crumbs?.at(-1);
  const trail = last && !last.href && typeof title === 'string' && last.name.trim() === title.trim() ? crumbs!.slice(0, -1) : crumbs;
  return (
    <div className="on-brand bg-brand">
      <div className={`${PAGE_BOX} ${pad}`}>
        <div className={WIDTH[width]}>
        {trail && trail.length > 0 ? <Crumbs items={trail} /> : null}
        {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
        <h1 className={`${h1} max-w-[22ch] break-words text-on-brand`}>{title}</h1>
        {lead ? <div className="mt-4 flex max-w-2xl flex-col gap-2 text-lg text-on-brand-muted">{lead}</div> : null}
        {meta ? <p className="mt-3 font-mono text-xs uppercase tracking-[0.06em] text-on-brand-faint">{meta}</p> : null}
        {children ? <div className="mt-6">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export type Family = 'weather' | 'spending' | 'civic';

const FAMILY_MARK: Record<Family, string> = {
  // Square for weather and permits, round for 311 and civic, so color is never the only signal.
  weather: 'rounded-[3px] bg-storm',
  spending: 'rounded-[3px] bg-sage-mark',
  civic: 'rounded-full bg-civic-mark',
};
const FAMILY_INK: Record<Family, string> = { weather: 'text-storm-ink', spending: 'text-sage-ink', civic: 'text-civic-ink' };

/** Family label for a record group: shaped color mark plus a mono label in the family ink (as in the home page ledger). */
export function FamilyMark({ family, children }: { family: Family; children?: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-mono text-sm uppercase tracking-[0.04em] ${FAMILY_INK[family]}`}>
      <span aria-hidden="true" className={`size-3.5 shrink-0 ${FAMILY_MARK[family]}`} />
      {children}
    </span>
  );
}

/** Just the shaped mark, for a row inside a ledger. */
export function FamilyDot({ family, className = '' }: { family: Family; className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-3 shrink-0 ${FAMILY_MARK[family]} ${className}`.trim()} />;
}

/** A ruled ledger: heavy ink rule on top, hairlines between rows. Rows are its children (li elements). */
export function Ledger({ children, className = '', as = 'ul', label }: { children: ReactNode; className?: string; as?: 'ul' | 'ol' | 'div' | 'dl'; label?: string }) {
  const Tag = as;
  return (
    <Tag aria-label={label} className={`border-t-2 border-ink [&>*]:border-b [&>*]:border-line ${className}`.trim()}>
      {children}
    </Tag>
  );
}

/**
 * Closing call to action on green, like the home page's closing band but inside the page column. The line is a paragraph,
 * not a heading, so the page outline does not change.
 */
export function ClosingBand({ line, children, note }: { line: ReactNode; children?: ReactNode; note?: ReactNode }) {
  return (
    <div className="on-brand rounded-card bg-brand px-6 py-8 md:px-8">
      <p className="font-display text-3xl text-on-brand md:text-4xl">{line}</p>
      {note ? <p className="mt-2 text-on-brand-muted">{note}</p> : null}
      <div className="mt-5 flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
