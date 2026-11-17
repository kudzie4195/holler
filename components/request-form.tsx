'use client';

import Link from 'next/link';
import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from './button';
import { Field, controlClasses } from './field';
import { hardNavigate } from './format';
import { Input } from './input';
import { Select } from './select';

export interface RequestTradeGroup {
  label: string | null;
  options: { id: string; label: string }[];
}

type FieldName = 'trade' | 'zip' | 'description' | 'email' | 'consent';
type Errors = Partial<Record<FieldName, string>>;

// Mirrors lib/requests/constants.ts (kept literal so this client file imports no server code).
const DESC_MIN = 20;
const DESC_MAX = 500;
const ORDER: FieldName[] = ['trade', 'zip', 'description', 'email', 'consent'];

const noop = () => () => {};

/**
 * The /request form. A plain POST to /api/requests that works with no JavaScript (the browser checks required fields and lengths,
 * the server answers with a redirect to /request/sent). With JavaScript it posts JSON instead, keeps what was typed when something
 * needs fixing, and shows each problem next to its field.
 */
export function RequestForm({ groups }: { groups: RequestTradeGroup[] }) {
  const enhanced = useSyncExternalStore(noop, () => true, () => false);
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [length, setLength] = useState(0);
  const descId = useId();
  const consentId = useId();

  function check(form: HTMLFormElement): Errors {
    const v = (n: string) => String((form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '').trim();
    const e: Errors = {};
    if (!v('trade')) e.trade = 'Pick what you need.';
    if (!/^\d{5}$/.test(v('zip'))) e.zip = 'Enter a 5-digit ZIP code.';
    const d = v('description');
    if (d.length < DESC_MIN) e.description = `Tell businesses a bit more. Use at least ${DESC_MIN} characters.`;
    else if (d.length > DESC_MAX) e.description = `Keep it under ${DESC_MAX} characters.`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) e.email = 'Check your email address.';
    if (!(form.elements.namedItem('consent') as HTMLInputElement | null)?.checked) e.consent = 'Tick the box to say you agree.';
    return e;
  }

  function focusFirst(e: Errors) {
    const first = ORDER.find((k) => e[k]);
    if (!first || !formRef.current) return;
    (formRef.current.elements.namedItem(first) as HTMLElement | null)?.focus();
  }

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    if (!enhanced) return; // plain form post
    ev.preventDefault();
    const form = ev.currentTarget;
    const local = check(form);
    setErrors(local);
    setMessage(null);
    if (Object.keys(local).length > 0) {
      setMessage('Check the highlighted fields and try again.');
      focusFirst(local);
      return;
    }
    const fd = new FormData(form);
    const body = {
      trade: fd.get('trade'),
      zip: fd.get('zip'),
      description: fd.get('description'),
      email: fd.get('email'),
      consent: fd.get('consent') === 'on',
      leave_blank: fd.get('leave_blank'),
    };
    setPending(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; errors?: Errors; message?: string };
      if (res.ok && json.ok) {
        hardNavigate('/request/sent');
        return;
      }
      const serverErrors = json.errors ?? {};
      setErrors(serverErrors);
      setMessage(json.message ?? "We couldn't take your request just now. Try again in a few minutes.");
      focusFirst(serverErrors);
    } catch {
      setMessage("We couldn't reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form
      ref={formRef}
      action="/api/requests"
      method="post"
      noValidate={enhanced}
      onSubmit={onSubmit}
      className="flex flex-col gap-5"
      aria-describedby={message ? 'request-form-message' : undefined}
    >
      <p id="request-form-message" role="alert" className="text-sm font-medium text-danger empty:hidden">
        {message}
      </p>

      <Select id="request-trade" name="trade" label="What do you need?" required defaultValue="" error={errors.trade}>
        <option value="" disabled>
          Pick a service
        </option>
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

      <div className="sm:w-40">
        <Input
          id="request-zip"
          name="zip"
          label="ZIP code"
          inputMode="numeric"
          autoComplete="postal-code"
          pattern="[0-9]{5}"
          maxLength={5}
          required
          placeholder="30030"
          error={errors.zip}
        />
      </div>

      <Field
        id={descId}
        label="Describe the job"
        hint="Say what needs doing and when. Only matching businesses see this. Leave out your phone number, street address and name."
        error={errors.description}
      >
        <textarea
          id={descId}
          name="description"
          required
          minLength={DESC_MIN}
          maxLength={DESC_MAX}
          rows={5}
          onChange={(e) => setLength(e.target.value.trim().length)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={`${errors.description ? `${descId}-error` : `${descId}-hint`} ${descId}-count`}
          className={`${controlClasses} resize-y py-3`}
        />
        <p id={`${descId}-count`} className="text-right font-mono text-xs tabular-nums text-muted">
          {length} / {DESC_MAX}
        </p>
      </Field>

      <Input
        id="request-email"
        name="email"
        type="email"
        label="Your email"
        autoComplete="email"
        required
        maxLength={254}
        hint="For the confirm link and replies. Businesses never see it unless you answer them."
        error={errors.email}
      />

      {/* Honeypot: hidden from people, screen readers and autofill (a name no autofill rule maps, autocomplete off, not focusable).
          A filled-in value means a bot; the server accepts and drops it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="request-leave-blank">Leave this empty</label>
        <input id="request-leave-blank" name="leave_blank" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={consentId} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            id={consentId}
            name="consent"
            type="checkbox"
            required
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? `${consentId}-error` : undefined}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            I am 18 or older and agree to the{' '}
            <Link href="/terms" className="font-medium text-accent-text underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="font-medium text-accent-text underline">
              Privacy Policy
            </Link>
            , Holler may send my request to local businesses and show only the service and my city on public pages, and I know Holler
            does not check or vouch for any business and this is not for emergencies.
          </span>
        </label>
        {errors.consent ? (
          <p id={`${consentId}-error`} role="alert" className="text-sm font-medium text-danger">
            {errors.consent}
          </p>
        ) : null}
      </div>

      <div>
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Sending...' : 'Send my request'}
        </Button>
      </div>
    </form>
  );
}
