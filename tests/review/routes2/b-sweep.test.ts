// REV2-ROUTES probe B: per-source alerted vs held, recomputed. Copy to tests/_rev2/ in a clone at d93f95d and run
// Round 18 ROUTES review 2 per-source sweep (logs/REV2-ROUTES-probe-tests), kept as a regression test (redo 2); the gate-only column is always 0 now.
//   REV_OUT=/tmp/x.md npx vitest run tests/_rev2/b-sweep.test.ts
// View A: every raw permit fixture in the repo through the real adapter, markContactPaths and matchSignals (one member per trade).
// View B: every stored permit row (summary only) in tests/signals/__data__ and tests/contacts/fixtures/public-before.json.
// Also writes <REV_OUT>-parts.tsv: every summary part of every permit row, with the gate's verdict, for reading by eye.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { parseJohnsCreek } from '@/lib/signals/adapters/arcgis-johnscreek';
import { parseCobb } from '@/lib/signals/adapters/arcgis-cobb';
import { markContactPaths } from '@/lib/signals/run';
import { matchSignals, type MatchProfile } from '@/lib/signals/match';
import { CATEGORIES } from '@/lib/signals/categories';
import { contactPathOf, textShowsPlace } from '@/lib/signals/alert-gate';
import type { StoredSignal } from '@/lib/signals/store';
import type { SignalInput } from '@/lib/signals/types';
import { sanitizeContacts } from '@/lib/contacts/sanitize';

const NOW = new Date('2026-11-22T12:00:00Z');
const j = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const soc = (id: string) => SOCRATA_DATASETS.find((d) => d.id === id)!;
const arc = (id: string) => ARCGIS_DATASETS.find((d) => d.id === id)!;
const rowsOf = (d: unknown) => (Array.isArray(d) ? d : (d as { rows: unknown[] }).rows);

const FIX: Array<[string, string, () => SignalInput[]]> = [
  ...['dc', 'dekalb', 'mecklenburg', 'raleigh'].map((c) => [`arcgis-${c}-permits`, `tests/fixtures/arcgis-${c}-permits.json`, () => parseArcgis(j(`tests/fixtures/arcgis-${c}-permits.json`), arc(`arcgis-${c}-permits`))] as [string, string, () => SignalInput[]]),
  ['arcgis-raleigh-permits', 'tests/contacts/fixtures/arcgis-synthetic-contacts.json', () => parseArcgis(j('tests/contacts/fixtures/arcgis-synthetic-contacts.json'), arc('arcgis-raleigh-permits'))],
  ['arcgis-atlanta-permits', 'tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json', () => parseArcgis(j('tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json'), arc('arcgis-atlanta-permits'))],
  ['arcgis-johnscreek-permits', 'tests/coverage/fixtures/arcgis-johnscreek-permits-live-2026-11-19.json', () => parseJohnsCreek(j('tests/coverage/fixtures/arcgis-johnscreek-permits-live-2026-11-19.json'))],
  ...['commercial', 'multiunit', 'residential'].map((c) => [`arcgis-cobb-${c}-permits`, `tests/coverage/fixtures/arcgis-cobb-${c}-live-2026-11-19.json`, () => parseCobb(j(`tests/coverage/fixtures/arcgis-cobb-${c}-live-2026-11-19.json`), arc(`arcgis-cobb-${c}-permits`))] as [string, string, () => SignalInput[]]),
  ...['buffalo', 'cambridge', 'chicago', 'cincinnati', 'montgomery', 'nola', 'norfolk', 'orlando', 'sf'].map((c) => [`socrata-${c}-permits`, `tests/fixtures/socrata-${c}-permits.json`, () => parseSocrata(j(`tests/fixtures/socrata-${c}-permits.json`), soc(`socrata-${c}-permits`))] as [string, string, () => SignalInput[]]),
  ['socrata-la-permits', 'tests/signals/adapters/fixtures/S-sample-la-permits.json', () => parseSocrata(j('tests/signals/adapters/fixtures/S-sample-la-permits.json').rows, soc('socrata-la-permits'))],
  ['socrata-austin-permits', 'tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json', () => parseSocrata(rowsOf(j('tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json')), soc('socrata-austin-permits'))],
  ['socrata-austin-permits', 'tests/contacts/fixtures/socrata-austin-permits-contacts.json', () => parseSocrata(rowsOf(j('tests/contacts/fixtures/socrata-austin-permits-contacts.json')), soc('socrata-austin-permits'))],
  ['socrata-chicago-permits', 'tests/contacts/fixtures/socrata-chicago-permits-contacts.json', () => parseSocrata(rowsOf(j('tests/contacts/fixtures/socrata-chicago-permits-contacts.json')), soc('socrata-chicago-permits'))],
];
const toStored = (s: SignalInput, id: number): StoredSignal => ({ id, source: s.source, external_id: s.externalId, kind: s.kind, subtype: (s.data?.subtype as string | undefined) ?? null, title: s.title, summary: s.summary ?? null, categories: s.categories, lat: s.lat ?? null, lon: s.lon ?? null, state: s.state ?? null, city: s.city ?? null, severity: s.severity, occurred_at: s.occurredAt, data: s.data ?? {} }) as unknown as StoredSignal;

