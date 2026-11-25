import { describe, expect, it } from 'vitest';
import { CELL_MAX, CSV_FORMATS, csvFormat, parseCsv, readCsv } from '@/lib/signals/manual-bids/csv';
import { buildManualBid, cleanUrl, isListPage, linkHost, normalizeUrl, parseManualDue, resolvePlace, scrubPublic, servedPlace } from '@/lib/signals/manual-bids/record';
import { checklistKey, readChecked, writeChecked } from '@/lib/signals/manual-bids/checklist-store';
import { MANUAL_PORTALS } from '@/lib/signals/manual-bids/portals';

// 2026-11-25 15:00 UTC (10:00 in Atlanta).
const NOW = new Date('2026-11-25T15:00:00Z');
const served = () => true;
const base = {
  url: 'https://mariettaga.gov/Bids.aspx?bidID=412',
  title: 'Roof replacement at Fire Station 3',
  agency: 'City of Marietta',
  dueDate: '2026-12-15',
  place: '30060',
};

describe('CSV parsing', () => {
  it('reads quotes, doubled quotes, commas and line breaks inside quotes, CRLF and a byte order mark', () => {
    const text = '﻿title,agency\r\n"Roof, gutters","City ""A"""\r\n"two\nlines",B\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['title', 'agency'],
      ['Roof, gutters', 'City "A"'],
      ['two\nlines', 'B'],
    ]);
  });

  it('maps the generic header names to fields, case and spaces ignored, with spreadsheet line numbers', () => {
    const text = ' Title ,AGENCY,due_date,url,zip,solicitation_id\nRoof repair,City of Marietta,2026-12-15,https://x.gov/b?id=1,30060,RFP 1\n';
    const r = readCsv(text, CSV_FORMATS.generic);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.records).toEqual([
      { line: 2, fields: { title: 'Roof repair', agency: 'City of Marietta', due_date: '2026-12-15', url: 'https://x.gov/b?id=1', zip: '30060', solicitation_id: 'RFP 1' } },
    ]);
  });

  it('refuses a file missing a required column and names it; nothing is guessed from other columns', () => {
    const r = readCsv('title,agency,url\nA,B,https://x.gov\n', CSV_FORMATS.generic);
    expect(r).toEqual({ ok: false, error: 'missing_columns', missing: ['due_date'] });
  });

  it('the Texas ESBD mapping is marked unconfirmed, fills state TX, and refuses a file whose headers do not match yet', () => {
    expect(CSV_FORMATS['tx-esbd'].confirmed).toBe(false);
    expect(CSV_FORMATS['tx-esbd'].defaults?.state).toBe('TX');
    const r = readCsv('Solicitation Title,Agency Name,Response Due Date\nA,B,12/15/2026\n', CSV_FORMATS['tx-esbd']);
    expect(r).toEqual({ ok: false, error: 'missing_columns', missing: ['Solicitation URL'] });
    const ok = readCsv('Solicitation Title,Agency Name,Response Due Date,Solicitation URL\nA,B,12/15/2026,https://x.gov/1\n', CSV_FORMATS['tx-esbd']);
    expect(ok.ok && ok.records[0].fields.state).toBe('TX');
    expect(csvFormat('nope')).toBeNull();
    expect(csvFormat('__proto__')).toBeNull();
  });

  it('an empty file is refused', () => {
    expect(readCsv('', CSV_FORMATS.generic)).toEqual({ ok: false, error: 'empty' });
  });
});

