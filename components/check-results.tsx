import { Badge } from './badge';
import { CoverageNoticeLine } from './coverage-notice';
import { ButtonLink } from './button';
import { timeAgo } from './format';
import { FamilyDot } from './page-header';
import { kindFamily, sourceLabel } from './signal-meta';
import { distanceFrom, groupItems, placeLine, safeUrl, type CheckItem } from '@/lib/check/group';
import { CHECK_RADIUS_LABEL, CHECK_WINDOW_DAYS } from '@/lib/check/scope';
import { FROM_MONTHLY, FROM_YEARLY, TRIAL_DAYS_FREE } from '@/lib/plan/price-copy';

function Cta({ citySlug, children }: { citySlug: string | null; children?: React.ReactNode }) {
  const href = citySlug ? `/signup?city=${encodeURIComponent(citySlug)}` : '/signup';
  return (
    <div className="on-brand mt-10 rounded-card bg-brand px-6 py-8 md:px-8">
      {children}
      <ButtonLink href={href} variant="signal" size="lg" className="max-w-full whitespace-normal! py-3 text-center">
        Get these by email. {TRIAL_DAYS_FREE}, no card
      </ButtonLink>
      <p className="mt-3 text-sm text-on-brand-muted">Then from {FROM_MONTHLY} a month or {FROM_YEARLY} a year. Holler never posts for you.</p>
    </div>
  );
}

export type CheckMode = 'results' | 'unreadable' | 'limited' | 'uncovered';

export function CheckResults({
  items,
  mode,
  checkedAt,
  placeLabel,
  tradeLabel,
  citySlug,
  watches,
  now,
  origin,
  coverage = null,
}: {
  items: CheckItem[];
  mode: CheckMode;
  checkedAt: string;
  placeLabel: string;
  trade: string;
  tradeLabel: string;
  citySlug: string | null;
  /** Record types Holler really watches for this trade in this area (see lib/check/watch.ts). */
  watches: string[];
  now: number;
  /** The ZIP's own position, used to order records by distance and to show how far each one is. */
  origin?: { lat: number; lon: number };
  /** One line when a source covering this place and trade is delayed, degraded or unavailable (lib/check/coverage-notice.ts). Never shown as full coverage. */
  coverage?: string | null;
}) {
  const groups = mode === 'results' ? groupItems(items, now, origin) : [];
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  if (shown === 0) {
    const trade = tradeLabel.toLowerCase();
    const intro: Record<CheckMode, string> = {
      // With a source behind, an empty list is not "nothing happened": say it is nothing in what Holler has read so far.
      results: coverage
        ? `In the records Holler has read so far, nothing within ${CHECK_RADIUS_LABEL} of ${placeLabel} matched ${trade} in the last ${CHECK_WINDOW_DAYS} days. Holler checked ${timeAgo(checkedAt, now)}.`
        : `Nothing in the public record within ${CHECK_RADIUS_LABEL} of ${placeLabel} matched ${trade} in the last ${CHECK_WINDOW_DAYS} days. Holler checked ${timeAgo(checkedAt, now)}.`,
      unreadable: 'We could not load recent records just now, so this page shows what Holler watches instead.',
      limited: 'You have run a lot of checks in a short time. Try again in a minute. Until then, this is what Holler watches.',
      uncovered: `Holler does not cover ${placeLabel} yet. We are adding places as public data sources are found.`,
    };
    return (
      <section aria-labelledby="check-heading" className="mt-10">
        <h2 id="check-heading" className="text-3xl text-ink md:text-4xl">
          {mode === 'uncovered' ? `Holler does not cover ${placeLabel} yet` : `Holler is watching near ${placeLabel} for ${trade} work`}
        </h2>
        <p className="mt-3 max-w-2xl text-muted">{intro[mode]}</p>
        {mode === 'results' ? <div className="mt-4 max-w-2xl empty:hidden"><CoverageNoticeLine line={coverage} /></div> : null}
        {mode !== 'uncovered' ? (
          <div className="mt-8">
            <h3 className="text-xl text-ink">What Holler watches for this trade near you</h3>
            {watches.length > 0 ? (
              <ul className="mt-3 border-t-2 border-ink">
                {watches.map((w) => (
                  <li key={w} className="border-b border-line py-3 text-ink">
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-muted">No public source tags this trade in your area yet.</p>
            )}
            <p className="mt-4 text-muted">
              Quiet stretches happen, and some places publish more than others. Holler scans its sources every 15 minutes to 12
              hours, depending on the source, and emails you at most once an hour. An alert can trail the event by a little.
            </p>
          </div>
        ) : null}
        {mode !== 'uncovered' ? <Cta citySlug={citySlug} /> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="check-heading" className="mt-10">
      <h2 id="check-heading" className="text-3xl text-ink md:text-4xl">
        {tradeLabel} within {CHECK_RADIUS_LABEL} of {placeLabel}, last 30 days
      </h2>
      <p className="mt-2 text-muted">
        {shown < items.length ? `Showing ${shown} records: active severe alerts first, then the closest, then the newest. ` : ''}
        Every record links to its source. Checked {timeAgo(checkedAt, now)}.
      </p>
      <div className="mt-4 max-w-2xl empty:hidden">
        <CoverageNoticeLine line={coverage} />
      </div>
      <div className="mt-8 flex flex-col gap-10">
        {groups.map((g) => (
          <div key={g.id}>
            <h3 className="flex items-center gap-2.5 text-xl text-ink">
              <FamilyDot family={kindFamily(g.items[0]?.kind ?? '')} />
              {g.title}
            </h3>
            <ul className="mt-3 border-t-2 border-ink">
              {g.items.map((it) => {
                const href = safeUrl(it.url);
                const miles = distanceFrom(origin, it);
                return (
                  <li key={it.id} className="border-b border-line">
                    <article className="py-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                        <Badge kind={it.kind} />
                        {placeLine(it) ? <span>{placeLine(it)}</span> : null}
                        {miles !== null ? (
                          <span className="font-mono text-xs uppercase text-ink">{miles < 1 ? 'under 1 mi away' : `${Math.round(miles)} mi away`}</span>
                        ) : null}
                        <time dateTime={it.occurredAt} className="font-mono text-xs uppercase tabular-nums">
                          {timeAgo(it.occurredAt, now)}
                        </time>
                      </div>
                      <p className="mt-2 text-lg font-semibold leading-snug text-ink">{it.title}</p>
                      <p className="text-sm text-muted">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-brand-text underline decoration-1 underline-offset-4">
                            Source: {sourceLabel(it.source)}
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : (
                          <span className="inline-flex min-h-11 items-center">Source: {sourceLabel(it.source)}</span>
                        )}
                      </p>
                    </article>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <Cta citySlug={citySlug}>
        <p className="mb-5 font-display text-3xl text-on-brand">New matches like these land in your inbox as they appear.</p>
      </Cta>
    </section>
  );
}
