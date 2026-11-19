import { useState, type FormEvent } from 'react';
import { requestPasswordReset, signInWithEmail, signUpWithEmail, validEmail } from '../auth/email';
import { isSupabaseConfigured } from '../auth/supabase';
import { siteUrl } from '../lib/env';
import { http } from '../services';
import { useApp } from '../state/AppContext';
import { Button, Field, Notice, Screen, openInApp } from '../ui/kit';

export function Auth({ mode }: { mode: 'signin' | 'signup' | 'forgot' }) {
  const app = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const title = mode === 'signup' ? 'Start your free trial' : mode === 'signin' ? 'Log in' : 'Reset your password';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!validEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode !== 'forgot' && !isSupabaseConfigured()) {
      setError('Sign-in is not set up in this build yet.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (mode === 'signin' && !password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const res = await requestPasswordReset(http, email);
        if (res.ok) setSentTo(email.trim());
        else setError(res.message);
      } else if (mode === 'signup') {
        const res = await signUpWithEmail(http, email, password);
        if (res.kind === 'error') setError(res.message);
        else if (res.kind === 'log-in-instead') {
          setInfo(res.message);
          app.navigate({ name: 'auth', mode: 'signin' }, { replace: true });
        }
        // signed-in: the app moves on by itself (auth state change).
      } else {
        const res = await signInWithEmail(email, password);
        if (!res.ok) setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'forgot' && sentTo) {
    return (
      <Screen title={title}>
        <div className="stack">
          <Notice tone="success" role="status">
            If there is an account for <strong>{sentTo}</strong>, a reset link is on its way. It can take a minute. Check spam too.
          </Notice>
          <p className="muted">The link opens the Holler website, where you pick a new password. Then come back and log in.</p>
          <Button full onClick={() => app.navigate({ name: 'auth', mode: 'signin' }, { replace: true })}>
            Back to log in
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={title}>
      <form className="stack-lg" onSubmit={(e) => void submit(e)} noValidate>
        {mode === 'signup' ? <p className="muted">No card needed. It takes about a minute.</p> : null}
        {mode === 'forgot' ? <p className="muted">We will email you a link to set a new password.</p> : null}
        {info ? <Notice tone="info" role="status">{info}</Notice> : null}
        <Field
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete={mode === 'signin' ? 'username' : 'email'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode !== 'forgot' ? (
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" full disabled={busy}>
          {busy
            ? mode === 'signup'
              ? 'Creating your account...'
              : mode === 'signin'
                ? 'Logging in...'
                : 'Sending...'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'signin'
                ? 'Log in'
                : 'Send reset link'}
        </Button>
        {mode === 'signup' ? (
          <p className="small muted" style={{ textAlign: 'center' }}>
            By creating an account you agree to the{' '}
            <button type="button" className="link-btn" onClick={() => void openInApp(siteUrl('/terms'))}>Terms</button> and{' '}
            <button type="button" className="link-btn" onClick={() => void openInApp(siteUrl('/privacy'))}>Privacy Policy</button>.
            We will email you a link to confirm your address.
          </p>
        ) : null}
        {mode === 'signin' ? (
          <div className="stack" style={{ textAlign: 'center' }}>
            <button type="button" className="link-btn" onClick={() => app.navigate({ name: 'auth', mode: 'forgot' })}>
              Forgot your password?
            </button>
            <p className="small muted">
              New here?{' '}
              <button type="button" className="link-btn" onClick={() => app.navigate({ name: 'auth', mode: 'signup' }, { replace: true })}>
                Start your free trial
              </button>
            </p>
          </div>
        ) : null}
        {mode === 'signup' ? (
          <p className="small muted" style={{ textAlign: 'center' }}>
            Already have an account?{' '}
            <button type="button" className="link-btn" onClick={() => app.navigate({ name: 'auth', mode: 'signin' }, { replace: true })}>
              Log in
            </button>
          </p>
        ) : null}
      </form>
    </Screen>
  );
}
