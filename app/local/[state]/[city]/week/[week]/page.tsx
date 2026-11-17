import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CITIES, cityBySlug, cityPath, stateBySlug, stateSlugFor } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd, collectionPageLd } from '@/lib/seo/jsonld';
import { SECTIONS, type SectionDef } from '@/lib/seo/sections';
import { sourceInfo } from '@/lib/seo/sources';
import { loadWeekData, WEEK_ROW_CAP, type WeekData } from '@/lib/seo/week-data';
import { buildSummarySentence, weekPeriod } from '@/lib/seo/week-summary';
import { isWeekIndexable, isoDay, mondayOf, weekPath } from '@/lib/seo/week';
import { fmtDate } from '@/lib/seo/view';
import { JsonLd } from '../../../../_components/jsonld';
import { SectionCard } from '../../../../_components/records';
import { Crumbs, H1, Page, PrimaryLink, linkClass } from '../../../../_components/ui';

// Any Monday in the current week and the 11 before it, for any city, renders on its first visit and is then cached (lib/seo/week-data.ts).
// Cache Components needs at least one known param set to prerender the route shell, so the build prerenders one: the largest city, this
// week. The 404 for every other date is decided in proxy.ts (lib/seo/route-check.ts) so it is a real status code; notFound() is the backstop.
export function generateStaticParams() {
  const c = CITIES[0];
  return [{ state: stateSlugFor(c.state) ?? '', city: c.slug, week: isoDay(mondayOf(Date.now())) }];
}

type Props = { params: Promise<{ state: string; city: string; week: string }> };

function resolve(stateSlug: string, citySlug: string) {
  const city = cityBySlug(citySlug);
  const st = stateBySlug(stateSlug);
  if (!city || !st || city.state !== st.code) return null;
  return { city, st };
}

/** A past week has no "active" alerts, so the two alert words are changed here. Every other section reads exactly as on the city page. */
function weekSection(def: SectionDef): SectionDef {
  if (def.id === 'alerts') return { ...def, title: 'Weather alerts', blurb: 'Warnings and watches issued during the week.' };
  return def;
}

function summaryOf(city: { name: string; state: string; slug: string }, data: WeekData): string | null {
  if (!data.valid || !data.ok) return null;
  return buildSummarySentence({
    place: `${city.name}, ${city.state}`,
    slug: city.slug,
    counts: data.counts,
    period: weekPeriod(data.startMs, Date.parse(data.asOf)),
    lowerBound: data.truncated,
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state, city: citySlug, week } = await params;
  const r = resolve(state, citySlug);
  if (!r) return { title: 'Not found', robots: { index: false } };
  const data = await loadWeekData(r.city.slug, week);
  if (!data.valid) return { title: 'Not found', robots: { index: false } };
  const { city } = r;
  const place = `${city.name}, ${city.state}`;
  const path = weekPath(cityPath(city), data.weekIso);
  const title = `${place}: public records for the week of ${fmtDate(data.weekIso)} | Holler`;
  const description = summaryOf(city, data) ?? `Public records for ${place} for the week of ${fmtDate(data.weekIso)}, each linked to its source.`;
  const indexable = data.ok && isWeekIndexable(data.total);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(path) },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: absoluteUrl(path), siteName: 'Holler', type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function WeekPage({ params }: Props) {
  const { state, city: citySlug, week } = await params;
  const r = resolve(state, citySlug);
  if (!r) notFound();
  const { city, st } = r;
  const data = await loadWeekData(city.slug, week);
  if (!data.valid) notFound();

  const cityHref = cityPath(city);
  const path = weekPath(cityHref, data.weekIso);
  const place = `${city.name}, ${city.state}`;
  const h1 = `${place}: public records for the week of ${fmtDate(data.weekIso)}`;
  const summary = summaryOf(city, data);
  const ctaHref = `/signup?city=${encodeURIComponent(city.slug)}`;
  const ctaLabel = `Get alerts for ${city.name} for $5/mo, first 7 days free`;

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
    collectionPageLd({ name: h1, path, dateModified: data.asOf, about: place, description: summary, items: listItems }),
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Local', path: '/local' },
      { name: st.name, path: `/local/${st.slug}` },
      { name: place, path: cityHref },
      { name: `Week of ${fmtDate(data.weekIso)}`, path },
    ]),
  ];

  return (
    <Page>
      <JsonLd data={ld} />
      <Crumbs
        items={[
          { name: 'Home', href: '/' },
          { name: 'Local', href: '/local' },
          { name: st.name, href: `/local/${st.slug}` },
          { name: place, href: cityHref },
          { name: `Week of ${fmtDate(data.weekIso)}` },
        ]}
      />
      <H1>{h1}</H1>
      {summary ? <p className="mt-4 max-w-2xl text-xl font-medium leading-snug">{summary}</p> : null}
      {data.ok ? (
        data.total > 0 ? (
          <p className="mt-3 max-w-2xl text-lg leading-relaxed">
            Weeks run Monday to Sunday, UTC. Every record below comes from a public source, and each one names that source and links to it.
            {data.current ? ' This week is still open, so the list grows as new records arrive.' : ''}
            {data.truncated ? ` The page reads at most ${WEEK_ROW_CAP.toLocaleString('en-US')} records, so counts are lower bounds.` : ''}
          </p>
        ) : (
          <p className="mt-3 max-w-2xl text-lg leading-relaxed">
            Holler has no public records tagged to {place} for this week. Weather alerts are checked every 15 minutes and city records a few times a day,
            so a record that is dated in this week can still show up late. Nothing here yet.
          </p>
        )
      ) : (
        <p className="mt-3 max-w-2xl text-lg leading-relaxed">Records for this week could not be loaded just now. Please try again in a few minutes.</p>
      )}
      {data.ok ? (
        <p className="mt-2 text-sm text-muted">
          Counts computed <time dateTime={data.asOf} className="font-mono">{fmtDate(data.asOf)}</time>.
        </p>
      ) : null}

      <nav aria-label="Weeks" className="mt-4 flex flex-wrap items-center gap-x-6 text-sm">
        {data.prev ? (
          <Link href={weekPath(cityHref, data.prev)} rel="prev" className={`${linkClass} inline-flex min-h-11 items-center`}>
            Previous week, {fmtDate(data.prev)}
          </Link>
        ) : null}
        {data.next ? (
          <Link href={weekPath(cityHref, data.next)} rel="next" className={`${linkClass} inline-flex min-h-11 items-center`}>
            Next week, {fmtDate(data.next)}
          </Link>
        ) : null}
        <Link href={cityHref} className={`${linkClass} inline-flex min-h-11 items-center`}>
          Back to {place}
        </Link>
      </nav>

      <div className="mt-6">
        <PrimaryLink href={ctaHref}>{ctaLabel}</PrimaryLink>
        <p className="mt-2 text-sm text-muted">No card to start. Holler never posts anything for you.</p>
      </div>

      <div className="mt-10 flex flex-col gap-6">
        {visible.map((s) => {
          const items = data.sections[s.id] ?? [];
          return (
            <SectionCard
              key={s.id}
              def={weekSection(s)}
              items={items}
              total={data.counts[s.id] ?? items.length}
              asOf={data.asOf}
              lowerBound={data.truncated}
            />
          );
        })}

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
    </Page>
  );
}
