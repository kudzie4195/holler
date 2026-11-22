'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button } from './button';
import { Input } from './input';

/**
 * "Coming to your area" card on the check page, shown when Holler has no permit or city-request data near a ZIP yet.
 * Same look as the Coming next cards. One email field; the ZIP and trade come from the check that was just run.
 * The answer is the same whether or not the address was already on the list.
 */
export function AreaWaitlist({ zip, trade, placeLabel, className = '' }: { zip: string; trade: string; placeLabel: string; className?: string }) {
  const headingId = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, zip, trade }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (data?.ok) setDone(true);
      else if (data?.error === 'invalid_email') setError('Enter a valid email address.');
      else if (data?.error === 'limited') setError('Too many tries. Try again in an hour.');
      else setError('Could not save that. Try again later.');
    } catch {
      setError('Could not save that. Try again later.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className={`rounded-card border border-line bg-surface p-5 sm:p-6 ${className}`}>
      <p className="text-sm font-semibold uppercase tracking-wide text-accent-text">Coming soon</p>
      <h2 id={headingId} className="mt-1 text-2xl text-ink">
        Holler is not in {placeLabel} yet.
      </h2>
      <p className="mt-2 text-ink/90">
        Storm alerts work here today. Building permits and city requests near you are next. Leave your email and we will send you one
        email when we launch here. Nothing else.
      </p>
      {done ? (
        <p role="status" className="mt-4 rounded-control bg-sky px-4 py-3 text-ink">
          Check your email and press the link to confirm. Then you are on the list.
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Input
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
            />
          </div>
          <Button type="submit" className="w-full shrink-0 sm:w-auto" disabled={busy}>
            {busy ? 'Saving' : 'Tell me when you launch'}
          </Button>
        </form>
      )}
    </section>
  );
}
