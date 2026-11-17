import { htmlPage } from '@/lib/email/html-page';
import { isTokenShape } from './tokens';
import { OPEN_DAYS } from './constants';
import type { CloseResult, ConfirmResult } from './service';

/**
 * Plain pages for the confirm and close links. Two steps, like /api/auth/verify: email scanners open every link, so GET only shows a
 * button and the POST does the work. An unknown, expired or used link always gets the same 200 page, with nothing about the request.
 */
const NOT_ACTIVE = () =>
  htmlPage('This link is not active', 'It may have expired or already been used. You can send a new request any time.', {
    links: [{ href: '/request', label: 'Ask for a service' }],
  });

export function tokenFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function confirmStep(token: string): Response {
  if (!isTokenShape(token)) return NOT_ACTIVE();
  return htmlPage('Confirm your request', 'Press the button to post it. Public pages show only the service and your city. Matching businesses get your description and can reply by email.', {
    form: { action: '/request/confirm', button: 'Confirm my request', fields: { token } },
  });
}

export function confirmAnswer(result: ConfirmResult): Response {
  switch (result.state) {
    case 'confirmed':
    case 'already_open':
      return htmlPage(
        result.state === 'confirmed' ? 'Your request is live' : 'Your request is already live',
        `Matching businesses near you can reply by email for ${OPEN_DAYS} days. Holler is new, so some areas have no businesses yet. Keep the close link from your email if you change your mind.`,
        { links: [{ href: result.closeUrl, label: 'Close my request now' }] },
      );
    case 'ended':
      return htmlPage('This request is closed', 'It no longer takes replies. You can send a new request any time.', {
        links: [{ href: '/request', label: 'Ask for a service' }],
      });
    case 'invalid':
      return NOT_ACTIVE();
    default:
      return htmlPage('Something went wrong', 'We could not post your request. Try the link again in a moment.', { status: 503 });
  }
}

export function closeStep(token: string): Response {
  if (!isTokenShape(token)) return NOT_ACTIVE();
  return htmlPage(
    'Close this request?',
    'Closing stops new replies and takes it off Holler within about 15 minutes. We delete your email address and your description. This cannot be undone.',
    { form: { action: '/request/close', button: 'Close the request', fields: { token } } },
  );
}

export function closeAnswer(result: CloseResult): Response {
  switch (result.state) {
    case 'closed':
      return htmlPage('Request closed', 'It gets no more replies and leaves Holler within about 15 minutes. We deleted your email address and your description.', {
        links: [{ href: '/request', label: 'Ask for something else' }],
      });
    case 'removed':
      return htmlPage('Request removed', 'Replies are stopped, it leaves public pages within about 15 minutes, and the email address and description are deleted.');
    case 'already_closed':
      return htmlPage('Already closed', 'This request was closed before. Nothing else to do.');
    case 'invalid':
      return NOT_ACTIVE();
    default:
      return htmlPage('Something went wrong', 'We could not close the request. Try the link again in a moment.', { status: 503 });
  }
}
