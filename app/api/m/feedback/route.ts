import { saveFeedback } from '@/lib/feedback/service';
import { requireMember } from '@/lib/mobile/auth';
import { fail, ok, preflight, readBody } from '@/lib/mobile/http';

const METHODS = 'POST';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/** POST /api/m/feedback: the member's answer on one alert. The web action's rules (saveFeedback with the member's own RLS client). */
export async function POST(req: Request) {
  const m = await requireMember(req, METHODS, { limit: 'write' });
  if (!m.ok) return m.response;
  const body = await readBody(req);
  if (!body.ok) return fail(req, METHODS, body.error);
  const { signalId, verdict, jobValueUsd } = body.data;
  const res = await saveFeedback(m.ctx.db, m.ctx.user.id, { signalId, verdict, jobValueUsd });
  if (!res.ok) {
    if (res.error === 'invalid') return fail(req, METHODS, 'invalid', 'That answer did not look right. Try again.');
    if (res.error === 'no_match') return fail(req, METHODS, 'not_found', 'That alert is not in your feed.');
    if (res.error === 'signed_out') return fail(req, METHODS, 'unauthorized');
    return fail(req, METHODS, 'server_error', "That didn't save. Try again.");
  }
  return ok(req, METHODS, { feedback: res.state });
}
