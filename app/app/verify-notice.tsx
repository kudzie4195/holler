'use client';

import { useState } from 'react';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';

/** Shown until the profile's email is confirmed. Alerts are not emailed before that. */
export function VerifyNotice() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/verify/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; alreadyVerified?: boolean };
      if (res.ok) setMessage(body.alreadyVerified ? 'Your email is already confirmed.' : 'Sent. Check your inbox.');
      else if (res.status === 429) setMessage('That was a lot of tries. Wait an hour, then ask again.');
      else setMessage(body.error ?? 'We could not send that right now. Try again in a moment.');
    } catch {
      setMessage("We couldn't reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <Notice tone="warn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong className="font-semibold">Confirm your email to get alerts.</strong> We sent you a link when you signed up.
        </span>
        <Button variant="secondary" size="sm" onClick={resend} disabled={pending}>
          {pending ? 'Sending...' : 'Send the link again'}
        </Button>
      </div>
      <p role="status" className="mt-2 text-sm empty:hidden">
        {message}
      </p>
    </Notice>
  );
}
