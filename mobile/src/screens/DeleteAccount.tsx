import { useState } from 'react';
import { ApiCallError } from '../api/client';
import type { DeleteAccountResponse } from '../contract';
import { api } from '../services';
import { useApp } from '../state/AppContext';
import { Button, Field, Notice, Screen, openInApp } from '../ui/kit';

export function DeleteAccount() {
  const app = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DeleteAccountResponse | null>(null);

  async function remove() {
    if (typed !== 'DELETE') return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.deleteAccount();
      if (res.storeSubscription) setDone(res);
      else await app.signOut();
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : 'We could not delete your account. Nothing was removed. Try again.');
      setBusy(false);
    }
  }

  if (done?.storeSubscription) {
    const where = done.storeSubscription.store === 'apple' ? 'the App Store' : 'Google Play';
    return (
      <Screen title="Account deleted" back={false}>
        <div className="stack-lg">
          <Notice tone="success" role="status">Your Holler account is deleted.</Notice>
          <div className="card stack">
            <h3>One more step</h3>
            <p>Your subscription is billed by {where}, and we can't cancel it for you. Cancel it there so you are not charged again.</p>
            <Button full onClick={() => void openInApp(done.storeSubscription!.manageUrl)}>Open subscriptions</Button>
          </div>
          <Button variant="secondary" full onClick={() => void app.signOut()}>Done</Button>
        </div>
      </Screen>
    );
  }

  return (
    // Also reached from onboarding, before there is a profile: no tab bar then, Back returns to onboarding.
    <Screen title="Delete account" tabs={!app.me?.needsOnboarding}>
      <div className="stack-lg">
        <div className="stack">
          <p>This deletes your Holler profile, your alerts, your feedback and your devices. It can't be undone.</p>
          <p className="muted">A plan billed through the website is canceled for you. A plan bought in the App Store or Google Play must be canceled there.</p>
        </div>
        <Field
          id="confirm-delete"
          label="Type DELETE to confirm"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value.trim())}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button variant="danger" full disabled={typed !== 'DELETE' || busy} onClick={() => void remove()}>
          {busy ? 'Deleting...' : 'Delete my account'}
        </Button>
        <Button variant="secondary" full disabled={busy} onClick={app.back}>
          Keep my account
        </Button>
      </div>
    </Screen>
  );
}
