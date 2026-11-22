// Review P2-4a/b and P2-3: LAUNCH.md says exactly what 0023 revokes, the re-run note ends at 0023, the reset protection is described
// as Holler's route only, and no step passes CRON_SECRET in a URL.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const md = readFileSync('LAUNCH.md', 'utf8');
const sql = readFileSync('supabase/migrations/0023_holler_grant_hygiene.sql', 'utf8').toLowerCase();

describe('LAUNCH.md matches the code (review follow-ups)', () => {
  it('the 0023 step names the authenticated SELECT revoke on holler_scan_runs that the SQL does (P2-4a)', () => {
    expect(sql).toContain('revoke select on table public.holler_scan_runs from anon, authenticated;');
    expect(md).toContain('anon and authenticated SELECT on holler_scan_runs');
    expect(md).not.toContain('anon SELECT on holler_matches and holler_scan_runs');
  });
  it('the re-run note runs the additive files through 0025 (P2-4b; 0024 and 0025 joined in round 17)', () => {
    expect(md).toContain('run 0001 to 0006 and 0008 to 0025 in order');
    expect(md).not.toMatch(/0008 to 0020 in order/);
  });
  it('the reset protection is described as the app route only, with the Supabase setting as the owner decision (P2-3)', () => {
    expect(md).toMatch(/Password change protection is for Holler's own route only/);
    expect(md).toMatch(/Secure password change/);
  });
  it('no step passes the cron secret in a query string (P2-1)', () => {
    expect(md).not.toMatch(/[?&]key=/);
  });
});
