import { describe, expect, it } from 'vitest';
import type { ContactInput } from '@/lib/contacts/types';
import { emailContact, hasBlock, mayHaveContacts, outreachPlan, recordClass, roleWords, type RecordClass } from '@/lib/outreach/plan';

const place = { city: 'Atlanta', state: 'GA', county: 'Fulton County', zip: '30301' };
const site: ContactInput = { role: 'site', name: '', address: '12 Main St', city: 'Atlanta', state: 'GA', zip: '30301' };
const gc = (name: string, extra: Partial<ContactInput> = {}): ContactInput => ({ role: 'contractor', name, ...extra });

describe('recordClass: every source and kind the feed can show', () => {
  const table: Array<[string, string, RecordClass]> = [
    ['socrata-chicago-permits', 'permit', 'permit'],
    ['arcgis-dekalb-permits', 'permit', 'permit'],
    ['socrata-sf-business', 'civic', 'business'],
    ['arcgis-mecklenburg-permits', 'permit', 'permit'],
    ['socrata-chicago-inspections', 'civic', 'inspection'],
    ['usaspending', 'contract', 'award'],
    ['sam-gov', 'contract', 'bid'],
    ['nws', 'alert', 'storm'],
    ['spc', 'report', 'storm'],
    ['fema', 'disaster', 'storm'],
    ['usgs', 'quake', 'area'],
    ['socrata-nyc-311', 'civic', 'area'],
    ['socrata-austin-violations', 'civic', 'area'],
    ['socrata-nyc-events', 'event', 'none'],
    ['ticketmaster', 'event', 'none'],
    ['faa', 'travel', 'none'],
    ['bluesky', 'ask', 'none'],
    ['websearch-brave', 'ask', 'none'],
    ['holler-request', 'ask', 'request'],
    ['some-new-source', 'civic', 'none'],
  ];
  for (const [source, kind, want] of table) {
    it(`${source} / ${kind} -> ${want}`, () => expect(recordClass(source, kind)).toBe(want));
  }
  it('helpers agree', () => {
    expect(mayHaveContacts('nws', 'alert')).toBe(false);
    // Round 20 (review P1-1): NYC whole-building heat requests keep a private block-level site, so the loader is asked for NYC 311.
    expect(mayHaveContacts('socrata-nyc-311', 'civic')).toBe(true);
    expect(mayHaveContacts('socrata-chicago-311', 'civic')).toBe(false);
    expect(mayHaveContacts('holler-request', 'ask')).toBe(false);
    expect(mayHaveContacts('usaspending', 'contract')).toBe(true);
    expect(hasBlock('faa', 'travel')).toBe(false);
    expect(hasBlock('holler-request', 'ask')).toBe(false);
    expect(hasBlock('nws', 'alert')).toBe(true);
    expect(roleWords('sam-gov', 'contract')).toBe('The office taking bids');
    expect(roleWords('nws', 'alert')).toBeNull();
  });
});

describe('P2-6: address label on a contractor entry', () => {
  const sig = { source: 'socrata-chicago-permits', kind: 'permit', ...place };
  it('no street of its own: the job-site address is labelled Job site', () => {
    const p = outreachPlan(sig, [site, gc('Peachtree Roofing LLC')]);
    expect(p?.type === 'org' && p.entries[0].addressLabel).toBe('Job site');
    expect(p?.type === 'org' && p.entries[0].address).toBe('12 Main St, Atlanta, GA 30301');
  });
  it('its own street address: labelled Address', () => {
    const p = outreachPlan(sig, [site, gc('Peachtree Roofing LLC', { address: '9 Oak Ave', city: 'Marietta', state: 'GA', zip: '30060' })]);
    expect(p?.type === 'org' && p.entries[0].addressLabel).toBe('Address');
    expect(p?.type === 'org' && p.entries[0].address).toBe('9 Oak Ave, Marietta, GA 30060');
  });
});

