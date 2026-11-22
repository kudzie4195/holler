import { cardBrief, type CardBrief } from '@/lib/signals/brief';
import type { OpportunityLabel } from '@/lib/signals/lead-rules';

/** What the block needs from a feed item. Everything is already on FeedItem. */
export interface BriefBlockItem {
  source: string;
  kind: string;
  subtype?: string | null;
  title?: string | null;
  summary?: string | null;
  label?: OpportunityLabel | null;
  trade?: string | null;
  url?: string | null;
  occurredAt: string;
  /** NYC no-heat cards: the stored company name and role (lib/signals/managed-by.ts). */
  managerName?: string | null;
  managerRole?: string | null;
}

/** The brief for a feed item (parts 2 to 5). Pure; the web card, the tests and the screenshots all call it. */
export function briefOfItem(item: BriefBlockItem): CardBrief {
  return cardBrief({
    source: item.source,
    kind: item.kind,
    subtype: item.subtype,
    title: item.title,
    summary: item.summary,
    label: item.label,
    trade: item.trade,
    url: item.url,
    occurredAt: item.occurredAt,
    managerName: item.managerName,
    managerRole: item.managerRole,
  });
}

const ROW = 'mt-1 break-words text-sm text-ink';

/**
 * Brief card v1, parts 2 to 5 (part 1, what happened, is the card's own title and summary above it):
 *   Why it matters, Next step, Source and date (with the link), What is uncertain (with the confidence).
 * Plain text in the card's existing type and colors. Wraps at any width: every row is a block with break-words.
 */
export function BriefBlock({ item }: { item: BriefBlockItem }) {
  const b = briefOfItem(item);
  return (
    <div data-testid="brief" className="mt-3 border-t border-line pt-2">
      <p className={ROW} data-testid="brief-why">
        <span className="font-semibold">Why it matters: </span>
        {b.why}
      </p>
      <p className={ROW} data-testid="brief-next">
        <span className="font-semibold">Next step: </span>
        {b.next}
      </p>
      {b.managedBy ? (
        <p className={ROW} data-testid="brief-managed">
          {b.managedBy}
        </p>
      ) : null}
      <p className={ROW} data-testid="brief-source">
        <span className="font-semibold">Source: </span>
        {b.source.label}
        {b.source.dateText ? (
          <>
            <span aria-hidden="true"> · </span>
            <time dateTime={item.occurredAt} className="whitespace-nowrap">
              {b.source.dateText}
            </time>
          </>
        ) : null}
        {b.source.href ? (
          <>
            <span aria-hidden="true"> · </span>
            <a
              href={b.source.href}
              {...(b.source.href.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              data-testid="brief-link"
              className="-my-3 inline-block py-3 font-medium text-brand-text underline md:-my-2 md:py-2"
            >
              {b.source.linkText}
              {b.source.href.startsWith('/') ? null : <span className="sr-only"> (opens in a new tab)</span>}
            </a>
          </>
        ) : null}
      </p>
      <p className={ROW} data-testid="brief-uncertain">
        <span className="font-semibold">What is uncertain: </span>
        {b.uncertain}
      </p>
    </div>
  );
}
