// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/**
 * REV-ROUTES probe 01: every permit fixture in the repo through the real adapter parse, the real contact sanitiser, markContactPaths
 * (the scan's own function) and matchSignals with one member per trade standing on the job site. Prints, per source: rows, contact path
 * (business / site / none), rows that would alert at least one trade, and how many of those are held as Background for every trade.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { parseJohnsCreek } from '@/lib/signals/adapters/arcgis-johnscreek';
import { markContactPaths } from '@/lib/signals/run';
import { matchSignals, type MatchProfile } from '@/lib/signals/match';
import { CATEGORIES } from '@/lib/signals/categories';
import type { StoredSignal } from '@/lib/signals/store';
import type { SignalInput } from '@/lib/signals/types';
import { sanitizeContacts } from '@/lib/contacts/sanitize';

const NOW = new Date('2026-11-22T12:00:00Z');
const j = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const soc = (id: string) => SOCRATA_DATASETS.find((d) => d.id === id)!;
const arc = (id: string) => ARCGIS_DATASETS.find((d) => d.id === id)!;

const FIXTURES: Array<[string, string, () => SignalInput[]]> = [
  ['arcgis-dc-permits', 'tests/fixtures/arcgis-dc-permits.json', () => parseArcgis(j('tests/fixtures/arcgis-dc-permits.json'), arc('arcgis-dc-permits'))],
  ['arcgis-dekalb-permits', 'tests/fixtures/arcgis-dekalb-permits.json', () => parseArcgis(j('tests/fixtures/arcgis-dekalb-permits.json'), arc('arcgis-dekalb-permits'))],
  ['arcgis-mecklenburg-permits', 'tests/fixtures/arcgis-mecklenburg-permits.json', () => parseArcgis(j('tests/fixtures/arcgis-mecklenburg-permits.json'), arc('arcgis-mecklenburg-permits'))],
  ['arcgis-raleigh-permits', 'tests/fixtures/arcgis-raleigh-permits.json', () => parseArcgis(j('tests/fixtures/arcgis-raleigh-permits.json'), arc('arcgis-raleigh-permits'))],
  ['arcgis-atlanta-permits', 'tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json', () => parseArcgis(j('tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json'), arc('arcgis-atlanta-permits'))],
  ['arcgis-johnscreek-permits', 'tests/coverage/fixtures/arcgis-johnscreek-permits-live-2026-11-19.json', () => parseJohnsCreek(j('tests/coverage/fixtures/arcgis-johnscreek-permits-live-2026-11-19.json'))],
  ...['buffalo', 'cambridge', 'chicago', 'cincinnati', 'montgomery', 'nola', 'norfolk', 'orlando', 'sf'].map(
    (c) => [`socrata-${c}-permits`, `tests/fixtures/socrata-${c}-permits.json`, () => parseSocrata(j(`tests/fixtures/socrata-${c}-permits.json`), soc(`socrata-${c}-permits`))] as [string, string, () => SignalInput[]],
  ),
  ['socrata-la-permits', 'tests/signals/adapters/fixtures/S-sample-la-permits.json', () => parseSocrata(j('tests/signals/adapters/fixtures/S-sample-la-permits.json').rows, soc('socrata-la-permits'))],
  ['socrata-austin-permits', 'tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json (synthetic)', () => { const d = j('tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json'); return parseSocrata(Array.isArray(d) ? d : d.rows, soc('socrata-austin-permits')); }],
  ['socrata-austin-permits', 'tests/contacts/fixtures/socrata-austin-permits-contacts.json', () => { const d = j('tests/contacts/fixtures/socrata-austin-permits-contacts.json'); return parseSocrata(Array.isArray(d) ? d : d.rows, soc('socrata-austin-permits')); }],
  ['socrata-chicago-permits', 'tests/contacts/fixtures/socrata-chicago-permits-contacts.json', () => { const d = j('tests/contacts/fixtures/socrata-chicago-permits-contacts.json'); return parseSocrata(Array.isArray(d) ? d : d.rows, soc('socrata-chicago-permits')); }],
];

const toStored = (s: SignalInput, id: number): StoredSignal =>
  ({
    id,
    source: s.source,
    external_id: s.externalId,
    kind: s.kind,
    subtype: (s.data?.subtype as string | undefined) ?? null,
    title: s.title,
    summary: s.summary ?? null,
    categories: s.categories,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    state: s.state ?? null,
    city: s.city ?? null,
    severity: s.severity,
    occurred_at: s.occurredAt,
    data: s.data ?? {},
  }) as unknown as StoredSignal;

describe('REV-ROUTES 01: permit fixtures, alerted vs held as background', () => {
  it('prints the table', () => {
    const out: string[] = ['| Source | Fixture | Rows | Named business | Site address only | No contact path | Rows that alert >=1 trade (no gate) | ...still alerted with the gate | ...held Background for every trade | % alerted |', '|---|---|---|---|---|---|---|---|---|---|'];
    const detail: string[] = [];
    const res: Record<string, { eligible: number; alerted: number; heldAll: number }> = {};
    let id = 1;
    for (const [source, file, parse] of FIXTURES) {
      let items: SignalInput[];
      try {
        items = parse();
      } catch (e) {
        out.push(`| ${source} | ${file} | PARSE FAILED ${(e as Error).message.slice(0, 60)} |`);
        continue;
      }
      const stored = items.map((s) => toStored(s, id++));
      markContactPaths(stored, items);
      let biz = 0, site = 0, none = 0, eligible = 0, alerted = 0, heldAll = 0;
      stored.forEach((r, k) => {
        const cp = (r as unknown as { contactPath?: string | null }).contactPath;
        if (cp === 'business') biz++;
        else if (cp === 'site') site++;
        else none++;
        const profiles: MatchProfile[] = CATEGORIES.map((c) => ({ user_id: c.id, categories: [c.id], lat: r.lat ?? 0, lon: r.lon ?? 0, state: r.state ?? 'GA', radius_mi: 50, plan: 'pro' }) as MatchProfile);
        const gated = matchSignals([r], profiles, 1000, NOW, true);
        // the same record with the contact state unknown = the matching before round 18
        const before = matchSignals([{ ...r, contactPath: undefined } as never], profiles, 1000, NOW, true);
        // which of the rows are alerts: a second pass with a held marker tells alert from market insight (a held row was an alert)
        const forced = matchSignals([{ ...r, contactPath: null } as never], profiles, 1000, NOW, true);
        const alertTrades = forced.filter((x) => x.alert_hold === 'background').map((x) => x.user_id);
        if (alertTrades.length) eligible++;
        const stillAlert = gated.filter((x) => alertTrades.includes(x.user_id) && !x.alert_hold).length;
        if (alertTrades.length && stillAlert > 0) alerted++;
        if (alertTrades.length && stillAlert === 0) heldAll++;
        const contacts = sanitizeContacts(items[k].contacts ?? [], { datasetCity: items[k].city ?? null });
        detail.push(`${source}\t${cp ?? 'none'}\t${alertTrades.length}\t${before.length}\t${r.title}\t${r.summary ?? ''}\t${contacts.map((c) => `${c.role}:${c.name || c.address}`).join('; ')}`);
      });
      out.push(`| ${source} | ${file} | ${stored.length} | ${biz} | ${site} | ${none} | ${eligible} | ${alerted} | ${heldAll} | ${eligible ? Math.round((100 * alerted) / eligible) + '%' : 'n/a'} |`);
      res[file] = { eligible, alerted, heldAll };
    }
    if (process.env.REV_OUT) writeFileSync(process.env.REV_OUT as string, out.join('\n') + '\n');
    if (process.env.REV_OUT) writeFileSync((process.env.REV_OUT as string).replace(/\.md$/, '-rows.tsv'), 'source\tcontactPath\talertTrades\tmatchedTrades\ttitle\tsummary\tcontacts\n' + detail.join('\n') + '\n');
    console.log(out.join('\n'));
    expect(out.length).toBeGreaterThan(2);
    // Redo 1 (decision 1): the Atlanta-area feeds alert every alert-eligible row (the live Atlanta fixture held 2 of 5 before).
    expect(res['tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json']).toEqual({ eligible: 5, alerted: 5, heldAll: 0 });
    expect(res['tests/fixtures/arcgis-dekalb-permits.json'].heldAll).toBe(0);
    // Every other fixture: a held row has no address and no business in its record (Raleigh: none and a lot number; LA: the fixture's
    // select left the address column out, see its provenance).
    for (const [file, r] of Object.entries(res)) {
      if (/arcgis-raleigh|S-sample-la/.test(file)) continue;
      expect(r.heldAll, file).toBe(0);
    }
    for (const line of detail) {
      const [source, cp, alertTrades, , , summary] = line.split('\t');
      if (cp === 'none' && Number(alertTrades) > 0) expect(/^\d+[A-Za-z]?\s+\S+\s+(?:st|ave|rd|dr|ln|ct|way|blvd)\b/i.test(summary ?? ''), `${source} held although it prints ${summary}`).toBe(false);
    }
  });
});
