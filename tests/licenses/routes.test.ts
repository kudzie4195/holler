// Round 20 (LIC): /api/admin/license-probe and /api/cron/license-sync. Bearer only (tests/security/cron-bearer-only.test.ts covers ?key=);
// the sync does nothing while HOLLER_LICENSE_SYNC_ENABLED is unset, and neither route touches the database without a state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const SECRET = 'right-secret-for-tests-0123456789';
const admin = { n: 0 };
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    admin.n += 1;
    throw new Error('no database in this test');
  },
}));

const auth = { authorization: `Bearer ${SECRET}` };
beforeEach(() => {
  admin.n = 0;
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('licence routes', () => {
  it('without the header: 401, nothing runs', async () => {
    for (const r of ['admin/license-probe', 'cron/license-sync']) {
      const { GET } = (await import(`../../app/api/${r}/route`)) as { GET: (req: NextRequest) => Promise<Response> };
      expect((await GET(new NextRequest(`https://localholler.com/api/${r}?state=FL`))).status).toBe(401);
    }
    expect(admin.n).toBe(0);
  });

  it('without ?state: 400 with the known states, no fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const r of ['admin/license-probe', 'cron/license-sync']) {
      const { GET } = (await import(`../../app/api/${r}/route`)) as { GET: (req: NextRequest) => Promise<Response> };
      const res = await GET(new NextRequest(`https://localholler.com/api/${r}`, { headers: auth }));
      expect(res.status).toBe(400);
      expect((await res.json()).knownStates).toEqual(['FL', 'CA', 'AZ', 'TX', 'NY']);
    }
    expect(f).not.toHaveBeenCalled();
    expect(admin.n).toBe(0);
  });

  it('sync with the switch off: { status: "disabled" }, no fetch, no database client', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.stubEnv('HOLLER_LICENSE_SYNC_ENABLED', '');
    const { GET } = (await import('../../app/api/cron/license-sync/route')) as { GET: (req: NextRequest) => Promise<Response> };
    const res = await GET(new NextRequest('https://localholler.com/api/cron/license-sync?state=fl', { headers: auth }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'FL', status: 'disabled' });
    expect(f).not.toHaveBeenCalled();
    expect(admin.n).toBe(0);
  });

  it('sync with the switch on but no service key: 503, no fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.stubEnv('HOLLER_LICENSE_SYNC_ENABLED', '1');
    const { GET } = (await import('../../app/api/cron/license-sync/route')) as { GET: (req: NextRequest) => Promise<Response> };
    const res = await GET(new NextRequest('https://localholler.com/api/cron/license-sync?state=FL', { headers: auth }));
    expect(res.status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });

  it('probe: an unknown state is 400 and fetches nothing; a known state reads the file (fake) and writes nothing', async () => {
    const f = vi.fn(async () => new Response('LicenseNo,BusinessName,BusinessType,BusinessPhone\r\n1012345,ACME ROOFING LLC,Corporation,213-555-0142\r\n1012346,JOHN SMITH,Sole Owner,213-555-0143\r\n'));
    vi.stubGlobal('fetch', f);
    const { GET } = (await import('../../app/api/admin/license-probe/route')) as { GET: (req: NextRequest) => Promise<Response> };
    expect((await GET(new NextRequest('https://localholler.com/api/admin/license-probe?state=ZZ', { headers: auth }))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
    const res = await GET(new NextRequest('https://localholler.com/api/admin/license-probe?state=CA', { headers: auth }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', rowCount: 2, keptAsCompanies: 1, keptWithPhone: 1 });
    expect(JSON.stringify(body)).not.toMatch(/ACME|JOHN SMITH|1012345|555-0142/);
    expect(admin.n).toBe(0);
  });
});
