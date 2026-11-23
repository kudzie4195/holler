import { coverageFor, type Coverage } from './cells';
import { isServedZip } from './coverage';
import { parseCheckParams } from './params';
import { lookupZip } from '@/lib/geo';

/**
 * The /check answer for raw query values, or null when the query is not a complete, known ZIP and trade. Used by the page header to
 * hide its sign-up button on a waitlist answer (review P3-7), with exactly the coverageFor call the page body makes.
 */
export function checkAnswer(zip: unknown, trade: unknown): Coverage | null {
  const params = parseCheckParams({ zip: typeof zip === 'string' ? zip : undefined, trade: typeof trade === 'string' ? trade : undefined });
  if (params.status !== 'ok') return null;
  const place = lookupZip(params.zip);
  if (!place) return null;
  return coverageFor(place, params.trade, isServedZip(place));
}
