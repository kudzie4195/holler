'use client';

import { hardNavigate } from './format';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Badge, StatusBadge } from './badge';
import { Button, ButtonLink } from './button';
import { Card } from './card';
import { EmptyState } from './empty-state';
import { getRequestReplyStates, setMatchStatus } from '@/app/app/actions';
import { RequestReply, type RequestReplyState } from './request-reply';
import { sourceLabel } from './signal-meta';
import { bidSourceLinkLabel } from '@/lib/signals/bid-card';
import { CADENCE_SHORT } from '@/lib/seo/cadence';
import type { ContactInput } from '@/lib/contacts/types';
import { WhoToContact, WhoToContactLocked } from './feed/who-to-contact';
import { FeedbackButtons } from './feed/feedback-buttons';
import { IntentNote } from './feed/intent-note';
import type { FeedbackState } from '@/lib/feedback/types';
import type { OpportunityLabel } from '@/lib/signals/lead-rules';

export type MatchStatus = 'new' | 'saved' | 'done' | 'dismissed';

export interface FeedItem {
  id: number;
  status: MatchStatus;
  kind: string;
  source: string;
  title: string;
  summary: string | null;
  url: string | null;
  distance: string | null;
  place: string | null;
  ago: string;
  occurredAt: string;
  draft: string | null;
  /** Place fields of the record, for the area kit in "Who to contact". Public data. */
  city?: string | null;
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  /** data.subtype of the record ('permit', '311', 'business', ...). Used for the intent label. */
  subtype?: string | null;
  /** Opportunity label for this member's trades (lib/signals/lead-rules.ts). Drives the chip and the order. Absent: no chip. */
  label?: OpportunityLabel;
  /** ISO date of a fix-by, due or response date the record publishes. Shown on Act Now cards; null shows "No deadline published". */
  deadline?: string | null;
  /** Id of the signal behind this match. Feedback is saved per signal; without it the feedback buttons are not shown. */
  signalId?: number;
  /** This member's saved feedback answer for the signal, if any. */
  feedback?: FeedbackState | null;
  /** One short AI line on why this record may matter to the member's trade (lib/ai notesFor). Checked when written. Never for a locked account. */
  aiNote?: string | null;
  /**
   * Set when the record's position is a stand-in (lib/signals/approx-location.ts): "In Cobb County. The county's feed has a street
   * address but no map point, so no distance is shown." Shown on the card in place of a distance.
   */
  approxNote?: string | null;
  /** Open city bids only: "Buyer: X. Due Dec 10, 2026, 19 days left." Worked out on the server. Never says the member can win or bid. */
  bidLine?: string | null;
  /**
   * Organisations and sites the record names, loaded on the server for this member only (never for a locked account).
   * Absent for records without contacts and always absent for a locked member.
   */
  contacts?: ContactInput[];
}

type Filter = 'all' | 'ask' | 'signals';

/** Source id of resident requests made on Holler (/request). Matches lib/requests/constants.ts REQUEST_SOURCE. */
export const REQUEST_SOURCE = 'holler-request';

function itemSourceLabel(source: string): string {
  return source === REQUEST_SOURCE ? 'Request made on Holler' : sourceLabel(source);
}

