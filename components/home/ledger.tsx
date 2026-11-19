import Link from 'next/link';
import type { Family } from '@/lib/seo/home-map';
import { shortDay } from '@/lib/seo/home-map';
import type { LedgerExample } from '@/lib/seo/home-live';
import { joinList, type HomeFamily } from '@/lib/seo/public-copy';
import { tradeEntry, tradePath } from '@/lib/seo/trade-view';
import { COL, H2, MARK_LIGHT, SHAPE } from './styles';

/** Family text on sand: about 7 to 7.9 contrast. Family marks at least 3.5 contrast. */
const INK: Record<Family, string> = { weather: 'text-storm-ink', permit: 'text-sage-ink', civic: 'text-civic-ink' };

/** The trades the ledger sentences name, once each, in the order named, only those with a page; link text as named. */
export function ledgerTrades(families: HomeFamily[]): { href: string; label: string }[] {
  const seen = new Set<string>();
  const out: { href: string; label: string }[] = [];
  for (const f of families) {
    for (const t of f.goodFor) {
      if (seen.has(t.id) || !tradeEntry(t.id)) continue;
      seen.add(t.id);
      out.push({ href: tradePath(t.id), label: `${t.label.charAt(0).toUpperCase()}${t.label.slice(1)}` });
    }
  }
  return out;
}

const TRADE_LINK = 'h-link font-medium text-brand-text underline-offset-4 hover:underline focus-visible:underline';

/**
 * "Three kinds of record. One feed.": one row per family. The example line is a real recent record of that family, with its date,
 * when the loaders have one; otherwise the row has none. Trade names in the sentences are plain text, as designed. Under the rows
 * one quiet index, "Find your trade", links the trade page of every trade the sentences name (once each, in the order named, only
 * trades that have a page), then "All trades" to /for: text links 44 px tall, no chips and no borders, a wrapped row on wide
 * screens and two columns on phones.
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
                    {f.from} Good for {joinList(f.goodFor.map((t) => t.label))}.
                  </p>
                </div>
                {ex ? (
                  <p className={`m-0 min-w-0 flex-[1_1_280px] self-center font-mono text-[0.8125rem] leading-normal ${INK[f.id]}`}>
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
        <nav aria-labelledby="trades-h" className="flex flex-col gap-1">
          <p id="trades-h" className="eyebrow m-0">
            FIND YOUR TRADE
          </p>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-6 p-0 max-[20rem]:grid-cols-1 min-[600px]:flex min-[600px]:flex-wrap min-[600px]:gap-x-8">
            {[...ledgerTrades(families), { href: '/for', label: 'All trades' }].map((t) => (
              <li key={t.href}>
                <Link href={t.href} className={TRADE_LINK}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
