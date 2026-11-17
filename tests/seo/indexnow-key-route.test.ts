import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ key: undefined as string | undefined }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/lib/env', () => ({ env: new Proxy({}, { get: (_t, p) => (p === 'INDEXNOW_KEY' ? h.key : undefined) }) }));
import { GET } from '@/app/indexnow-key.txt/route';

describe('/indexnow-key.txt', () => {
  beforeEach(() => {
    h.key = undefined;
  });
  it('404s when INDEXNOW_KEY is unset or malformed', async () => {
    expect((await GET()).status).toBe(404);
    h.key = 'short';
    expect((await GET()).status).toBe(404);
    h.key = 'has spaces in it 123';
    expect((await GET()).status).toBe(404);
  });
  it('serves exactly the key as plain text when it is valid', async () => {
    h.key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });
});
