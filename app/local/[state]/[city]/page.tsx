import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CITIES, cityBySlug, cityPath, nearbyCities, stateBySlug, stateSlugFor } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { loadPlaceData } from '@/lib/seo/data';
import { breadcrumbLd, faqLd, itemListLd, placeLd, webPageLd } from '@/lib/seo/jsonld';
import { SECTIONS } from '@/lib/seo/sections';
import { sourceInfo } from '@/lib/seo/sources';
import { isIndexable } from '@/lib/seo/threshold';
import { buildH1, buildSearchDescription, buildTitle } from '@/lib/seo/titles';
import { citySummary } from '@/lib/seo/week-summary';
import { thisAndLastWeek, weekPath } from '@/lib/seo/week';
import { tradeEntry, tradePath } from '@/lib/seo/trade-view';
import { buildFaq, buildHelps, buildIntro, fmtDate, fmtDateTime } from '@/lib/seo/view';
import { JsonLd } from '../../_components/jsonld';
import { SectionCard } from '../../_components/records';
import { Aside, ClosingBand, H2, Ledger, Page, PageHeader, PrimaryLink, linkClass, rowLinkClass, PublicRecordsNote } from '../../_components/ui';
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { cityCtaLabel } from '@/lib/plan/price-copy';

// SPEC asks for `export const revalidate = 21600`. That segment option is removed when
// cacheComponents is on (see next.config.ts), so the same 6 h lifetime is set with cacheLife in
// lib/seo/data.ts (loadPlaceData).

type Props = { params: Promise<{ state: string; city: string }> };

/** Prebuild the biggest cities; every other city renders on first visit (404 if unknown). */
export function generateStaticParams() {
  return CITIES.slice(0, 10).map((c) => ({ state: stateSlugFor(c.state) ?? '', city: c.slug }));
}

