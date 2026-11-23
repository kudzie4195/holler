// Round 15 review P0: the CAT_V 2 -> 3 bump must not re-derive stored version 2 rows from their summaries. A v2 row gets only the specific
// version 3 changes, and what it replaces is kept in data.cat_prev.
//
// Sourced: tests/signals/__data__/review-f-sample-156.json is the reviewer's 156 real stored permit rows (all cat_v = 2, 23 sources,
// read-only select, seed revF-r15-seed). Live counts quoted in F-report.md come from read-only selects on holler_signals (14 days).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fakeTables } from './fake-table';
import { remapRow, remapStoredSignals, remapVersionFilter, type StoredRuleRow } from '@/lib/signals/mapping/remap';
import { CAT_V } from '@/lib/signals/mapping/version';
import { NO_TRADE_WORK_TYPE_RE } from '@/lib/signals/mapping/permit';

type Row = [number, string, string, string, string, string[]];
const ROWS = JSON.parse(fs.readFileSync(path.join(__dirname, '../signals/__data__/review-f-sample-156.json'), 'utf8')) as Row[];
const asStored = (r: Row, cat_v: number | null = 2): StoredRuleRow => ({
  id: r[0], source: r[1], title: r[2], summary: r[3], city: r[4], categories: r[5], data: { subtype: 'permit', ...(cat_v ? { cat_v } : {}) },
});

describe('version 2 rows: only the version 3 delta (the reviewer\'s 156-row sample)', () => {
  const results = ROWS.map((r) => ({ r, m: remapRow(asStored(r)) }));
  const changed = results.filter((x) => x.m && x.m.changed);

  it('0 titles and 0 categories change except the intended delta rows', () => {
    // the intended delta: a structured no-trade work type in the summary
    const intended = ROWS.filter((r) => r[3].split(' | ').some((p) => NO_TRADE_WORK_TYPE_RE.test(p.trim())));
    expect(intended.map((r) => r[0]).sort()).toEqual(changed.map((x) => x.r[0]).sort());
    expect(changed).toHaveLength(3);
    for (const { r, m } of changed) {
      expect(r[1], String(r[0])).toBe('socrata-nyc-permits');
      expect(r[3], String(r[0])).toMatch(/Sidewalk Shed/);
      expect(m!.title).toBe('Permit in New York City');
      expect(m!.categories).toEqual([]);
    }
  });

  it('the 153 other rows keep their title and categories exactly, and are only stamped', () => {
    const rest = results.filter((x) => !x.m!.changed);
    expect(rest).toHaveLength(153);
    for (const { r, m } of rest) {
      expect(m!.title, String(r[0])).toBe(r[2]);
      expect(m!.categories, String(r[0])).toEqual(r[5]);
      expect(m!.data.cat_v).toBe(CAT_V);
      expect(m!.data.cat_prev).toBeUndefined();
    }
  });

  it('the rows the old summary-only re-map degraded are untouched: Cobb tenant fit-out, Q card #1 and #38 shapes, Austin new home, Chicago remodel, Cambridge addition', () => {
    const keep = (pred: (r: Row) => boolean) => {
      const hit = ROWS.filter(pred);
      expect(hit.length).toBeGreaterThan(0);
      for (const r of hit) expect(remapRow(asStored(r))!.title).toBe(r[2]);
      return hit.length;
    };
    expect(keep((r) => r[2].startsWith('Tenant fit-out permit in Cobb'))).toBe(5);
    expect(keep((r) => r[2].startsWith('New home and electrical'))).toBeGreaterThan(0);
    expect(keep((r) => /^Remodel permit in Chicago/.test(r[2]))).toBeGreaterThan(0);
    expect(keep((r) => /^Addition permit in Cambridge/.test(r[2]))).toBeGreaterThan(0);
    expect(keep((r) => /^Window and door permit in Montgomery/.test(r[2]))).toBeGreaterThan(0);
    expect(keep((r) => /^Demolition and addition permit in Montgomery/.test(r[2]))).toBeGreaterThan(0);
  });

  it('the same rows WITHOUT a version (v1) still get the full summary re-map: the delta path is only for v2', () => {
    const cobb = ROWS.filter((r) => r[2].startsWith('Tenant fit-out permit in Cobb'));
    const v1 = cobb.map((r) => remapRow(asStored(r, null))!);
    expect(v1.some((m) => m.title !== 'Tenant fit-out permit in Cobb County')).toBe(true);
  });
});

