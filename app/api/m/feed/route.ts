import { siteUrl } from '@/lib/env';
import { computeAccess } from '@/lib/auth/access';
import { matchScope } from '@/lib/plan/scope';
import { adminOrNull } from '@/lib/mobile/admin';
import { requireMember } from '@/lib/mobile/auth';
import { buildAlerts, decodeCursor, encodeCursor, readFeedPage } from '@/lib/mobile/feed';
import { fail, ok, preflight } from '@/lib/mobile/http';

const METHODS = 'GET';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/** GET /api/m/feed?cursor=: the member's alerts, newest first, 30 a page. Locked members get masked items and no contacts. */
export async function GET(req: Request) {
  const m = await requireMember(req, METHODS, { limit: 'read' });
  if (!m.ok) return m.response;
  const { user, db, profile } = m.ctx;

  const raw = new URL(req.url).searchParams.get('cursor');
  const cursor = raw ? decodeCursor(raw) : null;
  if (raw && !cursor) return fail(req, METHODS, 'invalid');

  const now = Date.now();
  const locked = computeAccess(profile!, now).locked;
  // The trades and keyword watches the plan covers: each alert carries its opportunity for them, and context rows are left out.
  const scope = matchScope(profile!);
  const page = await readFeedPage(db, user.id, cursor);
  if (page.error) return fail(req, METHODS, 'server_error', "We couldn't load your alerts. Try again in a moment.");
  const items = await buildAlerts(page.rows, { userId: user.id, locked, db, admin: locked ? null : adminOrNull(), siteUrl, now, trades: scope.categories, keywords: scope.keywords });
  return ok(req, METHODS, { locked, items, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null });
}
