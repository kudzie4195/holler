import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, Notice } from '@/components';
import { absoluteUrl } from '@/lib/seo/canonical';
import { DATA_META } from '@/lib/seo/guides/seo';
import { loadNationalStats } from '@/lib/seo/national-data';
import { dataJsonLd } from '@/lib/seo/national-seo';
import { socialMeta } from '@/lib/seo/social';
import { fmtDateTime } from '@/lib/seo/view';
import { Crumbs, JsonLd, Shell, proseLink } from '../guides/_components/shell';

export function generateMetadata(): Metadata {
  const m = DATA_META;
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: absoluteUrl(m.path) },
    ...socialMeta({ title: m.title, description: m.description, path: m.path }),
  };
}

const nf = (n: number) => n.toLocaleString('en-US');

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th scope="col" className={`border-b border-line py-2 text-sm font-semibold text-muted ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

export default async function DataPage() {
  const s = await loadNationalStats();

  return (
    <Shell wide>
      <JsonLd data={dataJsonLd(s)} />
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'Local public records in numbers' }]} />
      <h1 className="text-4xl text-ink">Local public records in numbers</h1>
      <p className="mt-4 text-lg text-ink/90">
        These are counts of the public records Holler has read. They are exact counts, and they show what Holler read, not how much demand there is.
      </p>

      {!s.ok ? (
        <div className="mt-8">
          <Notice tone="warn" role="status">
            The numbers are unavailable right now. Please try again in a few minutes.
          </Notice>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">
            {s.newestAt ? (
              <>
                Updated <time dateTime={s.newestAt} className="font-mono">{fmtDateTime(s.newestAt)}</time>, the time of the newest record.{' '}
              </>
            ) : null}
            Numbers computed <time dateTime={s.asOf} className="font-mono">{fmtDateTime(s.asOf)}</time> and refreshed about every hour.
          </p>

          {s.total30 === 0 ? (
            <div className="mt-8">
              <Notice tone="info">No records dated in the last 30 days were found, so there is nothing to count yet.</Notice>
            </div>
          ) : (
            <div className="mt-10 flex flex-col gap-8">
              <Card as="section">
                <h2 className="text-2xl text-ink">How many records did Holler read?</h2>
                <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-sm text-muted">Last 7 days</dt>
                    <dd className="text-3xl font-semibold text-ink">{nf(s.total7)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Last 30 days</dt>
                    <dd className="text-3xl font-semibold text-ink">{nf(s.total30)}</dd>
                  </div>
                  {s.citiesActive30 !== null ? (
                    <div>
                      <dt className="text-sm text-muted">Places with a record in 30 days</dt>
                      <dd className="text-3xl font-semibold text-ink">{nf(s.citiesActive30)}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className="mt-4 text-sm text-muted">
                  A record is one public item, such as a weather alert or a permit, dated inside the window. The counts show what Holler read, not all
                  local activity.
                </p>
              </Card>

              {s.kinds.some((k) => k.last7 > 0 || k.last30 > 0) ? (
                <Card as="section">
                  <h2 className="text-2xl text-ink">Records by type</h2>
                  <table className="mt-4 w-full border-collapse text-base">
                    <thead>
                      <tr>
                        <Th>Type</Th>
                        <Th right>7 days</Th>
                        <Th right>30 days</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.kinds.filter((k) => k.last7 > 0 || k.last30 > 0).map((k) => (
                        <tr key={k.id} className="border-b border-line last:border-b-0">
                          <th scope="row" className="py-2 text-left font-normal text-ink">
                            {k.label}
                          </th>
                          <td className="py-2 text-right font-mono text-ink">{nf(k.last7)}</td>
                          <td className="py-2 text-right font-mono text-ink">{nf(k.last30)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-4 text-sm text-muted">
                    City service records cover 311 requests, inspections, code violations and business licenses. Other records add up federal contracts,
                    disasters, earthquakes, airport status, events and resident requests. Types depend on which sources publish data.
                  </p>
                </Card>
              ) : null}

              {s.topCities.length > 0 ? (
                <Card as="section">
                  <h2 className="text-2xl text-ink">Top cities by records in 30 days</h2>
                  <table className="mt-4 w-full border-collapse text-base">
                    <thead>
                      <tr>
                        <Th>City</Th>
                        <Th right>Records</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.topCities.map((c) => (
                        <tr key={c.slug} className="border-b border-line last:border-b-0">
                          <th scope="row" className="py-2 text-left font-normal text-ink">
                            {c.path ? (
                              <Link href={c.path} className={proseLink}>
                                {c.name}
                                {c.state ? `, ${c.state}` : ''}
                              </Link>
                            ) : (
                              <>
                                {c.name}
                                {c.state ? `, ${c.state}` : ''}
                              </>
                            )}
                          </th>
                          <td className="py-2 text-right font-mono text-ink">{nf(c.last30)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-4 text-sm text-muted">
                    Cities rank higher when their government publishes open data that Holler has connected, so this is a list of where records exist, not
                    where demand is highest. We take the ten cities with the most records in 60 days and sort them by their last 30 days.
                  </p>
                </Card>
              ) : null}

              {s.topTrades.length > 0 ? (
                <Card as="section">
                  <h2 className="text-2xl text-ink">Trades with the most matched records</h2>
                  <table className="mt-4 w-full border-collapse text-base">
                    <thead>
                      <tr>
                        <Th>Trade</Th>
                        <Th right>Matched records</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.topTrades.map((t) => (
                        <tr key={t.id} className="border-b border-line last:border-b-0">
                          <th scope="row" className="py-2 text-left font-normal text-ink">
                            <Link href={`/for/${t.id}`} className={proseLink}>
                              {t.label}
                            </Link>
                          </th>
                          <td className="py-2 text-right font-mono text-ink">{nf(t.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-4 text-sm text-muted">
                    Counted in the newest {nf(s.sampleSize)} records. One record can match several trades, so the rows do not add up to the total.
                  </p>
                </Card>
              ) : null}

              {s.sourcesSeen > 0 ? (
                <Card as="section">
                  <h2 className="text-2xl text-ink">How many sources delivered data?</h2>
                  <p className="mt-3 text-3xl font-semibold text-ink">{nf(s.sourcesSeen)}</p>
                  <p className="mt-2 text-sm text-muted">
                    Sources seen in the newest {nf(s.sampleSize)} records. The true number can be higher, because a quiet source may not appear in a
                    sample. A source is one feed, such as a weather service or one city dataset.
                  </p>
                </Card>
              ) : null}
            </div>
          )}
        </>
      )}

      <p className="mt-12 text-base text-ink/90">
        Where the data comes from is listed in <Link href="/guides/free-public-data-sources-for-local-leads" className={proseLink}>free public data sources</Link>.
        Curious what Holler would watch near you? <Link href="/check" className={proseLink}>Check your area</Link>.
      </p>
    </Shell>
  );
}
