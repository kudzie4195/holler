import type { Metadata } from 'next';
import Link from 'next/link';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd, itemListLd } from '@/lib/seo/jsonld';
import { groupTrades, tradeEntries, tradeHeadline, tradePath } from '@/lib/seo/trade-view';
import { JsonLd } from '../local/_components/jsonld';
import { H2, Ledger, Page, PageHeader, linkClass, rowLinkClass } from '../local/_components/ui';
import { FROM_MONTHLY, TRIAL_DAYS_FREE } from '@/lib/plan/price-copy';

const TITLE = 'Local alerts by trade';
const DESCRIPTION =
  `Pick your trade and see what Holler sends: storm and hail reports, permits, city records and the public alerts that fit your trade. Plans from ${FROM_MONTHLY} a month, ${TRIAL_DAYS_FREE}.`;

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
    <Page
      width="wide"
      header={
        <PageHeader
          width="wide"
          crumbs={[{ name: 'Home', href: '/' }, { name: 'By trade' }]}
          title="Alerts for your trade"
          lead={
            <p>
              A roofer needs hail reports. A food truck needs event permits. A restoration crew needs flood warnings. Pick what you do
              and see what Holler watches for it, with live examples from the last two months.
            </p>
          }
        />
      }
    >
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
      <div className="flex flex-col gap-14">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={g.title ? `g-${g.id}` : undefined}>
            {g.title ? <H2 id={`g-${g.id}`}>{g.title}</H2> : null}
            <Ledger className="mt-4 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
              {g.trades.map((t) => (
                <li key={t.id}>
                  <Link href={tradePath(t.id)} className={`${rowLinkClass} flex min-h-11 flex-col justify-center py-3`}>
                    <span className="text-lg font-semibold">{t.label}</span>
                    <span className="text-sm text-muted">{tradeHeadline(t)}</span>
                  </Link>
                </li>
              ))}
            </Ledger>
          </section>
        ))}
      </div>
      <p className="mt-12 text-sm text-muted">
        Looking for a city instead? <Link href="/local" className={`${linkClass} inline-flex min-h-11 items-center text-ink`}>Browse by city</Link>.
      </p>
    </Page>
  );
}
