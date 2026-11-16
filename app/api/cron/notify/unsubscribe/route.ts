import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { verifyUnsubscribeToken } from '@/lib/email/token';
import { htmlPage } from '@/lib/email/html-page';

function userIdFrom(token: string): string | null {
  return env.CRON_SECRET ? verifyUnsubscribeToken(token, env.CRON_SECRET) : null;
}

const INVALID = () =>
  htmlPage('Link not valid', 'This unsubscribe link is not valid. You can turn off email alerts in your settings.', {
    status: 400,
    links: [{ href: '/app/settings', label: 'Email settings' }],
  });

/**
 * GET never changes anything: mail scanners (Safe Links, Mimecast) fetch every link in an email.
 * It renders a confirm page whose button POSTs back here.
 */
export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!userIdFrom(token)) return INVALID();
  return htmlPage('Turn off email alerts?', 'You will stop getting Holler emails. You can turn them back on in settings any time.', {
    form: {
      action: `/api/cron/notify/unsubscribe?t=${encodeURIComponent(token)}`,
      button: 'Turn off email alerts',
      fields: { t: token },
    },
    links: [{ href: '/app/settings', label: 'Email settings' }],
  });
}

/**
 * Performs the unsubscribe. Accepts both the confirm-page button (form body field t) and the RFC 8058
 * one-click request from mail clients (POST to the List-Unsubscribe URL with body List-Unsubscribe=One-Click).
 * The signed token is the authorization, so no session is needed.
 */
export async function POST(req: Request) {
  let token = new URL(req.url).searchParams.get('t') ?? '';
  if (!token) {
    const form = await req.formData().catch(() => null);
    const raw = form?.get('t');
    token = typeof raw === 'string' ? raw : '';
  }
  const userId = userIdFrom(token);
  if (!userId) return INVALID();
  try {
    const { error } = await createAdminClient().from('holler_profiles').update({ alert_email: false }).eq('user_id', userId);
    if (error) throw new Error(error.message);
  } catch {
    return htmlPage('Something went wrong', 'We could not update your settings. Try again, or turn off email alerts in your settings.', {
      status: 500,
    });
  }
  return htmlPage('Email alerts are off', 'You will not get Holler emails anymore. You can turn them back on in settings any time.', {
    links: [{ href: '/app/settings', label: 'Email settings' }],
  });
}