describe('REV2-ROUTES B: per-source table', () => {
  it('writes the tables', () => {
    const A = ['| Source | Fixture | Rows | Business | Stored site contact | Gate-only site (not shown) | Summary only | No path | Alert-eligible | Alerted | Held | % alerted |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
    const detail: string[] = [];
    const parts: string[] = ['view\tsource\tverdict\tpart\tsummary'];
    let id = 1;
    for (const [source, file, parse] of FIX) {
      const items = parse();
      const stored = items.map((s) => toStored(s, id++));
      markContactPaths(stored, items);
      let biz = 0, siteC = 0, gateOnly = 0, sumOnly = 0, none = 0, eligible = 0, alerted = 0, held = 0;
      stored.forEach((r, k) => {
        const cp = (r as unknown as { contactPath?: string | null }).contactPath;
        const raw = items[k].contacts ?? [];
        const clean = sanitizeContacts(raw, { datasetCity: items[k].city ?? null });
        const how = cp === 'business' ? 'business' : cp !== 'site' ? 'none' : clean.some((c) => c.role === 'site' && textShowsPlace(c.address)) ? 'site-contact' : 'summary';
        if (how === 'business') biz++; else if (how === 'site-contact') siteC++; else if ((how as string) === 'gate-only') gateOnly++; else if (how === 'summary') sumOnly++; else none++;
        const profiles: MatchProfile[] = CATEGORIES.map((c) => ({ user_id: c.id, categories: [c.id], lat: r.lat ?? 0, lon: r.lon ?? 0, state: r.state ?? 'GA', radius_mi: 50, plan: 'pro' }) as MatchProfile);
        const gated = matchSignals([r], profiles, 1000, NOW, true);
        const forced = matchSignals([{ ...r, contactPath: null } as never], profiles, 1000, NOW, true);
        const alertTrades = forced.filter((x) => x.alert_hold === 'background').map((x) => x.user_id);
        const still = gated.filter((x) => alertTrades.includes(x.user_id) && !x.alert_hold).length;
        if (alertTrades.length) { eligible++; if (still > 0) alerted++; else held++; }
        detail.push([source, file.split('/').pop(), how, alertTrades.length, still, r.title, r.summary ?? '', clean.map((c) => `${c.role}:${c.name || c.address}`).join('; ')].join('\t'));
        for (const p of (r.summary ?? '').split(' | ')) parts.push(['A', source, textShowsPlace(p) ? 'PLACE' : /\d/.test(p) ? 'no(digit)' : 'no', p, r.summary ?? ''].join('\t'));
      });
      A.push(`| ${source} | ${file.split('/').pop()} | ${stored.length} | ${biz} | ${siteC} | ${gateOnly} | ${sumOnly} | ${none} | ${eligible} | ${alerted} | ${held} | ${eligible ? Math.round((100 * alerted) / eligible) + '%' : 'n/a'} |`);
    }
    // View B
    interface Row { id: string; source: string; title: string; summary: string | null; from: string }
    const rows = new Map<string, Row>();
    for (const r of j('tests/signals/__data__/review-f-sample-156.json') as [number, string, string, string | null][]) rows.set(`s${r[0]}`, { id: String(r[0]), source: r[1], title: r[2], summary: r[3], from: 'review-f' });
    for (const c of j('tests/signals/__data__/quality-gate-r15-cards.json').cards as { signal: { id: number; source: string; kind?: string; title: string; summary: string | null } }[]) if (c.signal && /permits$/.test(c.signal.source)) rows.set(`s${c.signal.id}`, { id: String(c.signal.id), source: c.signal.source, title: c.signal.title, summary: c.signal.summary ?? null, from: 'r15-cards' });
    const pb = j('tests/contacts/fixtures/public-before.json') as Record<string, { source: string; externalId: string; title: string; summary?: string | null }[]>;
    for (const list of Object.values(pb)) for (const s of list) if (/permits$/.test(s.source)) rows.set(`pb${s.source}${s.externalId}`, { id: s.externalId, source: s.source, title: s.title, summary: s.summary ?? null, from: 'public-before' });
    const by = new Map<string, { n: number; path: number; none: string[]; printsDigit: string[] }>();
    for (const r of rows.values()) {
      if (!/permits$/.test(r.source)) continue;
      const b = by.get(r.source) ?? { n: 0, path: 0, none: [], printsDigit: [] };
      b.n++;
      if (contactPathOf([], r.summary)) b.path++;
      else {
        b.none.push(`${r.id} [${r.from}] ${r.summary}`);
        const numbered = (r.summary ?? '').split(' | ').find((p) => /^\s*\d+[A-Za-z]?\s+[A-Za-z]/.test(p) && !/job value|^1 or 2 family/i.test(p));
        if (numbered) b.printsDigit.push(`${r.id}: ${numbered}`);
      }
      by.set(r.source, b);
      for (const p of (r.summary ?? '').split(' | ')) parts.push(['B', r.source, textShowsPlace(p) ? 'PLACE' : /\d/.test(p) ? 'no(digit)' : 'no', p, r.summary ?? ''].join('\t'));
    }
    const B = ['| Source (stored rows) | Rows | With a path from the summary | No path | Numbered part refused | % |', '|---|---|---|---|---|---|'];
    const noPath: string[] = [];
    for (const [s, b] of [...by].sort()) {
      B.push(`| ${s} | ${b.n} | ${b.path} | ${b.none.length} | ${b.printsDigit.length} | ${Math.round((100 * b.path) / b.n)}% |`);
      for (const x of b.none) noPath.push(`${s}\t${x}`);
    }
    const f = process.env.REV_OUT;
    if (f) {
      writeFileSync(f, ['### A', ...A, '', '### B', ...B, '', 'Stored rows with no path:', ...noPath].join('\n') + '\n');
      writeFileSync(f.replace(/\.md$/, '-rows.tsv'), 'source\tfixture\thow\talertTrades\tstillAlerted\ttitle\tsummary\tcontacts\n' + detail.join('\n') + '\n');
      writeFileSync(f.replace(/\.md$/, '-parts.tsv'), parts.join('\n') + '\n');
    }
    expect(A.length).toBeGreaterThan(2);
    // Redo 2: no gate-only path exists any more, and the Atlanta-area feeds alert every alert-eligible row of their fixtures.
    for (const line of A.slice(2)) expect(line.split(' | ')[5], line).toBe('0');
    for (const src of ['arcgis-atlanta-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits', 'arcgis-cobb-residential-permits', 'arcgis-dekalb-permits']) {
      for (const line of A.filter((l) => l.startsWith(`| ${src} |`))) expect(line.trim().endsWith('| 100% |') || line.trim().endsWith('| n/a |'), line).toBe(true);
    }
  });
});
