import { useCallback, useEffect, useState } from 'react';
import { ApiCallError } from '../api/client';
import type { AlertDto } from '../contract';
import { api } from '../services';
import { useApp } from '../state/AppContext';
import { shortDate } from '../ui/format';
import { Button, ErrorState, Loading, Notice, Screen, openInApp } from '../ui/kit';
import { AlertMeta, Contacts, FeedbackButtons } from './AlertParts';

export function AlertDetail({ signalId }: { signalId: number }) {
  const app = useApp();
  const [item, setItem] = useState<AlertDto | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.alert(signalId);
      setItem(res.item);
      setLocked(res.locked);
    } catch (e) {
      const notFound = e instanceof ApiCallError && e.code === 'not_found';
      setError({ message: notFound ? 'This alert is no longer available. It may have ended.' : e instanceof ApiCallError ? e.message : "We couldn't load this alert.", notFound });
    }
  }, [signalId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title="Alert" tabs>
      {error ? (
        error.notFound ? (
          <div className="card stack">
            <h3>Alert not found</h3>
            <p className="muted">{error.message}</p>
            <Button variant="secondary" onClick={() => app.navigate({ name: 'feed' }, { reset: true })}>Back to alerts</Button>
          </div>
        ) : (
          <ErrorState message={error.message} onRetry={() => void load()} />
        )
      ) : !item ? (
        <Loading label="Loading the alert" />
      ) : (
        <div className="stack">
          <article className="card">
            <AlertMeta item={item} />
            {item.summary ? <p style={{ marginTop: 12, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{item.summary}</p> : null}
            <dl className="small" style={{ margin: '12px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
              <dt className="muted">Date</dt>
              <dd style={{ margin: 0 }}>{shortDate(item.occurredAt)}</dd>
              {item.expiresAt ? (
                <>
                  <dt className="muted">Ends</dt>
                  <dd style={{ margin: 0 }}>{shortDate(item.expiresAt)}</dd>
                </>
              ) : null}
              {item.county ? (
                <>
                  <dt className="muted">County</dt>
                  <dd style={{ margin: 0 }}>{item.county}</dd>
                </>
              ) : null}
            </dl>
            {item.url ? (
              <div style={{ marginTop: 14 }}>
                <Button full variant="secondary" onClick={() => void openInApp(item.url as string)}>
                  Open the source record
                </Button>
              </div>
            ) : null}
            {!locked ? <FeedbackButtons signalId={item.signalId} initial={item.feedback} onSaved={(f) => setItem({ ...item, feedback: f })} /> : null}
          </article>

          {locked ? (
            <Notice tone="warn">
              <p>Pick a plan to see the full record, the link and who to contact.</p>
              <div style={{ marginTop: 10 }}>
                <Button small onClick={() => app.navigate({ name: 'paywall' })}>See plans</Button>
              </div>
            </Notice>
          ) : null}

          <Contacts contacts={item.contacts} />

          {item.draft ? (
            <section className="card stack">
              <h3>Your saved draft</h3>
              <p style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{item.draft}</p>
            </section>
          ) : null}

          {item.sourceUrl && item.sourceLabel ? (
            <p className="small muted">
              Data from{' '}
              <button type="button" className="link-btn" onClick={() => void openInApp(item.sourceUrl as string)}>
                {item.sourceLabel}
              </button>
            </p>
          ) : null}
        </div>
      )}
    </Screen>
  );
}
