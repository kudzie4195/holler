import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { htmlPage } from '@/lib/email/html-page';
import { verifyOutcomeToken } from '@/lib/moat/token';
import { recordOutcome } from '@/lib/moat/outcome';
import { parseLang, t, type Lang } from '@/lib/i18n';

/**
 * Spanish (round 18 ES): a link from a Spanish email carries l=es (lib/moat/run.ts), passed on through the form as a hidden field. It is
 * not signed and only picks the words of the page; anything but exactly 'es' is the English page as before.
 */
function langOf(req: Request, form?: FormData | null): Lang {
  return parseLang(form?.get('l') ?? new URL(req.url).searchParams.get('l'));
}

const feedLinkLang = (lang: Lang) => [{ href: '/app', label: t(lang, 'email.open_feed') }];

function invalidLang(lang: Lang): Response {
  if (lang === 'en') return INVALID();
  return htmlPage(t(lang, 'page.outcome.invalid_h'), t(lang, 'page.outcome.invalid_p'), { status: 400, lang, links: feedLinkLang(lang) });
}

const INVALID = () =>
  htmlPage('Link not valid', 'This link is not valid or has expired. You can answer from your feed any time.', {
    status: 400,
    links: [{ href: '/app', label: 'See all your matches' }],
  });

function parse(token: string) {
  return env.CRON_SECRET ? verifyOutcomeToken(token, env.CRON_SECRET) : null;
}

/** GET never changes anything (mail scanners open every link). It shows one button that POSTs the answer. */
export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const parsed = parse(token);
  const lang = langOf(req);
  if (!parsed) return invalidLang(lang);
  const yes = parsed.answer === 'yes';
  if (lang !== 'en') {
    return htmlPage(t(lang, 'page.outcome.h'), t(lang, yes ? 'page.outcome.chose_yes' : 'page.outcome.chose_no'), {
      lang,
      form: { action: '/api/feedback/outcome', button: t(lang, yes ? 'page.outcome.button_yes' : 'page.outcome.button_no'), fields: { t: token, l: lang } },
    });
  }
  return htmlPage(
    'Did you get work from this?',
    yes ? 'You chose Yes. Press the button to save it.' : 'You chose No. Press the button to save it.',
    { form: { action: '/api/feedback/outcome', button: yes ? 'Yes, it led to work' : 'No, it did not', fields: { t: token } } },
  );
}

export async function POST(req: Request) {
  let token = new URL(req.url).searchParams.get('t') ?? '';
  let form: FormData | null = null;
  if (!token) {
    form = await req.formData().catch(() => null);
    const raw = form?.get('t');
    token = typeof raw === 'string' ? raw : '';
  }
  const parsed = parse(token);
  const lang = langOf(req, form);
  if (!parsed) return invalidLang(lang);
  let result;
  try {
    result = await recordOutcome(createAdminClient(), parsed.userId, parsed.signalId, parsed.answer);
  } catch {
    result = 'failed' as const;
  }
  if (lang !== 'en') {
    if (result === 'recorded') return htmlPage(t(lang, 'page.outcome.saved_h'), t(lang, parsed.answer === 'yes' ? 'page.outcome.saved_yes' : 'page.outcome.saved_no'), { lang, links: feedLinkLang(lang) });
    if (result === 'already') return htmlPage(t(lang, 'page.outcome.already_h'), t(lang, 'page.outcome.already_p'), { lang, links: feedLinkLang(lang) });
    if (result === 'none') return invalidLang(lang);
    return htmlPage(t(lang, 'page.error_h'), t(lang, 'page.outcome.error_p'), { status: 500, lang });
  }
  if (result === 'recorded') {
    return htmlPage(
      'Thanks, saved',
      parsed.answer === 'yes' ? 'We marked this alert as led to work. You can add the job amount in your feed.' : 'We saved your answer.',
      { links: [{ href: '/app', label: 'See all your matches' }] },
    );
  }
  if (result === 'already') {
    return htmlPage('Already answered', 'We have your answer for this alert. You can change it in your feed.', {
      links: [{ href: '/app', label: 'See all your matches' }],
    });
  }
  if (result === 'none') return INVALID();
  return htmlPage('Something went wrong', 'We could not save that. Try the link again in a moment.', { status: 500 });
}
