'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Select } from './select';
import { tradeGroups } from '@/lib/check/trades';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { WAITLIST, WAITLIST_EMAIL_MAX, WAITLIST_HONEYPOT } from '@/lib/waitlist/copy';

/**
 * The "Coming to your area" card on /check, for a ZIP Holler does not serve yet. Shown the way the "Coming next" list is: a heading,
 * one line, a ruled row. Email and trade (preselected from the check), the ZIP is carried in the card, one button. No account, no
 * login. The server (POST /api/waitlist) saves the row; this card only says what happened. No counts are shown anywhere.
 * The hidden `leave_blank` field is the honeypot (people never see it, simple bots fill it; the server accepts and drops it).
 */
export function AreaWaitlist({ zip, trade, placeLabel }: { zip: string; trade: string; placeLabel: string }) {
  const headingId = useId();
  const statusId = useId();
  // A trade no record type can reach on this deployment is left out of the list, as on the check form; the one passed in stays so
  // the visitor's own choice still shows.
  const groups = tradeGroups()
    .map((g) => ({ ...g, options: g.options.filter((o) => o.id === trade || !tradeComingSoon(o.id)) }))
    .filter((g) => g.options.length > 0);

  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (state !== 'idle') return;
    const fd = new FormData(ev.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(WAITLIST.errors.email);
      setMessage(null);
      return;
    }
    setEmailError(null);
    setMessage(null);
    setState('sending');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          email,
          zip,
          trade: fd.get('trade'),
          page: 'check',
          [WAITLIST_HONEYPOT]: fd.get(WAITLIST_HONEYPOT),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; field?: string } | null;
      if (data?.ok) {
        setState('done');
        setMessage(WAITLIST.thanks(placeLabel));
        return;
      }
      if (data?.error === 'invalid' && data.field === 'email') setEmailError(WAITLIST.errors.email);
      else if (data?.error === 'invalid') setMessage(WAITLIST.errors.invalid);
      else if (data?.error === 'limited') setMessage(WAITLIST.errors.limited);
      else setMessage(WAITLIST.errors.unavailable);
    } catch {
      setMessage(WAITLIST.errors.network);
    }
    setState('idle');
  }

  return (
    <section aria-labelledby={headingId} className="mt-10">
      <p className="font-mono text-sm uppercase tracking-[0.06em] text-brand-text">{WAITLIST.eyebrow}</p>
      <h2 id={headingId} className="mt-2 text-3xl text-ink md:text-4xl">
        {WAITLIST.heading(placeLabel)}
      </h2>
      <p className="mt-2 max-w-2xl text-muted">{WAITLIST.intro}</p>
      <p className="mt-2 max-w-2xl text-muted">{WAITLIST.note}</p>

      <div className="mt-6 border-t-2 border-ink pt-5">
        {state === 'done' ? (
          <p role="status" className="max-w-2xl text-lg font-semibold text-ink">
            {message}
          </p>
        ) : (
          <form onSubmit={onSubmit} noValidate aria-describedby={message ? statusId : undefined} className="max-w-3xl">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Input
                id="waitlist-email"
                name="email"
                type="email"
                label={WAITLIST.emailLabel}
                autoComplete="email"
                inputMode="email"
                required
                maxLength={WAITLIST_EMAIL_MAX}
                error={emailError}
              />
              <Select id="waitlist-trade" name="trade" label={WAITLIST.tradeLabel} defaultValue={trade}>
                {groups.map((g) =>
                  g.label ? (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    g.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))
                  ),
                )}
              </Select>
            </div>
            {/* Honeypot: hidden from people, screen readers and autofill (a name no autofill rule maps, autocomplete off, not focusable). */}
            <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
              <label htmlFor="waitlist-leave-blank">Leave this empty</label>
              <input id="waitlist-leave-blank" name={WAITLIST_HONEYPOT} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>
            <p className="mt-3 font-mono text-xs uppercase tracking-[0.06em] text-muted">ZIP {zip}</p>
            <div className="mt-4">
              <Button type="submit" size="lg" disabled={state === 'sending'} className="w-full sm:w-auto">
                {state === 'sending' ? WAITLIST.sending : WAITLIST.button}
              </Button>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted">{WAITLIST.privacy}</p>
            {/* Always in the layout, so a message never moves the form. role=status announces it. */}
            <p id={statusId} role="status" className="mt-2 min-h-6 text-sm text-danger">
              {message ?? ''}
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
