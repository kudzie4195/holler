import { siteUrl } from '@/lib/env';
import { computeAccess } from '@/lib/auth/access';
import { adminOrNull } from '@/lib/mobile/admin';
import { matchScope } from '@/lib/plan/scope';
import { requireMember } from '@/lib/mobile/auth';
import { buildAlerts, readOneMatch } from '@/lib/mobile/feed';
import { fail, ok, preflight } from '@/lib/mobile/http';
import { repairShortTrial } from '@/lib/auth/trial';
import { createAdminClient } from '@/lib/supabase/admin';

const METHODS = 'GET';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/**
 * GET /api/m/alert/{signalId}: one alert in full, only when this member has a match for it (read with the member's own RLS client,
 * filtered by their user id). Another member's alert, an unknown id and an ended resident request all answer the same 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ signalId: string }> }) {
  const { signalId: raw } = await ctx.params;
  const m = await requireMember(req, METHODS, { limit: 'read' });
  if (!m.ok) return m.response;
  const signalId = /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(signalId)) return fail(req, METHODS, 'not_found');
  const { user, db, profile: loaded } = m.ctx;
  // Review r3 D3: the same signed-in repair as GET /api/m/me, so a request that arrives before (or beside) /me is not answered locked.
  const repairedEnd = await repairShortTrial(user, loaded, createAdminClient);
  const profile = loaded && repairedEnd ? { ...loaded, trial_ends_at: repairedEnd } : loaded;

  const now = Date.now();
  const locked = computeAccess(profile!, now).locked;
  const one = await readOneMatch(db, user.id, signalId);
  if (one.error) return fail(req, METHODS, 'server_error');
  if (!one.row) return fail(req, METHODS, 'not_found');
  const [item] = await buildAlerts([one.row], { userId: user.id, locked, db, admin: locked ? null : adminOrNull(), siteUrl, now, trades: matchScope(profile!).categories });
  if (!item || item.signalId !== signalId) return fail(req, METHODS, 'not_found');
  return ok(req, METHODS, { locked, item });
}