describe('outreachPlan: organisation records', () => {
  it('permit with a contractor: name, role, address, published details, three actions', () => {
    const p = outreachPlan(
      { source: 'socrata-chicago-permits', kind: 'permit', ...place },
      [site, gc('Peachtree Roofing LLC', { phone: '404-555-0100', email: 'jobs@peachtree.example', website: 'peachtree.example' })],
    );
    expect(p?.type).toBe('org');
    if (p?.type !== 'org') return;
    const e = p.entries[0];
    expect(e).toMatchObject({ name: 'Peachtree Roofing LLC', role: 'Named on this permit', phone: '404-555-0100', email: 'jobs@peachtree.example' });
    expect(e.address).toBe('12 Main St, Atlanta, GA 30301');
    expect(e.addressLabel).toBe('Job site');
    expect(e.search?.href).toBe('https://www.google.com/search?q=Peachtree%20Roofing%20LLC%20Atlanta%20GA');
    expect(e.search?.label).toBe('Search this business');
    expect(e.map?.label).toBe('Open map');
    expect(e.map?.href).toContain('https://www.google.com/maps/search/?api=1&query=12%20Main%20St');
    expect(e.website?.href).toBe('https://peachtree.example/');
    expect(e.note).toContain('[your business]');
    expect(p.moreCount).toBe(0);
  });

  it('uses the plain-words role for each record type', () => {
    const roles: Array<[string, string, ContactInput['role'], string]> = [
      ['socrata-sf-business', 'civic', 'business', 'The business that opened'],
      ['socrata-nyc-inspections', 'civic', 'business', 'The business inspected'],
      ['usaspending', 'contract', 'awardee', 'The company that won this award'],
      ['sam-gov', 'contract', 'buyer', 'The office taking bids'],
    ];
    for (const [source, kind, role, words] of roles) {
      const p = outreachPlan({ source, kind, ...place }, [{ role, name: 'Acme Co', attn: 'J. Public' }]);
      expect(p?.type).toBe('org');
      if (p?.type === 'org') expect(p.entries[0].role).toBe(words);
    }
  });

  it('attention line only for a buyer', () => {
    const bid = outreachPlan({ source: 'sam-gov', kind: 'contract', ...place }, [{ role: 'buyer', name: 'GSA Region 4', attn: 'Pat Officer' }]);
    expect(bid?.type === 'org' && bid.entries[0].attn).toBe('Pat Officer');
    const permit = outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, [gc('Acme Roofing', { attn: 'Somebody' })]);
    expect(permit?.type === 'org' && permit.entries[0].attn).toBeNull();
  });

  it('many contacts: at most 3 shown and "and N more" counted, duplicates folded', () => {
    const many = ['A Roofing', 'B Roofing', 'C Roofing', 'D Roofing', 'E Roofing', 'a roofing'].map((n) => gc(n));
    const p = outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, many);
    expect(p?.type === 'org' && p.entries.map((e) => e.name)).toEqual(['A Roofing', 'B Roofing', 'C Roofing']);
    expect(p?.type === 'org' && p.moreCount).toBe(2);
  });

  it('missing city and state: the search link still builds, the map uses what exists', () => {
    const p = outreachPlan({ source: 'x-permits', kind: 'permit' }, [gc('Acme Roofing', { address: '9 Oak Ave' })]);
    expect(p?.type === 'org' && p.entries[0].search?.href).toBe('https://www.google.com/search?q=Acme%20Roofing');
    expect(p?.type === 'org' && p.entries[0].map?.href).toBe('https://www.google.com/maps/search/?api=1&query=9%20Oak%20Ave');
  });

  it('no address: no map button; no website published: no website link; bad website dropped', () => {
    const p = outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, [gc('Acme Roofing', { website: 'javascript:alert(1)' })]);
    expect(p?.type === 'org' && p.entries[0].map).toBeNull();
    expect(p?.type === 'org' && p.entries[0].website).toBeNull();
  });

  it('ignores contacts whose role does not fit the record', () => {
    const p = outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, [{ role: 'business', name: 'Cafe Uno' }]);
    expect(p?.type).toBe('area');
  });
});

describe('outreachPlan: job site', () => {
  it('permit with only a site: address, map, letter, no owner lookup', () => {
    const p = outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, [site]);
    expect(p?.type).toBe('site');
    if (p?.type !== 'site') return;
    expect(p.heading).toBe('The job site');
    expect(p.address).toBe('12 Main St, Atlanta, GA 30301');
    expect(p.map?.label).toBe('Open map');
    expect('records' in p).toBe(false);
    expect(JSON.stringify(p)).not.toMatch(/county records|property records/i);
    expect(p.letter?.label).toBe('Copy a letter');
    expect(p.letter?.note).toMatch(/^Dear Property owner\./);
    expect(JSON.stringify(p)).not.toMatch(/owner name|Smith/);
  });

  it('a business or award record with only a site shows address and map, no letter', () => {
    const p = outreachPlan({ source: 'socrata-sf-business', kind: 'civic', ...place }, [site]);
    expect(p?.type).toBe('site');
    if (p?.type !== 'site') return;
    expect(p.letter).toBeNull();
    expect(p.heading).toBe('Where the business is');
  });
});

