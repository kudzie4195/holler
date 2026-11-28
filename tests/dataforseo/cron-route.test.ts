import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  llm: vi.fn(async () => ({ status: 'done', checked: 9 })),
  vol: vi.fn(async () => ({ status: 'complete', batchesRun: 3 })),
  loc: vi.fn(async () => ({ status: 'complete', requests: 2 })),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('@/lib/dataforseo/llm-mentions', () => ({ QUERIES: ['a', 'b'], QUERY_LIMIT: 25, runLlmMentions: h.llm }));
vi.mock('@/lib/dataforseo/location-volume', () => ({
  buildLocationPlan: () => [],
  expectedLocationCostUsd: () => ({ cities: 0, keywords: 0, tasks: 0, usd: 0 }),
  loadDoneLocationKeywords: async () => new Set(),
  refreshLocationVolumes: h.loc,
}));
vi.mock('@/lib/dataforseo/volume', () => ({
  buildKeywordPlan: () => [],
  expectedVolumeCostUsd: () => ({ keywords: 0, tasks: 0, usd: 0 }),
  loadDoneKeywords: async () => new Set(),
  refreshVolumes: h.vol,
}));
vi.mock('@/lib/dataforseo/client', async (orig) => ({ ...(await orig<typeof import('@/lib/dataforseo/client')>()), getDb: async () => null }));

import { GET } from '../../app/api/cron/dataforseo/route';

const req = (q = '', headers: Record<string, string> = {}) => new Request('https://x.test/api/cron/dataforseo' + q, { headers });

describe('GET /api/cron/dataforseo', () => {
  beforeEach(() => {
    h.llm.mockClear();
    h.vol.mockClear();
    h.loc.mockClear();
    delete process.env.HOLLER_KEYWORD_VOLUME_ENABLED;
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
  });

  it('401 without the secret, and nothing runs', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('', { authorization: 'Bearer nope' }))).status).toBe(401);
    expect((await GET(req('?key=nope'))).status).toBe(401);
    expect(h.llm).not.toHaveBeenCalled();
    expect(h.vol).not.toHaveBeenCalled();
  });

  it('not_configured when the credentials are missing: 200 with a status, no work', async () => {
    const res = await GET(req('', { authorization: 'Bearer sekret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'not_configured' });
    expect(h.llm).not.toHaveBeenCalled();
  });

  it('switch off: status disabled, nothing runs (the switch has its own test with the real client in cron-switch.test.ts)', async () => {
    process.env.DATAFORSEO_LOGIN = 'a';
    process.env.DATAFORSEO_PASSWORD = 'b';
    const res = await GET(req('', { authorization: 'Bearer sekret' }));
    expect(await res.json()).toMatchObject({ status: 'disabled' });
    expect(h.llm).not.toHaveBeenCalled();
    expect(h.loc).not.toHaveBeenCalled();
    expect(h.vol).not.toHaveBeenCalled();
  });

  it('runs the mention check, location mode, then the volume refresh, for a Bearer secret; ?key= with the right secret is 401', async () => {
    process.env.DATAFORSEO_LOGIN = 'a';
    process.env.DATAFORSEO_PASSWORD = 'b';
    process.env.HOLLER_KEYWORD_VOLUME_ENABLED = '1';
    expect((await GET(req('?key=sekret'))).status).toBe(401);
    for (const r of [req('', { authorization: 'Bearer sekret' }), req('', { authorization: 'Bearer sekret' })]) {
      const res = await GET(r);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const j = await res.json();
      expect(j.llm.status).toBe('done');
      expect(j.location.requests).toBe(2);
      expect(j.volume.batchesRun).toBe(3);
    }
    expect(h.llm).toHaveBeenCalledTimes(2);
    expect(h.loc).toHaveBeenCalledTimes(2);
    expect(h.vol).toHaveBeenCalledTimes(2);
  });

  it('?dry=1 makes no DataForSEO work', async () => {
    process.env.DATAFORSEO_LOGIN = 'a';
    process.env.DATAFORSEO_PASSWORD = 'b';
    const res = await GET(req('?dry=1', { authorization: 'Bearer sekret' }));
    expect(await res.json()).toMatchObject({ dry: true, capUsd: 30 });
    expect(h.llm).not.toHaveBeenCalled();
    expect(h.loc).not.toHaveBeenCalled();
    expect(h.vol).not.toHaveBeenCalled();
  });
});
