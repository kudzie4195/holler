import { htmlPage } from '@/lib/email/html-page';
import { zipWaitlistConfirmDeps } from '@/lib/waitlist/zip-confirm-deps';
import { confirmWaitlist, type ConfirmCode } from '@/lib/waitlist/zip-confirm';

/**
 * Confirm link from the "Coming to your area" email. Two steps, like /request/confirm: email scanners open every link, so GET only
 * shows a button and the POST does the work. A bad, expired or unknown link always gets the same page.
 * Round 19 UNIFY: these links were emailed by the live site's double opt-in waitlist (holler_zip_waitlist, lib/waitlist/zip-confirm.ts).
 * New sign-ups use this base's waitlist and get no such link, but every link already sent keeps working until it expires (7 days).
 */
const NOT_ACTIVE = () =>
  htmlPage('This link is not active', 'It may have expired. Check your ZIP code again to get a new link.', {
    links: [{ href: '/check', label: 'Check a ZIP code' }],
  });

function tokenFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 400) : '';
}

export function GET(req: Request) {
  const token = tokenFrom(new URL(req.url).searchParams.get('token'));
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return NOT_ACTIVE();
  return htmlPage('Confirm your email', 'Press the button and we will send you one email when Holler launches in your area. Nothing else.', {
    form: { action: '/waitlist/confirm', button: 'Confirm my email', fields: { token } },
  });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  let code: ConfirmCode;
  try {
    code = (await confirmWaitlist(zipWaitlistConfirmDeps(), tokenFrom(form?.get('token')))).code;
  } catch {
    code = 'unavailable';
  }
  if (code === 'confirmed') {
    return htmlPage("You're on the list", 'We will send you one email when Holler launches in your area. Storm alerts already work everywhere.', {
      links: [{ href: '/check', label: 'Check another ZIP code' }],
    });
  }
  if (code === 'invalid') return NOT_ACTIVE();
  return htmlPage('Something went wrong', 'We could not save that. Try the link again in a moment.', { status: 503 });
}
