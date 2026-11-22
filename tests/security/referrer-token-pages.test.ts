// Review P2-2: pages whose URL carries a token get Referrer-Policy: no-referrer, overriding the global strict-origin-when-cross-origin.
// The effective value is worked out with Next's own path matcher (getPathMatch) and the documented "last matching entry wins" rule.
import { describe, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import nextConfig from '../../next.config';

async function effective(pathname: string): Promise<Record<string, string>> {
  const rules = await nextConfig.headers!();
  const out: Record<string, string> = {};
  for (const r of rules) {
    if (getPathMatch(r.source, { removeUnnamedParams: true })(pathname) === false) continue;
    for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

const TOKEN_PAGES = [
  '/api/auth/verify',
  '/api/feedback/outcome',
  '/api/cron/notify/unsubscribe',
  '/api/cron/lifecycle/unsubscribe',
  '/request/confirm',
  '/request/close',
  '/auth/confirm',
  '/auth/confirm/continue',
];

describe('Referrer-Policy on token pages (P2-2)', () => {
  for (const p of TOKEN_PAGES) {
    it(`${p}: no-referrer, and the global hardening headers are still there`, async () => {
      const h = await effective(p);
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    });
  }
  it('ordinary pages keep strict-origin-when-cross-origin', async () => {
    for (const p of ['/', '/login', '/app', '/check', '/request', '/api/requests', '/auth']) {
      expect((await effective(p))['referrer-policy']).toBe('strict-origin-when-cross-origin');
    }
  });
  it('every emailed token link points at one of the covered paths', async () => {
    const { readFileSync } = await import('node:fs');
    const src = ['app/api/auth/forgot/route.ts', 'app/api/cron/notify/route.ts', 'lib/auth/verification.ts', 'lib/moat/run.ts', 'lib/requests/service.ts', 'lib/lifecycle/unsub.ts']
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const paths = new Set<string>();
    for (const m of src.matchAll(/\}(\/(?:api|request|auth)\/[a-z/_-]+)\?(?:t|token|token_hash)=/g)) paths.add(m[1]);
    for (const m of src.matchAll(/_PATH = '(\/api\/[a-z/_-]+)'/g)) paths.add(m[1]);
    expect(paths.size).toBeGreaterThanOrEqual(6);
    for (const p of paths) expect(TOKEN_PAGES).toContain(p);
  });
});
