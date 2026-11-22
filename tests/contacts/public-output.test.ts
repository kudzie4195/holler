/**
 * Public output unchanged. fixtures/public-before.json is a committed snapshot: parseAllFixtures() over every fixture in tests/fixtures,
 * first taken from the adapters before any contact code existed, and regenerated only for intended public changes (round 7: the permit
 * mapping and data.cat_v, listed in the MATCH hand-back; round 15: data.jobValue, the project value a permit published, the same number its
 * summary already prints). The test reads that file only; it never runs git, so it works in any checkout,
 * a copy without .git, or a worktree. Now: the same projection (every SignalInput field except `contacts`) must be byte-for-byte equal,
 * and contacts must never leak into title, summary or data.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllFixtures, publicProjection } from './public-shape';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import type { SignalInput } from '@/lib/signals/types';

const before = JSON.parse(readFileSync(join(__dirname, 'fixtures/public-before.json'), 'utf8')) as Record<string, unknown[]>;

describe('public fields equal the committed snapshot (fixtures/public-before.json) for every existing fixture', () => {
  const now = parseAllFixtures();
  it('same fixtures, same item counts (102 items)', () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(before).sort());
    expect(Object.values(now).reduce((n, v) => n + v.length, 0)).toBe(102);
  });
  for (const f of Object.keys(before)) {
    it(`${f}: title, summary, city, zip, lat/lon, data and every other public field unchanged`, () => expect(now[f]).toEqual(before[f]));
  }
});

const CONTACT_FIXTURES: [string, (raw: unknown) => SignalInput[]][] = [
  ['socrata-chicago-permits-contacts.json', (r) => parseSocrata(r, SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-permits')!)],
  ['socrata-austin-permits-contacts.json', (r) => parseSocrata(r, SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-permits')!)],
  ['socrata-chicago-inspections-contacts.json', (r) => parseSocrata(r, SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-inspections')!)],
  ['socrata-austin-inspections-contacts.json', (r) => parseSocrata(r, SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-inspections')!)],
  ['socrata-chicago-business-contacts.json', (r) => parseSocrata(r, SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-business')!)],
  ['usaspending-awards-contacts.json', parseUsaSpending],
];

describe('contacts are added beside the public fields, never into them', () => {
  for (const [f, parse] of CONTACT_FIXTURES) {
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', f), 'utf8'));
    it(`${f}: switching the contact spec off changes nothing public`, () => {
      const on = parse(raw);
      if (f.startsWith('socrata-')) {
        const id = f.replace('-contacts.json', '');
        const d = SOCRATA_DATASETS.find((x) => x.id === id)!;
        const off = parseSocrata(raw, { ...d, contacts: undefined });
        expect(on.map(publicProjection)).toEqual(off.map(publicProjection));
      }
      expect(on.some((s) => s.contacts?.length)).toBe(true);
    });
    it(`${f}: no contact phone, email, contractor name or org address appears in title, summary or data; data has no contact keys`, () => {
      for (const s of parse(raw)) {
        const pub = `${s.title}\n${s.summary ?? ''}\n${JSON.stringify(s.data ?? {})}`.toLowerCase();
        expect(JSON.stringify(s.data ?? {})).not.toMatch(/contact|phone|email|attn/i);
        for (const c of s.contacts ?? []) {
          for (const v of [c.phone, c.email, c.website]) if (v) expect(pub.includes(v.toLowerCase()), `${v}`).toBe(false);
          if (c.role === 'contractor') {
            expect(pub.includes(c.name.toLowerCase()), c.name).toBe(false);
            if (c.address) expect(pub.includes(c.address.toLowerCase()), c.address).toBe(false);
          }
        }
      }
    });
  }
  it('every fixture file under tests/fixtures is covered by the snapshot or deliberately not parsed by this unit', () => {
    const files = readdirSync(join(__dirname, '../fixtures')).filter((x) => x.endsWith('.json'));
    const covered = new Set(Object.keys(before));
    const others = files.filter((x) => !covered.has(x));
    for (const o of others) expect(o, o).toMatch(/^(bluesky|fema|nws|sam|ticketmaster|usgs|websearch)/);
  });
});
