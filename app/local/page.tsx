import type { Metadata } from 'next';
import Link from 'next/link';
import { CITIES, STATES, citiesInState } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd } from '@/lib/seo/jsonld';
import { JsonLd } from './_components/jsonld';
import { Crumbs, H1, Page, linkClass } from './_components/ui';

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
    <Page>
      <JsonLd
        data={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Local', path: '/local' },
        ])}
      />
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'Local' }]} />
      <H1>What&apos;s happening near you</H1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Holler reads public data from weather, emergency, city and federal sources. Pick a state to see its cities,
        then open a city for the latest records and where each one came from.
      </p>
      <ul className="mt-8 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        {states.map((s) => (
          <li key={s.slug} className="border-t border-line py-3">
            <Link href={`/local/${s.slug}`} className={`${linkClass} inline-flex min-h-11 w-full items-center justify-between gap-4`}>
              <span className="text-lg font-medium">{s.name}</span>
              <span className="font-mono text-sm text-muted">
                {s.cities} {s.cities === 1 ? 'city' : 'cities'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