describe('outreachPlan: area kit and no block', () => {
  it('storm records get the kit with the storm guide, and any contacts passed in are ignored', () => {
    const p = outreachPlan({ source: 'nws', kind: 'alert', ...place }, [gc('Peachtree Roofing', { phone: '404' }), site]);
    expect(p?.type).toBe('area');
    if (p?.type !== 'area') return;
    expect(p.place).toBe('Atlanta, GA');
    expect(p.zips).toEqual(['30301']);
    expect(p.eddm.href).toBe('https://eddm.usps.com/eddm/select-routes.htm');
    expect(p.noteLabel).toBe('Copy a door hanger note');
    expect(p.guide.href).toBe('/guides/storm-damage-leads-from-weather-alerts-and-storm-reports');
    expect(JSON.stringify(p)).not.toContain('Peachtree');
    expect(JSON.stringify(p)).not.toContain('12 Main');
  });

  it('311 and code violations get the kit with the respond guide and never an address or contact', () => {
    for (const source of ['socrata-nyc-311', 'socrata-chicago-violations']) {
      const p = outreachPlan({ source, kind: 'civic', ...place }, [site, gc('X Roofing')]);
      expect(p?.type).toBe('area');
      if (p?.type !== 'area') continue;
      expect(p.guide.href).toBe('/guides/how-to-respond-to-a-local-lead-fast');
      expect(JSON.stringify(p)).not.toContain('Main St');
    }
  });

  it('quakes get the general kit', () => {
    const p = outreachPlan({ source: 'usgs', kind: 'quake', city: 'Reno', state: 'NV' }, undefined);
    expect(p?.type === 'area' && p.note).not.toMatch(/Storms/);
    expect(p?.type === 'area' && p.zips).toEqual([]);
  });

  it('an organisation record with no contacts falls back to the kit; nothing to say means no block', () => {
    expect(outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, [])?.type).toBe('area');
    expect(outreachPlan({ source: 'x-permits', kind: 'permit' }, [])).toBeNull();
    expect(outreachPlan({ source: 'nws', kind: 'alert' }, null)).toBeNull();
  });

  it('resident requests, airport delays, events, people asking and unknown sources get no block', () => {
    for (const [source, kind] of [['holler-request', 'ask'], ['faa', 'travel'], ['socrata-nyc-events', 'event'], ['bluesky', 'ask'], ['mystery', 'civic']]) {
      expect(outreachPlan({ source, kind, ...place }, [gc('Acme')])).toBeNull();
    }
  });

  it('zips only: kit shows ZIP codes and no city', () => {
    const p = outreachPlan({ source: 'spc', kind: 'report', zip: '30301-1234' }, []);
    expect(p?.type === 'area' && p.place).toBeNull();
    expect(p?.type === 'area' && p.zips).toEqual(['30301']);
  });

  it('every block carries the Do Not Call reminder', () => {
    const plans = [
      outreachPlan({ source: 'nws', kind: 'alert', ...place }, []),
      outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, [site]),
      outreachPlan({ source: 'x-permits', kind: 'permit', ...place }, [gc('Acme')]),
    ];
    for (const p of plans) expect(p?.reminder).toMatch(/^Check Do Not Call rules before you phone/);
  });
});

describe('emailContact', () => {
  it('names one organisation and its role, nothing else', () => {
    const c = emailContact({ source: 'x-permits', kind: 'permit' }, [site, gc('Peachtree Roofing LLC', { phone: '404-555-0100', address: '1 A St' })]);
    expect(c).toEqual({ name: 'Peachtree Roofing LLC', role: 'Named on this permit' });
  });
  it('is null with no organisation, for area records and for site-only records', () => {
    expect(emailContact({ source: 'x-permits', kind: 'permit' }, [site])).toBeNull();
    expect(emailContact({ source: 'nws', kind: 'alert' }, [gc('Acme')])).toBeNull();
    expect(emailContact({ source: 'x-permits', kind: 'permit' }, undefined)).toBeNull();
  });
});
