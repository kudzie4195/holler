// Integration round 3 (commander b): site-wide Organization + WebSite JSON-LD, once, in app/layout.tsx, built on organizationLd().
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPANY } from '@/lib/legal/company';
import { organizationLd, siteLd } from '@/lib/seo/jsonld';
import { jsonLdString } from '@/lib/seo/serialize';

describe('siteLd', () => {
  const ld = JSON.parse(jsonLdString(siteLd())) as { '@context': string; '@graph': Record<string, unknown>[] };
  const org = ld['@graph'].find((n) => n['@type'] === 'Organization')!;
  const site = ld['@graph'].find((n) => n['@type'] === 'WebSite')!;
  it('Organization extends organizationLd() with the legal name and mailing address from COMPANY', () => {
    expect(ld['@context']).toBe('https://schema.org');
    expect(org).toMatchObject(organizationLd());
    expect(org.legalName).toBe(COMPANY.legalName);
    expect(org.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: COMPANY.addressLines[0],
      addressLocality: 'Marietta',
      addressRegion: 'GA',
      postalCode: '30064',
      addressCountry: 'US',
    });
    expect(`${COMPANY.addressLines[1]}`).toBe('Marietta, GA 30064');
  });
  it('has no phone and no sameAs links', () => {
    const s = JSON.stringify(ld);
    expect(s).not.toMatch(/telephone|sameAs/);
  });
  it('WebSite points at the Organization', () => {
    expect(site.publisher).toEqual({ '@id': org['@id'] });
    expect(site.name).toBe(COMPANY.brand);
  });
  it('is rendered exactly once, in the root layout', () => {
    const layout = readFileSync(path.resolve(__dirname, '../../app/layout.tsx'), 'utf8');
    expect(layout.match(/jsonLdString\(siteLd\(\)\)/g)).toHaveLength(1);
  });
});
