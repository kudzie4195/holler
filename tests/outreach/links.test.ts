import { describe, expect, it } from 'vitest';
import { buildLink, cleanText, safeWebsite, USPS_EDDM_TOOL_URL } from '@/lib/outreach/links';

describe('outreach links: the one builder', () => {
  it('search link: https origin, org plus city and state, URL-encoded, new tab with rel', () => {
    const l = buildLink({ type: 'search', org: 'Smith & Sons Roofing, LLC', city: 'Atlanta', state: 'GA' })!;
    expect(l.href).toBe('https://www.google.com/search?q=Smith%20%26%20Sons%20Roofing%2C%20LLC%20Atlanta%20GA');
    expect(l).toMatchObject({ external: true, target: '_blank', rel: 'noopener noreferrer' });
  });

  it('search link survives a missing city and state, and is null with no organisation', () => {
    expect(buildLink({ type: 'search', org: 'Acme Plumbing' })!.href).toBe('https://www.google.com/search?q=Acme%20Plumbing');
    expect(buildLink({ type: 'search', org: '   ' })).toBeNull();
  });

  it('map link encodes the whole address', () => {
    const l = buildLink({ type: 'map', address: '12 Main St #4', city: 'Atlanta', state: 'GA', zip: '30301' })!;
    expect(l.href).toBe('https://www.google.com/maps/search/?api=1&query=12%20Main%20St%20%234%20Atlanta%20GA%2030301');
    expect(buildLink({ type: 'map', address: '' })).toBeNull();
  });

  it('eddm link is the verified USPS route tool; guide links stay on the site', () => {
    expect(USPS_EDDM_TOOL_URL).toBe('https://eddm.usps.com/eddm/select-routes.htm');
    expect(buildLink({ type: 'eddm' })!.href).toBe(USPS_EDDM_TOOL_URL);
    expect(buildLink({ type: 'guide', guide: 'storms' })).toEqual({
      href: '/guides/storm-damage-leads-from-weather-alerts-and-storm-reports',
      external: false,
    });
    expect(buildLink({ type: 'guide', guide: 'respond' })!.href).toBe('/guides/how-to-respond-to-a-local-lead-fast');
  });

  it('no input can produce a javascript:, data: or other non-https href', () => {
    const nasty = ['javascript:alert(1)', 'data:text/html,<script>', 'https://evil.test/"><script>', '//evil.test', "' onmouseover='x", '\u0000javascript:x'];
    for (const n of nasty) {
      for (const l of [
        buildLink({ type: 'search', org: n, city: n, state: n }),
        buildLink({ type: 'map', address: n, city: n, state: n, zip: n }),
        buildLink({ type: 'website', url: n }),
      ]) {
        if (l) expect(l.href.startsWith('https://')).toBe(true);
        if (l && !l.href.startsWith('https://www.google.com/')) expect(l.href).toMatch(/^https:\/\/[a-z0-9.-]+\//i);
      }
    }
    // text lands only inside the encoded query value
    const l = buildLink({ type: 'search', org: 'x&y=1#frag"><script>' })!;
    expect(l.href.split('?q=')[1]).not.toMatch(/[&#"<>]/);
  });

  it('every external link carries target and rel', () => {
    const links = [
      buildLink({ type: 'search', org: 'A' }),
      buildLink({ type: 'map', address: 'B' }),
      buildLink({ type: 'eddm' }),
      buildLink({ type: 'website', url: 'example.com' }),
    ];
    for (const l of links) expect(l).toMatchObject({ external: true, target: '_blank', rel: 'noopener noreferrer' });
  });

  it('websites: bare domain gets https, http is upgraded, other schemes and odd hosts are rejected', () => {
    expect(safeWebsite('acmeroofing.com')).toBe('https://acmeroofing.com/');
    expect(safeWebsite('http://acmeroofing.com/about')).toBe('https://acmeroofing.com/about');
    expect(safeWebsite('javascript:alert(1)')).toBeNull();
    expect(safeWebsite('data:text/html,hi')).toBeNull();
    expect(safeWebsite('ftp://example.com')).toBeNull();
    expect(safeWebsite('https://user:pw@example.com')).toBeNull();
    expect(safeWebsite('localhost')).toBeNull();
    expect(safeWebsite('two words.com')).toBeNull();
    expect(safeWebsite(null)).toBeNull();
  });

  it('cleanText flattens control characters and caps length', () => {
    expect(cleanText('a\n\tb\u0000c')).toBe('a b c');
    expect(cleanText('x'.repeat(500))).toHaveLength(200);
  });
});
