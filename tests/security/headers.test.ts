// Security pass r16 SEC-1: every path gets anti-framing and hardening headers from next.config.ts.
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

async function headersFor(): Promise<Record<string, string>> {
  expect(typeof nextConfig.headers).toBe('function');
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === '/:path*');
  expect(all, 'a rule for every path').toBeTruthy();
  return Object.fromEntries(all!.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe('security headers (SEC-1)', () => {
  it('forbids framing by any site (clickjacking on Settings > Delete account, billing, reply)', async () => {
    const h = await headersFor();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('sets nosniff, a referrer policy, base-uri, object-src and form-action', async () => {
    const h = await headersFor();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    for (const d of ["base-uri 'self'", "object-src 'none'", "form-action 'self'"]) expect(h['content-security-policy']).toContain(d);
    expect(h['permissions-policy']).toContain('camera=()');
  });
  it('the CSP sets no script-src/default-src (a nonce-less script policy would break prerendered pages)', async () => {
    const h = await headersFor();
    expect(h['content-security-policy']).not.toMatch(/script-src|default-src/);
  });
  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
