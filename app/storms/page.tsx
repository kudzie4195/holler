import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/app/local/_components/jsonld';
import { Aside, ClosingBand, FamilyMark, H2, Ledger, Page, PageHeader, PrimaryLink, PublicRecordsNote, linkClass, rowLinkClass } from '@/app/local/_components/ui';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd } from '@/lib/seo/jsonld';
import { countList } from '@/lib/storms/copy';
import { loadStormIndex, qualifyingReports } from '@/lib/storms/data';
import { reportPath } from '@/lib/storms/report';
import { MIN_INDEX_REPORTS } from '@/lib/storms/threshold';
import { stormCtaLabel } from '@/lib/plan/price-copy';

const TITLE = 'Recent storm reports by county | Holler';
const DESCRIPTION_LIVE =
  'Counties with at least 3 hail, wind or tornado reports in one day, plus FEMA storm declarations, from the last 60 days. Each page links to its official source records.';
const DESCRIPTION_EMPTY =
  'Counties appear here when the NOAA Storm Prediction Center logs at least 3 hail, wind or tornado reports in one day, or when FEMA declares a storm disaster. None qualify right now.';
const LIST_CAP = 150;

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadStormIndex();
  const live = qualifyingReports(data).length >= MIN_INDEX_REPORTS;
  const description = live ? DESCRIPTION_LIVE : DESCRIPTION_EMPTY;
  return {
    title: { absolute: TITLE },
    description,
    alternates: { canonical: absoluteUrl('/storms') },
    robots: live ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title: TITLE, description, url: absoluteUrl('/storms'), siteName: 'Holler', type: 'website' },
    twitter: { card: 'summary', title: TITLE, description },
  };
}

export default async function StormsIndexPage() {
  const data = await loadStormIndex();
  const reports = qualifyingReports(data);
  const live = reports.length >= MIN_INDEX_REPORTS;
  const shown = reports.slice(0, LIST_CAP);
  const times = reports.map((r) => (r.modifiedAt ? Date.parse(r.modifiedAt) : NaN)).filter(Number.isFinite);
  const ld: Record<string, unknown>[] = [
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Storm reports', path: '/storms' },
    ]),
  ];
  if (live) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Recent storm reports by county',
      url: absoluteUrl('/storms'),
      ...(times.length ? { dateModified: new Date(Math.max(...times)).toISOString() } : {}),
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: shown.length,
        itemListElement: shown.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: `${r.place} on ${r.dateLabel}`, url: absoluteUrl(reportPath(r)) })),
      },
    });
  }

  return (
    <Page
      withAside
      header={
        <PageHeader
          crumbs={[{ name: 'Home', href: '/' }, { name: 'Storm reports' }]}
          title="Recent storm reports by county"
          size="md"
          lead={
            <p>
              A county is listed when the NOAA Storm Prediction Center logs at least 3 hail, wind or tornado reports there on one day, or when
              FEMA declares a storm disaster for a state. The list covers the last 60 days, newest first.
            </p>
          }
        />
      }
    >
      <JsonLd data={ld} />

      {!data.ok ? (
        <section aria-labelledby="empty">
          <H2 id="empty">Storm reports are not loading</H2>
          <p className="mt-2 text-muted">Holler could not read its records just now. Try again in a few minutes.</p>
        </section>
      ) : !live ? (
        <section aria-labelledby="empty">
          <H2 id="empty">No county has enough reports right now</H2>
          <p className="mt-2 max-w-2xl text-muted">
            {reports.length === 0
              ? 'No county or FEMA declaration meets the bar in the last 60 days.'
              : `Only ${reports.length} ${reports.length === 1 ? 'place meets' : 'places meet'} the bar in the last 60 days, so Holler is not listing a page for it in search yet.`}{' '}
            This list fills in when a storm day produces enough reports.
          </p>
          {reports.length > 0 ? (
            <Ledger className="mt-4">
              {shown.map((r) => (
                <li key={`${r.state}-${r.slug}`}>
                  <Link href={reportPath(r)} className={`${rowLinkClass} flex min-h-12 items-center`}>
                    {r.place} on {r.dateLabel}
                  </Link>
                </li>
              ))}
            </Ledger>
          ) : null}
        </section>
      ) : (
        <>
          <FamilyMark family="weather">Weather</FamilyMark>
          <Ledger className="mt-3">
            {shown.map((r) => (
              <li key={`${r.state}-${r.slug}`} className="flex flex-wrap items-baseline justify-between gap-x-6 py-2">
                <Link href={reportPath(r)} className={`${rowLinkClass} inline-flex min-h-11 items-center text-lg font-semibold`}>
                  {r.place}
                </Link>
                <p className="pb-2 font-mono text-xs uppercase tracking-[0.04em] text-storm-ink">
                  {r.dateLabel}
                  {r.kind === 'state' ? ', FEMA storm declaration' : `, ${r.spcTotal} storm reports (${countList(r)})`}
                </p>
              </li>
            ))}
          </Ledger>
          {reports.length > shown.length ? <p className="mt-3 text-sm text-muted">Showing the newest {shown.length} of {reports.length}.</p> : null}
        </>
      )}

      <Aside className="mt-14 lg:mt-0">
        <ClosingBand
          line="Know first when a storm hits near you."
          note="Holler alerts roofers, tree services and other local trades when storm reports come in near them."
        >
          <PrimaryLink href="/signup" onBrand>
            {stormCtaLabel()}
          </PrimaryLink>
        </ClosingBand>
      </Aside>
      <p className="mt-6 text-sm text-muted">
        Sources:{' '}
        <a href="https://www.spc.noaa.gov/climo/reports/" target="_blank" rel="noopener" className={linkClass}>NOAA Storm Prediction Center storm reports</a>,{' '}
        <a href="https://www.fema.gov/disaster/declarations" target="_blank" rel="noopener" className={linkClass}>FEMA disaster declarations</a>.
      </p>
      <PublicRecordsNote />
    </Page>
  );
}