function resolve(stateSlug: string, citySlug: string) {
  const city = cityBySlug(citySlug);
  const st = stateBySlug(stateSlug);
  if (!city || !st || city.state !== st.code) return null;
  return { city, st };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state, city: citySlug } = await params;
  const r = resolve(state, citySlug);
  if (!r) return { title: 'Not found', robots: { index: false } };
  const { city } = r;
  const data = await loadPlaceData(city.slug);
  const path = cityPath(city);
  const title = buildTitle(city, data);
  // The quotable sentence is the description when there is one (it is not cut to 155 characters, so it never ends mid sentence).
  const description = citySummary(city, data) ?? buildSearchDescription(city, data);
  const indexable = isIndexable(data.total);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(path) },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: absoluteUrl(path), siteName: 'Holler', type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function CityPage({ params }: Props) {
  const { state, city: citySlug } = await params;
  const r = resolve(state, citySlug);
  if (!r) notFound();
  const { city, st } = r;
  const data = await loadPlaceData(city.slug);
  const path = cityPath(city);
  const place = `${city.name}, ${city.state}`;

  const summary = citySummary(city, data);
  const intro = buildIntro(city, data);
  const weeks = data.ok && data.total > 0 ? thisAndLastWeek(Date.parse(data.asOf)) : null;
  const helps = buildHelps(data);
  const faq = buildFaq(city, data);
  const nearby = nearbyCities(city.slug, 6);
  const ctaHref = `/signup?city=${encodeURIComponent(city.slug)}`;
  const ctaLabel = cityCtaLabel(city.name, TRIAL_DAYS);

  const visible = SECTIONS.filter((s) => (data.sections[s.id]?.length ?? 0) > 0);
  const listItems = visible
    .flatMap((s) => (data.sections[s.id] ?? []).slice(0, 3))
    .filter((i) => i.url)
    .slice(0, 12)
    .map((i) => ({ name: i.title, url: i.url as string }));
  const usedSources = [...new Set(data.sources.map((s) => sourceInfo(s)))].filter(
    (s, idx, arr) => s.homeUrl && arr.findIndex((o) => o.homeUrl === s.homeUrl) === idx,
  );

  const ld: Record<string, unknown>[] = [
    placeLd({ name: place, city: city.name, state: city.state, lat: city.lat, lon: city.lon, path, description: summary }),
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Local', path: '/local' },
      { name: st.name, path: `/local/${st.slug}` },
      { name: place, path },
    ]),
    faqLd(faq),
  ];
  if (data.ok) ld.push(webPageLd({ name: buildH1(city, data), path, dateModified: data.asOf, about: place, description: summary }));
  if (listItems.length) ld.push(itemListLd(`Recent public records for ${place}`, listItems));

  return (
    <Page
      withAside
      header={
        <PageHeader
          size="md"
          crumbs={[
            { name: 'Home', href: '/' },
            { name: 'Local', href: '/local' },
            { name: st.name, href: `/local/${st.slug}` },
            { name: place },
          ]}
          title={buildH1(city, data)}
          lead={summary ? <p className="text-xl font-medium leading-snug text-on-brand">{summary}</p> : null}
          meta={
            summary ? (
              <>
                Counts computed <time dateTime={data.asOf}>{fmtDate(data.asOf)}</time>
              </>
            ) : null
          }
        >
          <PrimaryLink href={ctaHref} onBrand>
            {ctaLabel}
          </PrimaryLink>
          <p className="mt-2 text-sm text-on-brand-muted">No card to start. Holler never posts anything for you.</p>
        </PageHeader>
      }
    >
      <JsonLd data={ld} />
      <p className="max-w-2xl text-lg leading-relaxed">{intro}</p>
      {data.ok || weeks ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted">
          {data.ok ? (
            <p>
              Last refreshed{' '}
              <time dateTime={data.asOf} className="font-mono text-ink">
                {fmtDateTime(data.asOf)}
              </time>
            </p>
          ) : null}
          {weeks ? (
            <p className="flex flex-wrap items-center gap-x-5">
              <span className="eyebrow">Records by week:</span>
              <Link href={weekPath(path, weeks.thisWeek)} className={`${linkClass} inline-flex min-h-11 items-center text-ink`}>
                This week
              </Link>
              <Link href={weekPath(path, weeks.lastWeek)} className={`${linkClass} inline-flex min-h-11 items-center text-ink`}>
                Last week
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-12 flex flex-col gap-14">
        {visible.map((s) => {
          const items = data.sections[s.id] ?? [];
          return <SectionCard key={s.id} def={s} items={items} total={data.counts[s.id] ?? items.length} asOf={data.asOf} />;
        })}

        {helps ? (
          <section aria-labelledby="who-this-helps">
            <H2 id="who-this-helps">{helps.heading}</H2>
            <p className="mt-2 text-muted">Number of records tagged to each trade. A record can help more than one trade.</p>
            <Ledger className="mt-4 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
              {helps.rows.map((row) => (
                <li key={row.id} className="flex min-h-12 items-baseline justify-between gap-4 py-1">
                  <span>
                    {tradeEntry(row.id) ? (
                      <Link href={tradePath(row.id)} className={`${linkClass} inline-flex min-h-11 items-center font-medium`}>
                        {row.label}
                      </Link>
                    ) : (
                      <span className="inline-flex min-h-11 items-center font-medium">{row.label}</span>
                    )}
                    {row.from ? <span className="block pb-2 text-sm text-muted">from {row.from}</span> : null}
                  </span>
                  <span className="font-mono text-sm">{row.count.toLocaleString('en-US')}</span>
                </li>
              ))}
            </Ledger>
          </section>
        ) : null}

        <section aria-labelledby="faq">
          <H2 id="faq">Questions about {place}</H2>
          <Ledger as="dl" className="mt-4">
            {faq.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="text-lg font-semibold">{f.q}</dt>
                <dd className="mt-1 text-muted">{f.a}</dd>
              </div>
            ))}
          </Ledger>
        </section>

        {nearby.length ? (
          <section aria-labelledby="nearby">
            <H2 id="nearby">Nearby cities</H2>
            <Ledger className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(11rem,100%),1fr))] gap-x-6">
              {nearby.map((c) => (
                <li key={c.slug}>
                  <Link href={cityPath(c)} className={`${rowLinkClass} flex min-h-12 items-center`}>
                    {c.name}, {c.state}
                  </Link>
                </li>
              ))}
            </Ledger>
          </section>
        ) : null}

        {/* After "Nearby cities" in the source, so focus goes FAQ, nearby links, then this card (final review A P2-6). From
            1024 px it sits in the right column, so where it is in the source does not move it on screen. The hero CTA above carries
            the price, so the card's button is short (final review B P2-2). */}
        <Aside>
          <ClosingBand line={<>Know first when {city.name} needs you.</>}>
            <PrimaryLink href={ctaHref} onBrand>
              Get {city.name} alerts
            </PrimaryLink>
          </ClosingBand>
        </Aside>

        {usedSources.length ? (
          <p className="text-sm text-muted">
            Sources on this page:{' '}
            {usedSources.map((s, i) => (
              <span key={s.homeUrl}>
                <a href={s.homeUrl} target="_blank" rel="noopener" className={linkClass}>
                  {s.label}
                </a>
                {i < usedSources.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <PublicRecordsNote />
    </Page>
  );
}
