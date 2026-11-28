import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real route with a stubbed DataForSEO client (fetch) and an in-memory database: proves the switch gates every call and every cent.
const h = vi.hoisted(() => ({ db: null as unknown, llm: vi.fn(async () => ({ status: 'done' })) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.db }));
vi.mock('@/lib/dataforseo/llm-mentions', async (orig) => ({ ...(await orig<typeof import('@/lib/dataforseo/llm-mentions')>()), runLlmMentions: h.llm }));

import { FakeDb } from '../ops/fakedb';
import { GET } from '../../app/api/cron/dataforseo/route';
import { jsonRes, okBody } from './helpers';

const req = (q = '', headers: Record<string, string> = { authorization: 'Bearer sekret' }) => new Request('https://x.test/api/cron/dataforseo' + q, { headers });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/api/cron/dataforseo and HOLLER_KEYWORD_VOLUME_ENABLED', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb({ holler_dataforseo_spend: [], holler_keyword_volume: [], holler_llm_mentions: [] });
    h.db = db;
    h.llm.mockClear();
    // The 5.1 s spacing between requests is real time in the route; make it instant here.
    vi.stubGlobal('setTimeout', ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);
    fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const t = JSON.parse(String(init.body))[0] as { keywords?: string[] };
      return jsonRes(okBody((t.keywords ?? []).map((keyword) => ({ keyword, search_volume: 10 })), 0.075));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('DATAFORSEO_LOGIN', 'user@example.test');
    vi.stubEnv('DATAFORSEO_PASSWORD', 'p4ss');
    vi.stubEnv('HOLLER_KEYWORD_VOLUME_ENABLED', '');
    vi.stubEnv('DATAFORSEO_MONTHLY_CAP_USD', '');
  });

  it('switch off (empty, unset, "0", "off"): status disabled, no DataForSEO call, no spend row, no database read', async () => {
    for (const v of ['', '0', 'off', 'no', 'false']) {
      vi.stubEnv('HOLLER_KEYWORD_VOLUME_ENABLED', v);
      const res = await GET(req());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'disabled', spentUsd: 0 });
    }
    vi.unstubAllEnvs();
    vi.stubEnv('DATAFORSEO_LOGIN', 'a');
    vi.stubEnv('DATAFORSEO_PASSWORD', 'b');
    delete process.env.HOLLER_KEYWORD_VOLUME_ENABLED;
    expect((await (await GET(req())).json()).status).toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.llm).not.toHaveBeenCalled();
    expect(db.tables.holler_dataforseo_spend).toHaveLength(0);
    expect(db.tables.holler_keyword_volume).toHaveLength(0);
    expect(db.calls).toEqual([]);
  });

  it('switch off + ?dry=1 still works: reports the plan and the estimate under 10 USD, makes no call', async () => {
    const res = await GET(req('?dry=1'));
    const j = await res.json();
    expect(j).toMatchObject({ dry: true, enabled: false, capUsd: 30, spentUsd: 0 });
    expect(j.expectedLocation).toMatchObject({ cities: 40, tasks: 40, usd: 3 });
    expect(j.expectedMonthlyUsd.total).toBeLessThan(10);
    expect(j.expectedMonthlyUsd.total).toBeCloseTo(j.expectedMonthlyUsd.volume + j.expectedMonthlyUsd.location + j.expectedMonthlyUsd.llm, 3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.llm).not.toHaveBeenCalled();
    expect(db.tables.holler_dataforseo_spend).toHaveLength(0);
  });

  it('switch off + bad auth is still 401', async () => {
    expect((await GET(req('', {}))).status).toBe(401);
    expect((await GET(req('?key=sekret', {}))).status).toBe(401);
  });

  it('switch on: location mode runs (shape and spend booked) inside the cap, then the national refresh', async () => {
    vi.stubEnv('HOLLER_KEYWORD_VOLUME_ENABLED', '1');
    vi.stubEnv('DATAFORSEO_MONTHLY_CAP_USD', '0.5');
    const res = await GET(req());
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(h.llm).toHaveBeenCalledTimes(1);
    expect(j.location).toBeDefined();
    expect(j.volume).toBeDefined();
    const tasks = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))[0] as Record<string, unknown>);
    expect(tasks.some((t) => t.location_name === 'Atlanta,Georgia,United States' && !('location_code' in t))).toBe(true);
    const spent = db.tables.holler_dataforseo_spend.reduce((n, x) => n + Number(x.cost_usd), 0);
    expect(spent).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('switch on with a tiny cap: nothing is spent past the cap', async () => {
    vi.stubEnv('HOLLER_KEYWORD_VOLUME_ENABLED', 'on');
    vi.stubEnv('DATAFORSEO_MONTHLY_CAP_USD', '0');
    const j = await (await GET(req())).json();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(j.location.status).toBe('cap_reached');
    expect(j.volume.status).toBe('cap_reached');
  });
});
