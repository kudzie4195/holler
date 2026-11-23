/**
 * holler_zip_waitlist: the double opt-in waitlist the live site ran before round 19 (the other branch's lib/waitlist, migration 0031,
 * applied live as their 0021). Since the round 19 review (defect 1) the product's ONE waitlist writes here with double opt-in
 * (lib/waitlist/service.ts: this base's card and checks, their table and confirmation email). This file confirms the links:
 *  - confirmWaitlist: a confirm link (/waitlist/confirm?token=...) stamps confirmed_at, including links the live site sent before;
 *  - the owner's per-ZIP counts read both tables (lib/admin/metros-load.ts); holler_area_waitlist stays, unused by new sign-ups. Pure logic over injected dependencies (taken unchanged from their
 * lib/waitlist/service.ts confirmWaitlist); production wiring is zipWaitlistConfirmDeps in lib/waitlist/zip-confirm-deps.ts.
 */

export const ZIP_WAITLIST_TABLE = 'holler_zip_waitlist';
/** Same purpose string the live site signed its links with, so those links still verify. */
export const WAITLIST_CONFIRM_PURPOSE = 'waitlist';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type DbError = { code?: string; message?: string } | null;

export interface ZipConfirmDeps {
  db: { confirm(id: string, at: string): PromiseLike<{ data: { id: string } | null; error: DbError }> };
  verifyToken: (token: string) => string | null;
  now: () => Date;
}

export type ConfirmCode = 'confirmed' | 'invalid' | 'unavailable';

export async function confirmWaitlist(deps: ZipConfirmDeps, token: unknown): Promise<{ code: ConfirmCode }> {
  if (typeof token !== 'string' || token.length > 400) return { code: 'invalid' };
  const id = deps.verifyToken(token);
  if (!id || !UUID_RE.test(id)) return { code: 'invalid' };
  const res = await deps.db.confirm(id, deps.now().toISOString());
  if (res.error) return { code: 'unavailable' };
  // No row: deleted since the email was sent. Same answer as a bad link.
  return { code: res.data ? 'confirmed' : 'invalid' };
}
