/**
 * verify-v1 finding 3 (P2), finding 4 (P2) and finding 12 (P2), commander decisions 3 and 6.
 *  - the violation re-map uses exactly the ingest's inputs (Austin classifies description AND case_type, which the row does not hold),
 *    so it never drops a trade the ingest assigned;
 *  - pruning on a lost trade deletes only an untouched match: status 'new', no draft, not emailed, not pushed, no feedback, no outcome
 *    answer;
 *  - readAllPages reads until an EMPTY page, so a project max-rows below 1000 cannot hide rows.
 */
import { describe, expect, it } from 'vitest';
import { fakeTables } from './fake-table';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { remapRow, type StoredRuleRow } from '@/lib/signals/mapping/remap';
import { pruneStaleMatches, rematchSignals } from '@/lib/signals/rematch';
import { readAllPages } from '@/lib/signals/store';
import type { MatchProfile } from '@/lib/signals/match';

const NOW = new Date('2026-11-19T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const austin = SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-violations')!;
const chicago = SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-violations')!;

/** Ingest a row, then store it the way a round 6 row looks to the re-map (no cat_v). */
function stored(ds: typeof austin, raw: Record<string, string>, id: number): StoredRuleRow {
  const [s] = parseSocrata([raw], ds);
  expect(s, JSON.stringify(raw)).toBeDefined();
  const { cat_v: _v, ...data } = s.data as Record<string, unknown>;
  void _v;
  return { id, source: s.source, title: s.title, summary: s.summary ?? null, city: s.city ?? null, categories: s.categories, data };
}

describe('verify-v1 P2 #3: the violation re-map never drops a trade the ingest assigned (Austin case_type)', () => {
  const base = { case_id: 'C', opened_date: '2026-11-17T10:00:00.000', status: 'Active', address: '3400 BALCONES DR', zip_code: '78731', latitude: '30.3', longitude: '-97.75' };
  const cases: [string, string][] = [
    ['Trash and debris in yard', 'Structure Condition Violation(s)'],
    ['High grass and weeds', 'Property Abatement'],
    ['Broken window', 'Structure Condition Violation(s)'],
    ['Fence in disrepair', 'Structure Condition Violation(s)'],
  ];
  cases.forEach(([description, caseType], i) => {
    it(`"${description}" + "${caseType}": re-map keeps every ingest trade`, () => {
      const row = stored(austin, { ...base, case_id: `C${i}`, description, case_type: caseType }, i + 1);
      const m = remapRow(row)!;
      expect(m.lost).toEqual([]);
      expect([...m.categories].sort()).toEqual([...(row.categories ?? [])].sort());
    });
  });
  it('a dataset whose one classified column is the printed title is still re-mapped (Chicago)', () => {
    const row = stored(chicago, { id: 'V1', violation_date: '2026-11-17T10:00:00.000', violation_description: 'ROOF LEAKING', violation_status: 'OPEN', address: '100 W MAIN ST', latitude: '41.9', longitude: '-87.6' }, 50);
    // a round 6 row carried plumbing for a roof leak; the current rules do not
    const m = remapRow({ ...row, categories: [...(row.categories ?? []), 'plumbing'] })!;
    expect(m.lost).toEqual(['plumbing']);
  });
});

