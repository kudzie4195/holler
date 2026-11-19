import Link from 'next/link';
import type { Family } from '@/lib/seo/home-map';
import { shortDay } from '@/lib/seo/home-map';
import type { LedgerExample } from '@/lib/seo/home-live';
import type { HomeFamily } from '@/lib/seo/public-copy';
import { tradeEntry, tradePath } from '@/lib/seo/trade-view';
import { COL, H2, MARK_LIGHT, SHAPE } from './styles';

/** Family text on sand: 7.86, 7.54 and 6.97 to 1. Marks 3.5:1 or better. */
const INK: Record<Family, string> = { weather: 'text-storm-ink', permit: 'text-sage-ink', civic: 'text-civic-ink' };

/** "plumbing, HVAC, electrical and windows and doors", each linked to its /for page when it exists. */
function Trades({ list }: { list: HomeFamily['goodFor'] }) {
  return (
    <>
      {list.map((t, i) => {
        const sep = i === 0 ? '' : i === list.length - 1 ? ' and ' : ', ';
        const name = tradeEntry(t.id) ? (
          <Link href={tradePath(t.id)} className="text-brand-text underline underline-offset-[3px] hover:decoration-2">
            {t.label}
          </Link>
        ) : (
          t.label
        );
        return (
          <span key={t.id}>
            {sep}
            {name}
          </span>
        );
      })}
    </>
  );
}

/**
 * "Three kinds of record. One feed.": one row per family. The example line is a real recent record of that family, with its date,
 * when the loaders have one; otherwise the row has none.
 */
export function Ledger({ families, examples }: { families: HomeFamily[]; examples: Record<Family, LedgerExample | null> }) {
  return (
    <section aria-labelledby="feeds-h" className="bg-sand">
      <div className={`${COL} flex flex-col gap-9 py-24`}>
        <h2 id="feeds-h" className={`${H2} max-w-[700px]`}>
          Three kinds of record. One feed.
        </h2>
        <div className="border-t-2 border-ink">
          {families.map((f) => {
            const ex = examples[f.id];
            return (
              <div key={f.id} className="flex flex-wrap gap-x-8 gap-y-3 border-b border-line-strong/40 py-[26px]">
                <span className={`inline-flex h-[30px] flex-[0_0_180px] items-center gap-2.5 font-mono text-sm ${INK[f.id]}`}>
                  <span aria-hidden="true" className={`h-3.5 w-3.5 ${SHAPE[f.id]} ${MARK_LIGHT[f.id]}`} />
                  {f.tag}
                </span>
                <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
                  <h3 className="m-0 text-xl font-semibold leading-snug">{f.title}</h3>
                  <p className="m-0 text-muted">
                    {f.from} Good for <Trades list={f.goodFor} />.
                  </p>
                </div>
                {ex ? (
                  <p className={`m-0 min-w-0 flex-[1_1_280px] self-center font-mono text-[13px] leading-normal ${INK[f.id]}`}>
                    EXAMPLE · <time dateTime={ex.occurredAt}>{shortDay(ex.occurredAt).toUpperCase()}</time>
                    <br />
                    {ex.title}
                    {ex.mi !== null ? ` · ${ex.mi.toFixed(1)} mi` : ''}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