describe('one hand-added bid becomes a normal bid record', () => {
  it('has the shape of every other bid: bids-manual, contract, subtype bid, approximate place, agency page as the link', () => {
    const r = buildManualBid({ ...base, solicitationId: 'RFP 26-014' }, { now: NOW, served });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.signal;
    expect(s).toMatchObject({
      source: 'bids-manual',
      kind: 'contract',
      title: 'Open bid in Marietta: Roof replacement at Fire Station 3',
      url: 'https://mariettaga.gov/Bids.aspx?bidID=412',
      state: 'GA',
      zip: '30060',
      categories: ['roofing'],
      severity: 2,
      occurredAt: NOW.toISOString(),
      externalId: 'manual:cityofmarietta:rfp26014',
    });
    expect(s.data).toMatchObject({ subtype: 'bid', buyer: 'City of Marietta', dueDate: '2026-12-15', solicitationId: 'RFP 26-014', loc: 'approx', approxLocation: true, via: 'manual', linkKind: 'solicitation' });
    // A date alone closes at 11:59 PM in Georgia (EST, UTC-5).
    expect(s.expiresAt).toBe('2026-12-16T04:59:00.000Z');
    // Block level at most: 3 decimals.
    for (const v of [s.lat as number, s.lon as number]) expect(Math.round(v * 1000) / 1000).toBe(v);
  });

  it('a due date in the past is rejected; today (still open until 11:59 PM local) and a time later today are accepted', () => {
    expect(buildManualBid({ ...base, dueDate: '2026-11-24' }, { now: NOW, served })).toEqual({ ok: false, problem: 'closed' });
    expect(buildManualBid({ ...base, dueDate: '11/20/2026' }, { now: NOW, served })).toEqual({ ok: false, problem: 'closed' });
    expect(buildManualBid({ ...base, dueDate: '2026-11-25 09:00' }, { now: NOW, served })).toEqual({ ok: false, problem: 'closed' });
    expect(buildManualBid({ ...base, dueDate: '2026-11-25' }, { now: NOW, served }).ok).toBe(true);
    expect(buildManualBid({ ...base, dueDate: '2026-11-25 14:00' }, { now: NOW, served }).ok).toBe(true);
  });

  it('refuses unreadable, impossible and placeholder dates', () => {
    expect(buildManualBid({ ...base, dueDate: 'soon' }, { now: NOW, served })).toEqual({ ok: false, problem: 'bad_due' });
    expect(buildManualBid({ ...base, dueDate: '2027-02-31' }, { now: NOW, served })).toEqual({ ok: false, problem: 'bad_due' });
    expect(buildManualBid({ ...base, dueDate: '' }, { now: NOW, served })).toEqual({ ok: false, problem: 'no_due' });
    expect(buildManualBid({ ...base, dueDate: '2099-12-31' }, { now: NOW, served })).toEqual({ ok: false, problem: 'due_far' });
    expect(parseManualDue('Dec 15, 2026', 'TX')?.day).toBe('2026-12-15');
  });

  it('takes https links only, with a real host and no credentials', () => {
    expect(cleanUrl('http://townofcarrboro.org/Bids.aspx')).toBeNull();
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('https://user:pw@city.gov/bids')).toBeNull();
    expect(cleanUrl('https://localhost/bids')).toBeNull();
    expect(cleanUrl('https://city.gov/bids#top')).toBe('https://city.gov/bids');
    expect(buildManualBid({ ...base, url: 'http://mariettaga.gov/Bids.aspx?bidID=1' }, { now: NOW, served })).toEqual({ ok: false, problem: 'bad_url' });
  });

  it('places by ZIP or "City, ST" with the app geo helpers, and refuses an unknown place or one outside the served areas', () => {
    expect(resolvePlace({ place: '30060' })).toMatchObject({ zip: '30060', state: 'GA' });
    expect(resolvePlace({ place: 'Marietta, GA' })).toMatchObject({ city: 'Marietta', state: 'GA', zip: null });
    expect(resolvePlace({ city: 'Austin', state: 'Texas' })).toMatchObject({ city: 'Austin', state: 'TX' });
    expect(resolvePlace({ place: 'Nowhereville, ZZ' })).toBeNull();
    expect(buildManualBid({ ...base, place: 'Nowhereville, ZZ' }, { now: NOW, served })).toEqual({ ok: false, problem: 'no_place' });
    expect(buildManualBid({ ...base, place: '30060' }, { now: NOW, served: () => false })).toEqual({ ok: false, problem: 'outside_area' });
    // The site's own served test only (review P2-1): Marietta is served; Peachtree City (Atlanta metro rim), Carrboro and the centres of
    // Houston, Philadelphia, Miami and Phoenix are not, exactly as /check and the waitlist say.
    expect(servedPlace(resolvePlace({ place: '30060' })!)).toBe(true);
    for (const z of ['30269', '27510', '59001', '77002', '19107', '33130', '85004']) expect(servedPlace(resolvePlace({ place: z })!), z).toBe(false);
    for (const z of ['30269', '77002']) expect(buildManualBid({ ...base, place: z }, { now: NOW })).toEqual({ ok: false, problem: 'outside_area' });
  });

  it('keeps contact details out of the title and never stores the description', () => {
    const r = buildManualBid({ ...base, title: 'Roof repair, questions to buyer@city.gov or https://city.gov/q', description: 'Contact Jane Doe 555-0100' }, { now: NOW, served });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.title).toBe('Open bid in Marietta: Roof repair, questions to or');
    expect(JSON.stringify(r.signal)).not.toMatch(/Jane|555-0100|buyer@/);
  });

  it('a CivicPlus category list (Bids.aspx?CatID=17) is a list page too; tracking parameters and query case do not split one link', () => {
    expect(isListPage('https://mariettaga.gov/Bids.aspx?CatID=17')).toBe(true);
    expect(isListPage('https://mariettaga.gov/Bids.aspx?CatID=17&BidID=9')).toBe(false);
    expect(normalizeUrl('https://city.gov/b?BidID=9&utm_source=x&fbclid=y')).toBe(normalizeUrl('https://www.city.gov/b?bidid=9'));
  });

  it('an agency list page is not used as the identity of one bid', () => {
    expect(isListPage('https://www.mariettaga.gov/Bids.aspx')).toBe(true);
    expect(isListPage('https://roswellgov.bonfirehub.com/portal/?tab=openOpportunities')).toBe(true);
    expect(isListPage('https://mariettaga.gov/Bids.aspx?bidID=412')).toBe(false);
    const a = buildManualBid({ ...base, url: 'https://mariettaga.gov/Bids.aspx' }, { now: NOW, served });
    expect(a.ok && a.keys.urlKey).toBeNull();
    expect(a.ok && a.signal.data?.linkKind).toBe('list');
    expect(normalizeUrl('https://WWW.City.gov/Bids/?x=1')).toBe('city.gov/bids?x=1');
  });
});

