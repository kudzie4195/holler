import { describe, expect, it, vi } from 'vitest';
import { builderKey, summarizeBuilders, type BuilderRow } from '@/lib/builders/active';
import { FakeDb } from '../ops/fakedb';
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
    expect(out[0].kinds).toEqual(['Solar', 'Roof']);
    expect(out[0].newest).toBe(daysAgo(2));
  });

  it('ignores case, punctuation, spacing and trailing legal forms in the key', () => {
    expect(builderKey('Acme  Roofing, L.L.C.')).toBe(builderKey('ACME ROOFING'));
    expect(builderKey('Smith & Sons Co.')).toBe(builderKey('smith and sons'));
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

  it('marks a company with 3 new-home permits as builder for a painter', () => {
    const rows = [1, 2, 3].map((i) => row('Lakeline Homes LLC', 'New home permit in Austin', i));
    const out = summarizeBuilders(rows, ['painting'], NOW);
    expect(out[0].relation).toBe('builder');
    expect(out[0].permits).toBe(3);
  });

  it('is other (not builder) for a trade sub whose permits mix general and trade kinds', () => {
    const rows = [1, 2, 3].map((i) => row('Landmark Electric', 'New home and electrical permit in Austin', i));
    expect(summarizeBuilders(rows, ['painting'], NOW)[0].relation).toBe('other');
  });

  it('is other for a single new-home permit, builder needs at least 2', () => {
    expect(summarizeBuilders([row('Lakeline Homes LLC', 'New home permit in Austin')], ['painting'], NOW)[0].relation).toBe('other');
  });

  it('is other for a specialty company outside the member trade', () => {
    const out = summarizeBuilders([row('Cool Air Systems LLC', 'HVAC permit in Austin')], ['painting'], NOW);
    expect(out[0].relation).toBe('other');
  });

  it('ignores permits older than 30 days', () => {
    const rows = [row('Acme Roofing LLC', 'Roof permit in Austin', 31), row('Acme Roofing LLC', 'Roof permit in Austin', 29)];
    expect(summarizeBuilders(rows, [], NOW)[0].permits).toBe(1);
    expect(summarizeBuilders([rows[0]], [], NOW)).toEqual([]);
  });

  it('caps at 15 and sorts by permit count, newest, name', () => {
    const rows: BuilderRow[] = [];
    const names = ['Alpine', 'Beacon', 'Cedar', 'Delta', 'Everest', 'Falcon', 'Granite', 'Harbor', 'Ironwood', 'Juniper', 'Keystone', 'Lakeline', 'Meridian', 'Northstar', 'Oakridge', 'Pinnacle', 'Quarry', 'Ridgeline', 'Summit', 'Timberline'];
    for (const n of names) rows.push(row(`${n} Construction`, 'Roof permit in Austin', 5));
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

  it('labels every builder other for a painter', () => {
    expect(Object.values(rel(['painting']))).toEqual(['other', 'other', 'other', 'other']);
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

describe('loadActiveBuilders', () => {
  const profile = { categories: ['plumbing'], lat: 30.27, lon: -97.74, state: 'TX', radius_mi: 25 };

  it('returns [] on a database error', async () => {
    const { loadActiveBuilders } = await import('@/lib/builders/load');
    const db = new FakeDb();
    db.failOn['holler_signals.select'] = 'boom';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadActiveBuilders(db as never, profile, NOW)).toEqual([]);
    db.failOn = { 'holler_signal_contacts.select': 'boom' };
    db.tables.holler_signals = [{ id: 1, kind: 'permit', title: 'Plumbing permit in Austin', source: 's', lat: 30.27, lon: -97.74, occurred_at: daysAgo(1), categories: ['plumbing'] }];
    expect(await loadActiveBuilders(db as never, profile, NOW)).toEqual([]);
    spy.mockRestore();
  });

  it('returns builders from nearby permits only, in two queries', async () => {
    const { loadActiveBuilders } = await import('@/lib/builders/load');
    const db = new FakeDb({
      holler_signals: [
        { id: 1, kind: 'permit', title: 'Plumbing permit in Austin', source: 's', lat: 30.28, lon: -97.75, occurred_at: daysAgo(2), categories: ['plumbing'] },
        { id: 2, kind: 'permit', title: 'Plumbing permit in Dallas', source: 's', lat: 32.78, lon: -96.8, occurred_at: daysAgo(2), categories: ['plumbing'] },
        { id: 3, kind: 'permit', title: 'Plumbing permit in Austin', source: 's', lat: 30.28, lon: -97.75, occurred_at: daysAgo(40), categories: ['plumbing'] },
      ],
      holler_signal_contacts: [
        { id: 1, signal_id: 1, role: 'contractor', name: 'Victory Plumbing Company', phone: '512-555-0101', website: null },
        { id: 2, signal_id: 1, role: 'site', name: '', phone: null, website: null },
        { id: 3, signal_id: 2, role: 'contractor', name: 'Dallas Pipes LLC', phone: null, website: null },
        { id: 4, signal_id: 3, role: 'contractor', name: 'Old Pipes LLC', phone: null, website: null },
      ],
    });
    const out = await loadActiveBuilders(db as never, profile, NOW);
    expect(out.map((b) => b.name)).toEqual(['Victory Plumbing Company']);
    expect(out[0].relation).toBe('same-trade');
    expect(db.calls).toEqual(['holler_signals.select', 'holler_signal_contacts.select']);
  });
});
