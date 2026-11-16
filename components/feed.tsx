'use client';

import { hardNavigate } from './format';
import { useMemo, useState, useTransition } from 'react';
import { Badge, StatusBadge } from './badge';
import { Button, ButtonLink } from './button';
import { Card } from './card';
import { EmptyState } from './empty-state';
import { setMatchStatus } from '@/app/app/actions';
import { sourceLabel } from './signal-meta';
import { CADENCE_SHORT } from '@/lib/seo/cadence';

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
}

type Filter = 'all' | 'ask' | 'signals';

export function Feed({
  items: initial,
  cityPage,
}: {
  items: FeedItem[];
  cityPage: { href: string; label: string } | null;
}) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter matches" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={filter === t.id}
              onClick={() => setFilter(t.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
                filter === t.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:border-ink/40'
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
              className="h-4 w-4 accent-[var(--color-accent)]"
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
              <MatchCard item={item} onStatus={update} onDraft={setDraft} />
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
}: {
  item: FeedItem;
  onStatus: (id: number, status: MatchStatus) => void;
  onDraft: (id: number, draft: string) => void;
}) {
  const closed = item.status === 'done' || item.status === 'dismissed';
  return (
    <Card as="article" className={closed ? 'opacity-70' : ''}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <Badge kind={item.kind} />
        <span>{sourceLabel(item.source)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={item.occurredAt} className="font-mono text-xs tabular-nums">
          {item.ago}
        </time>
        {item.distance ? (
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
        {item.status === 'saved' ? <StatusBadge tone="accent">Saved</StatusBadge> : null}
        {item.status === 'done' ? <StatusBadge tone="success">Done</StatusBadge> : null}
        {item.status === 'dismissed' ? <StatusBadge>Dismissed</StatusBadge> : null}
      </div>

      <h2 className="mt-3 text-lg font-semibold leading-snug text-ink">{item.title}</h2>
      {item.summary ? <p className="mt-1 line-clamp-2 text-muted">{item.summary}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-ink/40 md:min-h-9"
          >
            Open source
            <span className="sr-only"> (opens in a new tab)</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ) : null}
        {item.kind === 'ask' ? <DraftControls item={item} onDraft={onDraft} /> : null}
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
      {item.kind === 'ask' && item.draft ? <DraftPanel key={item.draft} item={item} /> : null}
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
      const body = (await res.json().catch(() => ({}))) as { draft?: string };
      if (res.ok && body.draft) {
        onDraft(item.id, body.draft);
      } else if (res.status === 400 || res.status === 404) {
        setError('Drafts only work for people asking for help.');
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
    <div className="mt-4 rounded-xl border border-line bg-background p-4">
      <label htmlFor={`draft-${item.id}`} className="text-sm font-semibold text-ink">
        Your draft. Edit it, then post it yourself.
      </label>
      <textarea
        id={`draft-${item.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="mt-2 w-full resize-y rounded-xl border border-line bg-surface p-3 text-base text-ink hover:border-ink/40"
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
                <Badge kind={item.kind} />
                <span className="font-mono text-xs">{item.ago}</span>
                {item.distance ? <span className="font-mono text-xs">{item.distance}</span> : null}
              </div>
              <h2 className="mt-3 text-lg font-semibold leading-snug">{item.title}</h2>
              <p className="mt-1 text-muted">{item.summary}</p>
            </Card>
          </li>
        ))}
      </ul>
      <div className="absolute inset-x-0 top-6 mx-auto w-full max-w-md px-1 sm:top-10">{children}</div>
    </div>
  );
}
