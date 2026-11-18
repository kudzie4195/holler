/**
 * Round 5 fix A: site addresses (F7), buyer names and attn (F8), and the hard stop on contacts for code violations and 311 (F9).
 */
import { describe, expect, it } from 'vitest';
import { sanitizeContact } from '@/lib/contacts/sanitize';
import { extractContacts, NO_CONTACT_SUBTYPES, type ContactSpec } from '@/lib/contacts/extract';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';

describe('F7: a site address is a place, never free text', () => {
  const site = (address: string) => sanitizeContact({ role: 'site', name: '', address, city: 'Austin', state: 'TX' });
  it('keeps addresses that start with a house number (digits, a letter, or a range)', () => {
    for (const a of ['12 HOME LN', '12B HOME LN', '12-14 HOME LN', '5521 S KOMENSKY AVE', '1200 W Ben White Blvd']) expect(site(a)?.address, a).toBe(a);
  });
  it('drops free text and a missing house number', () => {
    for (const a of ['JOHN OWNER 12 HOME LN (cell 512-555-0100)', 'HOME LN', 'CORNER OF MAIN AND ELM', 'call John', 'N/A', '']) expect(site(a), a).toBeNull();
  });
  it('FIX-E: a phone or an email after the street suffix is cut off, the street stays (was: whole address dropped)', () => {
    for (const a of ['12 HOME LN cell 512-555-0100', '12 HOME LN 5125550100', '12 HOME LN jsmith@mail.com']) expect(site(a)?.address, a).toBe('12 HOME LN');
  });
});

describe('F8, re-pinned by FIX-E (review3 P2-1, P2-3): no buyer is stored until the bids unit adds its own reviewed rules', () => {
  const buyer = (name: string, attn?: string) => sanitizeContact({ role: 'buyer', name, attn });
  it('organizations, public offices and agency acronyms: not stored either (no adapter produces buyers)', () => {
    for (const n of ['City of Austin', 'Travis County Purchasing Office', 'General Services Administration', 'GSA', 'USACE', 'Department of the Navy',
      'Austin Independent School District', 'Office of the Mayor', 'Texas Board of Nursing']) expect(buyer(n), n).toBeNull();
  });
  it('personal names, person-only values and the review3 P2-1 shapes', () => {
    for (const n of ['John Smith', 'SMITH, JOHN A', 'JOHN', 'SMITH', 'Mary Jones', 'Jane Doe 512-555-0100', 'jane@x.gov', 'MR JOHN SMITH',
      'Dept of Public Works - D Lopez', 'Dept of Public Works Lopez M', 'Office of Candy Smith', 'City Clerk Alex Court', 'DANNY', 'JULIA', 'JSMITH'])
      expect(buyer(n), n).toBeNull();
  });
  it('attn is never stored (review3 P2-3), for any role', () => {
    expect(buyer('City of Austin', 'Jane Doe, Purchasing')).toBeNull();
    expect(sanitizeContact({ role: 'contractor', name: 'ACME ROOFING LLC', attn: 'John Smith 5550100' })?.attn).toBeNull();
  });
  it('the review repro: a person buyer with a contact-laden attn is not stored', () => {
    expect(sanitizeContact({ role: 'buyer', name: 'John Smith', attn: 'Jane Doe 512-555-0100 jane@x.gov' })).toBeNull();
  });
});

describe('F9: extractContacts gives nothing for code violations and 311 requests, whatever spec is configured', () => {
  const spec: ContactSpec = {
    verifiedUrl: 'https://example.test', checkedOn: '2026-11-18',
    site: { addressFields: ['address'] },
    orgs: [{ role: 'business', nameFields: ['name'], phoneField: 'phone' }],
  };
  const row: Record<string, string> = { address: '5521 S KOMENSKY AVE', name: 'ACME ROOFING LLC', phone: '312-555-0100' };
  const read = (f: string) => row[f] ?? '';
  it('violation and 311 subtypes return []', () => {
    expect([...NO_CONTACT_SUBTYPES].sort()).toEqual(['311', 'violation']);
    expect(extractContacts(read, spec, { city: 'Chicago', state: 'IL' }, 'violation')).toEqual([]);
    expect(extractContacts(read, spec, { city: 'Chicago', state: 'IL' }, '311')).toEqual([]);
  });
  it('other subtypes still get contacts', () => {
    expect(extractContacts(read, spec, { city: 'Chicago', state: 'IL' }, 'permit')).toHaveLength(2);
  });
  it('end to end: a spec put on a violation dataset by mistake stores nothing', () => {
    const d = SOCRATA_DATASETS.find((x) => x.subtype === 'violation' && x.verified)!;
    const field = (d.addressFields ?? [])[0];
    const r: Record<string, string> = {
      [d.idField ?? 'id']: 'v1', [d.dateField]: '2026-11-10T00:00:00.000', [field]: '5521 S KOMENSKY AVE', name: 'ACME ROOFING LLC',
    };
    for (const f of d.textFields) r[f] ??= 'Work without permit roof';
    for (const f of d.titleFields) r[f] ??= 'Work without permit roof';
    const out = parseSocrata([r], { ...d, contacts: { ...spec, site: { addressFields: [field] } } });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.contacts ?? []).toEqual([]);
    const asPermit = parseSocrata([r], { ...d, subtype: 'permit', contacts: { ...spec, site: { addressFields: [field] } } });
    expect(asPermit.some((s) => s.contacts?.length)).toBe(true);
  });
});
