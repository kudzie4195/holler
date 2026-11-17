import { breadcrumbLd, datasetLd } from './jsonld';
import type { NationalStats } from './national-data';

const DAY = 86_400_000;

/**
 * Dataset + BreadcrumbList for /data. temporalCoverage is the 30 day window ending when the numbers were computed.
 * dateModified is the newest record's time, or the computation time when there is no record.
 * An unavailable page still gets the breadcrumb, but no Dataset: there is nothing to describe.
 */
export function dataJsonLd(stats: NationalStats): Record<string, unknown>[] {
  const crumbs = breadcrumbLd([
    { name: 'Home', path: '/' },
    { name: 'Local public records in numbers', path: '/data' },
  ]);
  if (!stats.ok) return [crumbs];
  const end = new Date(stats.asOf);
  const start = new Date(end.getTime() - 30 * DAY);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return [
    datasetLd({
      name: 'Local public records in numbers: records read by Holler',
      description:
        'Counts of public records Holler has read from weather, storm, disaster, federal and city open data sources: totals for the last 7 and 30 days, counts by record type, the busiest cities and the trades the records matched.',
      path: '/data',
      temporalCoverage: `${day(start)}/${day(end)}`,
      dateModified: stats.newestAt ?? stats.asOf,
      variables: ['Records in the last 7 days', 'Records in the last 30 days', 'Records by type', 'Records by city', 'Matched trades'],
    }),
    crumbs,
  ];
}
