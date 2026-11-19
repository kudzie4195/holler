'use client';

import { hardNavigate } from './format';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Notice } from './notice';
import { PasswordInput } from './password-input';

interface ApiResult {
  ok: boolean;
  error?: string;
  next?: string;
  signedIn?: boolean;
}

async function post(url: string, payload: unknown): Promise<{ status: number; body: ApiResult }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({ ok: false }))) as ApiResult;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: { ok: false, error: "We couldn't reach the server. Check your connection and try again." } };
  }
}

function useFormRunner() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  return { pending, setPending, error, setError };
}

function ErrorNotice({ error, children }: { error: { message: string; status: number } | null; children?: React.ReactNode }) {
  if (!error) return null;
  return (
    <Notice tone="danger" role="alert">
      {error.message} {children}
    </Notice>
  );
}

export function SignupForm({ city }: { city?: string | null }) {
  const { pending, setPending, error, setError } = useFormRunner();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { status, body } = await post('/api/auth/signup', { email, password });
    if (body.ok) {
      const target = body.signedIn ? `/onboarding${city ? `?city=${encodeURIComponent(city)}` : ''}` : '/login';
      hardNavigate(target);
      return;
    }
    setError({ message: body.error ?? 'Something went wrong. Try again.', status });
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PasswordInput
        label="Password"
        name="password"
        autoComplete="new-password"
        hint="At least 8 characters."
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ErrorNotice error={error}>
        {error?.status === 409 ? <Link href="/login" className="font-semibold underline">Log in</Link> : null}
      </ErrorNotice>
      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? 'Creating your account...' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-muted">
        By creating an account you agree to the{' '}
        <Link href="/terms" className="font-medium text-brand-text underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="font-medium text-brand-text underline">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}

export function LoginForm({ next, linkExpired }: { next: string; linkExpired?: boolean }) {
  const { pending, setPending, error, setError } = useFormRunner();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { status, body } = await post('/api/auth/login', { email, password });
    if (body.ok) {
      hardNavigate(next);
      return;
    }
    setError({ message: body.error ?? 'Something went wrong. Try again.', status });
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {linkExpired ? <Notice tone="warn">That link has expired or was already used. Log in, or ask for a new reset link.</Notice> : null}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PasswordInput
        label="Password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ErrorNotice error={error} />
      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? 'Logging in...' : 'Log in'}
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot" className="inline-flex min-h-11 items-center font-medium text-brand-text underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

export function ForgotForm({ linkExpired }: { linkExpired?: boolean }) {
  const { pending, setPending, error, setError } = useFormRunner();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { status, body } = await post('/api/auth/forgot', { email });
    setPending(false);
    if (body.ok) {
      setSent(true);
      return;
    }
    setError({ message: body.error ?? 'Something went wrong. Try again.', status });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <Notice tone="success">
          If there is an account for <strong>{email}</strong>, a reset link is on its way. It can take a minute. Check spam too.
        </Notice>
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {linkExpired ? <Notice tone="warn">That reset link has expired or was already used. Ask for a new one.</Notice> : null}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <ErrorNotice error={error} />
      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? 'Sending...' : 'Send reset link'}
      </Button>
    </form>
  );
}

export function ResetForm() {
  const { pending, setPending, error, setError } = useFormRunner();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setMismatch("Those passwords don't match.");
      return;
    }
    setMismatch(null);
    setPending(true);
    const { status, body } = await post('/api/auth/reset', { password });
    if (body.ok) {
      hardNavigate('/app');
      return;
    }
    setError({ message: body.error ?? 'Something went wrong. Try again.', status });
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <PasswordInput
        label="New password"
        name="password"
        autoComplete="new-password"
        hint="At least 8 characters."
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <PasswordInput
        label="Confirm new password"
        name="confirm"
        autoComplete="new-password"
        required
        minLength={8}
        error={mismatch}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <ErrorNotice error={error}>
        {error?.status === 401 ? <Link href="/forgot" className="font-semibold underline">Get a new link</Link> : null}
      </ErrorNotice>
      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? 'Saving...' : 'Save new password'}
      </Button>
    </form>
  );
}