describe('verify-v1 P2 #4: pruning deletes only an untouched match', () => {
  const PLUMBER: MatchProfile = { user_id: 'plumber', categories: ['plumbing'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
  const sig = { id: 5, source: 'arcgis-dekalb-permits', kind: 'permit', categories: ['hvac'], lat: 33.85, lon: -84.35, state: 'GA', severity: 1, occurred_at: ago(1), expires_at: null, title: 'HVAC permit in DeKalb County', summary: null, data: { subtype: 'permit' } };
  const users = ['u-new', 'u-saved', 'u-done', 'u-draft', 'u-pushed', 'u-emailed', 'u-feedback', 'u-asked'];
  const profiles = users.map((u) => ({ ...PLUMBER, user_id: u }));
  const m = (id: number, user: string, over: Record<string, unknown> = {}) => ({ id, user_id: user, signal_id: 5, status: 'new', notified: false, draft: null, pushed_at: null, ...over });

  it('verifier repro: a saved, pushed match is kept; only the untouched one goes', async () => {
    const db = fakeTables({
      holler_signals: [sig],
      holler_matches: [
        m(1, 'u-new'),
        m(2, 'u-saved', { status: 'saved', pushed_at: ago(0.5) }),
        m(3, 'u-done', { status: 'done' }),
        m(4, 'u-draft', { draft: 'Hi, I saw the permit.' }),
        m(5, 'u-pushed', { pushed_at: ago(0.5) }),
        m(6, 'u-emailed', { notified: true }),
        m(7, 'u-feedback'),
        m(8, 'u-asked'),
      ],
      holler_signal_feedback: [{ user_id: 'u-feedback', signal_id: 5, verdict: 'not_relevant' }],
      holler_outcome_asks: [{ id: 1, user_id: 'u-asked', signal_id: 5, channel: 'feed', answer: null }],
    });
    const r = await pruneStaleMatches(db, [5], { now: NOW, profiles });
    expect(r).toEqual({ removed: 1 });
    expect(db.tables.holler_matches.map((x: { id: number }) => x.id).sort()).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
  it('before migration 0020 (no pushed_at) the read retries without that filter and still keeps touched rows', async () => {
    const db = fakeTables({ holler_signals: [sig], holler_matches: [m(1, 'u-new'), m(2, 'u-saved', { status: 'saved' })] });
    const orig = db.from.bind(db);
    db.from = (t: string) => {
      const q = orig(t);
      if (t !== 'holler_matches') return q;
      const is = q.is.bind(q);
      q.is = (c: string, v: null) => (c === 'pushed_at' ? { order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'column holler_matches.pushed_at does not exist' } }) }), select: () => Promise.resolve({ data: null, error: { message: 'column holler_matches.pushed_at does not exist' } }) } : is(c, v));
      return q;
    };
    const r = await pruneStaleMatches(db, [5], { now: NOW, profiles });
    expect(r).toEqual({ removed: 1 });
    expect(db.tables.holler_matches.map((x: { id: number }) => x.id)).toEqual([2]);
  });
  it('a feedback read error keeps every match', async () => {
    const db = fakeTables({ holler_signals: [sig], holler_matches: [m(1, 'u-new')] }, { failSelect: 'holler_signal_feedback' });
    const r = await pruneStaleMatches(db, [5], { now: NOW, profiles, log: () => {} });
    expect(r.removed).toBe(0);
    expect(r.error).toMatch(/holler_signal_feedback/);
    expect(db.tables.holler_matches).toHaveLength(1);
  });
});

describe('verify-v1 P2 #12: paged reads continue until an empty page', () => {
  it('rematch with the project max-rows at 300 still sees every existing pair (verifier repro, created 5)', async () => {
    const P: MatchProfile = { user_id: 'me', categories: ['plumbing'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
    const signals = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, source: 'arcgis-dekalb-permits', kind: 'permit', categories: ['plumbing'], lat: 33.85, lon: -84.35, state: 'GA', severity: 1, occurred_at: ago(i < 25 ? 0.5 : 1), expires_at: null, title: 't', summary: null, data: { subtype: 'permit' } }));
    const matches: Record<string, unknown>[] = [];
    let id = 1;
    for (let k = 0; k < 1400; k++) matches.push({ id: id++, user_id: `other${k}`, signal_id: 1 + (k % 25) });
    for (let s = 1; s <= 25; s++) matches.push({ id: id++, user_id: 'me', signal_id: s });
    const db = fakeTables({ holler_signals: signals, holler_matches: matches }, { maxRows: 300 });
    const r = await rematchSignals(db, signals.map((s) => s.id), { now: NOW, profiles: [P] });
    expect(r.created).toBe(5);
    const mine = db.tables.holler_matches.filter((x: { user_id: string }) => x.user_id === 'me').map((x: { signal_id: number }) => x.signal_id);
    expect(mine.filter((s: number) => s > 25).sort((a: number, b: number) => a - b)).toEqual([26, 27, 28, 29, 30]);
  });
  it('readAllPages: a short page does not end the read, an empty page does; offsets follow the rows returned', async () => {
    const all = Array.from({ length: 750 }, (_, i) => i);
    const asked: [number, number][] = [];
    const rows = await readAllPages<number>((a, b) => {
      asked.push([a, b]);
      return Promise.resolve({ data: all.slice(a, Math.min(b + 1, a + 300)), error: null });
    });
    expect(rows).toEqual(all);
    expect(asked.map(([a]) => a)).toEqual([0, 300, 600, 750]);
  });
});
