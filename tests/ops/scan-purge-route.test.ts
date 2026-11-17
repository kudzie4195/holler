// Integration round 3, item 1: the scan cron runs the resident-request housekeeping (never on a dry run), puts its result in the JSON
// as `requests`, and a purge failure (an error result, a throw or a timeout) never fails the scan.
// Review round 3 P1-5: the purge runs BEFORE the scan, bounded, so a slow scan cannot starve the deletions the legal pages promise.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  purge: vi.fn(),
  runScan: vi.fn(),
  order: [] as string[],
}));

async function load() {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.doMock('@/lib/signals/run', () => ({ SCAN_DEADLINE_MS: 45_000, runScan: h.runScan }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ fake: 'db' }) }));
  vi.doMock('@/lib/requests/service', () => ({ purgeEndedRequests: h.purge }));
  return (await import('@/app/api/cron/scan/route')).GET;
}
const req = (qs = '') => new NextRequest(`http://localhost/api/cron/scan${qs}`, { headers: { authorization: 'Bearer s3cret' } });

afterEach(() => {
  vi.unstubAllEnvs();
  h.purge.mockReset();
  h.runScan.mockReset();
  h.order.length = 0;
});

describe('GET /api/cron/scan: request housekeeping', () => {
  it('runs purgeEndedRequests BEFORE the scan, with the scan database, and returns its result as `requests`', async () => {
    h.runScan.mockImplementation(async () => (h.order.push('scan'), { sources: [{ id: 'nws' }], error: null }));
    h.purge.mockImplementation(async () => (h.order.push('purge'), { purged: 1, deletedPending: 2, signalsDeleted: 3, error: null }));
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toEqual({ purged: 1, deletedPending: 2, signalsDeleted: 3, error: null });
    expect(body.sources).toEqual([{ id: 'nws' }]);
    expect(h.order).toEqual(['purge', 'scan']);
    expect(h.purge.mock.calls[0][0]).toEqual({ fake: 'db' });
  });

  it('a scan that throws cannot skip the purge: the purge already ran', async () => {
    h.purge.mockImplementation(async () => (h.order.push('purge'), { purged: 0, deletedPending: 0, signalsDeleted: 1, error: null }));
    h.runScan.mockImplementation(async () => {
      h.order.push('scan');
      throw new Error('adapter exploded');
    });
    const GET = await load();
    await expect(GET(req())).rejects.toThrow('adapter exploded');
    expect(h.order).toEqual(['purge', 'scan']);
  });

  it('the purge is bounded: one that hangs is cut off, the scan still runs with a deadline inside the function budget', async () => {
    vi.useFakeTimers();
    try {
      h.purge.mockImplementation(() => new Promise(() => {}));
      h.runScan.mockImplementation(async (opts: { deadlineMs: number }) => (h.order.push(`scan:${opts.deadlineMs}`), { sources: [], error: null }));
      const GET = await load();
      const pending = GET(req());
      await vi.advanceTimersByTimeAsync(8_000);
      const body = await (await pending).json();
      expect(body.requests).toMatchObject({ signalsDeleted: 0 });
      expect(body.requests.error).toMatch(/purge passed 8 s/);
      expect(h.order).toHaveLength(1);
      const deadline = Number(h.order[0].split(':')[1]);
      expect(deadline).toBeLessThanOrEqual(45_000 - 8_000);
      expect(deadline).toBeGreaterThanOrEqual(20_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not purge on a dry run (requests: null)', async () => {
    h.runScan.mockResolvedValue({ sources: [{ id: 'nws' }], error: null });
    const GET = await load();
    const body = await (await GET(req('?dry=1'))).json();
    expect(h.purge).not.toHaveBeenCalled();
    expect(body.requests).toBeNull();
  });

  it('a purge that throws never fails the scan: 200, and the error is reported', async () => {
    h.runScan.mockResolvedValue({ sources: [{ id: 'nws' }], error: null });
    h.purge.mockRejectedValue(new Error('db down'));
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).requests).toMatchObject({ signalsDeleted: 0, error: 'db down' });
  });

  it('a purge error result keeps the scan status', async () => {
    h.runScan.mockResolvedValue({ sources: [{ id: 'nws' }], error: null });
    h.purge.mockResolvedValue({ purged: 0, deletedPending: 0, signalsDeleted: 0, error: 'permission denied' });
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).requests.error).toBe('permission denied');
  });
});
