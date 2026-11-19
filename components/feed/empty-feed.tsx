import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card } from '@/components/card';
import { timeAgo } from '@/components/format';
import { sourceLabel } from '@/components/signal-meta';
import { getProfile } from '@/lib/auth/session';
import { distanceFrom, groupItems, placeLine, safeUrl } from '@/lib/check/group';
import { CHECK_RADIUS_LABEL } from '@/lib/check/scope';
import { tradeLabel } from '@/lib/check/trades';
import { loadEmptyFeedData, EMPTY_FEED_DAYS, type EmptyFeedData } from '@/lib/preview/empty-feed';
import { typeLabel } from '@/lib/preview/recent';
import { RecentActivity } from './recent-activity';

/** How many area check records the empty feed lists before linking to the full check. */
export const EMPTY_CHECK_SHOWN = 5;
/** How many other trades are listed. */
export const EMPTY_TRADES_SHOWN = 8;

export const NO_LOCAL_FEED = 'No city or county feed covers this area yet. Storm and federal records still do.';

/** The empty feed replaces the bare empty state for a member with access whose match list loaded and is empty. */
export function emptyFeedApplies(o: { items: number; locked: boolean; failed: boolean }): boolean {
  return o.items === 0 && !o.locked && !o.failed;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The markup, from finished data. Every number is a count of real rows; a capped count says "At least". */
export function EmptyFeedView({ data, now, recent }: { data: EmptyFeedData; now: number; recent?: ReactNode }) {
  const check = data.check;
  const trades = check ? listWords(check.trades.map((t) => tradeLabel(t).toLowerCase())) : '';
  const shown = check && check.ok ? groupItems(check.items, now, check.origin).flatMap((g) => g.items).slice(0, EMPTY_CHECK_SHOWN) : [];
  const checkHref = check && data.zip && check.trades[0] ? `/check?zip=${encodeURIComponent(data.zip)}&trade=${encodeURIComponent(check.trades[0])}` : null;
  const place = data.placeLabel ?? 'your ZIP code';
  const others = data.otherTrades.slice(0, EMPTY_TRADES_SHOWN);

  return (
    <div className="flex flex-col gap-6" data-testid="empty-feed">
      <section aria-labelledby="empty-feed-h" className="rounded-card border border-line bg-surface p-5 shadow-soft md:p-6">
        <h2 id="empty-feed-h" className="text-2xl text-ink">
          Nothing has matched yet
        </h2>
        <p className="mt-2 text-muted">
          No record has matched your trades and area so far. Quiet weeks happen. Below is what Holler can see near you right now, taken from the
          same public records your alerts come from. Every line is real.
        </p>
      </section>

      {check ? (
        <section aria-labelledby="empty-check-h">
          <h2 id="empty-check-h" className="text-xl font-semibold text-ink">
            The free area check for {place}
          </h2>
          {check.uncovered ? (
            <p className="mt-2 text-muted">Holler does not cover {place} yet.</p>
          ) : !check.ok ? (
            <p className="mt-2 text-muted">We could not load the area check just now. Try again in a minute.</p>
          ) : shown.length === 0 ? (
            <p className="mt-2 text-muted">
              Nothing in the public record within {CHECK_RADIUS_LABEL} of {place} matched {trades} in the last 30 days.
            </p>
          ) : (
            <>
              <p className="mt-2 text-muted">
                {trades.charAt(0).toUpperCase() + trades.slice(1)} within {CHECK_RADIUS_LABEL}, last 30 days.
                {check.items.length > shown.length ? ` Showing ${shown.length} of ${check.items.length}.` : ''}
              </p>
              <ul className="mt-3 flex flex-col gap-3">
                {shown.map((it) => {
                  const href = safeUrl(it.url);
                  const miles = distanceFrom(check.origin, it);
                  return (
                    <li key={it.id}>
                      <Card as="article" className="!p-4">
                        <p className="break-words font-semibold leading-snug text-ink">{it.title}</p>
                        <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted">
                          {placeLine(it) ? <span>{placeLine(it)}</span> : null}
                          {miles !== null ? <span>{miles < 1 ? 'under 1 mi away' : `${Math.round(miles)} mi away`}</span> : null}
                          <time dateTime={it.occurredAt} className="font-mono text-xs tabular-nums">
                            {timeAgo(it.occurredAt, now)}
                          </time>
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-accent-text underline md:min-h-9">
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
            </>
          )}
          {checkHref && !check.uncovered ? (
            <Link href={checkHref} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent-text underline md:min-h-9">
              Open the full area check
            </Link>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="empty-watch-h" className="rounded-card border border-line bg-surface p-5 shadow-soft md:p-6">
        <h2 id="empty-watch-h" className="text-xl font-semibold text-ink">
          What Holler is watching near you
        </h2>
        {data.local.length > 0 ? (
          <ul className="mt-3 space-y-1 text-ink">
            {data.local.map((s) => (
              <li key={s.id} className="break-words">
                {s.label}.{' '}
                <span className="text-muted">{fmtDate(s.newest) ? `Newest record ${fmtDate(s.newest)}.` : 'No record date yet.'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-ink">{NO_LOCAL_FEED}</p>
        )}
        {data.national.length > 0 ? (
          <p className="mt-3 text-sm text-muted">
            Storm and federal records come from {listWords(data.national.map((s) => s.label))}. They cover every US address.
          </p>
        ) : null}

        {data.planLimited.length > 0 ? (
          <p className="mt-5 text-muted" data-testid="plan-limited">
            Your plan sends alerts for {data.planTrades} of your saved trades. Not included now:{' '}
            {listWords(data.planLimited.map((t) => tradeLabel(t)))}.{' '}
            <Link href="/app/settings#billing-h" className="font-semibold text-accent-text underline">
              See plans
            </Link>
          </p>
        ) : null}

        <h3 className="mt-5 text-lg text-ink">Other trades inside your radius</h3>
        {!data.countsOk ? (
          <p className="mt-2 text-muted">We could not count nearby records just now.</p>
        ) : others.length === 0 ? (
          <p className="mt-2 text-muted">
            No records for other trades landed within {data.radius} miles in the last {EMPTY_FEED_DAYS} days.
          </p>
        ) : (
          <>
            <p className="mt-2 text-muted">
              Records within {data.radius} miles in the last {EMPTY_FEED_DAYS} days, for trades you have not picked:
            </p>
            <ul className="mt-2 space-y-1 text-ink">
              {others.map((t) => (
                <li key={t.trade} className="break-words">
                  <span className="font-semibold">{t.label}:</span>{' '}
                  {t.byType
                    .map((b) => `${data.capped ? 'at least ' : ''}${b.count.toLocaleString('en-US')} ${typeLabel(b.key, b.count)}`)
                    .join(', ')
                    .replace(/^at least/, 'At least')}
                </li>
              ))}
            </ul>
            <Link href="/app/settings" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent-text underline md:min-h-9">
              Add a trade in Settings
            </Link>
          </>
        )}
      </section>

      {recent ?? null}
    </div>
  );
}

/**
 * Loads and renders the empty feed for this member. Reads the member's own profile, the cached public area check and public signal
 * columns (lib/preview/empty-feed.ts). Reads cookies, so render it inside Suspense.
 */
export async function EmptyFeed({ userId }: { userId: string }) {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const now = new Date();
  const data = await loadEmptyFeedData(profile, { now });
  return <EmptyFeedView data={data} now={now.getTime()} recent={<RecentActivity userId={userId} />} />;
}
