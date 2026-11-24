'use client';

import { hardNavigate } from './format';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Notice } from './notice';
import { PasswordInput } from './password-input';
import { t, type DictKey, type Lang } from '@/lib/i18n';
import { STATS_CONSENT_TEXT } from '@/lib/auth/stats-consent';

/**
 * A form's words in its language (round 18 ES). English is the literal the form always printed, so English markup is unchanged; the
 * Spanish auth pages (/es/signup, /es/login, /es/forgot, /es/reset) pass lang 'es' and get the dictionary's words, Spanish links, and
 * send lang 'es' to the API so its answers are Spanish too.
 */
function wordsFor(lang: Lang) {
  return (key: DictKey, en: string) => (lang === 'en' ? en : t(lang, key));
}

/** The path of a page in the form's language: '/login' or '/es/login'. */
function pathFor(lang: Lang, path: string): string {
  return lang === 'en' ? path : `/es${path}`;
}

/** The request body: English bodies are exactly as before; a Spanish form adds lang. */
function withLang<T extends object>(lang: Lang, payload: T): T | (T & { lang: Lang }) {
  return lang === 'en' ? payload : { ...payload, lang };
}

interface ApiResult {
  ok: boolean;
  error?: string;
  next?: string;
  signedIn?: boolean;
}

async function post(url: string, payload: unknown, lang: Lang = 'en'): Promise<{ status: number; body: ApiResult }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({ ok: false }))) as ApiResult;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: { ok: false, error: wordsFor(lang)('auth.err.network', "We couldn't reach the server. Check your connection and try again.") } };
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

/**
 * Where a successful sign-up answer goes (round 24, review P3-2): onboarding when signed in, else the log-in page, except when the
 * statistics box was ticked and the account was not signed in: then the form stays and shows the note (an address that already had a
 * sign-in is not changed, so its box was not saved). Pure, so tests can check it without a browser.
 */
export function signupNext(body: { signedIn?: boolean }, statsConsent: boolean, lang: Lang, city?: string | null): string {
  if (body.signedIn) return `${pathFor(lang, '/onboarding')}${city ? `?city=${encodeURIComponent(city)}` : ''}`;
  if (statsConsent) return 'consent-note';
  return pathFor(lang, '/login');
}

export function SignupForm({ city, lang = 'en' }: { city?: string | null; lang?: Lang }) {
  const { pending, setPending, error, setError } = useFormRunner();
  const w = wordsFor(lang);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /**
   * Round 23: the data-use box. Optional and UNTICKED, and the account is created either way: nothing on this page depends on it, and
   * the button says nothing about it. Ticking it sends statsConsent true, which the API stores with the wording version and the time
   * (lib/auth/stats-consent.ts). Leaving it alone sends nothing and stores nothing. Settings can turn it off again later.
   */
  const [statsConsent, setStatsConsent] = useState(false);
  const [existingNote, setExistingNote] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { status, body } = await post('/api/auth/signup', withLang(lang, statsConsent ? { email, password, statsConsent: true } : { email, password }), lang);
    if (body.ok) {
      // Round 24 (review P3-2): an address that already has a sign-in (the shared sign-in with the owner's other products) is not
      // changed, so a ticked box is not saved for it. Say so before sending them to log in, in words that are true either way and do
      // not reveal whether the address was registered; Settings has the same box.
      const next = signupNext(body, statsConsent, lang, city);
      if (next === 'consent-note') {
        setExistingNote(true);
        setPending(false);
        return;
      }
      hardNavigate(next);
      return;
    }
    setError({ message: body.error ?? w('auth.err.generic', 'Something went wrong. Try again.'), status });
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <Input
        label={w('auth.email', 'Email')}
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
        label={w('auth.password', 'Password')}
        lang={lang}
        name="password"
        autoComplete="new-password"
        hint={w('auth.password_hint', 'At least 8 characters.')}
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <label className="flex cursor-pointer items-start gap-3 text-sm text-muted">
        <input
          type="checkbox"
          name="stats_consent"
          checked={statsConsent}
          onChange={(e) => setStatsConsent(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
        />
        {/* Round 24 (review P3-1): the box is optional, so the label says so first, as Settings does. The consent wording itself
            (STATS_CONSENT_TEXT and its version) is unchanged. */}
        <span>
          <span className="font-semibold text-ink">{w('consent.optional', 'Optional.')}</span> {w('consent.stats', STATS_CONSENT_TEXT)}
        </span>
      </label>
      {existingNote ? (
        <Notice tone="info" role="status">
          {w('consent.signup.existing', 'If this email already had an account, its choice about combined statistics did not change. You can set it in Settings after you log in.')}{' '}
          <Link href={pathFor(lang, '/login')} className="font-semibold underline">{w('auth.login', 'Log in')}</Link>
        </Notice>
      ) : null}
      <ErrorNotice error={error}>
        {error?.status === 409 ? <Link href={pathFor(lang, '/login')} className="font-semibold underline">{w('auth.login', 'Log in')}</Link> : null}
      </ErrorNotice>
      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? w('auth.signup.pending', 'Creating your account...') : w('auth.signup.submit', 'Create account')}
      </Button>
      <p className="text-center text-sm text-muted">
        {w('auth.signup.agree', 'By creating an account you agree to the')}{' '}
        <Link href="/terms" className="font-medium text-brand-text underline" {...(lang === 'en' ? {} : { hrefLang: 'en' })}>
          {w('auth.signup.terms', 'Terms')}
        </Link>{' '}
        {w('auth.signup.and', 'and')}{' '}
        <Link href="/privacy" className="font-medium text-brand-text underline" {...(lang === 'en' ? {} : { hrefLang: 'en' })}>
          {w('auth.signup.privacy', 'Privacy Policy')}
        </Link>
        .
      </p>
    </form>
  );
}

