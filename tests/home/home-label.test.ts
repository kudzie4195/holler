// The map label rule (lib/seo/home-label.ts) on real title shapes: every title the adapters produced from the recorded fixtures
// (tests/contacts/fixtures/public-before.json holds the adapters' output for every file in tests/fixtures), plus weather titles.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LABEL_MAX, labelPhrase, mapLabel } from '@/lib/seo/home-label';

function titlesIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => titlesIn(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.title === 'string') out.add(o.title);
    Object.values(o).forEach((x) => titlesIn(x, out));
  }
  return out;
}
const ADAPTER_TITLES = [...titlesIn(JSON.parse(readFileSync(new URL('../contacts/fixtures/public-before.json', import.meta.url), 'utf8')))];

describe('map label rule', () => {
  it('the examples the brief names', () => {
    expect(mapLabel('Roof permit in Chicago')).toBe('ROOF PERMIT');
    expect(mapLabel('311 request in Chicago: Tree Emergency')).toBe('TREE EMERGENCY');
  });

  it('real adapter titles: permits, 311, code violations', () => {
    const cases: [string, string][] = [
      ['HVAC permit in Buffalo', 'HVAC PERMIT'],
      ['HVAC and electrical permit in Mecklenburg County', 'HVAC PERMIT'],
      ['Roof and siding permit in New Orleans', 'ROOF PERMIT'],
      ['Window and siding permit in Montgomery County', 'WINDOW PERMIT'],
      ['New construction permit in Chicago', 'NEW CONSTRUCTION'],
      ['Building permit in Washington', 'BUILDING PERMIT'],
      ['Site work permit in Orlando', 'SITE WORK PERMIT'],
      ['311 request in Chicago: Graffiti Removal Request', 'GRAFFITI REMOVAL'],
      ['311 request in Chicago: Rodent Baiting/Rat Complaint', 'RODENT BAITING'],
      ['311 request in Chicago: Tree Trim Request', 'TREE TRIM'],
      ['311 request in Dallas: Illegal Dumping Reports', 'ILLEGAL DUMPING'],
      ['311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', 'HEAT/HOT WATER'],
      ['311 request in Kansas City: Illegal Dumping / Dumping in alley', 'ILLEGAL DUMPING'],
      ['Code violation in Chicago: REPAIR PORCH SYSTEM', 'REPAIR PORCH'],
      ['Code violation in Chicago: EXTERIOR WALLS DEFECTIVE: BRICK', 'EXTERIOR WALLS'],
      ['Code violation in Chicago: RODENT INFESTATION IN REAR YARD', 'RODENT'],
    ];
    for (const [t, want] of cases) {
      expect(ADAPTER_TITLES, t).toContain(t);
      expect(mapLabel(t), t).toBe(want);
    }
  });

  it('weather titles (SPC and NWS shapes)', () => {
    expect(mapLabel('1.00 inch hail reported near Tulsa, OK')).toBe('1.00 IN HAIL');
    expect(mapLabel('60 mph wind gust reported near Moore, OK')).toBe('60 MPH WIND GUST');
    expect(mapLabel('Tornado reported near Moore, OK')).toBe('TORNADO');
    expect(mapLabel('Severe Thunderstorm Warning: Tulsa County')).toBe('SEVERE T-STORM');
    expect(mapLabel('Winter Storm Warning: Cook County')).toBe('WINTER STORM');
  });

  it('every adapter title gives a non-empty label of at most 16 characters, made of words from the title', () => {
    expect(ADAPTER_TITLES.length).toBeGreaterThan(50);
    for (const t of ADAPTER_TITLES) {
      const l = mapLabel(t);
      expect(l.length, t).toBeGreaterThan(0);
      expect(l.length, t).toBeLessThanOrEqual(LABEL_MAX);
      expect(l, t).toBe(l.toUpperCase());
      // Every word of the label comes from the title (after the two short forms: "in" for inch, "t-storm" for thunderstorm).
      const src = t.toUpperCase().replace(/\bINCH(ES)?\b/g, 'IN').replace(/THUNDERSTORMS?/g, 'T-STORM');
      for (const w of l.split(/[\s/]+/)) expect(src, `${t} -> ${l}`).toContain(w);
    }
  });

  it('keeps the record case for the key and never returns empty', () => {
    expect(labelPhrase('311 request in Chicago: Tree Emergency')).toBe('Tree Emergency');
    expect(labelPhrase('Code violation in Chicago: REPAIR PORCH SYSTEM')).toBe('Repair porch');
    expect(labelPhrase('')).toBe('Record');
    expect(labelPhrase('Permit in Chicago')).toBe('Permit');
    expect(mapLabel('Supercalifragilisticexpialidocious')).toHaveLength(LABEL_MAX);
  });
});
