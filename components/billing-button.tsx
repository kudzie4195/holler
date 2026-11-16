'use client';

import { hardNavigate } from './format';
import { useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './button';

/**
 * POSTs to a billing endpoint (/api/stripe/checkout or /api/stripe/portal) and follows the returned url.
 * ASSUMED response contract from W5: 200 {"url": "https://..."}; 503 when Stripe is not configured; 401 when signed out.
 */
export function BillingButton({
  endpoint,
  children,
  variant = 'primary',
  size = 'md',
  full,
  unavailableMessage = "Billing opens soon, you're on the free trial.",
}: {
  endpoint: '/api/stripe/checkout' | '/api/stripe/portal';
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  unavailableMessage?: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function go() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, { method: 'POST' });
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
      <p role="status" className="text-sm text-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}
