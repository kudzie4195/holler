// Fixtures: hand-written attack strings (assumed). The tab case is the reproduction from the review (P1-2):
// new URL("/\t/evil.com", "https://holler.example").href === "https://evil.com/" under the WHATWG parser.
import { describe, expect, it } from 'vitest';
import { cleanCitySlug, safeNext } from '../../lib/auth/redirect';
import { originAllowed } from '../../lib/auth/origin';

describe('safeNext', () => {
  const bad = [
    '/%09/evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/ /evil.com',
    '/ /evil.com',
    '/ /evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '/%5cevil.com',
    '/%0a/evil.com',
    '/%0d/evil.com',
    'https://evil.com',
    'http://evil.com/app',
    'javascript:alert(1)',
    'evil.com',
    '/%E0%A4%A',
    '\\\\evil.com',
    '',
  ];
  it.each(bad)('rejects %j', (input) => {
    expect(safeNext(input)).toBe('/app');
  });

  it('rejects null and undefined', () => {
    expect(safeNext(null)).toBe('/app');
    expect(safeNext(undefined)).toBe('/app');
  });

  it('honors a custom fallback', () => {
    expect(safeNext('//evil.com', '/login')).toBe('/login');
  });

  it.each(['/app/settings', '/local/georgia', '/local/georgia/atlanta-ga', '/app?upgraded=1', '/reset', '/app/settings?tab=billing#x'])(
    'allows %j unchanged',
    (input) => {
      expect(safeNext(input)).toBe(input);
    },
  );

  it('every accepted value stays on the same origin when parsed like the browser does', () => {
    for (const input of [...bad, '/app', '/local/x']) {
      const out = safeNext(input);
      expect(new URL(out, 'https://holler.example').origin).toBe('https://holler.example');
    }
  });
});

describe('cleanCitySlug', () => {
  it('accepts slugs and rejects junk', () => {
    expect(cleanCitySlug('atlanta-ga')).toBe('atlanta-ga');
    expect(cleanCitySlug('../x')).toBeNull();
    expect(cleanCitySlug(null)).toBeNull();
  });
});

describe('originAllowed (login CSRF guard)', () => {
  const req = (headers: Record<string, string>) => new Request('https://holler.example/auth/confirm', { method: 'POST', headers });
  const site = 'https://holler.example';
  it('allows same origin and missing Origin', () => {
    expect(originAllowed(req({ origin: 'https://holler.example', host: 'holler.example' }), site)).toBe(true);
    expect(originAllowed(req({}), site)).toBe(true);
  });
  it('rejects cross-site, opaque and malformed origins', () => {
    expect(originAllowed(req({ origin: 'https://evil.example', host: 'holler.example' }), site)).toBe(false);
    expect(originAllowed(req({ origin: 'null' }), site)).toBe(false);
    expect(originAllowed(req({ origin: 'not a url' }), site)).toBe(false);
  });
});
