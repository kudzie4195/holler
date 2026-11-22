'use client';

import { useState } from 'react';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { t, type DictKey, type Lang } from '@/lib/i18n';

/** Shown until the profile's email is confirmed. Alerts are not emailed before that. `lang`: the member's language (round 18 ES). */
export function VerifyNotice({ lang = 'en' }: { lang?: Lang }) {
  const w = (key: DictKey, en: string) => (lang === 'en' ? en : t(lang, key));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/verify/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: lang === 'en' ? '{}' : JSON.stringify({ lang }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; alreadyVerified?: boolean };
      if (res.ok) setMessage(body.alreadyVerified ? w('verify.already', 'Your email is already confirmed.') : w('verify.sent', 'Sent. Check your inbox.'));
      else if (res.status === 429) setMessage(w('verify.limited', 'That was a lot of tries. Wait an hour, then ask again.'));
      else setMessage(body.error ?? w('verify.failed', 'We could not send that right now. Try again in a moment.'));
    } catch {
      setMessage(w('auth.err.network', "We couldn't reach the server. Check your connection and try again."));
    }
    setPending(false);
  }

  return (
    <Notice tone="warn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {lang === 'en' ? (
        <span>
          <strong className="font-semibold">Confirm your email to get alerts.</strong> We sent you a link when you signed up.
        </span>
        ) : (
          <span>
            <strong className="font-semibold">{t(lang, 'verify.h')}</strong> {t(lang, 'verify.p')}
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={resend} disabled={pending}>
          {pending ? w('auth.forgot.pending', 'Sending...') : w('verify.resend', 'Send the link again')}
        </Button>
      </div>
      <p role="status" className="mt-2 text-sm empty:hidden">
        {message}
      </p>
    </Notice>
  );
}
