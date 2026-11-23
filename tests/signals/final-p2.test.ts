// Round 15 final fixes (review-final.md P2 and Q3-grades.md small issues), one test per fix.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { labelForMember } from '@/lib/signals/lead-rules';
import { routeWhyFor } from '@/lib/signals/permit-routing';
import { cardBrief, summaryForCard } from '@/lib/signals/brief';
import { outreachPlan } from '@/lib/outreach/plan';
import { WhoToContact } from '@/components/feed/who-to-contact';

vi.mock('server-only', () => ({}));

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('DeKalb summary: the label "Issued Status Code" is not a status', () => {
  const ds = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;
  const row = (status: string) => ({
    features: [{ attributes: { applicationNumber: 'BC-1', issuedDateTime: Date.UTC(2026, 10, 12, 15), WorkTypeDescription: 'Residential Air Conditioning', OccupancyTypeDescription: 'Single Family', statusDescription: status, location: '100 TEST ST, DECATUR GA 30030' }, geometry: { x: -84.3, y: 33.77 } }],
  });
  it('new rows never store the label, and a real status is kept', () => {
    expect(parseArcgis(row('Issued Status Code'), ds)[0].summary ?? '').not.toMatch(/issued status code/i);
    expect(parseArcgis(row('Issued'), ds)[0].summary ?? '').toContain('Issued');
  });
  it('rows already stored with the label do not show it on a card', () => {
    const stored = 'Residential Air Conditioning | Single Family | Issued Status Code | 100 TEST ST';
    const base = { source: 'arcgis-dekalb-permits', kind: 'permit', subtype: 'permit', title: 'Water heater permit in DeKalb County' };
    expect(summaryForCard({ ...base, summary: stored })).toBe('Residential Air Conditioning | Single Family | 100 TEST ST');
    expect(summaryForCard({ ...base, summary: 'Issued Status Code' })).toBeNull();
  });
});

describe('Who to contact', () => {
  const sunrun = [
    { role: 'contractor' as const, name: 'SUNRUN INSTALLATION SERVICES', phone: null },
    { role: 'contractor' as const, name: 'SUNRUN INSTALLATION SERVICES INC', phone: '415-555-0101', license: 'CL123456' },
    { role: 'site' as const, name: '', address: '8051 S SAWYER AVE', city: 'Chicago', state: 'IL', zip: '60652' },
  ];
  const sig = { source: 'socrata-chicago-permits', kind: 'permit', city: 'Chicago', state: 'IL', zip: '60652', summary: 'Solar | 8051 S SAWYER AVE' };

  it('one company under two spellings is one entry and keeps the phone and licence only the other row had', () => {
    const plan = outreachPlan(sig, sunrun as any);
    expect(plan?.type).toBe('org');
    const entries = (plan as any).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('SUNRUN INSTALLATION SERVICES');
    expect(entries[0].phone).toBe('415-555-0101');
    expect(entries[0].license).toBe('CL123456');
  });

  it('the job site is printed once on a card with two different companies', () => {
    const two = [{ role: 'contractor' as const, name: 'SUNRUN INSTALLATION SERVICES INC' }, { role: 'contractor' as const, name: 'ACME ELECTRIC LLC' }, sunrun[2]];
    const html = renderToStaticMarkup(createElement(WhoToContact, { item: sig, contacts: two as any }));
    const t = text(html);
    expect(t.match(/Job site: 8051 S SAWYER AVE/g) ?? []).toHaveLength(1);
    expect(t).toContain('SUNRUN INSTALLATION SERVICES INC');
    expect(t).toContain('ACME ELECTRIC LLC');
  });

  it('a company with its own address keeps it, and the job site still appears once', () => {
    const own = [{ role: 'contractor' as const, name: 'ACME ELECTRIC LLC', address: '1 MAIN ST', city: 'Chicago', state: 'IL', zip: '60601' }, { role: 'contractor' as const, name: 'BETA ROOFING LLC' }, { role: 'contractor' as const, name: 'GAMMA SOLAR LLC' }, sunrun[2]];
    const t = text(renderToStaticMarkup(createElement(WhoToContact, { item: sig, contacts: own as any })));
    expect(t.match(/Address: 1 MAIN ST/g) ?? []).toHaveLength(1);
    expect(t.match(/Job site: 8051 S SAWYER AVE/g) ?? []).toHaveLength(1);
  });

  it('"Reach this area" says Area for a county and City for a city', () => {
    const county = text(renderToStaticMarkup(createElement(WhoToContact, { item: { source: 'arcgis-dekalb-permits', kind: 'permit', city: 'DeKalb County', state: 'GA', zip: null, summary: null }, contacts: [] })));
    expect(county).toContain('Area: DeKalb County, GA');
    expect(county).not.toContain('City: DeKalb County');
    const city = text(renderToStaticMarkup(createElement(WhoToContact, { item: { source: 'arcgis-atlanta-permits', kind: 'permit', city: 'Atlanta', state: 'GA', zip: null, summary: null }, contacts: [] })));
    expect(city).toContain('City: Atlanta, GA');
  });
});

describe('routed sentences', () => {
  it('"Multi Family" is an apartment permit, never a commercial one', () => {
    const why = routeWhyFor('Remodel permit in Atlanta', 'pest-control', { summary: 'Multi Family Alteration | $57,750 job value | 100 PEACHTREE ST NE', source: 'arcgis-atlanta-permits' });
    expect(why).toMatch(/^An apartment permit was filed nearby/);
    expect(why).not.toMatch(/commercial/i);
  });
  it('a commercial alteration keeps the commercial noun', () => {
    expect(routeWhyFor('Remodel permit in Atlanta', 'pest-control', { summary: 'Commercial Alteration | $8,400,000 job value | 100 PEACHTREE ST NE', source: 'arcgis-atlanta-permits' })).toMatch(/^A commercial permit was filed nearby/);
  });
  it('new construction says "buildings" for cleaning, a new HOME says "homes"', () => {
    expect(routeWhyFor('New construction permit in Chicago', 'cleaning')).toBe('A new-construction permit was filed nearby; finished buildings may need a clean.');
    expect(routeWhyFor('New home permit in Chicago', 'cleaning')).toBe('A new-home permit was filed nearby; finished homes may need a clean.');
  });
  it('the brief card uses the same sentences', () => {
    const b = cardBrief({ source: 'socrata-nyc-permits', kind: 'permit', subtype: 'permit', title: 'New construction permit in New York City', label: 'coming_soon', trade: 'cleaning' });
    expect(b.why).not.toMatch(/\bhome\b/);
  });
});

describe('liquor licences do not reach HVAC', () => {
  const lic = (what: string, cats: string[]) => ({ source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: `New business license in Chicago: ${what}`, categories: cats });
  it.each(['Outdoor Patio, Sale of Liquor', 'Consumption on Premises - Incidental Activity', 'Sale of Liquor'])('%s -> context for HVAC', (what) => {
    expect(labelForMember(lic(what, ['hvac', 'pest-control']), ['hvac'])).toBe('context');
  });
  it('round 19 RULES (review lines 24, 25): no licence reaches HVAC, and only a food premises reaches pest control', () => {
    expect(labelForMember(lic('Retail Food Establishment, Sale of Liquor', ['hvac', 'pest-control']), ['hvac'])).toBe('context');
    expect(labelForMember(lic('Retail Food Establishment', ['hvac', 'pest-control']), ['pest-control'])).toBe('coming_soon');
    expect(labelForMember(lic('Outdoor Patio, Sale of Liquor', ['hvac', 'pest-control']), ['pest-control'])).toBe('context');
  });
});
