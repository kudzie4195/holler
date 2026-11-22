// Round 19 UNIFY: the live site's double opt-in waitlist (holler_zip_waitlist). Its confirm links keep working after the merge; the
// confirm tests and the migration tests are the other branch's tests/waitlist/service.test.ts ones, rewritten for lib/waitlist/zip-confirm.ts
// and the renamed migration 0031. Their joinWaitlist, email and card tests are not kept: that sign-up path is not in the merged product
// (this base's waitlist takes new sign-ups; tests/waitlist/service.test.ts covers it).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { signScopedToken, verifyScopedToken } from '../../lib/email/token';
import { WAITLIST_CONFIRM_PURPOSE, confirmWaitlist, type ZipConfirmDeps } from '../../lib/waitlist/zip-confirm';

vi.mock('server-only', () => ({}));

const SECRET = 'test-secret';
const ID = '6f1c2b0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c';

function fakeDeps(): { deps: ZipConfirmDeps; confirmed: string[] } {
  const confirmed: string[] = [];
  const deps: ZipConfirmDeps = {
    db: {
      confirm: async (id) => {
        confirmed.push(id);
        return { data: id === ID ? { id } : null, error: null };
      },
    },
    verifyToken: (t) => verifyScopedToken(t, WAITLIST_CONFIRM_PURPOSE, SECRET),
    now: () => new Date('2026-11-19T12:00:00Z'),
  };
  return { deps, confirmed };
}

describe('confirmWaitlist (links the live site already emailed)', () => {
  it('confirms with a valid token and rejects forged, expired, wrong-purpose and junk tokens', async () => {
    const { deps, confirmed } = fakeDeps();
    expect(await confirmWaitlist(deps, signScopedToken(WAITLIST_CONFIRM_PURPOSE, ID, SECRET, 3600))).toEqual({ code: 'confirmed' });
    expect(confirmed).toEqual([ID]);
    const forged = signScopedToken(WAITLIST_CONFIRM_PURPOSE, ID, 'other-secret', 3600);
    const expired = signScopedToken(WAITLIST_CONFIRM_PURPOSE, ID, SECRET, 60, Date.now() - 3_600_000);
    const verifyTok = signScopedToken('verify', ID, SECRET, 3600);
    for (const bad of [forged, expired, verifyTok, '', 'x.y', 42, 'a'.repeat(500)]) {
      expect(await confirmWaitlist(deps, bad)).toEqual({ code: 'invalid' });
    }
    expect(confirmed).toEqual([ID]);
  });

  it('a deleted row reads as an inactive link; a database error is unavailable', async () => {
    const { deps } = fakeDeps();
    const other = '00000000-0000-4000-8000-000000000000';
    expect(await confirmWaitlist(deps, signScopedToken(WAITLIST_CONFIRM_PURPOSE, other, SECRET, 3600))).toEqual({ code: 'invalid' });
    const failing: ZipConfirmDeps = { ...deps, db: { confirm: async () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) } };
    expect(await confirmWaitlist(failing, signScopedToken(WAITLIST_CONFIRM_PURPOSE, ID, SECRET, 3600))).toEqual({ code: 'unavailable' });
  });

  it('nothing in the merged product inserts into holler_zip_waitlist or sends its confirm email', () => {
    for (const f of ['lib/waitlist/service.ts', 'lib/waitlist/deps.ts', 'lib/waitlist/zip-confirm.ts', 'lib/waitlist/zip-confirm-deps.ts', 'app/api/waitlist/route.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/holler_zip_waitlist['"`]?\)?\s*\.\s*(insert|upsert)/);
      expect(src, f).not.toMatch(/renderWaitlistConfirm|sendEmail/);
    }
  });
});

describe('migration 0031_holler_zip_waitlist.sql (the other branch 0021, renamed, already applied live)', () => {
  const sql = readFileSync('supabase/migrations/0031_holler_zip_waitlist.sql', 'utf8');
  it('is service-role only and touches only holler_ objects', () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.holler_zip_waitlist from public, anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
    const ddl = sql.replace(/--[^\n]*/g, '');
    const objects = [
      ...ddl.matchAll(/(?:create table if not exists|create unique index if not exists|create index if not exists|alter table|revoke all on table|drop constraint if exists|add constraint)\s+(?:public\.)?([a-z_]+)/gi),
      ...ddl.matchAll(/\bon public\.([a-z_]+)/gi),
    ].map((m) => m[1]);
    expect(objects.length).toBeGreaterThan(6);
    for (const o of objects) expect(o).toMatch(/^holler_/);
  });
  it('one row per email and ZIP, and says it is already applied live', () => {
    expect(sql).toMatch(/unique index if not exists holler_zip_waitlist_email_zip_idx on public\.holler_zip_waitlist \(email, zip\)/);
    expect(sql).toMatch(/ALREADY APPLIED on the live database/);
  });
});
