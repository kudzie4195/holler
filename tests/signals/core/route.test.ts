import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

async function load(secret: string | undefined) {
  vi.resetModules();
  // Keep this test independent of the other worker's adapter modules.
  vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [], getAdapter: () => undefined }));
  if (secret === undefined) vi.stubEnv('CRON_SECRET', '');
  else vi.stubEnv('CRON_SECRET', secret);
  return (await import('@/app/api/cron/scan/route')).GET;
}
const req = (qs = '', headers: Record<string, string> = {}) => new NextRequest(`http://localhost/api/cron/scan${qs}`, { headers });

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/scan auth', () => {
  it('fails closed when CRON_SECRET is not configured', async () => {
    const GET = await load(undefined);
    expect((await GET(req('?key=anything'))).status).toBe(500);
  });
  it('rejects missing or wrong credentials', async () => {
    const GET = await load('s3cret');
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('?key=nope'))).status).toBe(401);
    expect((await GET(req('', { authorization: 'Bearer nope' }))).status).toBe(401);
  });
  it('accepts Bearer and ?key=, and rejects an unknown ?source= with 400 (dry, no DB)', async () => {
    const GET = await load('s3cret');
    const a = await GET(req('?dry=1&source=__nope__', { authorization: 'Bearer s3cret' }));
    expect(a.status).toBe(400);
    const b = await GET(req('?dry=1&source=__nope__&key=s3cret'));
    expect(b.status).toBe(400);
  });
});
