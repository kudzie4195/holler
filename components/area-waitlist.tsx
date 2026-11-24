'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Select } from './select';
import type { TradeGroup } from '@/lib/check/trades';
import { WAITLIST, WAITLIST_EMAIL_MAX, WAITLIST_HONEYPOT, waitlistRefusal, type WaitlistCardWords } from '@/lib/waitlist/copy';

/**
 * The "Coming to your area" card on /check, for a ZIP Holler does not serve yet, or (round 23, `tradeLabel` set) for a ZIP it does serve
 * where the trade the visitor picked has nothing an owner could act on. Shown the way the "Coming next" list is: a heading,
 * one line, a ruled row. Email and trade (preselected from the check), the ZIP is carried in the card, one button. No account, no
 * login. The server (POST /api/waitlist) saves the row; this card only says what happened. No counts are shown anywhere.
 * The hidden `leave_blank` field is the honeypot (people never see it, simple bots fill it; the server accepts and drops it).
 */
export function AreaWaitlist({
  zip,
  trade,
  placeLabel,
  groups,
  tradeLabel = null,
  words = null,
  closed = false,
}: {
  zip: string;
  trade: string;
  placeLabel: string;
  /**
   * The trade options, already filtered on the server (components/check-form.tsx builds the same list). Round 23: they are passed in
   * rather than computed here, so this client component no longer imports lib/check/trades and lib/seo/signal-types, which dragged the
   * whole US ZIP table and the capability tables into the /check browser bundle, and so the waitlist list and the check list cannot
   * drift apart (the waitlist used to offer Locksmith, which sign-up refuses).
   */
  groups: TradeGroup[];
  tradeLabel?: string | null;
  /**
   * Round 24 INT2: the Spanish card on /es/check passes its finished words here and then posts lang 'es', so the confirmation email and
   * the confirm page are Spanish. Without it the card is the English one, byte for byte, and posts no language.
   */
  words?: WaitlistCardWords | null;
  /** Round 24 FIX2 (review P3-1): the trade is closed everywhere (sign-up does not take it): the note says so. */
  closed?: boolean;
}) {
  const headingId = useId();
  const statusId = useId();

  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const w = words ?? {
    ...WAITLIST,
    heading: tradeLabel ? WAITLIST.tradeHeading(tradeLabel.toLowerCase(), placeLabel) : WAITLIST.heading(placeLabel),
    intro: tradeLabel ? WAITLIST.tradeIntro : WAITLIST.intro,
    note: tradeLabel ? (closed ? WAITLIST.tradeClosedNote(tradeLabel.toLowerCase()) : WAITLIST.tradeNote) : WAITLIST.note,
    thanks: WAITLIST.thanks(placeLabel),
  };

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (state !== 'idle') return;
    const fd = new FormData(ev.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(w.errors.email);
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
          ...(words ? { lang: 'es' } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; field?: string } | null;
      if (data?.ok) {
        setState('done');
        setMessage(w.thanks);
        return;
      }
      // Round 24 (review P2-3): every refusal says what is wrong (lib/waitlist/copy.ts waitlistRefusal).
      const refusal = waitlistRefusal(data, w.errors);
      setEmailError(refusal.emailError);
      setMessage(refusal.message);
    } catch {
      setMessage(w.errors.network);
    }
    setState('idle');
  }

  return (
    <section aria-labelledby={headingId} className="mt-10">
      <p className="font-mono text-sm uppercase tracking-[0.06em] text-brand-text">{w.eyebrow}</p>
      <h2 id={headingId} className="mt-2 text-3xl text-ink md:text-4xl">
        {w.heading}
      </h2>
      <p className="mt-2 max-w-2xl text-muted">{w.intro}</p>
      <p className="mt-2 max-w-2xl text-muted">{w.note}</p>

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
                label={w.emailLabel}
                autoComplete="email"
                inputMode="email"
                required
                maxLength={WAITLIST_EMAIL_MAX}
                error={emailError}
              />
              <Select id="waitlist-trade" name="trade" label={w.tradeLabel} defaultValue={trade}>
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
                {state === 'sending' ? w.sending : w.button}
              </Button>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted">{w.privacy}</p>
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
