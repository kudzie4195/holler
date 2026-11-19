import { sourceInfo } from '@/lib/seo/sources';
import type { SectionDef } from '@/lib/seo/sections';
import type { SectionItem } from '@/lib/seo/summarize';
import { fmtItemTime } from '@/lib/seo/view';
import { FamilyMark, H2, Ledger, linkClass, type Family } from './ui';

/** Record family of a city-page section, same mapping as the --color-kind-* tokens. */
export function sectionFamily(id: string): Family {
  if (id === 'alerts' || id === 'storm' || id === 'disasters') return 'weather';
  if (id === 'permits' || id === 'contracts') return 'spending';
  return 'civic';
}

const FAMILY_LABEL: Record<Family, string> = { weather: 'Weather', spending: 'Permits and spending', civic: '311 and city' };

/** One cited record: source (linked to its home page), time, title linked to its public source (often the dataset page, not the single record), two line summary. Shared by city and weekly pages. */
export function ItemRow({ item, ask, asOf }: { item: SectionItem; ask: boolean; asOf: string }) {
  const src = sourceInfo(item.source);
  return (
    <li className="py-4">
      <p className="font-medium leading-snug">
        {item.url ? (
          <a href={item.url} target="_blank" rel={ask ? 'nofollow ugc noopener' : 'noopener'} className={linkClass}>
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </p>
      {!ask && item.summary ? <p className="mt-1 line-clamp-2 text-[0.9375rem] text-muted">{item.summary}</p> : null}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <time dateTime={item.occurredAt} className="font-mono text-xs uppercase tracking-[0.04em] text-ink">
          {fmtItemTime(item.occurredAt, asOf)}
        </time>
        <span>
          Source:{' '}
          {src.homeUrl ? (
            <a href={src.homeUrl} target="_blank" rel="noopener" className={linkClass}>
              {src.label}
            </a>
          ) : (
            src.label
          )}
        </span>
      </p>
    </li>
  );
}

/**
 * A record section as a ruled ledger: family mark and count, heading, blurb, then the rows. `lowerBound` writes "at least" before
 * the count. The family mark (shape plus color plus a word) replaces the round 8 tinted first card.
 */
export function SectionCard({
  def,
  items,
  total,
  asOf,
  lowerBound = false,
}: {
  def: Pick<SectionDef, 'id' | 'title' | 'blurb'>;
  items: SectionItem[];
  total: number;
  asOf: string;
  lowerBound?: boolean;
  /** Kept for callers from round 8; every section now carries its family mark. */
  tinted?: boolean;
}) {
  const family = sectionFamily(def.id);
  return (
    <section aria-labelledby={def.id}>
      <FamilyMark family={family}>{FAMILY_LABEL[family]}</FamilyMark>
      <H2 id={def.id} className="mt-2">
        {def.title}{' '}
        <span className="font-mono text-base font-medium normal-case tracking-normal text-muted">
          ({lowerBound ? 'at least ' : ''}
          {total.toLocaleString('en-US')})
        </span>
      </H2>
      <p className="mt-2 text-muted">{def.blurb}</p>
      <Ledger className="mt-4">
        {items.map((it) => (
          <ItemRow key={it.id} item={it} ask={def.id === 'asks'} asOf={asOf} />
        ))}
      </Ledger>
      {total > items.length ? (
        <p className="mt-3 text-sm text-muted">
          Showing the {items.length} most recent of {lowerBound ? 'at least ' : ''}
          {total.toLocaleString('en-US')}.
        </p>
      ) : null}
    </section>
  );
}
