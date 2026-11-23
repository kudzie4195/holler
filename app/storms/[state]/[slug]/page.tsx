import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/app/local/_components/jsonld';
import { ClosingBand, H2, Page, PageHeader, PrimaryLink, PublicRecordsNote, linkClass } from '@/app/local/_components/ui';
import { stateBySlug } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd } from '@/lib/seo/jsonld';
import { FEMA_ONLY_NOTE, HOW_TO_READ, SIGNUP_LINE, h1 as headingOf, metaDescription, pageTitle, summary } from '@/lib/storms/copy';
import { loadStormReport } from '@/lib/storms/data';
import { reportPath } from '@/lib/storms/report';
import { RecordsTable } from '../../_components/records-table';
import { stormCtaLabel } from '@/lib/plan/price-copy';

type Props = { params: Promise<{ state: string; slug: string }> };

/**
 * Cache Components needs at least one static param. A placeholder that no record can match keeps the build off the database:
 * it renders the 404 page, and every real report renders on its first visit and is then cached (30 minutes, see lib/storms/data.ts).
 */
export function generateStaticParams() {
  return [{ state: 'georgia', slug: 'placeholder' }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state, slug } = await params;
  const res = await loadStormReport(state, slug);
  if (res.status !== 'ok') return { title: 'Not found', robots: { index: false } };
  const r = res.report;
  const title = pageTitle(r);
  const description = metaDescription(r);
  const path = reportPath(r);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(path) },
    robots: r.qualifies ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: absoluteUrl(path), siteName: 'Holler', type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function StormReportPage({ params }: Props) {
  const { state, slug } = await params;
  const st = stateBySlug(state);
  const res = await loadStormReport(state, slug);
  if (res.status === 'missing' || !st) notFound();
  if (res.status === 'error') throw new Error('Storm records could not be read');
  const r = res.report;
  const path = reportPath(r);
  const heading = headingOf(r);
  const lines = summary(r);
  const sources = [
    ...(r.spcTotal > 0 ? [{ label: 'NOAA Storm Prediction Center storm reports', href: 'https://www.spc.noaa.gov/climo/reports/' }] : []),
    ...(r.declarations > 0 ? [{ label: 'FEMA disaster declarations', href: 'https://www.fema.gov/disaster/declarations' }] : []),
  ];
  const ld: Record<string, unknown>[] = [
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Storm reports', path: '/storms' },
      { name: heading, path },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: heading,
      url: absoluteUrl(path),
      description: metaDescription(r),
      ...(r.modifiedAt ? { dateModified: r.modifiedAt } : {}),
      about: { '@type': 'Place', name: r.place },
    },
  ];

  return (
    <Page
      width="wide"
      header={
        <PageHeader
          width="wide"
          size="md"
          crumbs={[{ name: 'Home', href: '/' }, { name: 'Storm reports', href: '/storms' }, { name: r.place }]}
          title={heading}
          lead={lines.map((l) => (
            <p key={l} className="leading-relaxed">
              {l}
            </p>
          ))}
        />
      }
    >
      <JsonLd data={ld} />
      <p className="max-w-2xl text-muted">{r.spcTotal > 0 ? HOW_TO_READ : FEMA_ONLY_NOTE}</p>

      <div className="mt-10 flex flex-col gap-12">
        <section aria-labelledby="records">
          <H2 id="records">Source records</H2>
          <div className="mt-4">
            <RecordsTable records={r.records} dateLabel={r.dateLabel} />
          </div>
        </section>

        <ClosingBand line={SIGNUP_LINE} note="No card to start. Holler never posts anything for you.">
          <PrimaryLink href="/signup" onBrand>
            {stormCtaLabel()}
          </PrimaryLink>
        </ClosingBand>

        <p className="text-sm text-muted">
          Sources:{' '}
          {sources.map((s, i) => (
            <span key={s.href}>
              <a href={s.href} target="_blank" rel="noopener" className={linkClass}>
                {s.label}
              </a>
              {i < sources.length - 1 ? ', ' : '.'}
            </span>
          ))}{' '}
          <Link href="/storms" className={linkClass}>All recent storm reports</Link>.
        </p>
      </div>
      <PublicRecordsNote />
    </Page>
  );
}
