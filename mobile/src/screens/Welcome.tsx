import { useState } from 'react';
import { isUserCancelled } from '../auth/callback';
import { isSupabaseConfigured } from '../auth/supabase';
import { signInWithApple, signInWithGoogle, socialButtonsFor, type SocialProvider } from '../auth/social';
import { config } from '../lib/env';
import { useApp } from '../state/AppContext';
import { Button, Mark, Notice } from '../ui/kit';

function AppleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 17 20" aria-hidden="true" fill="currentColor">
      <path d="M14.2 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4zM11.7 3c.7-.9 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function Welcome() {
  const app = useApp();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttons = socialButtonsFor(config.flags);
  const trialDays = app.config?.trialDays;

  async function social(provider: SocialProvider) {
    setError(null);
    if (!isSupabaseConfigured()) {
      setError('Sign-in is not set up in this build yet.');
      return;
    }
    setBusy(provider);
    try {
      const run = provider === 'apple' ? signInWithApple : signInWithGoogle;
      await run();
      // Signed in (Apple on iPhone), or the browser is open and the callback finishes the trip.
    } catch (e) {
      if (!isUserCancelled(e)) setError("That sign-in didn't go through. Try again, or use your email.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app">
      <div className="scroll">
        <div className="center-screen stack-lg">
          <div className="brand">
            <Mark size={40} />
            <span>Holler</span>
          </div>
          <div className="stack">
            <h2 className="title">Find nearby work in public records.</h2>
            <p className="muted">
              Permits, storm reports and local requests near you, sorted for your trade. New ones reach your phone.
              {trialDays ? ` Free for ${trialDays} days, no card.` : ''}
            </p>
          </div>
          {app.notice ? <Notice tone="warn">{app.notice}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="stack">
            {buttons.includes('apple') ? (
              <Button variant="dark" className="apple-btn" full disabled={busy !== null} onClick={() => void social('apple')}>
                <AppleLogo />
                {busy === 'apple' ? 'Opening Apple...' : 'Sign in with Apple'}
              </Button>
            ) : null}
            {buttons.includes('google') ? (
              <Button variant="secondary" className="google-btn" full disabled={busy !== null} onClick={() => void social('google')}>
                <GoogleLogo />
                {busy === 'google' ? 'Opening Google...' : 'Continue with Google'}
              </Button>
            ) : null}
            {buttons.length ? <div className="divider">or</div> : null}
            <Button full onClick={() => { app.setNotice(null); app.navigate({ name: 'auth', mode: 'signup' }); }}>
              Sign up with email
            </Button>
            <Button variant="secondary" full onClick={() => { app.setNotice(null); app.navigate({ name: 'auth', mode: 'signin' }); }}>
              Log in
            </Button>
          </div>
          <p className="small muted" style={{ textAlign: 'center' }}>
            Want to look first?{' '}
            <button type="button" className="link-btn" onClick={() => app.navigate({ name: 'check' })}>
              Check your area
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
