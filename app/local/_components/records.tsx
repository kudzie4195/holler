import { sourceInfo } from '@/lib/seo/sources';
import type { SectionDef } from '@/lib/seo/sections';
import type { SectionItem } from '@/lib/seo/summarize';
import { fmtItemTime } from '@/lib/seo/view';
import { Card, H2, linkClass } from './ui';

/** One cited record: source (linked to its home page), time, title linked to the record, two line summary. Shared by city and weekly pages. */
export function ItemRow({ item, ask, asOf }: { item: SectionItem; ask: boolean; asOf: string }) {
  const src = sourceInfo(item.source);
  return (
    <li className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
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
        <time dateTime={item.occurredAt} className="font-mono">
          {fmtItemTime(item.occurredAt, asOf)}
        </time>
      </div>
      <p className="mt-1 font-medium leading-snug">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel={ask ? 'nofollow ugc noopener' : 'noopener'}
            className={linkClass}
          >
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </p>
      {!ask && item.summary ? <p className="mt-1 line-clamp-2 text-[15px] text-muted">{item.summary}</p> : null}
    </li>
  );
}

/** A section card with its heading, count, blurb and rows. `lowerBound` writes "at least" before the count. */
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
}) {
  return (
    <Card>
      <H2 id={def.id}>
        {def.title}{' '}
        <span className="font-mono text-base font-normal text-muted">
          ({lowerBound ? 'at least ' : ''}
          {total.toLocaleString('en-US')})
        </span>
      </H2>
      <p className="mt-1 text-sm text-muted">{def.blurb}</p>
      <ul className="mt-4">
        {items.map((it) => (
          <ItemRow key={it.id} item={it} ask={def.id === 'asks'} asOf={asOf} />
        ))}
      </ul>
      {total > items.length ? (
        <p className="mt-3 text-sm text-muted">
          Showing the {items.length} most recent of {lowerBound ? 'at least ' : ''}
          {total.toLocaleString('en-US')}.
        </p>
      ) : null}
    </Card>
  );
}
