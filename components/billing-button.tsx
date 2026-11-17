'use client';

import { hardNavigate } from './format';
import { useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './button';

/**
 * POSTs to a billing endpoint (/api/stripe/checkout or /api/stripe/portal) and follows the returned url.
 * Checkout takes an optional {plan: 'monthly' | 'annual', tier: 'starter' | 'pro'} body (missing means Starter monthly).
 * Response contract: 200 {"url": "https://..."}; 503 when Stripe is not configured; 401 when signed out; 409 already subscribed.
 */
export function BillingButton({
  endpoint,
  children,
  variant = 'primary',
  size = 'md',
  full,
  unavailableMessage = "Billing opens soon, you're on the free trial.",
  plan,
  tier,
  note,
}: {
  endpoint: '/api/stripe/checkout' | '/api/stripe/portal';
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  unavailableMessage?: string;
  /** Checkout only: which interval to start. Omitted means monthly (the server default). */
  plan?: 'monthly' | 'annual';
  /** Checkout only: which plan to start. Omitted means Starter (the server default). */
  tier?: 'starter' | 'pro';
  /** Shown under the button, always visible: the auto-renewal sentence (lib/stripe/plans.ts renewalNote) for a subscribe button. */
  note?: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function go() {
    setPending(true);
    setMessage(null);
    try {
      // Checkout requires a JSON body type (a cross-site form cannot send one); the portal takes no body.
      const res =
        endpoint === '/api/stripe/checkout'
          ? await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: plan ?? 'monthly', tier: tier ?? 'starter' }) })
          : await fetch(endpoint, { method: 'POST' });
      if (res.status === 503) {
        setMessage(unavailableMessage);
      } else if (res.status === 401) {
        hardNavigate('/login');
        return;
      } else if (res.status === 409 && endpoint === '/api/stripe/checkout') {
        // Already subscribed: manage it in the billing portal instead of creating a second subscription.
        const portal = await fetch('/api/stripe/portal', { method: 'POST' });
        const body = (await portal.json().catch(() => ({}))) as { url?: string };
        if (portal.ok && body.url) {
          window.location.href = body.url;
          return;
        }
        setMessage('You already have a subscription. Open Settings to manage billing.');
      } else if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { url?: string };
        if (body.url) {
          window.location.href = body.url;
          return;
        }
        setMessage('Billing did not open. Try again in a moment.');
      } else {
        setMessage('Billing did not open. Try again in a moment.');
      }
    } catch {
      setMessage("We couldn't reach billing. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <div className={full ? 'w-full' : 'inline-flex flex-col items-start gap-2'}>
      <Button variant={variant} size={size} full={full} onClick={go} disabled={pending}>
        {pending ? 'Opening...' : children}
      </Button>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      <p role="status" className="text-sm text-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}

/**
 * Moves a paying member to the other plan: POST /api/stripe/change-plan {tier}. The billing interval stays as it is.
 * 200 reloads the page so the new limits show. 402: the card was declined for the upgrade, nothing changed. 409: no subscription to
 * change, or a payment is due first. 429: too many switches this hour.
 */
export function PlanChangeButton({
  tier,
  children,
  variant = 'primary',
  note,
}: {
  tier: 'starter' | 'pro';
  children: React.ReactNode;
  variant?: ButtonVariant;
  /** Shown under the button: the auto-renewal sentence for the new plan (lib/stripe/plans.ts planChangeNote). */
  note?: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function go() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/stripe/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      if (res.status === 401) {
        hardNavigate('/login?next=/app/settings');
        return;
      }
      if (res.ok) {
        window.location.reload();
        return;
      }
      const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      if (res.status === 402) setMessage('Your card was declined, so nothing changed. Update your card in Manage billing, then try again.');
      else if (res.status === 409 && err === 'payment_due') setMessage('Your last payment did not go through. Update your card in Manage billing first.');
      else if (res.status === 409) setMessage('We could not find a subscription to change. Refresh the page and try again.');
      else if (res.status === 429) setMessage('Too many changes this hour. Wait a bit, then try again.');
      else if (res.status === 503 && err === 'unavailable') setMessage('Billing is busy. Try again in a moment.');
      else if (res.status === 503) setMessage('Billing is not open yet.');
      else setMessage('The change did not go through. Try again in a moment.');
    } catch {
      setMessage("We couldn't reach billing. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <Button variant={variant} onClick={go} disabled={pending}>
        {pending ? 'Changing...' : children}
      </Button>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      <p role="status" className="text-sm text-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}
