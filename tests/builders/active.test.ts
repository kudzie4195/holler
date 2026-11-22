// Ported from origin/r10-integrate tests/builders/active.test.ts (round 19 UNIFY). Adapted to this base:
//  - kinds are this base's permit label keys (lib/signals/permit-routing.ts permitLabelsOf: 'solar', 'roof'), printed by the component;
//  - names must pass this base's organisation check (isOrganisationName, exact). This base does not have the other branch's entity-marker
//    change to the classifier (ed621e9, not ported by instruction), so 'Lakeline Homes LLC' and some one-word '<X> Construction' names
//    are rejected here: the fixtures use names this base accepts ('Lakeline Construction LLC', the 12 accepted first words below).
import { describe, expect, it, vi } from 'vitest';
import { builderKey, summarizeBuilders, telHref, type BuilderRow } from '@/lib/builders/active';
import anchor from '../builders/austin-builders.json';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
let seq = 0;
const row = (name: string | null, title: string, days = 3, extra: Partial<BuilderRow> = {}): BuilderRow => ({
  signal_id: ++seq, title, occurred_at: daysAgo(days), role: 'contractor', name, ...extra,
});

describe('summarizeBuilders', () => {
  it('merges "SUNRUN INSTALLATION SERVICES INC" and "Sunrun Installation Services"; display is the most frequent spelling', () => {
    const rows = [
      row('SUNRUN INSTALLATION SERVICES INC', 'Roof and solar permit in Austin', 2, { phone: '512-555-0100' }),
      row('Sunrun Installation Services', 'Solar permit in Austin', 4),
      row('Sunrun Installation Services', 'Solar permit in Austin', 6),
    ];
    const out = summarizeBuilders(rows, [], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Sunrun Installation Services');
    expect(out[0].permits).toBe(3);
    expect(out[0].phone).toBe('512-555-0100');
    expect(out[0].kinds).toEqual(['solar', 'roof']);
    expect(out[0].newest).toBe(daysAgo(2));
  });

  it('ignores case, punctuation, spacing and trailing legal forms in the key', () => {
    expect(builderKey('Acme  Roofing, L.L.C.')).toBe(builderKey('ACME ROOFING'));
    expect(builderKey('Smith & Sons Co.')).toBe(builderKey('smith and sons'));
  });

  it('round 19 integration: names follow the round 18 contractor rule; a person or a name with a phone in it is dropped, never shown', () => {
    const rows = [row('JOHN SMITH', 'Roof permit in Austin'), row('Smith, John', 'Roof permit in Austin'), row('Acme Roofing LLC 404-555-0100', 'Roof permit in Austin')];
    expect(summarizeBuilders(rows, [], NOW)).toEqual([]);
    // The old strict check refused this trade name; the contractor rule (the one cards use) shows it.
    expect(summarizeBuilders([row('Lakeline Homes LLC', 'New home permit in Austin')], [], NOW).map((b) => b.name)).toEqual(['Lakeline Homes LLC']);
  });

  it('drops empty names, people, and non-contractor roles', () => {
    const rows = [
      row('', 'Roof permit in Austin'),
      row('Maria Garcia', 'Roof permit in Austin'),
      row('Acme Roofing LLC', 'Roof permit in Austin', 3, { role: 'site' }),
      row('Acme Roofing LLC', 'Roof permit in Austin'),
    ];
    const out = summarizeBuilders(rows, [], NOW);
    expect(out.map((b) => b.name)).toEqual(['Acme Roofing LLC']);
    expect(out[0].permits).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(/Maria|Garcia/);
  });

  it('marks a plumbing member\'s plumbing contractor as same-trade', () => {
    const out = summarizeBuilders([row('Victory Plumbing Company', 'Plumbing permit in Austin')], ['plumbing'], NOW);
    expect(out[0].relation).toBe('same-trade');
  });

  it('never labels a general-only company as builder: relation is same-trade or other', () => {
    const rows = [1, 2, 3].map((i) => row('Lakeline Construction LLC', 'New home permit in Austin', i));
    expect(summarizeBuilders(rows, ['painting'], NOW)[0].relation).toBe('other');
    expect(summarizeBuilders(rows, ['general-contractor'], NOW)[0].relation).toBe('other');
    expect(JSON.stringify(summarizeBuilders(rows, ['general-contractor'], NOW))).not.toContain('builder');
  });

  it('F4: a general-contractor member does not see a plumbing sub on new-home permits as same-trade; a plumber does', () => {
    const rows = [1, 2].map((i) => row('Victory Plumbing Company', 'New home and plumbing permit in Austin', i, { categories: ['general-contractor', 'plumbing'] }));
    expect(summarizeBuilders(rows, ['general-contractor'], NOW)[0].relation).toBe('other');
    expect(summarizeBuilders(rows, ['plumbing'], NOW)[0].relation).toBe('same-trade');
  });

  it('F4: tagged categories and unparsed kinds grant nothing', () => {
    expect(summarizeBuilders([row('Lakeline Construction LLC', 'New home permit in Austin', 2, { categories: ['general-contractor', 'plumbing'] })], ['plumbing'], NOW)[0].relation).toBe('other');
    expect(summarizeBuilders([row('Acme Plumbing LLC', 'Home Occupation permit in Austin')], ['plumbing'], NOW)[0].relation).toBe('other');
    expect(summarizeBuilders([row('Acme Plumbing LLC', 'Mechanical permit in Austin')], ['plumbing'], NOW)[0].relation).toBe('other');
  });

  it('is other for a specialty company outside the member trade', () => {
    const out = summarizeBuilders([row('Cool Air Systems LLC', 'HVAC permit in Austin')], ['painting'], NOW);
    expect(out[0].relation).toBe('other');
  });

  it('F5: INCORPORATED, CORPORATION, PLLC, LLP, PC, LIMITED are trailing legal forms', () => {
    for (const f of ['Incorporated', 'Corporation', 'PLLC', 'LLP', 'PC', 'Limited']) expect(builderKey(`Acme Roofing ${f}`)).toBe(builderKey('Acme Roofing'));
    const rows = ['Acme Roofing Incorporated', 'Acme Roofing Corporation', 'Acme Roofing PLLC', 'Acme Roofing'].map((n) => row(n, 'Roof permit in Austin'));
    const out = summarizeBuilders(rows, [], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].permits).toBe(4);
  });

  it('F5: a spelling tie prefers the one that is not ALL CAPS', () => {
    const rows = [row('ACME ROOFING LLC', 'Roof permit in Austin'), row('Acme Roofing LLC', 'Roof permit in Austin')];
    expect(summarizeBuilders(rows, [], NOW)[0].name).toBe('Acme Roofing LLC');
    expect(summarizeBuilders([...rows].reverse(), [], NOW)[0].name).toBe('Acme Roofing LLC');
  });

  it('F6: phones need 7 digits; a junk phone never wins over a real one and tel href is digits and a leading +', () => {
    const out = summarizeBuilders([row('Acme Roofing LLC', 'Roof permit in Austin', 2, { phone: 'N/A' }), row('Acme Roofing LLC', 'Roof permit in Austin', 3, { phone: '+1 (512) 555-0100' })], [], NOW);
    expect(out[0].phone).toBe('+1 (512) 555-0100');
    expect(telHref(out[0].phone)).toBe('+15125550100');
    expect(telHref('N/A')).toBeNull();
    expect(telHref('123456')).toBeNull();
    expect(summarizeBuilders([row('Acme Roofing LLC', 'Roof permit in Austin', 2, { phone: '12-34' })], [], NOW)[0].phone).toBeNull();
    expect('website' in out[0]).toBe(false);
  });

  it('ignores permits older than 30 days', () => {
    const rows = [row('Acme Roofing LLC', 'Roof permit in Austin', 31), row('Acme Roofing LLC', 'Roof permit in Austin', 29)];
    expect(summarizeBuilders(rows, [], NOW)[0].permits).toBe(1);
    expect(summarizeBuilders([rows[0]], [], NOW)).toEqual([]);
  });

  it('caps at 15 and sorts by permit count, newest, name', () => {
    const rows: BuilderRow[] = [];
    const words = ['Alpine', 'Falcon', 'Granite', 'Harbor', 'Keystone', 'Lakeline', 'Meridian', 'Northstar', 'Oakridge', 'Pinnacle'];
    const names = words.flatMap((w) => [`${w} Construction`, `${w} Roofing LLC`]);
    expect(names).toHaveLength(20);
    for (const n of names) rows.push(row(n, 'Roof permit in Austin', 5));
    rows.push(row('Zenith Construction', 'Roof permit in Austin', 6), row('Zenith Construction', 'Roof permit in Austin', 7));
    const out = summarizeBuilders(rows, [], NOW);
    expect(out).toHaveLength(15);
    expect(out[0].name).toBe('Zenith Construction');
    const rest = out.slice(1).map((b) => b.name);
    expect(rest).toEqual([...rest].sort());
    expect(out[1].name).toBe('Alpine Construction');
  });

  it('counts one permit once per builder and limits kinds to 3', () => {
    const r = row('Acme Roofing LLC', 'Roof, HVAC and plumbing permit in Austin');
    const out = summarizeBuilders([r, { ...r }, row('Acme Roofing LLC', 'Pool permit in Austin')], [], NOW);
    expect(out[0].permits).toBe(2);
    expect(out[0].kinds).toHaveLength(3);
  });
});

