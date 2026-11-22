/**
 * holler_zip_waitlist: the double opt-in waitlist the live site ran before round 19 (the other branch's lib/waitlist, migration 0031,
 * applied live as their 0021). Round 19 UNIFY keeps ONE waitlist feature in the product: this base's (holler_area_waitlist, migration
 * 0021, lib/waitlist/service.ts), which new sign-ups use. This file keeps the other one's data usable and loses nothing:
 *  - confirmWaitlist: a confirm link already emailed by the live site (/waitlist/confirm?token=...) still stamps confirmed_at;
 *  - the owner's per-ZIP counts read both tables (lib/admin/metros-load.ts).
 * Nothing here inserts a new row, and nothing sends an email. Pure logic over injected dependencies (taken unchanged from their
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
