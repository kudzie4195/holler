'use client';

import { useEffect, useState } from 'react';
import { Button } from '../button';
import { t, type Lang } from '@/lib/i18n';

type Answer = 'yes' | 'no' | 'not_yet';

/**
 * One small follow-up on a card the member marked Useful at least a week ago: "Did you get work from this?".
 * It shows only when the server has an unanswered ask for this member and alert, and hides after an answer. Any failure hides it.
 */
export function FeedbackFollowUp({ signalId, onYes, lang = 'en' }: { signalId: number; onYes?: () => void; lang?: Lang }) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/feedback/outcome/feed?signal=${signalId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { pending: false }))
      .then((j: { pending?: boolean }) => {
        if (live) setPending(j.pending === true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signalId]);

  async function answer(a: Answer) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/feedback/outcome/feed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signalId, answer: a }),
      });
      if (r.ok) {
        setDone(a);
        if (a === 'yes') onYes?.();
      } else setError(t(lang, 'card.save_error'));
    } catch {
      setError(t(lang, 'card.save_error'));
    }
    setBusy(false);
  }

  if (done) return <p role="status" className="mt-3 text-sm text-muted">{t(lang, 'card.feedback.thanks')}</p>;
  if (!pending) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t(lang, 'card.fu.group')}>
      <span className="text-sm text-ink">{t(lang, 'card.fu.question')}</span>
      {(['yes', 'no', 'not_yet'] as const).map((a) => (
        <Button key={a} size="sm" variant="secondary" disabled={busy} onClick={() => void answer(a)}>
          {t(lang, a === 'yes' ? 'card.fu.yes' : a === 'no' ? 'card.fu.no' : 'card.fu.not_yet')}
        </Button>
      ))}
      <p role="alert" className="w-full text-sm font-medium text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}
