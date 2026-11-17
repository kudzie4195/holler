import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { STATES, cityPath, citiesInState, stateBySlug } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { loadPlaceCounts } from '@/lib/seo/data';
import { breadcrumbLd, itemListLd } from '@/lib/seo/jsonld';
import { WINDOW_DAYS } from '@/lib/seo/threshold';
import { JsonLd } from '../_components/jsonld';
import { Crumbs, H1, Page, linkClass } from '../_components/ui';

type Props = { params: Promise<{ state: string }> };

export function generateStaticParams() {
  return STATES.filter((s) => citiesInState(s.code).length > 0).map((s) => ({ state: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const st = stateBySlug(state);
  if (!st || citiesInState(st.code).length === 0) return { title: 'Not found', robots: { index: false } };
  const path = `/local/${st.slug}`;
  const title = `What's happening in ${st.name}`;
  const description = `Weather alerts, storm reports and other public records for ${citiesInState(st.code).length} cities in ${st.name}, each with its public source.`;
  return {
    title: { absolute: `${title} | Holler` },
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { title: `${title} | Holler`, description, url: absoluteUrl(path), siteName: 'Holler', type: 'website' },
    twitter: { card: 'summary', title: `${title} | Holler`, description },
  };
}

export default async function StatePage({ params }: Props) {
  const { state } = await params;
  const st = stateBySlug(state);
  if (!st) notFound();
  const cities = citiesInState(st.code);
  if (cities.length === 0) notFound();
  const pc = await loadPlaceCounts();
  const showCounts = pc.ok;

  return (
    <Page>
      <JsonLd
        data={[
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Local', path: '/local' },
            { name: st.name, path: `/local/${st.slug}` },
          ]),
          itemListLd(
            `Cities in ${st.name}`,
            cities.map((c) => ({ name: `${c.name}, ${c.state}`, url: absoluteUrl(cityPath(c)) })),
          ),
        ]}
      />
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'Local', href: '/local' }, { name: st.name }]} />
      <H1>What&apos;s happening in {st.name}</H1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        {cities.length} {cities.length === 1 ? 'city' : 'cities'} with 50,000 or more people, biggest first.
        {showCounts ? ` Counts show public records tagged to each city in the last ${WINDOW_DAYS} days.` : ''}
      </p>
      <ul className="mt-8 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {cities.map((c) => {
          const n = pc.counts[c.slug] ?? 0;
          return (
            <li key={c.slug} className="border-t border-line py-1">
              <Link href={cityPath(c)} className={`${linkClass} inline-flex min-h-11 w-full items-center justify-between gap-4`}>
                <span className="text-lg font-medium">{c.name}</span>
                {showCounts && n > 0 ? (
                  <span className="font-mono text-sm text-muted">
                    {n.toLocaleString('en-US')}
                    {pc.partial ? '+' : ''} {n === 1 ? 'record' : 'records'}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
