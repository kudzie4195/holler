import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiCallError } from '../api/client';
import type { AlertDto } from '../contract';
import { api } from '../services';
import { useApp } from '../state/AppContext';
import { plural } from '../ui/format';
import { family } from '../ui/kind';
import { Button, EmptyState, ErrorState, Loading, Notice, Screen, usePullToRefresh } from '../ui/kit';
import { AlertMeta, FeedbackButtons } from './AlertParts';

export function Feed() {
  const app = useApp();
  const [items, setItems] = useState<AlertDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // A notice ("You're on Pro...") is shown once: kept for this visit, then cleared app-wide.
  const [notice] = useState(app.notice);
  useEffect(() => {
    if (notice) app.setNotice(null);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.feed(null);
      setItems(res.items);
      setCursor(res.nextCursor);
      setLocked(res.locked);
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : "We couldn't load your alerts.");
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await api.feed(cursor);
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((i) => i.matchId));
        return [...(prev ?? []), ...res.items.filter((i) => !seen.has(i.matchId))];
      });
      setCursor(res.nextCursor);
      setLocked(res.locked);
    } catch (e) {
      setMoreError(e instanceof ApiCallError ? e.message : "We couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ended requests can leave a page short, so keep paging while a cursor exists and the end is in view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  const ptr = usePullToRefresh(async () => {
    await Promise.all([load(), app.reloadMe()]);
  });

  const access = app.me?.access;
  const profile = app.me?.profile;
  const showLocked = locked && app.access.state !== 'paid';

  return (
    <Screen
      title="Alerts"
      brand
      tabs
      back={false}
      end={
        <Button variant="ghost" small disabled={ptr.busy} onClick={() => void ptr.run()}>
          {ptr.busy ? 'Loading' : 'Refresh'}
        </Button>
      }
    >
      <div {...ptr.handlers}>
        <div className={`ptr ${ptr.pulling || ptr.busy ? 'show' : ''}`} aria-hidden="true">
          {ptr.busy ? 'Refreshing...' : 'Release to refresh'}
        </div>
        <div className="stack">
          {notice ? <Notice tone="success" role="status">{notice}</Notice> : null}
          {showLocked ? (
            <Notice tone="warn">
              <p style={{ fontWeight: 600 }}>Your free trial has ended.</p>
              <p style={{ marginTop: 4 }}>Alerts still arrive, but details stay hidden until you pick a plan.</p>
              <div style={{ marginTop: 10 }}>
                <Button small onClick={() => app.navigate({ name: 'paywall' })}>See plans</Button>
              </div>
            </Notice>
          ) : null}
          {!showLocked && access?.state === 'trial' && app.access.state === 'trial' ? (
            <Notice tone="info">
              {access.trialDaysLeft > 0 ? `${plural(access.trialDaysLeft, 'day', 'days')} left in your free trial.` : 'Your free trial ends today.'}{' '}
              <button type="button" className="link-btn" onClick={() => app.navigate({ name: 'paywall' })}>See plans</button>
            </Notice>
          ) : null}
          {profile && !profile.emailVerified ? (
            <Notice tone="info">Please confirm your email. We sent a link to {app.me?.user.email ?? 'your inbox'}.</Notice>
          ) : null}

          {error && !items ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          {!error && !items ? <Loading label="Loading your alerts" /> : null}
          {error && items ? <Notice tone="danger">{error}</Notice> : null}

          {items && items.length === 0 && !cursor ? (
            <EmptyState title="No alerts yet">
              <p className="muted">
                New matches for your trades{profile?.city ? ` around ${profile.city}` : ''} show up here as they come in. A wider radius or more trades finds more.
              </p>
              <div className="row">
                <Button small variant="secondary" onClick={() => app.navigate({ name: 'profile' })}>Edit trades and area</Button>
              </div>
            </EmptyState>
          ) : null}

          {items?.map((item) => (
            <article key={item.matchId} className={`card stripe-${family(item.kind)}`}>
              <button type="button" className="alert-card" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', minHeight: 44 }} onClick={() => app.navigate({ name: 'alert', signalId: item.signalId })}>
                <AlertMeta item={item} />
              </button>
              {!locked ? (
                <FeedbackButtons
                  compact
                  signalId={item.signalId}
                  initial={item.feedback}
                  onSaved={(f) => setItems((prev) => prev?.map((p) => (p.matchId === item.matchId ? { ...p, feedback: f } : p)) ?? prev)}
                />
              ) : null}
            </article>
          ))}

          <div ref={sentinel} />
          {cursor ? (
            <div className="stack">
              {moreError ? <Notice tone="danger">{moreError}</Notice> : null}
              <Button variant="secondary" full disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? 'Loading more...' : 'Load more'}
              </Button>
            </div>
          ) : items && items.length > 0 ? (
            <p className="small muted" style={{ textAlign: 'center' }}>That is everything for now.</p>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}
