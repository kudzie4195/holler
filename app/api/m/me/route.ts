import { siteUrl } from '@/lib/env';
import { requireMember } from '@/lib/mobile/auth';
import { ok, preflight } from '@/lib/mobile/http';
import { meBody, type MeProfileRow } from '@/lib/mobile/me';
import { repairShortTrial } from '@/lib/auth/trial';
import { createAdminClient } from '@/lib/supabase/admin';

const METHODS = 'GET';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/** GET /api/m/me: who is signed in, their profile, access and limits. Works with no profile (needsOnboarding) and when locked. */
export async function GET(req: Request) {
  const m = await requireMember(req, METHODS, { needProfile: false, limit: 'read' });
  if (!m.ok) return m.response;
  const profile = m.ctx.profile as MeProfileRow | null;
  // Round 18: same signed-in repair as /app (lib/auth/trial.ts repairShortTrial). No query unless the row is a short never-paid trial.
  const repairedEnd = await repairShortTrial(m.ctx.user, profile, createAdminClient);
  const row = profile && repairedEnd ? { ...profile, trial_ends_at: repairedEnd } : profile;
  return ok(req, METHODS, meBody(m.ctx.user, row, siteUrl, Date.now()));
}
