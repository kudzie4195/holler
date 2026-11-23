import { htmlPage } from '@/lib/email/html-page';
import { zipWaitlistConfirmDeps } from '@/lib/waitlist/zip-confirm-deps';
import { confirmWaitlist, type ConfirmCode } from '@/lib/waitlist/zip-confirm';
import { t } from '@/lib/i18n';

/**
 * Confirm link from the "Coming to your area" email. Two steps, like /request/confirm: email scanners open every link, so GET only
 * shows a button and the POST does the work. A bad, expired or unknown link always gets the same page.
 * Round 19: every sign-up on /check gets one of these links (double opt-in into holler_zip_waitlist, lib/waitlist/service.ts), and links
 * the live site sent before the merge keep working until they expire (7 days). "Check your ZIP code again to get a new link" is true: a
 * new sign-up for an unconfirmed address sends a new link.
 */
type L = 'en' | 'es';

/**
 * The page language: English unless the link or the form says lang=es (round 19 integration). Never read from a cookie (the holler_lang
 * hint never decides a server page, lib/auth/lang-cookie.ts). Sign-ups are made on the English /check page today, so every link sent is
 * English; the Spanish words are ready for a Spanish sign-up and are covered by tests/i18n.
 */
function langOf(v: unknown): L {
  return v === 'es' ? 'es' : 'en';
}

const NOT_ACTIVE = (lang: L) =>
  htmlPage(t(lang, 'wl.confirm.inactive.title'), t(lang, 'wl.confirm.inactive.body'), {
    links: [{ href: '/check', label: t(lang, 'wl.confirm.inactive.link') }],
    ...(lang === 'es' ? { lang } : {}),
  });

function tokenFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 400) : '';
}

export function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const lang = langOf(params.get('lang'));
  const token = tokenFrom(params.get('token'));
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return NOT_ACTIVE(lang);
  return htmlPage(t(lang, 'wl.confirm.title'), t(lang, 'wl.confirm.body'), {
    form: { action: '/waitlist/confirm', button: t(lang, 'wl.confirm.button'), fields: lang === 'es' ? { token, lang } : { token } },
    ...(lang === 'es' ? { lang } : {}),
  });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const lang = langOf(form?.get('lang'));
  let code: ConfirmCode;
  try {
    code = (await confirmWaitlist(zipWaitlistConfirmDeps(), tokenFrom(form?.get('token')))).code;
  } catch {
    code = 'unavailable';
  }
  if (code === 'confirmed') {
    return htmlPage(t(lang, 'wl.confirm.done.title'), t(lang, 'wl.confirm.done.body'), {
      links: [{ href: lang === 'es' ? '/es/check' : '/check', label: t(lang, 'wl.confirm.done.link') }],
      ...(lang === 'es' ? { lang } : {}),
    });
  }
  if (code === 'invalid') return NOT_ACTIVE(lang);
  return htmlPage(t(lang, 'wl.confirm.error.title'), t(lang, 'wl.confirm.error.body'), { status: 503, ...(lang === 'es' ? { lang } : {}) });
}
