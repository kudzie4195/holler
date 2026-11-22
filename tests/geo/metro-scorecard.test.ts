import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cityBySlug } from '@/lib/geo';
import { METROS } from '@/lib/geo/metros';

const sql = readFileSync(join(__dirname, '..', '..', 'scripts', 'metro-scorecard.sql'), 'utf8');

/** The rows of the `with <name>(...) as (values ...)` list, as the text between the parentheses of each tuple. */
function valuesOf(name: string): string[] {
  const m = new RegExp(`${name}\\([^)]*\\) as \\(\\s*values([\\s\\S]*?)\\n\\)`, 'i').exec(sql);
  if (!m) throw new Error(`no ${name} VALUES list`);
  return [...m[1].matchAll(/^\s*\((.*)\),?\s*$/gm)].map((x) => x[1]);
}

describe('scripts/metro-scorecard.sql', () => {
  it('lists the same metros, states, centers and radii as METROS, in order', () => {
    const rows = valuesOf('metros').map((r) => {
      const t = /^'([^']+)', ARRAY\[([^\]]*)\], (-?[\d.]+), (-?[\d.]+), (\d+)$/.exec(r.trim());
      if (!t) throw new Error(`cannot parse ${r}`);
      return { id: t[1], states: [...t[2].matchAll(/'(\w+)'/g)].map((s) => s[1]), lat: Number(t[3]), lon: Number(t[4]), radiusMi: Number(t[5]) };
    });
    expect(rows).toEqual(METROS.map((m) => ({ id: m.id, states: [...m.states], lat: m.center.lat, lon: m.center.lon, radiusMi: m.radiusMi })));
  });

  it('lists the core cities of every metro (name and state of the CITIES entry)', () => {
    const rows = valuesOf('metro_cities').map((r) => {
      const t = /^'([^']+)', '((?:[^']|'')+)', '(\w+)'$/.exec(r.trim());
      if (!t) throw new Error(`cannot parse ${r}`);
      return `${t[1]}|${t[2].replace(/''/g, "'")}|${t[3]}`;
    });
    const expected = METROS.flatMap((m) =>
      m.cities.map((slug) => {
        const c = cityBySlug(slug)!;
        return `${m.id}|${c.name}|${c.state}`;
      }),
    );
    expect(rows).toEqual(expected);
  });

  it('is read-only and documents every output column', () => {
    expect(sql).not.toMatch(/^\s*(insert|update|delete|drop|alter|truncate|create|grant)\b/im);
    for (const col of ['metro', 'total_signals', 'probation_signals', 'permits', 'permits_w_contractor', 'violations_311', 'new_businesses', 'bids', 'contact_share']) {
      expect(sql, col).toMatch(new RegExp(`^--\\s+${col}\\b`, 'm'));
    }
  });
});
