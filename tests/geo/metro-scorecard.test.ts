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
      [
        ...m.cities.map((slug) => {
          const c = cityBySlug(slug)!;
          return `${m.id}|${c.name}|${c.state}`;
        }),
        ...(m.cityNames ?? []).map((n) => `${m.id}|${n}|${m.states[0]}`),
      ],
    );
    expect(rows).toEqual(expected);
  });

  it('compares state upper-cased and trimmed, city by slug, and orders metros like METROS', () => {
    expect(sql).toMatch(/upper\(btrim\(s\.state\)\) as state/);
    expect(sql).toMatch(/upper\(mc\.state\) = r\.state/);
    expect(sql).toMatch(/regexp_replace\(lower\(r\.city\)/);
    const orders = [...sql.matchAll(/array_position\(array\[([^\]]*)\], metros\.metro\)/g)].map((m) => [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]));
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) expect(o).toEqual(METROS.map((m) => m.id));
  });

  it('has no probation column; a second query samples holler_source_samples per source', () => {
    const [first, second] = sql.split('-- QUERY 2 of 2');
    expect(first).not.toMatch(/probation/i);
    expect(second).toMatch(/holler_source_samples/);
    expect(second).toMatch(/rn <= 3/);
    expect(second).toMatch(/interval '14 days'/);
  });

  it('is read-only and documents every output column', () => {
    expect(sql).not.toMatch(/^\s*(insert|update|delete|drop|alter|truncate|create|grant)\b/im);
    for (const col of ['metro', 'total_signals', 'permits', 'permits_w_contractor', 'violations_311', 'new_businesses', 'bids', 'contact_share']) {
      expect(sql, col).toMatch(new RegExp(`^--\\s+${col}\\b`, 'm'));
    }
  });
});
