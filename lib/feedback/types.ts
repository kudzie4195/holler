/** Feedback on an alert. Client-safe: no server imports. Matches supabase/migrations/0009_holler_signal_feedback.sql. */
export const VERDICTS = ['useful', 'not_relevant', 'led_to_work'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABEL: Record<Verdict, string> = {
  useful: 'Useful',
  not_relevant: 'Not relevant',
  led_to_work: 'Led to work',
};

export const JOB_VALUE_MIN = 0;
export const JOB_VALUE_MAX = 1_000_000;

export interface FeedbackState {
  verdict: Verdict;
  /** Whole dollars, only ever set with 'led_to_work'. */
  jobValueUsd: number | null;
}

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'string' && (VERDICTS as readonly string[]).includes(v);
}

export function isJobValue(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= JOB_VALUE_MIN && v <= JOB_VALUE_MAX;
}

/**
 * Parses the text of the job value field. '' means "no amount" (null). Whole dollars only, 0 to 1,000,000.
 * Returns undefined when the text is not acceptable.
 */
export function parseJobValue(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (t === '') return null;
  if (!/^\d{1,7}$/.test(t)) return undefined;
  const n = Number(t);
  return isJobValue(n) ? n : undefined;
}