describe('review fixes: privacy, length, formulas, link hosts', () => {
  it('strips phone numbers, street addresses and names after "contact" from title and agency, and stores none of them', () => {
    const r = buildManualBid(
      { ...base, title: 'Roof repair at 1423 Oak Hollow Dr - contact John Q. Smith (404) 555-0147', agency: 'City of Marietta, 88 Pine St, phone 770-555-0199' },
      { now: NOW, served },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = JSON.stringify(r.signal);
    for (const bit of ['1423', 'Oak Hollow', '555-0147', '404', 'John', 'Smith', '88 Pine', '770-555-0199']) expect(stored, bit).not.toContain(bit);
    expect(r.signal.title).toBe('Open bid in Marietta: Roof repair');
    // The scrub errs on the safe side: words right before a phone number go too ("City of"); the owner sees this in the preview.
    expect(r.view.agency.startsWith('City of')).toBe(true);
    // A number right before a street word is not an address: kept.
    expect(scrubPublic('Fire Station 3 Road Improvements')).toBe('Fire Station 3 Road Improvements');
  });

  it('refuses a title or an agency that is only a person-like name', () => {
    expect(buildManualBid({ ...base, title: 'John Q. Smith' }, { now: NOW, served })).toEqual({ ok: false, problem: 'person_name' });
    expect(buildManualBid({ ...base, agency: 'Maria Gonzalez', trade: 'roofing' }, { now: NOW, served })).toEqual({ ok: false, problem: 'person_name' });
    expect(buildManualBid({ ...base, title: 'SMITH, JOHN' }, { now: NOW, served })).toEqual({ ok: false, problem: 'person_name' });
    for (const title of ['Brookhaven Park Lighting', 'Kenner Drainage Pump Repair', 'Mary Ann Park Restroom Renovation']) {
      const r = buildManualBid({ ...base, title }, { now: NOW, served });
      expect(r.ok || r.problem !== 'person_name', title).toBe(true);
    }
    for (const agency of ['City of Marietta', 'Gwinnett County Purchasing', 'St. Bernard Parish Government', 'Town of Manor', 'Atlanta Public Schools', 'Roswell', 'Lilburn']) {
      expect(buildManualBid({ ...base, agency }, { now: NOW, served }).ok, agency).toBe(true);
    }
  });

  it('cuts every field before any pattern runs: a 500,000-character cell finishes fast', () => {
    const huge = 'a'.repeat(500_000);
    const t0 = Date.now();
    buildManualBid({ ...base, title: `${huge}@b.c`, agency: huge, description: huge, solicitationId: huge, place: huge, dueDate: huge }, { now: NOW, served });
    buildManualBid({ ...base, title: `Roof ${'x'.repeat(500_000)}` }, { now: NOW, served });
    const csv = readCsv(`title,agency,due_date,url\n${huge},${huge},2026-12-15,https://x.gov/1\n`, CSV_FORMATS.generic);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(csv.ok && csv.records[0].fields.title?.length).toBe(CELL_MAX);
  });

  it('removes a leading = + - @ from every stored text (spreadsheet formulas)', () => {
    for (const lead of ['=', '+', '-', '@', '\t=', ' =+']) {
      const r = buildManualBid({ ...base, title: `${lead}SUM(1+1) Roof replacement`, agency: `${lead}City of Marietta`, solicitationId: `${lead}1+1` }, { now: NOW, served });
      expect(r.ok, JSON.stringify(lead)).toBe(true);
      if (!r.ok) continue;
      const d = r.signal.data as { buyer: string; solicitationId: string };
      for (const v of [r.view.title, d.buyer, d.solicitationId, r.signal.summary ?? '']) expect(v, JSON.stringify(lead)).not.toMatch(/^[=+\-@\t]/);
    }
  });

  it('refuses link shorteners, portals whose terms ban commercial use, odd ports and punycode hosts; reports the host', () => {
    for (const u of ['https://bit.ly/3abc', 'https://tinyurl.com/x', 'https://t.co/x', 'https://goo.gl/x', 'https://ow.ly/x']) {
      expect(buildManualBid({ ...base, url: u }, { now: NOW, served }), u).toEqual({ ok: false, problem: 'short_link' });
    }
    expect(buildManualBid({ ...base, url: 'https://roswellgov.bonfirehub.com/portal/?tab=openOpportunities' }, { now: NOW, served })).toEqual({ ok: false, problem: 'terms_host' });
    expect(cleanUrl('https://city.gov:8443/bids')).toBeNull();
    expect(cleanUrl('https://xn--mariettga-9za.gov/bids')).toBeNull();
    const r = buildManualBid({ ...base, url: 'https://www.MariettaGA.gov/Bids.aspx?bidID=412' }, { now: NOW, served });
    expect(r.ok && r.view.host).toBe('mariettaga.gov');
    expect(linkHost('not a url')).toBe('');
  });
});

describe('the manual list data and the browser-only check boxes', () => {
  it('copies the round 32 manual list: 28 governments in 6 metros, each status matching the site rules', () => {
    expect(MANUAL_PORTALS.map((m) => m.metro)).toEqual(['Atlanta GA', 'Austin TX', 'Charlotte NC', 'Raleigh NC', 'New Orleans LA', 'Baton Rouge LA']);
    const all = MANUAL_PORTALS.flatMap((m) => m.portals);
    expect(all).toHaveLength(28);
    // Every 'enter' and 'terms' row's seat ZIP passes the site's served test; every 'outside_area' row fails it.
    for (const p of all) {
      const place = resolvePlace({ place: p.zip });
      expect(place, p.government).not.toBeNull();
      if (p.status === 'outside_area') expect(servedPlace(place!), p.government).toBe(false);
      if (p.status === 'enter' || p.status === 'terms') expect(servedPlace(place!), p.government).toBe(true);
    }
    expect(all.filter((p) => p.status === 'outside_area').map((p) => p.government)).toEqual(['Peachtree City', 'Orange County', 'Carrboro']);
    // Bonfire rows: hand-check only, never entered (quick add refuses their host too).
    expect(all.filter((p) => p.family === 'Bonfire/Euna').every((p) => p.status === 'terms' && /do not enter/.test(p.note ?? ''))).toBe(true);
    // Baker: the listed URL is a Tennessee town's; no link at all.
    const baker = all.find((p) => p.government === 'Baker')!;
    expect(baker).toMatchObject({ status: 'bad_url', url: null });
    expect(JSON.stringify(MANUAL_PORTALS)).not.toContain('lawrenceburgtn');
  });

  it('keys the week by its Monday and survives storage that throws', () => {
    expect(checklistKey(new Date(2026, 10, 25))).toBe('holler.manualBids.checked.2026-11-23');
    expect(checklistKey(new Date(2026, 10, 29))).toBe('holler.manualBids.checked.2026-11-23');
    expect(checklistKey(new Date(2026, 10, 30))).toBe('holler.manualBids.checked.2026-11-30');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(readChecked('k', broken)).toEqual({});
    expect(writeChecked('k', { a: true }, broken)).toBe(false);
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(writeChecked('k', { 'GA:Marietta': true, 'GA:Roswell': false }, store)).toBe(true);
    expect(readChecked('k', store)).toEqual({ 'GA:Marietta': true });
    mem.set('k', '"not an object"');
    expect(readChecked('k', store)).toEqual({});
  });
});
