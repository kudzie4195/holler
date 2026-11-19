import { getStripe } from '@/lib/stripe';
import { deleteHollerAccount } from '@/lib/mobile/account';
import { adminOrNull } from '@/lib/mobile/admin';
import { requireMember } from '@/lib/mobile/auth';
import { fail, ok, preflight, readBody } from '@/lib/mobile/http';

const METHODS = 'POST';
export const maxDuration = 30;

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/**
 * POST /api/m/account/delete with { confirm: "DELETE" } (App Store guideline 5.1.1(v)). The same deletion as Settings > Delete
 * account (lib/mobile/account.ts deleteHollerAccount), plus the member's push tokens. Reachable when locked and without a profile
 * (a half-finished account can still be removed). The user id comes from the verified token, never from the body.
 */
export async function POST(req: Request) {
  const m = await requireMember(req, METHODS, { needProfile: false, limit: 'delete' });
  if (!m.ok) return m.response;
  const body = await readBody(req);
  if (!body.ok) return fail(req, METHODS, body.error);
  if (body.data.confirm !== 'DELETE') return fail(req, METHODS, 'confirm_required');
  const admin = adminOrNull();
  if (!admin) return fail(req, METHODS, 'not_configured');
  const res = await deleteHollerAccount({ admin, userId: m.ctx.user.id, stripe: getStripe(), profile: m.ctx.profile });
  if (!res.ok) {
    return res.error === 'billing_cancel_failed'
      ? fail(req, METHODS, 'billing_cancel_failed')
      : fail(req, METHODS, 'server_error', "We couldn't delete your account. Try again in a moment.");
  }
  return ok(req, METHODS, { signOut: true, storeSubscription: res.storeSubscription });
}
