import { requestDeps } from '@/lib/requests/deps';
import { confirmAnswer, confirmStep, tokenFrom } from '@/lib/requests/pages';
import { confirmRequest, type ConfirmResult } from '@/lib/requests/service';

/** GET shows a button (email scanners open links); POST marks the request open, publishes it and matches it. */
export function GET(req: Request) {
  return confirmStep(tokenFrom(new URL(req.url).searchParams.get('token')));
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = tokenFrom(form?.get('token'));
  let result: ConfirmResult;
  try {
    result = await confirmRequest(requestDeps(), token);
  } catch {
    result = { state: 'error' };
  }
  return confirmAnswer(result);
}
