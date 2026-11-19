import { useState } from 'react';
import { api, push } from '../services';
import { useApp } from '../state/AppContext';
import { Button, Mark, Notice } from '../ui/kit';

/** The plain screen shown once, after onboarding, before the system asks about notifications. */
export function PushPrompt() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function done() {
    await push.markPromptSeen();
    app.navigate({ name: 'feed' }, { reset: true });
  }

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    const result = await push.enable();
    if (result === 'enabled') {
      try {
        app.setMe(await api.updateProfile({ pushAlerts: true }));
      } catch {
        /* the token is registered; the switch in Settings can fix the setting later */
      }
      await done();
      return;
    }
    setBusy(false);
    if (result === 'denied') setMessage('Notifications are off for Holler. You can turn them on later in your phone settings.');
    else setMessage("Notifications aren't available on this phone right now. Your alerts are still in the app.");
  }

  return (
    <div className="app">
      <div className="scroll">
        <div className="center-screen stack-lg">
          <Mark size={48} />
          <h2 className="title">Hear about new work first</h2>
          <div className="stack">
            <p>When a new permit, storm report or local request matches your trades and area, Holler can send a notification.</p>
            <p className="muted">At most one an hour. Tap it to open the alert. You can turn this off in Settings any time.</p>
          </div>
          {message ? <Notice tone="warn">{message}</Notice> : null}
          <div className="stack">
            {message ? (
              <Button full onClick={() => void done()}>
                Go to my alerts
              </Button>
            ) : (
              <>
                <Button full disabled={busy} onClick={() => void turnOn()}>
                  {busy ? 'Turning on...' : 'Turn on alerts'}
                </Button>
                <Button variant="secondary" full disabled={busy} onClick={() => void done()}>
                  Not now
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
