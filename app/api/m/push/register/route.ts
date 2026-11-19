import { adminOrNull } from '@/lib/mobile/admin';
import { requireMember } from '@/lib/mobile/auth';
import { fail, ok, preflight, readBody } from '@/lib/mobile/http';
import { cleanAppVersion, registerToken, unregisterToken, validPlatform, validToken } from '@/lib/push/tokens';

const METHODS = 'POST, DELETE';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/** POST /api/m/push/register: stores this device's FCM token for the signed-in member. */
export async function POST(req: Request) {
  const m = await requireMember(req, METHODS, { limit: 'push' });
  if (!m.ok) return m.response;
  const body = await readBody(req);
  if (!body.ok) return fail(req, METHODS, body.error);
  const { token, platform, appVersion } = body.data;
  if (!validToken(token) || !validPlatform(platform)) return fail(req, METHODS, 'invalid');
  const admin = adminOrNull();
  if (!admin) return fail(req, METHODS, 'not_configured');
  const res = await registerToken(admin, m.ctx.user.id, { token, platform, appVersion: cleanAppVersion(appVersion) });
  if (res !== 'ok') return fail(req, METHODS, res === 'not_configured' ? 'not_configured' : 'server_error');
  return ok(req, METHODS, {});
}

/** DELETE /api/m/push/register: removes this device's token (only when it belongs to the signed-in member). */
export async function DELETE(req: Request) {
  const m = await requireMember(req, METHODS, { needProfile: false, limit: 'push' });
  if (!m.ok) return m.response;
  const body = await readBody(req);
  if (!body.ok) return fail(req, METHODS, body.error);
  const { token } = body.data;
  if (!validToken(token)) return fail(req, METHODS, 'invalid');
  const admin = adminOrNull();
  if (!admin) return fail(req, METHODS, 'not_configured');
  const res = await unregisterToken(admin, m.ctx.user.id, token);
  if (res !== 'ok') return fail(req, METHODS, res === 'not_configured' ? 'not_configured' : 'server_error');
  return ok(req, METHODS, {});
}
