import { Suspense } from 'react';
import Link from 'next/link';
import { BillingButton } from '@/components/billing-button';
import { Card } from '@/components/card';
import { ComingNextForMember } from '@/components/coming-next-member';
import { RecentActivity } from '@/components/feed/recent-activity';
import { Feed, LockedFeed, type FeedItem, type MatchStatus } from '@/components/feed';
import { formatDistance, maskText, timeAgo } from '@/components/format';
import { Notice } from '@/components/notice';
import { VerifyNotice } from './verify-notice';
import { computeAccess } from '@/lib/auth/access';
import { cityPageFor } from '@/lib/auth/city-link';
import { requireProfile } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { priceLabel, renewalNote } from '@/lib/stripe/plans';
import { HOLLER_REQUEST_SOURCE, isEndedRequest } from '@/lib/signals/request-visibility';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestTextForMember } from '@/lib/requests/details';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { loadFeedback } from '@/lib/feedback/service';
import type { FeedbackState } from '@/lib/feedback/types';
import { mayHaveContacts } from '@/lib/outreach/plan';
import type { ContactRecord } from '@/lib/contacts/types';

interface SignalRow {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  zip: string | null;
  occurred_at: string;
  expires_at: string | null;
  /** data->>subtype of the record, for the intent label. */
  subtype?: string | null;
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
      'id,status,distance_mi,draft,created_at,signal:holler_signals(id,source,kind,title,summary,url,city,state,county,zip,occurred_at,expires_at,subtype:data->>subtype)',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  const now = Date.now();
  const access = computeAccess(profile, now);
  const cityPage = cityPageFor(profile.lat, profile.lon);

  // Resident requests that have ended (closed, removed, past 14 days) leave the feed at once, before the cron deletes them.
  const rows = ((data ?? []) as unknown as MatchRow[]).filter((m) => {
    const s = Array.isArray(m.signal) ? m.signal[0] : m.signal;
    return !!s && !isEndedRequest(s, now);
  });
  // A resident's filtered description is not in the public record. It is read with the service role for this member's own request
  // matches only (requestTextForMember checks user_id and that the request is still open), and never for a locked account.
  const requestMatchIds = rows
    .filter((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal)?.source === HOLLER_REQUEST_SOURCE)
    .map((m) => m.id);
  let requestText: Record<number, string> = {};
  if (!access.locked && requestMatchIds.length > 0) {
    try {
      requestText = await requestTextForMember(createAdminClient(), user.id, requestMatchIds, new Date(now));
    } catch {
      requestText = {};
    }
  }
  // "Who to contact": organisations and sites the record names. Read with the service role, only for signal ids taken from THIS
  // member's own matches (the query above is filtered by user_id), only for records that can carry contacts, and never for a locked
  // account. The loader checks the match owner again. Any failure means no contacts and the feed renders as before.
  let contactsBySignal = new Map<number, ContactRecord[]>();
  if (!access.locked) {
    const signalIds = rows
      .map((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow)
      .filter((s) => mayHaveContacts(s.source, s.kind))
      .map((s) => s.id);
    if (signalIds.length > 0) {
      try {
        contactsBySignal = await loadMemberContacts({
          db: createAdminClient(),
          userId: user.id,
          signalIds,
          locked: false,
        });
      } catch {
        contactsBySignal = new Map();
      }
    }
  }
  // The member's own feedback answers (RLS: own rows only). A missing table or any failure just means no answers are shown.
  let feedbackBySignal = new Map<number, FeedbackState>();
  if (!access.locked && rows.length > 0) {
    const ids = rows.map((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow).map((s) => s.id);
    feedbackBySignal = await loadFeedback(supabase, user.id, ids);
  }
  const items: FeedItem[] = rows.map((m) => {
    const s = (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow;
    const isRequest = s.source === HOLLER_REQUEST_SOURCE;
    const base: FeedItem = {
      id: m.id,
      status: m.status,
      kind: s.kind,
      source: s.source,
      title: s.title,
      summary: isRequest ? (requestText[m.id] ?? null) : s.summary,
      url: s.url,
      distance: formatDistance(m.distance_mi),
      place: [s.city, s.state].filter(Boolean).join(', ') || null,
      ago: timeAgo(s.occurred_at, now),
      occurredAt: s.occurred_at,
      draft: m.draft,
      city: s.city,
      state: s.state,
      county: s.county,
      zip: s.zip,
      subtype: s.subtype ?? null,
      signalId: s.id,
      feedback: feedbackBySignal.get(s.id) ?? null,
    };
    const found = access.locked ? undefined : contactsBySignal.get(s.id);
    if (found && found.length > 0) base.contacts = found.map((c) => {
        const contact: Partial<ContactRecord> = { ...c };
        delete contact.signalId;
        return contact as Omit<ContactRecord, 'signalId'>;
      });
    // Locked: ship placeholders only, never the real text, link or draft.
    return access.locked
      ? { ...base, title: maskText(s.title), summary: s.summary ? maskText(s.summary) : null, url: null, draft: null, county: null, zip: null }
      : base;
  });

  // Accounts under 3 days old were filled from the 14-day backfill at signup.
  const firstRun = now - new Date(profile.created_at).getTime() < 3 * 86_400_000;

  return { profile, access, cityPage, items, firstRun, failed: Boolean(error) };
}

export default async function AppHome(props: PageProps<'/app'>) {
  const upgraded = (await props.searchParams).upgraded === '1';
  const { profile, access, cityPage, items, firstRun, failed } = await loadDashboard();

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

      {items.length === 0 && !access.locked ? (
        <div className="mt-6">
          <Suspense fallback={null}>
            <RecentActivity userId={profile.user_id} />
          </Suspense>
        </div>
      ) : null}

      <div className="mt-6">
        {access.locked ? (
          <LockedFeed items={items}>
            <Card className="text-center">
              <h2 className="text-2xl text-ink">Your free week is over</h2>
              <p className="mt-2 text-muted">
                {items.length > 0
                  ? `${items.length} ${items.length === 1 ? 'match is' : 'matches are'} waiting. `
                  : ''}
                Starter is {priceLabel('starter', 'monthly')} a month. Pro is {priceLabel('pro', 'monthly')} a month and covers more areas
                and trades. Cancel any time.
              </p>
              <div className="mt-5 flex flex-col items-center gap-3">
                <BillingButton
                  endpoint="/api/stripe/checkout"
                  tier="starter"
                  plan="monthly"
                  unavailableMessage="Billing opens soon. Check back shortly."
                  note={renewalNote('starter', 'monthly', { inTrial: !access.trialEnded })}
                >
                  Keep my alerts for {priceLabel('starter', 'monthly')}/mo
                </BillingButton>
                <Link href="/app/settings#billing-h" className="text-sm font-medium text-accent-text underline">
                  See both plans and yearly prices
                </Link>
              </div>
            </Card>
          </LockedFeed>
        ) : (
          <Feed items={items} cityPage={cityPage} firstRun={firstRun} />
        )}
      </div>
      <ComingNextForMember />
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
            in your free trial. Plans start at {priceLabel('starter', 'monthly')} a month.
          </span>
          <Link href="/app/settings#billing-h" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text underline md:min-h-9">
            Pick a plan
          </Link>
        </div>
      </Notice>
    );
  }
  return null;
}