describe('the NYC fire-sprinkler correction (re-grade Q2 item 6)', () => {
  const nyc = (summary: string, title: string, categories: string[]): StoredRuleRow => ({
    id: 9, source: 'socrata-nyc-permits', title, summary, city: 'New York City', categories, data: { subtype: 'permit', cat_v: 2 },
  });
  it('a "Sprinklers" permit titled Landscaping loses the landscaping tag and the wrong title; the work type text in the summary is the proof', () => {
    const m = remapRow(nyc('Sprinklers | $90,000 job value | Manhattan | 44 WALL STREET Manhattan', 'Landscaping permit in New York City', ['landscaping']))!;
    expect(m.categories).toEqual([]);
    expect(m.title).toBe('Permit in New York City');
    expect(m.lost).toEqual(['landscaping']);
    expect(m.gained).toEqual([]);
    expect(m.changed).toBe(true);
  });
  it('a row it changes records what it replaced, so the write can be reversed', () => {
    const m = remapRow(nyc('Sidewalk Shed | $20,000 job value | Brooklyn | 181 MCGUINNESS BOULEVARD', 'Roof and window permit in New York City', ['roofing', 'windows-doors']))!;
    expect(m.data.cat_prev).toEqual({ v: 2, title: 'Roof and window permit in New York City', categories: ['roofing', 'windows-doors'] });
    expect(m.data.cat_v).toBe(CAT_V);
  });
  it('a real NYC trade permit is not touched', () => {
    const m = remapRow(nyc('Mechanical Systems | $46,250 job value | Manhattan | 774 BROADWAY', 'HVAC permit in New York City', ['hvac']))!;
    expect(m.changed).toBe(false);
    expect(m.title).toBe('HVAC permit in New York City');
  });
  it('the work type must be the whole value: "sprinkler head" inside another value is not a match (DeKalb and Cambridge rows in the live read)', () => {
    const m = remapRow(nyc('Residential Remodel | Sprinkler head repair at pool | $3,000 job value', 'Remodel permit in New York City', ['general-contractor']))!;
    expect(m.changed).toBe(false);
  });
});

describe('the scan reads version 2 rows only where the delta can apply, and writes nothing else', () => {
  const rowsFor = () => {
    const mk = (id: number, summary: string, title: string, cats: string[], over: any = {}) => ({
      id, source: 'socrata-nyc-permits', external_id: `E${id}`, kind: 'permit', title, summary, city: 'New York City', state: 'NY', lat: 40.7, lon: -74, severity: 1,
      categories: cats, occurred_at: new Date('2026-11-18T12:00:00Z').toISOString(), expires_at: null, data: { subtype: 'permit', cat_v: 2 }, ...over,
    });
    return [
      mk(1, 'Sprinklers | $90,000 job value | Manhattan | 44 WALL STREET', 'Landscaping permit in New York City', ['landscaping']),
      mk(2, 'Mechanical Systems | $46,250 job value | Manhattan | 774 BROADWAY', 'HVAC permit in New York City', ['hvac']),
      mk(3, 'Commercial Alteration | $40,000 job value | 740 LAMBERT NE', 'Remodel permit in Atlanta', ['general-contractor'], { source: 'arcgis-atlanta-permits', city: 'Atlanta' }),
      mk(4, 'ROOF LEAKS | OPEN', 'Code violation in Chicago: ROOF LEAKS', ['roofing', 'general-contractor'], { source: 'socrata-chicago-violations', city: 'Chicago', data: { subtype: 'violation', cat_v: 2 } }),
      mk(5, 'Residential Water Heater | Single Family Dwelling | Issued', 'HVAC permit in DeKalb County', ['plumbing', 'hvac'], { source: 'arcgis-dekalb-permits', city: 'DeKalb County', data: { subtype: 'permit' } }),
    ];
  };
  it('the filter names the delta words', () => {
    const f = remapVersionFilter();
    expect(f).toContain('data->>cat_v.is.null');
    expect(f).toContain('data->>cat_v.eq.1');
    expect(f).toContain('and(data->>cat_v.eq.2,or(data->>subtype.eq.violation');
    for (const w of ['sidewalk shed', 'sprinkler', 'standpipe', 'curb cut']) expect(f).toContain(`summary.ilike.*${w}*`);
  });
  it('a pass updates the sprinkler row, the violation row and the unversioned row, and never reads or writes the other v2 rows', async () => {
    const db = fakeTables({ holler_signals: rowsFor(), holler_matches: [] });
    const rep = await remapStoredSignals(db, { now: new Date('2026-11-19T12:00:00Z'), rematch: async () => ({ created: 0 }), prune: async () => ({ removed: 0 }) });
    const t = db.tables.holler_signals;
    expect(rep.scanned).toBe(3);
    expect(t.find((r: any) => r.id === 1)).toMatchObject({ title: 'Permit in New York City', categories: [], data: { cat_v: CAT_V, cat_prev: { v: 2, title: 'Landscaping permit in New York City', categories: ['landscaping'] } } });
    expect(t.find((r: any) => r.id === 2)).toMatchObject({ title: 'HVAC permit in New York City', categories: ['hvac'], data: { cat_v: 2 } }); // not read, not written
    expect(t.find((r: any) => r.id === 3)).toMatchObject({ title: 'Remodel permit in Atlanta', categories: ['general-contractor'], data: { cat_v: 2 } }); // not read, not written
    expect(t.find((r: any) => r.id === 4).title).toBe('Code violation in Chicago: ROOF LEAKS');
    expect(t.find((r: any) => r.id === 5)).toMatchObject({ title: 'Water heater permit in DeKalb County' });
    // only the rows that changed carry cat_prev
    expect(t.filter((r: any) => r.data.cat_prev).map((r: any) => r.id).sort()).toEqual([1, 5]);
  });
});
