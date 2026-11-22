// Security pass r16, review P2-1: every cron and admin route takes CRON_SECRET in the Authorization header ONLY. The right secret
// in a ?key= query is 401 (CRON_SECRET also signs every emailed token, so a secret in a logged URL would be a forgery key).
// Schedulers already send the header: supabase/cron.sql (pg_net) and Vercel Cron ("Authorization: Bearer <CRON_SECRET>",
// https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isBearerAuthorized, isCronAuthorized } from '../../lib/email/cron-auth';

vi.mock('server-only', () => ({}));
const SECRET = 'right-secret-for-tests-0123456789';

const ROUTES = [
  'admin/firecrawl-probe',
  'admin/quality',
  'admin/scores',
  'admin/sources',
  'cron/ai',
  'cron/dataforseo',
  'cron/health',
  'cron/indexnow',
  'cron/lifecycle',
  'cron/moat',
  'cron/notify',
  'cron/scan',
] as const;

const adminTouched = { n: 0 };
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    adminTouched.n += 1;
    throw new Error('must not be reached without auth');
  },
}));

beforeEach(() => {
  adminTouched.n = 0;
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe('cron and admin routes: Bearer only (P2-1)', () => {
  for (const r of ROUTES) {
    it(`/api/${r}: ?key=<right secret> is 401 and nothing runs`, async () => {
      const { GET } = (await import(`../../app/api/${r}/route`)) as { GET: (req: NextRequest) => Promise<Response> };
      for (const qs of [`?key=${SECRET}`, `?key=${SECRET}&dry=1`]) {
        const res = await GET(new NextRequest(`https://localholler.com/api/${r}${qs}`));
        expect(res.status).toBe(401);
      }
      expect(adminTouched.n).toBe(0);
    });
  }

  it('the helper: header accepted, query refused, unset secret refuses everything', () => {
    const bearer = new Request('https://x.test/api/cron/scan', { headers: { authorization: `Bearer ${SECRET}` } });
    const query = new Request(`https://x.test/api/cron/scan?key=${SECRET}`);
    expect(isCronAuthorized(bearer, SECRET)).toBe(true);
    expect(isCronAuthorized(query, SECRET)).toBe(false);
    expect(isBearerAuthorized(query, SECRET)).toBe(false);
    expect(isCronAuthorized(bearer, undefined)).toBe(false);
  });

  it('no route reads a key query parameter any more, and the docs show the header form only', () => {
    for (const r of ROUTES) expect(readFileSync(`app/api/${r}/route.ts`, 'utf8')).not.toMatch(/searchParams\.get\(['"]key['"]\)/);
    expect(readFileSync('lib/email/cron-auth.ts', 'utf8')).not.toMatch(/searchParams/);
    for (const doc of ['LAUNCH.md', 'SPEC.md']) expect(readFileSync(doc, 'utf8')).not.toMatch(/[?&]key=</);
    const cron = readFileSync('supabase/cron.sql', 'utf8');
    expect(cron).toMatch(/'Authorization', 'Bearer '/);
    expect(cron).not.toMatch(/[?&]key=/);
  });
});
