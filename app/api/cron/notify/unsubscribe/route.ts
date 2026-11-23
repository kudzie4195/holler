import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { verifyUnsubscribeToken } from '@/lib/email/token';
import { htmlPage } from '@/lib/email/html-page';
import { profileLanguageReader, unsubscribeLang } from '@/lib/email/unsub-lang';
import { t, type Lang } from '@/lib/i18n';

function userIdFrom(token: string): string | null {
  return env.CRON_SECRET ? verifyUnsubscribeToken(token, env.CRON_SECRET) : null;
}

/**
 * Round 24: the page's language (lib/email/unsub-lang.ts). English words come from the dictionary and are the same as before, byte for
 * byte. Only GET (the page a person sees first) reads the member's saved language; its form carries `l` to the POST, so the POST never
 * reads the profile (a one-click POST from a mail client shows its answer to nobody).
 */
function langFor(req: Request, userId: string | null, form?: FormData | null): Promise<Lang> {
  return unsubscribeLang(req, form === undefined ? userId : null, (id) => profileLanguageReader(createAdminClient())(id), form);
}

/** `lang` on the page and `l` in the form only for Spanish, so an English page keeps its exact bytes. */
const only = (lang: Lang) => (lang === 'en' ? {} : { lang });

const INVALID = (lang: Lang) =>
  htmlPage(t(lang, 'page.verify.invalid_h'), t(lang, 'unsub.alerts.invalid_p'), {
    status: 400,
    links: [{ href: '/app/settings', label: t(lang, 'unsub.settings') }],
    ...only(lang),
  });

/**
 * GET never changes anything: mail scanners (Safe Links, Mimecast) fetch every link in an email.
 * It renders a confirm page whose button POSTs back here.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const userId = userIdFrom(token);
  const lang = await langFor(req, userId);
  if (!userId) return INVALID(lang);
  return htmlPage(t(lang, 'unsub.alerts.confirm_h'), t(lang, 'unsub.alerts.confirm_p'), {
    form: {
      action: `/api/cron/notify/unsubscribe?t=${encodeURIComponent(token)}`,
      button: t(lang, 'unsub.alerts.button'),
      fields: lang === 'en' ? { t: token } : { t: token, l: lang },
    },
    links: [{ href: '/app/settings', label: t(lang, 'unsub.settings') }],
    ...only(lang),
  });
}

/**
 * Performs the unsubscribe. Accepts both the confirm-page button (form body field t) and the RFC 8058
 * one-click request from mail clients (POST to the List-Unsubscribe URL with body List-Unsubscribe=One-Click).
 * The signed token is the authorization, so no session is needed.
 */
export async function POST(req: Request) {
  let token = new URL(req.url).searchParams.get('t') ?? '';
  const form = await req.formData().catch(() => null);
  if (!token) {
    const raw = form?.get('t');
    token = typeof raw === 'string' ? raw : '';
  }
  const userId = userIdFrom(token);
  const lang = await langFor(req, userId, form ?? null);
  if (!userId) return INVALID(lang);
  try {
    const { error } = await createAdminClient().from('holler_profiles').update({ alert_email: false }).eq('user_id', userId);
    if (error) throw new Error(error.message);
  } catch {
    return htmlPage(t(lang, 'page.error_h'), t(lang, 'unsub.alerts.error_p'), {
      status: 500,
      ...only(lang),
    });
  }
  return htmlPage(t(lang, 'unsub.alerts.done_h'), t(lang, 'unsub.alerts.done_p'), {
    links: [{ href: '/app/settings', label: t(lang, 'unsub.settings') }],
    ...only(lang),
  });
}
