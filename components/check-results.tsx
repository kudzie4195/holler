import { Badge } from './badge';
import { ButtonLink } from './button';
import { Card } from './card';
import { timeAgo } from './format';
import { kindStripe, sourceLabel } from './signal-meta';
import { distanceFrom, groupItems, placeLine, safeUrl, type CheckItem } from '@/lib/check/group';
import { CHECK_RADIUS_LABEL } from '@/lib/check/scope';
import { FROM_MONTHLY, FROM_YEARLY, TRIAL_DAYS_FREE } from '@/lib/plan/price-copy';

function Cta({ citySlug, children }: { citySlug: string | null; children?: React.ReactNode }) {
  const href = citySlug ? `/signup?city=${encodeURIComponent(citySlug)}` : '/signup';
  return (
    <div className="mt-8 rounded-card bg-ink px-6 py-8 text-center">
      {children}
      <ButtonLink href={href} size="lg" className="max-w-full whitespace-normal! py-3 text-center">
        Get these by email. {TRIAL_DAYS_FREE}, no card
      </ButtonLink>
      <p className="mt-3 text-sm text-white/75">Then from {FROM_MONTHLY} a month or {FROM_YEARLY} a year. Holler never posts for you.</p>
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
}) {
  const groups = mode === 'results' ? groupItems(items, now, origin) : [];
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  if (shown === 0) {
    const trade = tradeLabel.toLowerCase();
    const intro: Record<CheckMode, string> = {
      results: `Nothing in the public record within ${CHECK_RADIUS_LABEL} of ${placeLabel} matched ${trade} in the last 30 days. Holler checked ${timeAgo(checkedAt, now)}.`,
      unreadable: 'We could not load recent records just now, so this page shows what Holler watches instead.',
      limited: 'You have run a lot of checks in a short time. Try again in a minute. Until then, this is what Holler watches.',
      uncovered: `Holler does not cover ${placeLabel} yet. We are adding places as public data sources are found.`,
    };
    return (
      <section aria-labelledby="check-heading" className="mt-10">
        <h2 id="check-heading" className="text-2xl text-ink">
          {mode === 'uncovered' ? `Holler does not cover ${placeLabel} yet` : `Holler is watching near ${placeLabel} for ${trade} work`}
        </h2>
        <p className="mt-3 max-w-2xl text-muted">{intro[mode]}</p>
        {mode !== 'uncovered' ? (
          <Card className="mt-6">
            <h3 className="text-lg text-ink">What Holler watches for this trade near you</h3>
            {watches.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
                {watches.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-muted">No public source tags this trade in your area yet.</p>
            )}
            <p className="mt-4 text-muted">
              Quiet stretches happen, and some places publish more than others. Holler scans its sources every 15 minutes to 12
              hours, depending on the source, and emails you at most once an hour. An alert can trail the event by a little.
            </p>
          </Card>
        ) : null}
        {mode !== 'uncovered' ? <Cta citySlug={citySlug} /> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="check-heading" className="mt-10">
      <h2 id="check-heading" className="text-2xl text-ink">
        {tradeLabel} within {CHECK_RADIUS_LABEL} of {placeLabel}, last 30 days
      </h2>
      <p className="mt-2 text-muted">
        {shown < items.length ? `Showing ${shown} records: active severe alerts first, then the closest, then the newest. ` : ''}
        Every record links to its source. Checked {timeAgo(checkedAt, now)}.
      </p>
      <div className="mt-6 flex flex-col gap-8">
        {groups.map((g) => (
          <div key={g.id}>
            <h3 className="text-lg text-ink">{g.title}</h3>
            <ul className="mt-3 flex flex-col gap-3">
              {g.items.map((it) => {
                const href = safeUrl(it.url);
                const miles = distanceFrom(origin, it);
                return (
                  <li key={it.id}>
                    <Card as="article" className={`!p-4 md:!p-5 ${kindStripe(it.kind)}`}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                        <Badge kind={it.kind} />
                        {placeLine(it) ? <span>{placeLine(it)}</span> : null}
                        {miles !== null ? <span>{miles < 1 ? 'under 1 mi away' : `${Math.round(miles)} mi away`}</span> : null}
                        <span aria-hidden="true">·</span>
                        <time dateTime={it.occurredAt} className="font-mono text-xs tabular-nums">
                          {timeAgo(it.occurredAt, now)}
                        </time>
                      </div>
                      <p className="mt-2 font-semibold leading-snug text-ink">{it.title}</p>
                      <p className="mt-2 text-sm text-muted">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-accent-text underline">
                            Source: {sourceLabel(it.source)}
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : (
                          <>Source: {sourceLabel(it.source)}</>
                        )}
                      </p>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <Cta citySlug={citySlug}>
        <p className="mx-auto mb-5 max-w-md text-lg text-white">New matches like these land in your inbox as they appear.</p>
      </Cta>
    </section>
  );
}
