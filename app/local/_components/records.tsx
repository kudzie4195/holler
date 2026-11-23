import { sourceInfo } from '@/lib/seo/sources';
import { stripNotes } from '@/lib/signals/carry';
import type { SectionDef } from '@/lib/seo/sections';
import type { SectionItem } from '@/lib/seo/summarize';
import { fmtItemTime } from '@/lib/seo/view';
import { FamilyMark, H2, Ledger, linkClass, type Family } from './ui';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';

/**
 * Round 21 final review P3: business sources whose summary ends with the premises address (round 20 NEXT `premises`). The two-line clamp
 * cut that address off on a narrow screen, so it gets its own line, never clamped.
 */
const PREMISES_SOURCES: ReadonlySet<string> = new Set([...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.premises).map((d) => d.id));
const HOUSE_START = /^\d{1,6}[A-Za-z]?(?:-\d{1,6})?\s+\S/;

/** The summary split into the clamped part and a trailing premises address (business sources with a premises rule only). */
export function summaryParts(source: string, summary: string): { body: string; address: string | null } {
  if (!PREMISES_SOURCES.has(source)) return { body: summary, address: null };
  const at = summary.lastIndexOf(' | ');
  const last = at >= 0 ? summary.slice(at + 3).trim() : '';
  return at >= 0 && HOUSE_START.test(last) ? { body: summary.slice(0, at), address: last } : { body: summary, address: null };
}

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
      {/* Holler's own notes (the heat count, "Also cited") are member-feed wording, never printed on a public page (round 19 review P3 item 11). */}
      {!ask && stripNotes(item.summary) ? (() => {
        const parts = summaryParts(item.source, stripNotes(item.summary) as string);
        return (
          <>
            <p className="mt-1 line-clamp-2 text-[0.9375rem] text-muted">{parts.body}</p>
            {parts.address ? <p className="text-[0.9375rem] text-muted">{parts.address}</p> : null}
          </>
        );
      })() : null}
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
