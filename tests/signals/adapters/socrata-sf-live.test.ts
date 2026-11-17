/**
 * N2 (verify.md): the SF business feed went dead after the names fix removed dba_name from textFields. 267 of 268 live rows since
 * 2026-11-03 have no lic_code_description, so every row was skipped before it counted toward shapeOk and the adapter logged
 * "error: parsed 0 of N rows" on any day without a coded row.
 *
 * Fixture provenance: tests/fixtures/socrata-sf-business-live-2026-11-16.json is the review's saved live pull of data.sf.gov g8m3-pdis
 * (/tmp/r2-verify/live/sf-business.json, fetched 2026-11-17, 18 real rows, newest by location_start_date) with every name and address
 * column removed (dba_name, ownership_name, full_business_address), null columns omitted the way Socrata omits them, and coordinates
 * rounded to 3 decimals.
 *   sourced:  uniqueid, location_start_date, business_zip, location, the null lic_code_description / lic_code_descriptions_list, and the
 *             column name self_reported_naics_code (re-fetched live 2026-11-17: 518210, 812111, 811420 on the three newest rows).
 *   assumed:  the NAICS values on rows other than 1437462-11-261-1145457 (811420, sourced); they are cycled from the three live values
 *             because the saved pull did not include that column. The last row has no NAICS column on purpose (a row the parser must skip).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSocrataAdapter, parseSocrataReport } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';

const rows = JSON.parse(readFileSync(join(__dirname, '../../fixtures/socrata-sf-business-live-2026-11-16.json'), 'utf8')) as Record<string, unknown>[];
const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-sf-business')!;

/** Names and addresses the live rows carried (from /tmp/r2-verify/live/sf-business.json). None may appear in the fixture or any stored field. */
const PERSONAL = ['Daija', 'Terry', 'Jonathan', 'Taylor', 'Lau', 'Jameel', 'Douglas', 'Chaban', 'Prentiss', 'Geary', 'Birch 710', 'Eazy'];

describe('N2: the SF business feed parses live rows that have no license-code description', () => {
  it('the fixture is 18 live-shaped rows with no name, address or description column', () => {
    expect(rows).toHaveLength(18);
    const cols = new Set(rows.flatMap((r) => Object.keys(r)));
    for (const banned of ['dba_name', 'ownership_name', 'full_business_address', 'lic_code_description', 'lic_code_descriptions_list']) expect(cols.has(banned), banned).toBe(false);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(PERSONAL.join('|'), 'i'));
  });

  it('negative control: the config that shipped (description fields only) parses 0 of 18 and would log the error', () => {
    const old = parseSocrataReport(rows, { ...ds, textFields: ['lic_code_description', 'lic_code_descriptions_list'] });
    expect(old).toMatchObject({ rows: 18, shapeOk: 0 });
    expect(old.items).toHaveLength(0);
  });

  it('the fixed config parses 17 of 18 rows (the row with no NAICS code is skipped), shapeOk 17', () => {
    const r = parseSocrataReport(rows, ds);
    expect(r.rows).toBe(18);
    expect(r.shapeOk).toBe(17);
    expect(r.items).toHaveLength(17);
    for (const s of r.items) {
      expect(s.title).toBe('New business license in San Francisco: business');
      expect(s.kind).toBe('civic');
      expect(s.categories.length).toBeGreaterThan(0);
    }
  });

  it('stores no name, no street address and no exact point', () => {
    const items = parseSocrataReport(rows, ds).items;
    const hay = JSON.stringify(items);
    expect(hay).not.toMatch(new RegExp(PERSONAL.join('|'), 'i'));
    for (const s of items) {
      expect(s.summary ?? '').toBe('');
      expect(Math.abs((s.lat as number) * 100 - Math.round((s.lat as number) * 100))).toBeLessThan(1e-6); // 2 decimals
      expect(Object.keys(s.data ?? {}).sort()).toEqual(['dataset', 'domain', 'subtype']);
    }
    expect(items.map((s) => s.externalId)).toContain('1437462-11-261-1145457');
  });

  it('the adapter logs no error on these rows (health email stays quiet, smoke test passes)', async () => {
    const logs: string[] = [];
    const ctx = {
      since: new Date(),
      env: {},
      log: (m: string) => logs.push(m),
      fetch: (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch,
    };
    const out = await buildSocrataAdapter(ds).fetch(ctx);
    expect(out).toHaveLength(17);
    expect(logs.join('|')).not.toMatch(/error/i);
  });

  it('a feed whose rows all lack the NAICS column still reports a changed shape (the silent-empty rule keeps working)', async () => {
    const logs: string[] = [];
    const bare = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'self_reported_naics_code')));
    const ctx = { since: new Date(), env: {}, log: (m: string) => logs.push(m), fetch: (async () => new Response(JSON.stringify(bare), { status: 200 })) as unknown as typeof fetch };
    expect(await buildSocrataAdapter(ds).fetch(ctx)).toEqual([]);
    expect(logs.join('|')).toMatch(/error: parsed 0 of 18 rows, shape may have changed/);
  });
});
