import { describe, expect, it } from 'vitest';
import { CSV_FORMATS, csvFormat, parseCsv, readCsv } from '@/lib/signals/manual-bids/csv';
import { buildManualBid, cleanUrl, isListPage, normalizeUrl, parseManualDue, resolvePlace, servedPlace } from '@/lib/signals/manual-bids/record';
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
    // The real coverage test: Marietta is served; Peachtree City is inside the Atlanta metro; rural Montana is neither.
    expect(servedPlace(resolvePlace({ place: '30060' })!)).toBe(true);
    expect(servedPlace(resolvePlace({ place: '30269' })!)).toBe(true);
    expect(servedPlace(resolvePlace({ place: '59001' })!)).toBe(false);
  });

  it('keeps contact details out of the title and never stores the description', () => {
    const r = buildManualBid({ ...base, title: 'Roof repair, questions to buyer@city.gov or https://city.gov/q', description: 'Contact Jane Doe 555-0100' }, { now: NOW, served });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.title).toBe('Open bid in Marietta: Roof repair, questions to or');
    expect(JSON.stringify(r.signal)).not.toMatch(/Jane|555-0100|buyer@/);
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

describe('the manual list data and the browser-only check boxes', () => {
  it('copies the round 32 manual list: 28 governments in 6 metros, round 32 warnings kept', () => {
    expect(MANUAL_PORTALS.map((m) => m.metro)).toEqual(['Atlanta GA', 'Austin TX', 'Charlotte NC', 'Raleigh NC', 'New Orleans LA', 'Baton Rouge LA']);
    expect(MANUAL_PORTALS.reduce((n, m) => n + m.portals.length, 0)).toBe(28);
    expect(MANUAL_PORTALS.flatMap((m) => m.portals).filter((p) => p.flag).map((p) => p.government)).toEqual(['Carrboro', 'Baker']);
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
