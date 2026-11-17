import { env } from '@/lib/env';

/**
 * REQUESTS_ENABLED: new resident requests are on unless it is "0", "false", "off" or "no". The API reads it on every request; the
 * /request page is built at deploy time, so its "paused" note follows the variable after the next deploy.
 */
export function requestsEnabled(value: string | undefined = env.REQUESTS_ENABLED): boolean {
  return !/^(?:0|false|off|no)$/i.test((value ?? '').trim());
}
