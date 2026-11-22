/**
 * Round 18 unit LISTS, review redo 1: the reviewer's privacy probe, kept as a permanent regression test. Originally: every permit fixture in the repo goes through the REAL adapter, then through buildList and the
 * rendered ListSheet. No value of a raw owner / applicant / contact / contractor / name column may appear in any list output.
 * Also: adversarial raw rows (a name typed into the address or type column) through the real adapter.
 * Run from a checkout: npx vitest run tests/rev/rev-lists-privacy.probe.test.ts --silent=false
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildList, type PermitRow } from '@/lib/lists/core';
import { ListSheet } from '@/components/lists/list-sheet';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import type { SignalInput } from '@/lib/signals/types';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

let nid = 1;
function toRow(s: SignalInput): PermitRow {
  const d = (s.data ?? {}) as Record<string, unknown>;
  return {
    id: nid++, source: s.source, kind: s.kind, title: s.title, summary: s.summary ?? null, url: s.url ?? null,
    lat: s.lat ?? null, lon: s.lon ?? null, city: s.city ?? null, state: s.state ?? null, zip: s.zip ?? null,
    occurred_at: s.occurredAt, subtype: (d.subtype as string) ?? null,
    approxLocation: d.approxLocation === true ? 'true' : null, loc: (d.loc as string) ?? null, projectOf: (d.projectOf as string) ?? null,
  };
}
const NAME_COL_RE = /owner|applicant|contact|contractor|(?:^|_)name$|full_name|person|tenant|phone|email/i;
function nameValues(raw: unknown): string[] {
  const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw : ((raw as { features?: { attributes: Record<string, unknown> }[] }).features ?? []).map((f) => f.attributes);
  const out = new Set<string>();
  for (const r of rows) for (const [k, v] of Object.entries(r ?? {})) {
    if (!NAME_COL_RE.test(k) || /type|city|state|zip|address|trade|street_name/i.test(k)) continue;
    if (typeof v === 'string' && v.trim().length >= 4 && !/^(?:private owner|n\/a|none|owner|contractor)$/i.test(v.trim())) out.add(v.trim());
  }
  return [...out];
}
function listText(rows: PermitRow[]): { text: string; total: number } {
  // every row is "in the area": a huge radius around each row's own point
  const located = rows.filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number');
  const areas = located.slice(0, 1).map((r) => ({ lat: r.lat as number, lon: r.lon as number }));
  const list = buildList(rows, { areas, areaRadiusMi: 5000, max: 10_000 });
  const html = renderToStaticMarkup(createElement(ListSheet, { lang: 'en', heading: 'x', notes: [], entries: list.entries, total: list.total, capped: false, showDistance: true }) as never);
  return { text: `${JSON.stringify(list.entries)} ${html}`, total: list.total };
}

const SOCRATA_FIX: [string, string][] = [];
const ARCGIS_FIX: [string, string][] = [];
for (const dir of ['tests/fixtures', 'tests/contacts/fixtures', 'tests/signals/adapters/fixtures']) {
  if (!fs.existsSync(path.join(ROOT, dir))) continue;
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const m = /^(socrata-[a-z]+-permits)(?:-[a-z0-9-]+)?\.json$/.exec(f);
    if (m && SOCRATA_DATASETS.some((d) => d.id === m[1])) SOCRATA_FIX.push([`${dir}/${f}`, m[1]]);
    const a = /^(arcgis-[a-z]+-permits)(?:-[a-z0-9-]+)?\.json$/.exec(f);
    if (a && ARCGIS_DATASETS.some((d) => d.id === a[1])) ARCGIS_FIX.push([`${dir}/${f}`, a[1]]);
  }
}

describe('every permit fixture through the real adapter, then the list', () => {
  it('found fixtures', () => {
    console.log('socrata permit fixtures:', SOCRATA_FIX.map((x) => x[0]).join(', '));
    console.log('arcgis permit fixtures:', ARCGIS_FIX.map((x) => x[0]).join(', '));
    expect(SOCRATA_FIX.length + ARCGIS_FIX.length).toBeGreaterThan(5);
  });
  for (const [file, id] of [...SOCRATA_FIX, ...ARCGIS_FIX]) {
    it(`${file}: no raw name-column value in the list`, () => {
      const raw = read(file);
      const sigs = id.startsWith('socrata') ? parseSocrata(raw, SOCRATA_DATASETS.find((d) => d.id === id)!) : parseArcgis(raw, ARCGIS_DATASETS.find((d) => d.id === id)!);
      const { text, total } = listText(sigs.map(toRow));
      const names = nameValues(raw);
      const hits = names.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
      console.log(`${id}: ${sigs.length} signals, ${total} list lines, ${names.length} name-column values checked, hits: ${JSON.stringify(hits)}`);
      expect(hits).toEqual([]);
    });
  }
});

describe('adversarial raw rows through the real Chicago and Austin adapters', () => {
  const chicago = SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-permits')!;
  const austin = SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-permits')!;
  const chBase = read('tests/contacts/fixtures/socrata-chicago-permits-contacts.json')[0];
  const auBase = read('tests/contacts/fixtures/socrata-austin-permits-contacts.json')[0];
  const cases: [string, typeof chicago, Record<string, unknown>][] = [
    ['street_name holds a name', chicago, { ...chBase, id: 'a1', street_name: 'DAMEN AVE JOHN Q HOMEOWNER' }],
    ['street_name is a name only', chicago, { ...chBase, id: 'a2', street_name: 'HOMEOWNER JOHN' }],
    ['permit_type holds a name', chicago, { ...chBase, id: 'a3', permit_type: 'GARCIA RESIDENCE' }],
    ['work_type holds a name', chicago, { ...chBase, id: 'a4', work_type: 'Maria Garcia' }],
    ['address then name', austin, { ...auBase, permit_number: 'b1', original_address1: '4812 AVENUE H JANE APPLICANT' }],
    ['address dash residence', austin, { ...auBase, permit_number: 'b2', original_address1: '4812 AVENUE H - APPLICANT RESIDENCE' }],
    ['address c/o', austin, { ...auBase, permit_number: 'b3', original_address1: '4812 AVENUE H C/O JANE APPLICANT' }],
    ['unit on address', austin, { ...auBase, permit_number: 'b4', original_address1: '4812 AVENUE H UNIT 12' }],
    ['apt on address', austin, { ...auBase, permit_number: 'b5', original_address1: '4812 AVENUE H APT 12' }],
    ['permit class holds a name', austin, { ...auBase, permit_number: 'b6', work_class: 'Jane Applicant', permit_type_desc: 'Jane Applicant Residence' }],
  ];
  for (const [name, ds, row] of cases) {
    it(`PROBE ${name}`, () => {
      const sigs = parseSocrata([row], ds);
      const rows = sigs.map(toRow);
      const { text } = listText(rows);
      const list = buildList(rows, { areas: rows.filter((r) => r.lat !== null).slice(0, 1).map((r) => ({ lat: r.lat as number, lon: r.lon as number })), areaRadiusMi: 50 });
      console.log(name, '| title:', JSON.stringify(sigs[0]?.title), '| summary:', JSON.stringify(sigs[0]?.summary), '| list:', JSON.stringify(list.entries.map((e) => [e.address, e.permitType])));
      expect(text).not.toMatch(/HOMEOWNER|APPLICANT|GARCIA|JANE|MARIA/i);
    });
  }
});
