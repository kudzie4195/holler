import { useEffect, useState, type FormEvent } from 'react';
import { ApiCallError } from '../api/client';
import type { CheckResponse } from '../contract';
import { api } from '../services';
import { useApp } from '../state/AppContext';
import { cleanZip, relativeDay } from '../ui/format';
import { Button, ErrorState, Field, Loading, Notice, Screen } from '../ui/kit';

/** The free area check. Works signed out. */
export function Check() {
  const app = useApp();
  const signedIn = Boolean(app.session) && app.phase === 'ready';
  const trades = app.config?.trades ?? [];
  const [zip, setZip] = useState(app.me?.profile?.zip ?? '');
  const [trade, setTrade] = useState(app.me?.profile?.trades?.[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResponse | null>(null);

  useEffect(() => {
    if (!trade && trades.length) setTrade(trades[0].id);
  }, [trade, trades]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{5}$/.test(zip)) {
      setError('Enter a 5-digit ZIP code.');
      return;
    }
    if (!trade) {
      setError('Pick a trade.');
      return;
    }
    setBusy(true);
    try {
      setResult(await api.check(zip, trade));
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : "We couldn't run that check. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Area check" tabs={signedIn} back={signedIn ? false : undefined}>
      <div className="stack-lg">
        <p className="muted">See what public records show near a ZIP code for one trade. Free, no account needed.</p>
        {!app.config ? (
          app.configError ? <ErrorState message={app.configError} onRetry={() => void app.reloadConfig()} /> : <Loading />
        ) : (
          <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
            <Field id="check-zip" label="ZIP code" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zip} onChange={(e) => setZip(cleanZip(e.target.value))} />
            <div className="field">
              <label htmlFor="check-trade">Trade</label>
              <select id="check-trade" value={trade} onChange={(e) => setTrade(e.target.value)}>
                {trades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button type="submit" full disabled={busy}>
              {busy ? 'Checking...' : 'Check this area'}
            </Button>
          </form>
        )}

        {result ? <CheckResults result={result} /> : null}

        {!signedIn ? (
          <div className="card stack">
            <h3>Get these as alerts</h3>
            <p className="muted">Holler watches your area and sends new matches to your phone.</p>
            <Button full onClick={() => app.navigate({ name: 'auth', mode: 'signup' })}>Start your free trial</Button>
          </div>
        ) : null}
      </div>
    </Screen>
  );
}

function CheckResults({ result }: { result: CheckResponse }) {
  const where = `${result.place.city}, ${result.place.state} ${result.place.zip}`.trim();
  if (result.mode === 'limited') return <Notice tone="warn">Too many checks in a short time. Wait a minute, then try again.</Notice>;
  if (result.mode === 'unreadable') return <Notice tone="warn">We couldn't read the records for this area just now. Try again later.</Notice>;
  if (result.mode === 'uncovered') {
    return (
      <div className="card stack">
        <h3>Not covered yet</h3>
        <p className="muted">We don't have public record sources for {where} yet. Try a nearby ZIP code.</p>
      </div>
    );
  }
  const total = result.groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) {
    return (
      <div className="card stack">
        <h3>Nothing recent</h3>
        <p className="muted">No recent {result.trade.label.toLowerCase()} records near {where}. That can change any day.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      <h3>
        Near {where} for {result.trade.label.toLowerCase()}
      </h3>
      {result.groups.map((g) =>
        g.items.length ? (
          <section key={g.id} className="stack">
            <p className="section-label" style={{ margin: '8px 4px 0' }}>{g.title}</p>
            {g.items.map((i) => (
              <div key={i.id} className="card">
                <p style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{i.title}</p>
                <div className="meta">
                  {i.place ? <span>{i.place}</span> : null}
                  <span>{relativeDay(i.occurredAt)}</span>
                  {i.distanceMi != null ? <span>{i.distanceMi < 1 ? 'under 1 mi away' : `${i.distanceMi.toFixed(1)} mi away`}</span> : null}
                </div>
                {i.sourceLabel ? <p className="tiny muted" style={{ marginTop: 4 }}>Source: {i.sourceLabel}</p> : null}
              </div>
            ))}
          </section>
        ) : null,
      )}
    </div>
  );
}
