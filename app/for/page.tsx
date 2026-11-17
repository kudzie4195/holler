import type { Metadata } from 'next';
import Link from 'next/link';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd, itemListLd } from '@/lib/seo/jsonld';
import { groupTrades, tradeEntries, tradeHeadline, tradePath } from '@/lib/seo/trade-view';
import { JsonLd } from '../local/_components/jsonld';
import { Crumbs, H1, H2, Page, linkClass } from '../local/_components/ui';

const TITLE = 'Local alerts by trade';
const DESCRIPTION =
  'Pick your trade and see what Holler sends: storm and hail reports, permits, city records and the public alerts that fit your trade. $5 a month, 7 days free.';

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | Holler` },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/for') },
  openGraph: { title: `${TITLE} | Holler`, description: DESCRIPTION, url: absoluteUrl('/for'), siteName: 'Holler', type: 'website' },
  twitter: { card: 'summary', title: `${TITLE} | Holler`, description: DESCRIPTION },
};

export default function ForIndexPage() {
  const entries = tradeEntries();
  const groups = groupTrades(entries);
  return (
    <Page>
      <JsonLd
        data={[
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'By trade', path: '/for' },
          ]),
          itemListLd(
            'Trades Holler sends alerts to',
            entries.map((t) => ({ name: t.label, url: absoluteUrl(tradePath(t.id)) })),
          ),
        ]}
      />
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'By trade' }]} />
      <H1>Alerts for your trade</H1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        A roofer needs hail reports. A food truck needs event permits. A restoration crew needs flood warnings. Pick what you do
        and see what Holler watches for it, with live examples from the last two months.
      </p>
      <div className="mt-8 flex flex-col gap-10">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`g-${g.id}`}>
            {g.title ? <H2 id={`g-${g.id}`}>{g.title}</H2> : null}
            <ul className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {g.trades.map((t) => (
                <li key={t.id} className="border-t border-line">
                  <Link href={tradePath(t.id)} className={`${linkClass} flex min-h-11 flex-col justify-center py-2`}>
                    <span className="text-lg font-medium">{t.label}</span>
                    <span className="text-sm text-muted">{tradeHeadline(t)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-10 text-sm text-muted">
        Looking for a city instead? <Link href="/local" className={`${linkClass} inline-flex min-h-11 items-center`}>Browse by city</Link>.
      </p>
    </Page>
  );
}
