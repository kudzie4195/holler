import { env } from '@/lib/env';
import { verifyVerifyToken } from '@/lib/email/token';
import { htmlPage } from '@/lib/email/html-page';
import { markEmailVerified } from '@/lib/auth/verification';

const INVALID = () =>
  htmlPage('Link not valid', 'This confirmation link is invalid or has expired. Log in and use "Send the link again" on your dashboard.', {
    status: 400,
    links: [{ href: '/login?next=/app', label: 'Log in' }],
  });

/**
 * Two-step, like the password link: email scanners GET every link, so GET only shows a button.
 * The POST is what records the confirmation. Token: HMAC-signed, purpose 'verify', expires after 7 days.
 */
export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const userId = env.CRON_SECRET ? verifyVerifyToken(token, env.CRON_SECRET) : null;
  if (!userId) return INVALID();
  return htmlPage('Confirm your email', 'Press the button to finish. Holler will then send you alerts for your area.', {
    form: { action: '/api/auth/verify', button: 'Confirm my email', fields: { t: token } },
  });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const raw = form?.get('t') ?? new URL(req.url).searchParams.get('t');
  const token = typeof raw === 'string' ? raw : '';
  const userId = env.CRON_SECRET ? verifyVerifyToken(token, env.CRON_SECRET) : null;
  if (!userId) return INVALID();

  try {
    const ok = await markEmailVerified(userId);
    if (!ok) throw new Error('not recorded');
  } catch {
    return htmlPage('Something went wrong', 'We could not confirm your email. Try the link again in a moment.', { status: 500 });
  }
  return htmlPage('Email confirmed', 'Thanks. Holler can now send you alerts.', {
    links: [{ href: '/app', label: 'Open your feed' }],
  });
}
