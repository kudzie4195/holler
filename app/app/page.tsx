import Link from 'next/link';
import { BillingButton } from '@/components/billing-button';
import { Card } from '@/components/card';
import { Feed, LockedFeed, type FeedItem, type MatchStatus } from '@/components/feed';
import { formatDistance, maskText, timeAgo } from '@/components/format';
import { Notice } from '@/components/notice';
import { VerifyNotice } from './verify-notice';
import { computeAccess } from '@/lib/auth/access';
import { cityPageFor } from '@/lib/auth/city-link';
import { requireProfile } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

interface SignalRow {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  city: string | null;
  state: string | null;
  occurred_at: string;
}

interface MatchRow {
  id: number;
  status: MatchStatus;
  distance_mi: number | null;
  draft: string | null;
  created_at: string;
  signal: SignalRow | SignalRow[] | null;
}

/** Loads the feed. Kept out of the component so time-dependent values (trial days, "x min ago") are computed per request. */
async function loadDashboard() {
  const { user, profile } = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('holler_matches')
    .select(
      'id,status,distance_mi,draft,created_at,signal:holler_signals(id,source,kind,title,summary,url,city,state,occurred_at)',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  const now = Date.now();
  const access = computeAccess(profile, now);
  const cityPage = cityPageFor(profile.lat, profile.lon);

  const rows = ((data ?? []) as unknown as MatchRow[]).filter((m) => m.signal);
  const items: FeedItem[] = rows.map((m) => {
    const s = (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow;
    const base: FeedItem = {
      id: m.id,
      status: m.status,
      kind: s.kind,
      source: s.source,
      title: s.title,
      summary: s.summary,
      url: s.url,
      distance: formatDistance(m.distance_mi),
      place: [s.city, s.state].filter(Boolean).join(', ') || null,
      ago: timeAgo(s.occurred_at, now),
      occurredAt: s.occurred_at,
      draft: m.draft,
    };
    // Locked: ship placeholders only, never the real text, link or draft.
    return access.locked
      ? { ...base, title: maskText(s.title), summary: s.summary ? maskText(s.summary) : null, url: null, draft: null }
      : base;
  });

  return { profile, access, cityPage, items, failed: Boolean(error) };
}

export default async function AppHome(props: PageProps<'/app'>) {
  const upgraded = (await props.searchParams).upgraded === '1';
  const { profile, access, cityPage, items, failed } = await loadDashboard();

  return (
    <>
      <h1 className="text-4xl text-ink">Your matches</h1>
      <p className="mt-2 text-muted">
        {profile.business_name}, within <span className="font-mono tabular-nums">{profile.radius_mi}</span> mi of{' '}
        {profile.city && profile.state ? `${profile.city}, ${profile.state}` : profile.zip}.{' '}
        {cityPage ? (
          <Link href={cityPage.href} className="font-medium text-accent-text underline">
            See what&apos;s happening in {cityPage.label}
          </Link>
        ) : null}
      </p>

      <div className="mt-6 flex flex-col gap-4 empty:hidden">
        {upgraded ? (
          <Notice tone="success" role="status">
            Thanks. Your payment went through. It can take a few seconds to show up here.
          </Notice>
        ) : null}
        {profile.email_verified_at ? null : <VerifyNotice />}
        <TrialBanner access={access} />
        {failed ? <Notice tone="danger" role="alert">We couldn&apos;t load your matches. Refresh in a moment.</Notice> : null}
      </div>

      <div className="mt-6">
        {access.locked ? (
          <LockedFeed items={items}>
            <Card className="text-center">
              <h2 className="text-2xl text-ink">Your free week is over</h2>
              <p className="mt-2 text-muted">
                {items.length > 0
                  ? `${items.length} ${items.length === 1 ? 'match is' : 'matches are'} waiting. `
                  : ''}
                Keep your alerts for $5 a month. Cancel any time.
              </p>
              <div className="mt-5 flex justify-center">
                <BillingButton endpoint="/api/stripe/checkout" unavailableMessage="Billing opens soon. Check back shortly.">
                  Keep my alerts for $5/mo
                </BillingButton>
              </div>
            </Card>
          </LockedFeed>
        ) : (
          <Feed items={items} cityPage={cityPage} />
        )}
      </div>
    </>
  );
}

function TrialBanner({ access }: { access: ReturnType<typeof computeAccess> }) {
  if (access.status === 'past_due') {
    return (
      <Notice tone="warn">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Your last payment didn&apos;t go through. Update your card to keep alerts on.</span>
          <BillingButton endpoint="/api/stripe/portal" variant="secondary" size="sm">
            Manage billing
          </BillingButton>
        </div>
      </Notice>
    );
  }
  if (access.status === 'trialing' && !access.trialEnded) {
    return (
      <Notice tone="info">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong className="font-semibold">
              {access.daysLeft} {access.daysLeft === 1 ? 'day' : 'days'} left
            </strong>{' '}
            in your free trial. Keep alerts after that for $5/mo.
          </span>
          <BillingButton endpoint="/api/stripe/checkout" variant="secondary" size="sm">
            Subscribe
          </BillingButton>
        </div>
      </Notice>
    );
  }
  return null;
}