export function Feed({
  items: initial,
  cityPage,
  firstRun = false,
}: {
  items: FeedItem[];
  cityPage: { href: string; label: string } | null;
  /** New account: the feed was filled from the last two weeks, so say so. */
  firstRun?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [replyStates, setReplyStates] = useState<Record<number, RequestReplyState>>({});

  // Resident requests: ask the server which ones this business already answered (or that are closed). page.tsx does not pass this.
  const requestIds = initial.filter((i) => i.source === REQUEST_SOURCE).map((i) => i.id);
  const requestKey = requestIds.join(',');
  useEffect(() => {
    if (!requestKey) return;
    let alive = true;
    getRequestReplyStates(requestKey.split(',').map(Number))
      .then((states) => {
        if (alive) setReplyStates((cur) => ({ ...states, ...cur }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [requestKey]);

  function markReplied(id: number) {
    setReplyStates((cur) => ({ ...cur, [id]: 'replied' }));
  }

  const open = items.filter((i) => i.status === 'new' || i.status === 'saved');
  const closedCount = items.length - open.length;
  const pool = showClosed ? items : open;
  const counts = {
    all: pool.length,
    ask: pool.filter((i) => i.kind === 'ask').length,
    signals: pool.filter((i) => i.kind !== 'ask').length,
  };
  const visible = useMemo(
    () => pool.filter((i) => (filter === 'all' ? true : filter === 'ask' ? i.kind === 'ask' : i.kind !== 'ask')),
    [pool, filter],
  );

  function update(id: number, status: MatchStatus) {
    const prev = items;
    setError(null);
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status } : i)));
    startTransition(async () => {
      const res = await setMatchStatus(id, status).catch(() => ({ ok: false }));
      if (!res.ok) {
        setItems(prev);
        setError("That didn't save. Try again.");
      }
    });
  }

  function setDraft(id: number, draft: string) {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, draft } : i)));
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing has matched yet"
        action={
          cityPage ? (
            <ButtonLink href={cityPage.href} variant="secondary">
              See what&apos;s happening in {cityPage.label}
            </ButtonLink>
          ) : undefined
        }
      >
        <p>
          {CADENCE_SHORT} When something matches what you do and where you work, it
          lands here and in your email. Quiet days happen.
        </p>
      </EmptyState>
    );
  }

  const tabs: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'ask', label: 'People asking' },
    { id: 'signals', label: 'Signals' },
  ];

  return (
    <div>
      {firstRun ? (
        <p className="mb-4 text-muted">
          Here is what the last two weeks looked like near you. New alerts arrive by email.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter matches" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={filter === t.id}
              onClick={() => setFilter(t.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-medium transition-colors ${
                filter === t.id ? 'border-brand bg-brand text-on-brand hover:bg-brand-raised' : 'border-line-strong bg-surface text-ink hover:border-ink hover:bg-sand'
              }`}
            >
              {t.label}
              <span className="font-mono text-xs tabular-nums opacity-80">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        {closedCount > 0 ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            Show done and dismissed ({closedCount})
          </label>
        ) : null}
      </div>

      <p role="alert" className="mt-3 text-sm font-medium text-danger empty:hidden">
        {error}
      </p>

      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={filter === 'ask' ? 'No one is asking right now' : filter === 'signals' ? 'No signals right now' : 'All caught up'}>
            <p>New matches show up here as soon as a scan finds them.</p>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {visible.map((item) => (
            <li key={item.id}>
              <MatchCard
                item={item}
                onStatus={update}
                onDraft={setDraft}
                replyState={replyStates[item.id]}
                onReplied={markReplied}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchCard({
  item,
  onStatus,
  onDraft,
  replyState,
  onReplied,
}: {
  item: FeedItem;
  onStatus: (id: number, status: MatchStatus) => void;
  onDraft: (id: number, draft: string) => void;
  replyState?: RequestReplyState;
  onReplied?: (id: number) => void;
}) {
  const closed = item.status === 'done' || item.status === 'dismissed';
  // A resident request has no outside source page and is answered through Holler, so it gets Reply instead of the source link and draft.
  const isRequest = item.source === REQUEST_SOURCE;
  return (
    <Card as="article" className={closed ? 'opacity-70' : ''}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <Badge kind={item.kind} label={item.subtype === 'bid' ? 'Open bid' : undefined} />
        <span>{itemSourceLabel(item.source)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={item.occurredAt} className="font-mono text-xs tabular-nums">
          {item.ago}
        </time>
        {item.approxNote ? null : item.distance ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs tabular-nums">{item.distance}</span>
          </>
        ) : item.place ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{item.place}</span>
          </>
        ) : null}
        {item.status === 'saved' ? <StatusBadge tone="brand">Saved</StatusBadge> : null}
        {item.status === 'done' ? <StatusBadge tone="success">Done</StatusBadge> : null}
        {item.status === 'dismissed' ? <StatusBadge>Dismissed</StatusBadge> : null}
      </div>

      {item.approxNote ? <p className="mt-2 text-sm text-muted" data-testid="approx-note">{item.approxNote}</p> : null}
      <IntentNote item={item} />
      {item.bidLine ? <p className="mt-1 text-sm font-medium text-ink" data-testid="bid-line">{item.bidLine}</p> : null}
      {item.aiNote ? (
        <p className="mt-1 break-words text-sm text-ink">
          <span className="font-semibold">Why it may matter: </span>
          {item.aiNote}
        </p>
      ) : null}
      <h2 className="h-plain mt-2 text-lg leading-snug text-ink">{item.title}</h2>
      {item.summary ? <p className="mt-1 line-clamp-2 text-muted">{item.summary}</p> : null}

      {isRequest ? null : <WhoToContact item={item} contacts={item.contacts} />}

      <div className="mt-4 flex flex-wrap gap-2">
        {item.url && !isRequest ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-ink hover:bg-sand md:min-h-9"
          >
            {bidSourceLinkLabel(item.source)}
            <span className="sr-only"> (opens in a new tab)</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ) : null}
        {isRequest ? (
          <RequestReply matchId={item.id} state={replyState} onReplied={(id) => onReplied?.(id)} />
        ) : item.kind === 'ask' ? (
          <DraftControls item={item} onDraft={onDraft} />
        ) : null}
        {item.status === 'new' ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => onStatus(item.id, 'saved')}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => onStatus(item.id, 'done')}>Done</Button>
            <Button size="sm" variant="ghost" onClick={() => onStatus(item.id, 'dismissed')}>Dismiss</Button>
          </>
        ) : null}
        {item.status === 'saved' ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => onStatus(item.id, 'done')}>Done</Button>
            <Button size="sm" variant="ghost" onClick={() => onStatus(item.id, 'dismissed')}>Dismiss</Button>
            <Button size="sm" variant="ghost" onClick={() => onStatus(item.id, 'new')}>Unsave</Button>
          </>
        ) : null}
        {closed ? (
          <Button size="sm" variant="ghost" onClick={() => onStatus(item.id, 'new')}>Move back to inbox</Button>
        ) : null}
      </div>

      {/* key: a fresh draft from "Redraft reply" replaces whatever was edited. */}
      {item.kind === 'ask' && !isRequest && item.draft ? <DraftPanel key={item.draft} item={item} /> : null}

      {typeof item.signalId === 'number' ? <FeedbackButtons signalId={item.signalId} initial={item.feedback ?? null} /> : null}
    </Card>
  );
}

/** "Draft reply" button. The draft text itself renders in DraftPanel below the actions. */
function DraftControls({ item, onDraft }: { item: FeedItem; onDraft: (id: number, draft: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchId: item.id }),
      });
      if (res.status === 401) {
        hardNavigate('/login');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { draft?: string; message?: unknown };
      if (res.ok && body.draft) {
        onDraft(item.id, body.draft);
      } else if (res.status === 400 || res.status === 404) {
        setError('Drafts only work for people asking for help.');
      } else if ((res.status === 403 || res.status === 429 || res.status === 503) && typeof body.message === 'string') {
        setError(body.message);
      } else {
        setError("We couldn't write a draft just now. Try again.");
      }
    } catch {
      setError("We couldn't reach the server. Try again.");
    }
    setPending(false);
  }

  return (
    <>
      <Button size="sm" variant="primary" onClick={run} disabled={pending}>
        {pending ? 'Writing...' : item.draft ? 'Redraft reply' : 'Draft reply'}
      </Button>
      <p role="alert" className="w-full text-sm text-danger empty:hidden">
        {error}
      </p>
    </>
  );
}

function DraftPanel({ item }: { item: FeedItem }) {
  const [text, setText] = useState(item.draft ?? '');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 rounded-card border border-line bg-background p-4">
      <label htmlFor={`draft-${item.id}`} className="text-sm font-semibold text-ink">
        Your draft. Edit it, then post it yourself.
      </label>
      <textarea
        id={`draft-${item.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="mt-2 w-full resize-y rounded-control border border-line-strong bg-surface p-3 text-base text-ink hover:border-ink"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <span role="status" className="text-sm text-muted">
          {copied ? 'Copied to your clipboard.' : 'Holler never posts for you.'}
        </span>
      </div>
    </div>
  );
}

/** Paywall view: placeholders only. The server sends masked text, so nothing real sits behind the blur. */
export function LockedFeed({ items, children }: { items: FeedItem[]; children: React.ReactNode }) {
  return (
    <div className="relative min-h-[30rem]">
      <ul aria-hidden="true" inert className="pointer-events-none flex select-none flex-col gap-4 blur-[6px]">
        {items.slice(0, 4).map((item) => (
          <li key={item.id}>
            <Card as="article">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <Badge kind={item.kind} label={item.subtype === 'bid' ? 'Open bid' : undefined} />
                <span className="font-mono text-xs">{item.ago}</span>
                {item.distance ? <span className="font-mono text-xs">{item.distance}</span> : null}
              </div>
              <h2 className="h-plain mt-3 text-lg leading-snug">{item.title}</h2>
              <p className="mt-1 text-muted">{item.summary}</p>
              <WhoToContactLocked item={item} />
            </Card>
          </li>
        ))}
      </ul>
      <div className="absolute inset-x-0 top-6 mx-auto w-full max-w-md px-1 sm:top-10">{children}</div>
    </div>
  );
}
