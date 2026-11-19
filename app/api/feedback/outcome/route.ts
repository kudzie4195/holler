import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { htmlPage } from '@/lib/email/html-page';
import { verifyOutcomeToken } from '@/lib/moat/token';
import { recordOutcome } from '@/lib/moat/outcome';

const INVALID = () =>
  htmlPage('Link not valid', 'This link is not valid or has expired. You can answer from your feed any time.', {
    status: 400,
    links: [{ href: '/app', label: 'Open your feed' }],
  });

function parse(token: string) {
  return env.CRON_SECRET ? verifyOutcomeToken(token, env.CRON_SECRET) : null;
}

/** GET never changes anything (mail scanners open every link). It shows one button that POSTs the answer. */
export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const t = parse(token);
  if (!t) return INVALID();
  const yes = t.answer === 'yes';
  return htmlPage(
    'Did you get work from this?',
    yes ? 'You chose Yes. Press the button to save it.' : 'You chose No. Press the button to save it.',
    { form: { action: '/api/feedback/outcome', button: yes ? 'Yes, it led to work' : 'No, it did not', fields: { t: token } } },
  );
}

export async function POST(req: Request) {
  let token = new URL(req.url).searchParams.get('t') ?? '';
  if (!token) {
    const form = await req.formData().catch(() => null);
    const raw = form?.get('t');
    token = typeof raw === 'string' ? raw : '';
  }
  const t = parse(token);
  if (!t) return INVALID();
  let result;
  try {
    result = await recordOutcome(createAdminClient(), t.userId, t.signalId, t.answer);
  } catch {
    result = 'failed' as const;
  }
  if (result === 'recorded') {
    return htmlPage(
      'Thanks, saved',
      t.answer === 'yes' ? 'We marked this alert as led to work. You can add the job amount in your feed.' : 'We saved your answer.',
      { links: [{ href: '/app', label: 'Open your feed' }] },
    );
  }
  if (result === 'already') {
    return htmlPage('Already answered', 'We have your answer for this alert. You can change it in your feed.', {
      links: [{ href: '/app', label: 'Open your feed' }],
    });
  }
  if (result === 'none') return INVALID();
  return htmlPage('Something went wrong', 'We could not save that. Try the link again in a moment.', { status: 500 });
}
