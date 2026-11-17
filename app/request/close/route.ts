import { requestDeps } from '@/lib/requests/deps';
import { closeAnswer, closeStep, tokenFrom } from '@/lib/requests/pages';
import { expireRequestPages } from '@/lib/requests/cache';
import { closeRequest, type CloseResult } from '@/lib/requests/service';

/**
 * Close (resident) and remove (site owner) share this link. GET shows a button; POST closes, deletes the stored email address and
 * description, expires the public record and the cached pages that listed it. The same link is in every email for a request.
 */
export function GET(req: Request) {
  return closeStep(tokenFrom(new URL(req.url).searchParams.get('token')));
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = tokenFrom(form?.get('token'));
  let result: CloseResult;
  try {
    result = await closeRequest(requestDeps(), token);
  } catch {
    result = { state: 'error' };
  }
  // Cached pages that list a request are tagged; expire them now so the ended request is gone on the next visit (their own lifetime
  // is 15 minutes at most either way).
  if (result.state === 'closed' || result.state === 'removed' || result.state === 'already_closed') expireRequestPages();
  return closeAnswer(result);
}
