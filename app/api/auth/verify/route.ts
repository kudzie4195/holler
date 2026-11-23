import { env } from '@/lib/env';
import { verifyVerifyToken } from '@/lib/email/token';
import { htmlPage } from '@/lib/email/html-page';
import { markEmailVerified } from '@/lib/auth/verification';
import { parseLang, t, type Lang } from '@/lib/i18n';

const INVALID = () =>
  htmlPage('Link not valid', 'This confirmation link is invalid or has expired. Log in and use "Send the link again" on your dashboard.', {
    status: 400,
    links: [{ href: '/login?next=/app', label: 'Log in' }],
  });

/**
 * The language of the page: l=es on a link from a Spanish email (lib/auth/verification.ts verifyUrlFor), carried through the form as a
 * hidden field. Not signed and not needed: it picks the words only. Anything but exactly 'es' is the English page as before.
 */
function langOf(req: Request, form?: FormData | null): Lang {
  const v = form?.get('l') ?? new URL(req.url).searchParams.get('l');
  return parseLang(v);
}

function invalidLang(lang: Lang): Response {
  if (lang === 'en') return INVALID();
  return htmlPage(t(lang, 'page.verify.invalid_h'), t(lang, 'page.verify.invalid_p'), {
    status: 400,
    lang,
    links: [{ href: '/es/login?next=/app', label: t(lang, 'auth.login') }],
  });
}

/**
 * Two-step, like the password link: email scanners GET every link, so GET only shows a button.
 * The POST is what records the confirmation. Token: HMAC-signed, purpose 'verify', expires after 7 days.
 */
export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const userId = env.CRON_SECRET ? verifyVerifyToken(token, env.CRON_SECRET) : null;
  const lang = langOf(req);
  if (!userId) return invalidLang(lang);
  if (lang !== 'en') {
    return htmlPage(t(lang, 'page.verify.h'), t(lang, 'page.verify.p'), {
      lang,
      form: { action: '/api/auth/verify', button: t(lang, 'mail.verify.button'), fields: { t: token, l: lang } },
    });
  }
  return htmlPage('Confirm your email', 'Press the button to finish. Holler will then send you alerts for your area.', {
    form: { action: '/api/auth/verify', button: 'Confirm my email', fields: { t: token } },
  });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const raw = form?.get('t') ?? new URL(req.url).searchParams.get('t');
  const token = typeof raw === 'string' ? raw : '';
  const userId = env.CRON_SECRET ? verifyVerifyToken(token, env.CRON_SECRET) : null;
  const lang = langOf(req, form);
  if (!userId) return invalidLang(lang);

  try {
    const ok = await markEmailVerified(userId);
    if (!ok) throw new Error('not recorded');
  } catch {
    if (lang !== 'en') return htmlPage(t(lang, 'page.error_h'), t(lang, 'page.verify.error_p'), { status: 500, lang });
    return htmlPage('Something went wrong', 'We could not confirm your email. Try the link again in a moment.', { status: 500 });
  }
  if (lang !== 'en') {
    return htmlPage(t(lang, 'page.verify.done_h'), t(lang, 'page.verify.done_p'), { lang, links: [{ href: '/app', label: t(lang, 'email.open_feed') }] });
  }
  return htmlPage('Email confirmed', 'Thanks. Holler can now send you alerts.', {
    links: [{ href: '/app', label: 'Open your feed' }],
  });
}
