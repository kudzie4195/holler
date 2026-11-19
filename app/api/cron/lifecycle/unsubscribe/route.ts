import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { htmlPage } from '@/lib/email/html-page';
import { verifyLifecycleUnsub, LIFECYCLE_UNSUB_PATH } from '@/lib/lifecycle/unsub';

function userIdFrom(token: string): string | null {
  return env.CRON_SECRET ? verifyLifecycleUnsub(token, env.CRON_SECRET) : null;
}

const INVALID = () =>
  htmlPage('Link not valid', 'This link is not valid. Your alert emails are not affected by it.', {
    status: 400,
    links: [{ href: '/app/settings', label: 'Email settings' }],
  });

/** GET never changes anything (mail scanners fetch every link). It shows a confirm page whose button POSTs back here. */
export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!userIdFrom(token)) return INVALID();
  return htmlPage('Stop trial emails?', 'You will stop getting the short emails about your trial. Your alert emails are not affected.', {
    form: { action: `${LIFECYCLE_UNSUB_PATH}?t=${encodeURIComponent(token)}`, button: 'Stop these emails', fields: { t: token } },
    links: [{ href: '/app/settings', label: 'Email settings' }],
  });
}

/** Performs it. Accepts the confirm-page button and the RFC 8058 one-click POST from mail clients. The signed token is the authorization. */
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
    const { error } = await createAdminClient()
      .from('holler_lifecycle_sends')
      .upsert([{ user_id: userId, kind: 'optout' }], { onConflict: 'user_id,kind', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } catch {
    return htmlPage('Something went wrong', 'We could not save that. Try the link again in a few minutes.', { status: 500 });
  }
  return htmlPage('Trial emails are off', 'You will not get these emails anymore. Your alert emails are not affected.', {
    links: [{ href: '/app/settings', label: 'Email settings' }],
  });
}
