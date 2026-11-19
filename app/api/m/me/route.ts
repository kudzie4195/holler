import { siteUrl } from '@/lib/env';
import { requireMember } from '@/lib/mobile/auth';
import { ok, preflight } from '@/lib/mobile/http';
import { meBody, type MeProfileRow } from '@/lib/mobile/me';

const METHODS = 'GET';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/** GET /api/m/me: who is signed in, their profile, access and limits. Works with no profile (needsOnboarding) and when locked. */
export async function GET(req: Request) {
  const m = await requireMember(req, METHODS, { needProfile: false, limit: 'read' });
  if (!m.ok) return m.response;
  return ok(req, METHODS, meBody(m.ctx.user, m.ctx.profile as MeProfileRow | null, siteUrl, Date.now()));
}
