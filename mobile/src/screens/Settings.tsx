import { useEffect, useState } from 'react';
import { ApiCallError } from '../api/client';
import { MANAGE_URLS } from '../contract';
import { config, siteUrl } from '../lib/env';
import { platform } from '../lib/platform';
import { currentStoreState, restoreMessage, restorePurchases, storeAvailable, PurchaseError } from '../purchases/purchases';
import { api, push } from '../services';
import { useApp } from '../state/AppContext';
import { pushIsOn } from '../state/member';
import { Button, Notice, Screen, Switch, openInApp } from '../ui/kit';
import { plural } from '../ui/format';

export function Settings() {
  const app = useApp();
  const me = app.me;
  const profile = me?.profile ?? null;
  const access = me?.access ?? null;
  // Push shows ON only when the server flag is on AND this phone has a token registered for this account.
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const [emailOn, setEmailOn] = useState(Boolean(profile?.alertEmail));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    setEmailOn(Boolean(profile?.alertEmail));
  }, [profile?.alertEmail]);

  useEffect(() => {
    let alive = true;
    void push.isRegistered().then((r) => {
      if (alive) setPushRegistered(r);
    });
    return () => {
      alive = false;
    };
  }, [profile?.pushAlerts]);

  const pushOn = pushIsOn(profile?.pushAlerts, pushRegistered);

  const planName = app.config?.plans?.[app.access.tier === 'pro' ? 'pro' : 'solo']?.name ?? (app.access.tier === 'pro' ? 'Pro' : 'Solo');
  const planLine =
    app.access.state === 'paid'
      ? `${planName} plan`
      : app.access.state === 'trial' && access
        ? `Free trial, ${plural(access.trialDaysLeft, 'day', 'days')} left`
        : 'Trial over, no plan yet';

  async function setPush(on: boolean) {
    setMessage(null);
    setBusy('push');
    try {
      if (on) {
        const res = await push.enable();
        if (res === 'denied') {
          setMessage({ tone: 'warn', text: 'Notifications are off for Holler in your phone settings. Turn them on there first.' });
          return;
        }
        if (res !== 'enabled') {
          setMessage({ tone: 'warn', text: "Notifications aren't available on this phone right now." });
          return;
        }
        await push.markPromptSeen();
      } else {
        await push.disable();
      }
      setPushRegistered(await push.isRegistered());
      app.setMe(await api.updateProfile({ pushAlerts: on }));
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof ApiCallError ? e.message : "That didn't save. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function setEmail(on: boolean) {
    setMessage(null);
    setBusy('email');
    try {
      app.setMe(await api.updateProfile({ alertEmail: on }));
      setEmailOn(on);
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof ApiCallError ? e.message : "That didn't save. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setMessage(null);
    setBusy('restore');
    try {
      const result = await restorePurchases(app.session?.user.id);
      if (result.kind === 'restored') {
        // The UI unlocks from the store at once; the server catches up while we poll.
        app.setStoreEntitlement(result.entitlement);
        void app.pollUntilPaid();
      } else if (result.kind === 'none') app.setStoreEntitlement(null);
      setMessage(restoreMessage(result));
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof PurchaseError ? e.message : 'We could not restore right now. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function manage() {
    if (access?.billingSource === 'stripe') {
      setMessage({ tone: 'warn', text: 'Your plan is billed through the Holler website. Log in at localholler.com and open Settings to change it.' });
      return;
    }
    const st = await currentStoreState(app.session?.user.id);
    const fallback = platform() === 'android' ? MANAGE_URLS.google : MANAGE_URLS.apple;
    await openInApp(st?.managementUrl || (access?.billingSource === 'apple' || access?.billingSource === 'google' ? access.manageUrl : null) || fallback);
  }

  const links = app.config?.links;
  const store = storeAvailable();
  const pushAvailable = push.available();

  return (
    <Screen title="Settings" tabs back={false}>
      <div>
        {message ? <Notice tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>{message.text}</Notice> : null}

        <p className="section-label">Account</p>
        <div className="settings-list">
          <div>
            <span>Email</span>
            <span className="muted small" style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{me?.user.email ?? 'Not shared'}</span>
          </div>
          <button type="button" onClick={() => app.navigate({ name: 'profile' })}>
            <span>Business, trades and area</span>
            <span className="muted" aria-hidden="true">›</span>
          </button>
        </div>

        <p className="section-label">Alerts</p>
        <div className="settings-list">
          {pushAvailable ? (
            <div>
              <span>Push notifications</span>
              {pushOn ? (
                <Switch label="Push notifications" checked disabled={busy !== null || !profile} onChange={(v) => void setPush(v)} />
              ) : (
                <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="muted small">Off</span>
                  <Button small variant="secondary" disabled={busy !== null || !profile || pushRegistered === null} onClick={() => void setPush(true)}>
                    {busy === 'push' ? 'Turning on...' : 'Turn on'}
                  </Button>
                </span>
              )}
            </div>
          ) : (
            <div>
              <span>Push notifications</span>
              <span className="muted small">Not available in this build</span>
            </div>
          )}
          <div>
            <span>Email digest</span>
            <Switch label="Email digest" checked={emailOn} disabled={busy !== null || !profile} onChange={(v) => void setEmail(v)} />
          </div>
        </div>

        <p className="section-label">Plan</p>
        <div className="settings-list">
          <div>
            <span>Current plan</span>
            <span className="muted small">{planLine}</span>
          </div>
          <button type="button" onClick={() => app.navigate({ name: 'paywall' })}>
            <span>{app.access.state === 'paid' ? 'Plans' : 'See plans'}</span>
            <span className="muted" aria-hidden="true">›</span>
          </button>
          {store ? (
            <button type="button" disabled={busy !== null} onClick={() => void restore()}>
              <span>{busy === 'restore' ? 'Restoring...' : 'Restore purchases'}</span>
            </button>
          ) : null}
          {store || access?.billingSource === 'stripe' ? (
            <button type="button" onClick={() => void manage()}>
              <span>Manage subscription</span>
              <span className="muted" aria-hidden="true">›</span>
            </button>
          ) : null}
        </div>

        <p className="section-label">Help</p>
        <div className="settings-list">
          <button type="button" onClick={() => void openInApp(links?.terms ?? siteUrl('/terms'))}>Terms of Use</button>
          <button type="button" onClick={() => void openInApp(links?.privacy ?? siteUrl('/privacy'))}>Privacy Policy</button>
          <button type="button" onClick={() => void openInApp(links?.support ?? siteUrl('/about'), { supportMailto: links?.support })}>Support</button>
        </div>

        <div className="stack" style={{ marginTop: 24 }}>
          {/* Never disabled by a store call or a save: Sign out always works. */}
          <Button variant="secondary" full onClick={() => void app.signOut()}>
            Sign out
          </Button>
          <Button variant="danger" full onClick={() => app.navigate({ name: 'delete' })}>
            Delete account
          </Button>
          <p className="tiny muted" style={{ textAlign: 'center' }}>Holler {config.appVersion}</p>
        </div>
      </div>
    </Screen>
  );
}