/**
 * Where to go after log-in (round 24, review P1-2): `next`, plus the alert email's card anchor when the login page was opened with one
 * (`/login?next=/app#card-123`: the hash never reaches the server, so `next` cannot carry it). Only a `#card-<digits>` hash is carried, and
 * only onto a `next` that has no hash of its own.
 */
export function nextWithCardHash(next: string, hash: string): string {
  return /^#card-\d{1,15}$/.test(hash) && !next.includes('#') ? next + hash : next;
}

export function LoginForm({ next, linkExpired, lang = 'en' }: { next: string; linkExpired?: boolean; lang?: Lang }) {
  const { pending, setPending, error, setError } = useFormRunner();
  const w = wordsFor(lang);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { status, body } = await post('/api/auth/login', withLang(lang, { email, password }), lang);
    if (body.ok) {
      // Round 24 (review P1-2): a signed-out member who opened an alert email's card link lands here as /login?next=/app#card-<id>. The
      // browser keeps the #card part on this page but `next` cannot carry it (the server never sees a hash), so it is added back here.
      hardNavigate(nextWithCardHash(next, window.location.hash));
      return;
    }
    setError({ message: body.error ?? w('auth.err.generic', 'Something went wrong. Try again.'), status });
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {linkExpired ? <Notice tone="warn">{w('auth.login.expired', 'That link has expired or was already used. Log in, or ask for a new reset link.')}</Notice> : null}
      <Input
        label={w('auth.email', 'Email')}
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
        label={w('auth.password', 'Password')}
        lang={lang}
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ErrorNotice error={error} />
      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? w('auth.login.pending', 'Logging in...') : w('auth.login', 'Log in')}
      </Button>
      <p className="text-center text-sm">
        <Link href={pathFor(lang, '/forgot')} className="inline-flex min-h-11 items-center font-medium text-brand-text underline">
          {w('auth.login.forgot', 'Forgot your password?')}
        </Link>
      </p>
    </form>
  );
}

export function ForgotForm({ linkExpired, lang = 'en' }: { linkExpired?: boolean; lang?: Lang }) {
  const { pending, setPending, error, setError } = useFormRunner();
  const w = wordsFor(lang);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { status, body } = await post('/api/auth/forgot', withLang(lang, { email }), lang);
    setPending(false);
    if (body.ok) {
      setSent(true);
      return;
    }
    setError({ message: body.error ?? w('auth.err.generic', 'Something went wrong. Try again.'), status });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4" role="status">
        {lang === 'en' ? (
        <Notice tone="success">
          If there is an account for <strong>{email}</strong>, a reset link is on its way. It can take a minute. Check spam too.
        </Notice>
        ) : (
          <Notice tone="success">
            {`${t(lang, 'auth.forgot.sent_pre')} `}
            <strong>{email}</strong>
            {t(lang, 'auth.forgot.sent_post')}
          </Notice>
        )}
        <Link href={pathFor(lang, '/login')} className="inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline">
          {w('auth.back_login', 'Back to log in')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {linkExpired ? <Notice tone="warn">{w('auth.forgot.expired', 'That reset link has expired or was already used. Ask for a new one.')}</Notice> : null}
      <Input
        label={w('auth.email', 'Email')}
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
        {pending ? w('auth.forgot.pending', 'Sending...') : w('auth.forgot.submit', 'Send reset link')}
      </Button>
    </form>
  );
}

export function ResetForm({ lang = 'en' }: { lang?: Lang }) {
  const { pending, setPending, error, setError } = useFormRunner();
  const w = wordsFor(lang);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setMismatch(w('auth.reset.mismatch', "Those passwords don't match."));
      return;
    }
    setMismatch(null);
    setPending(true);
    const { status, body } = await post('/api/auth/reset', withLang(lang, { password }), lang);
    if (body.ok) {
      hardNavigate('/app');
      return;
    }
    setError({ message: body.error ?? w('auth.err.generic', 'Something went wrong. Try again.'), status });
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <PasswordInput
        label={w('auth.reset.new', 'New password')}
        lang={lang}
        name="password"
        autoComplete="new-password"
        hint={w('auth.password_hint', 'At least 8 characters.')}
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <PasswordInput
        label={w('auth.reset.confirm', 'Confirm new password')}
        lang={lang}
        name="confirm"
        autoComplete="new-password"
        required
        minLength={8}
        error={mismatch}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <ErrorNotice error={error}>
        {error?.status === 401 ? <Link href={pathFor(lang, '/forgot')} className="font-semibold underline">{w('auth.reset.new_link', 'Get a new link')}</Link> : null}
      </ErrorNotice>
      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? w('auth.reset.pending', 'Saving...') : w('auth.reset.submit', 'Save new password')}
      </Button>
    </form>
  );
}