describe('Austin anchor data', () => {
  const rows: BuilderRow[] = (anchor.rows as [number, string, string, string, string][]).map(([signal_id, name, phone, title, date]) => ({
    signal_id, name, phone, title, occurred_at: `${date}T12:00:00Z`, role: 'contractor',
  }));
  const rel = (trades: string[]) => Object.fromEntries(summarizeBuilders(rows, trades, NOW).map((b) => [b.name, b.relation]));

  it('counts distinct permits per builder exactly and orders by count, newest, name', () => {
    const out = summarizeBuilders(rows, [], NOW);
    expect(Object.fromEntries(out.map((b) => [b.name, b.permits]))).toEqual(anchor.truth);
    expect(out.map((b) => b.name)).toEqual(['Victory Plumbing Company', 'Charge Electrical Services LLC', 'Landmark Electric', 'Radiant Plumbing and Air Conditioning']);
    expect(out.map((b) => b.permits)).toEqual([15, 9, 9, 7]);
  });

  it('labels every builder other for a painter and for a general-contractor member', () => {
    expect(Object.values(rel(['painting']))).toEqual(['other', 'other', 'other', 'other']);
    expect(Object.values(rel(['general-contractor']))).toEqual(['other', 'other', 'other', 'other']);
  });

  it('labels plumbers same-trade for a plumbing member', () => {
    const r = rel(['plumbing']);
    expect(r['Victory Plumbing Company']).toBe('same-trade');
    // Radiant's real permits are titled Electrical / HVAC only, so by title it is not plumbing despite its name.
    expect(r['Radiant Plumbing and Air Conditioning']).toBe('other');
  });

  it('labels electricians same-trade for an electrical member', () => {
    const r = rel(['electrical']);
    expect(r['Charge Electrical Services LLC']).toBe('same-trade');
    expect(r['Landmark Electric']).toBe('same-trade');
    expect(r['Radiant Plumbing and Air Conditioning']).toBe('same-trade');
  });

  it('shows Radiant phone', () => {
    const b = summarizeBuilders(rows, [], NOW).find((x) => x.name.startsWith('Radiant'));
    expect(b?.phone).toBeTruthy();
  });
});

