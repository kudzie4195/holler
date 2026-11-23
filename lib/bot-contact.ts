import { env } from '@/lib/env';

/** Round 21 final review P2-2: the mailbox a webmaster writes to. SUPPORT_EMAIL (Vercel), else support@localholler.com. */
export function botContactAddress(value: string | undefined = env.SUPPORT_EMAIL): string {
  const v = value?.trim() ?? '';
  return /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/.test(v) ? v : 'support@localholler.com';
}
