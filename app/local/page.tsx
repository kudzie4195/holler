import type { Metadata } from 'next';
import Link from 'next/link';
import { CITIES, STATES, citiesInState } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd } from '@/lib/seo/jsonld';
import { JsonLd } from './_components/jsonld';
import { Ledger, Page, PageHeader, rowLinkClass } from './_components/ui';

const TITLE = 'Local activity by state';
const DESCRIPTION = `Weather alerts, storm reports and other public records for ${CITIES.length} US cities, each with its public source.`;

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | Holler` },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/local') },
  openGraph: { title: `${TITLE} | Holler`, description: DESCRIPTION, url: absoluteUrl('/local'), siteName: 'Holler', type: 'website' },
  twitter: { card: 'summary', title: `${TITLE} | Holler`, description: DESCRIPTION },
};

export default function LocalIndexPage() {
  const states = STATES.map((s) => ({ ...s, cities: citiesInState(s.code).length })).filter((s) => s.cities > 0);
  return (
    <Page
      header={
        <PageHeader
          crumbs={[{ name: 'Home', href: '/' }, { name: 'Local' }]}
          title={<>What&apos;s happening near you</>}
          lead={
            <p>
              Holler reads public data from weather, emergency, city and federal sources. Pick a state to see its cities, then open a
              city for the latest records and where each one came from.
            </p>
          }
        />
      }
    >
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Local', path: '/local' },
        ])}
      />
      <Ledger className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        {states.map((s) => (
          <li key={s.slug}>
            <Link href={`/local/${s.slug}`} className={`${rowLinkClass} flex min-h-12 w-full items-center justify-between gap-4 py-1`}>
              <span className="text-lg font-medium">{s.name}</span>
              <span className="font-mono text-sm text-muted">
                {s.cities} {s.cities === 1 ? 'city' : 'cities'}
              </span>
            </Link>
          </li>
        ))}
      </Ledger>
    </Page>
  );
}
