'use client';

import { useEffect, useState } from 'react';
import { Button } from '../button';

type Answer = 'yes' | 'no' | 'not_yet';
const LABEL: Record<Answer, string> = { yes: 'Yes', no: 'No', not_yet: 'Not yet' };

/**
 * One small follow-up on a card the member marked Useful at least a week ago: "Did you get work from this?".
 * It shows only when the server has an unanswered ask for this member and alert, and hides after an answer. Any failure hides it.
 */
export function FeedbackFollowUp({ signalId, onYes }: { signalId: number; onYes?: () => void }) {
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
      } else setError("That didn't save. Try again.");
    } catch {
      setError("That didn't save. Try again.");
    }
    setBusy(false);
  }

  if (done) return <p role="status" className="mt-3 text-sm text-muted">Thanks, saved.</p>;
  if (!pending) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Follow-up on this alert">
      <span className="text-sm text-ink">Did you get work from this?</span>
      {(['yes', 'no', 'not_yet'] as const).map((a) => (
        <Button key={a} size="sm" variant="secondary" disabled={busy} onClick={() => void answer(a)}>
          {LABEL[a]}
        </Button>
      ))}
      <p role="alert" className="w-full text-sm font-medium text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}
