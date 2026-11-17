import { Badge } from './badge';
import { ButtonLink } from './button';
import { Card } from './card';
import { timeAgo } from './format';
import { sourceLabel } from './signal-meta';
import { safeUrl, groupItems, type CheckItem } from '@/lib/check/group';
import { watchesFor } from '@/lib/check/watch';

function Cta({ citySlug, children }: { citySlug: string | null; children?: React.ReactNode }) {
  const href = citySlug ? `/signup?city=${encodeURIComponent(citySlug)}` : '/signup';
  return (
    <div className="mt-8 rounded-card bg-ink px-6 py-8 text-center">
      {children}
      <ButtonLink href={href} size="lg" className="max-w-full whitespace-normal! py-3 text-center">
        Get these by email. 7 days free, no card
      </ButtonLink>
      <p className="mt-3 text-sm text-white/75">Then $5 a month or $48 a year. Holler never posts for you.</p>
    </div>
  );
}

export function CheckResults({
  items,
  ok,
  checkedAt,
  placeLabel,
  trade,
  tradeLabel,
  citySlug,
  now,
}: {
  items: CheckItem[];
  ok: boolean;
  checkedAt: string;
  placeLabel: string;
  trade: string;
  tradeLabel: string;
  citySlug: string | null;
  now: number;
}) {
  const groups = groupItems(items, now);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  if (shown === 0) {
    const watches = watchesFor(trade);
    return (
      <section aria-labelledby="check-heading" className="mt-10">
        <h2 id="check-heading" className="text-2xl text-ink">
          Holler is watching {placeLabel} for {tradeLabel.toLowerCase()} work
        </h2>
        <p className="mt-3 max-w-2xl text-muted">
          {ok
            ? `Nothing in the public record near ${placeLabel} matched ${tradeLabel.toLowerCase()} in the last 30 days. Holler checked ${timeAgo(checkedAt, now)}.`
            : `We could not load recent records just now, so this page shows what Holler watches instead.`}
        </p>
        <Card className="mt-6">
          <h3 className="text-lg text-ink">What Holler watches for this trade</h3>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
            {watches.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-4 text-muted">
            Quiet stretches happen, and some cities publish more than others. The first alert arrives the moment something nearby
            fits.
          </p>
        </Card>
        <Cta citySlug={citySlug} />
      </section>
    );
  }

  return (
    <section aria-labelledby="check-heading" className="mt-10">
      <h2 id="check-heading" className="text-2xl text-ink">
        {tradeLabel} near {placeLabel}, last 30 days
      </h2>
      <p className="mt-2 text-muted">
        {shown < items.length ? `The ${shown} most relevant of ${items.length >= 60 ? '60 or more' : items.length} records. ` : ''}
        Every record links to its source. Checked {timeAgo(checkedAt, now)}.
      </p>
      <div className="mt-6 flex flex-col gap-8">
        {groups.map((g) => (
          <div key={g.id}>
            <h3 className="text-lg text-ink">{g.title}</h3>
            <ul className="mt-3 flex flex-col gap-3">
              {g.items.map((it) => {
                const href = safeUrl(it.url);
                return (
                  <li key={it.id}>
                    <Card as="article" className="!p-4 md:!p-5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                        <Badge kind={it.kind} />
                        {it.place ? <span>{it.place}</span> : null}
                        <span aria-hidden="true">·</span>
                        <time dateTime={it.occurredAt} className="font-mono text-xs tabular-nums">
                          {timeAgo(it.occurredAt, now)}
                        </time>
                      </div>
                      <p className="mt-2 font-semibold leading-snug text-ink">{it.title}</p>
                      <p className="mt-2 text-sm text-muted">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-text underline">
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
