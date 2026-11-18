'use client';

import { useId, useState } from 'react';
import { submitFeedback } from '@/app/app/actions';
import { Button } from '../button';
import { controlClasses } from '../field';
import {
  JOB_VALUE_MAX,
  JOB_VALUE_MIN,
  VERDICTS,
  VERDICT_LABEL,
  isVerdict,
  parseJobValue,
  type FeedbackState,
  type Verdict,
} from '@/lib/feedback/types';

/**
 * Three-button answer on an alert: Useful, Not relevant, Led to work. One answer per member per alert; picking another replaces it.
 * "Led to work" also opens an optional whole-dollar job value field. The server action does the real checking.
 */
export function FeedbackButtons({ signalId, initial }: { signalId: number; initial?: FeedbackState | null }) {
  const [verdict, setVerdict] = useState<Verdict | null>(initial?.verdict ?? null);
  const [saved, setSaved] = useState<number | null>(initial?.jobValueUsd ?? null);
  const [amount, setAmount] = useState(initial?.jobValueUsd != null ? String(initial.jobValueUsd) : '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function send(next: Verdict, value: number | null) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await submitFeedback(signalId, next, value);
      if (res.ok && isVerdict(res.verdict)) {
        setVerdict(res.verdict);
        setSaved(res.jobValueUsd ?? null);
        if (res.verdict !== 'led_to_work') setAmount('');
        setMessage('Thanks, saved.');
      } else {
        setError(res.error ?? "That didn't save. Try again.");
      }
    } catch {
      setError("That didn't save. Try again.");
    }
    setPending(false);
  }

  function pick(next: Verdict) {
    if (pending || next === verdict) return;
    // Switching to "Led to work" keeps a value already saved for this alert; any other answer clears it on the server.
    void send(next, next === 'led_to_work' ? saved : null);
  }

  function saveAmount() {
    const value = parseJobValue(amount);
    if (value === undefined) {
      setError(`Enter whole dollars from ${JOB_VALUE_MIN} to 1,000,000.`);
      return;
    }
    void send('led_to_work', value);
  }

  const showAmount = verdict === 'led_to_work';
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div role="group" aria-label="Feedback on this alert" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Was this alert helpful?</span>
        {VERDICTS.map((v) => (
          <Button
            key={v}
            size="sm"
            variant={verdict === v ? 'primary' : 'secondary'}
            aria-pressed={verdict === v}
            disabled={pending}
            onClick={() => pick(v)}
          >
            {VERDICT_LABEL[v]}
          </Button>
        ))}
      </div>
      {showAmount ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-value`} className="text-sm font-medium text-ink">
              About how much was the job? (optional)
            </label>
            <input
              id={`${id}-value`}
              type="number"
              inputMode="numeric"
              min={JOB_VALUE_MIN}
              max={JOB_VALUE_MAX}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Dollars"
              className={`${controlClasses} w-40`}
            />
          </div>
          <Button size="sm" variant="secondary" disabled={pending} onClick={saveAmount}>
            Save amount
          </Button>
        </div>
      ) : null}
      <p role="status" className="mt-2 text-sm text-muted empty:hidden">
        {message}
      </p>
      <p role="alert" className="mt-2 text-sm font-medium text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}
