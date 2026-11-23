import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { htmlPage } from '@/lib/email/html-page';
import { profileLanguageReader, unsubscribeLang } from '@/lib/email/unsub-lang';
import { verifyLifecycleUnsub, LIFECYCLE_UNSUB_PATH } from '@/lib/lifecycle/unsub';
import { t, type Lang } from '@/lib/i18n';

function userIdFrom(token: string): string | null {
  return env.CRON_SECRET ? verifyLifecycleUnsub(token, env.CRON_SECRET) : null;
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
  htmlPage(t(lang, 'page.verify.invalid_h'), t(lang, 'unsub.trial.invalid_p'), {
    status: 400,
    links: [{ href: '/app/settings', label: t(lang, 'unsub.settings') }],
    ...only(lang),
  });

/** GET never changes anything (mail scanners fetch every link). It shows a confirm page whose button POSTs back here. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const userId = userIdFrom(token);
  const lang = await langFor(req, userId);
  if (!userId) return INVALID(lang);
  return htmlPage(t(lang, 'unsub.trial.confirm_h'), t(lang, 'unsub.trial.confirm_p'), {
    form: { action: `${LIFECYCLE_UNSUB_PATH}?t=${encodeURIComponent(token)}`, button: t(lang, 'unsub.trial.button'), fields: lang === 'en' ? { t: token } : { t: token, l: lang } },
    links: [{ href: '/app/settings', label: t(lang, 'unsub.settings') }],
    ...only(lang),
  });
}

/** Performs it. Accepts the confirm-page button and the RFC 8058 one-click POST from mail clients. The signed token is the authorization. */
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
    const { error } = await createAdminClient()
      .from('holler_lifecycle_sends')
      .upsert([{ user_id: userId, kind: 'optout' }], { onConflict: 'user_id,kind', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } catch {
    return htmlPage(t(lang, 'page.error_h'), t(lang, 'unsub.trial.error_p'), { status: 500, ...only(lang) });
  }
  return htmlPage(t(lang, 'unsub.trial.done_h'), t(lang, 'unsub.trial.done_p'), {
    links: [{ href: '/app/settings', label: t(lang, 'unsub.settings') }],
    ...only(lang),
  });
}
