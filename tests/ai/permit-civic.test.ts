import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runClassify, SYSTEM_PROMPT, type RunOptions } from '../../lib/ai/classify';
import { dayLimit, modelSignalsToday, pickWithinLimit, runLimit } from '../../lib/ai/limits';
import { cleanNote, noteViolations } from '../../lib/ai/note-rules';
import { aiCoverageLine, loadAiCoverage } from '../../lib/admin/ai-coverage';
import { AiFakeDb, NOW, sig } from './fake-db';
import { mockModel } from './mock-model';

// Item 2.5: AI classification of permits and civic records (311, violations, inspections), with a fake model only.

const rematch = vi.fn(async (_db: unknown, ids: number[]): Promise<{ created: number; error?: string }> => ({ created: ids.length }));
beforeEach(() => {
  rematch.mockClear();
});

const opts = (db: AiFakeDb, model: RunOptions['model'], over: Partial<RunOptions> = {}): RunOptions => ({
  db: db as never,
  now: NOW,
  deadline: Date.now() + 45_000,
  env: {},
  model,
  rematch,
  concurrency: 3,
  ...over,
});

const permit = (id: number, over: Record<string, unknown> = {}) =>
  sig(id, { title: `Re-roof permit ${id} for a single family home`, summary: 'Permit issued to replace roof shingles on 2 stories.', categories: ['roofing'], ...over });
const civic = (id: number, over: Record<string, unknown> = {}) =>
  sig(id, {
    source: 'socrata-austin-311',
    kind: 'civic',
    subtype: '311',
    title: `311 request ${id}: water leak at a property`,
    summary: 'Service request for a water line leak.',
    categories: ['plumbing'],
    data: { subtype: '311' },
    ...over,
  });

const answer = (note: string, trade = 'plumbing', p = 0.9) => (ids: number[]) => ({
  results: ids.map((id) => ({ id, trades: [{ trade, p }], notes: [{ trade, why: note }] })),
});

describe('item 2.5: permit and civic records are classified', () => {
  it('applies the trade, stores a trade-specific line, tells the model the permit and civic rules, counts per kind', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1, { categories: ['gutters'] }), civic(2)] });
    const { model, calls } = mockModel((ids) => ({
      results: ids.map((id) =>
        id === 1
          ? { id, trades: [{ trade: 'roofing', p: 0.92 }], notes: [{ trade: 'roofing', why: 'A re-roof of a home this size may also call for gutter and flashing work.' }] }
          : { id, trades: [{ trade: 'plumbing', p: 0.85 }], notes: [{ trade: 'plumbing', why: 'A water line leak report may lead to pipe repair work.' }] },
      ),
    }));
    const s = await runClassify(opts(db, model));
    expect(s.reason).toBeNull();
    expect(s.signalsClassified).toBe(2);
    expect(s.byKind).toEqual({ permit: { classified: 1, applied: 1, withNote: 1 }, civic: { classified: 1, applied: 0, withNote: 1 } });
    // the label check: the rule label (gutters) was replaced by the confident AI trade, the old one is kept
    expect(db.tables.holler_signals.find((x) => x.id === 1)!.categories).toEqual(['roofing']);
    expect(db.tables.holler_signal_ai.find((x) => x.signal_id === 1)).toMatchObject({ applied: true, prev_categories: ['gutters'] });
    expect(db.tables.holler_signal_ai.find((x) => x.signal_id === 2)!.notes).toEqual({ plumbing: 'A water line leak report may lead to pipe repair work.' });
    const sent = JSON.stringify(calls[0].prompt);
    expect(sent).toContain('Rules for permit and civic records');
    expect(SYSTEM_PROMPT).toMatch(/never shows who was or will be hired/);
  });

  it('a note with a number or a name that is not in the record is dropped; the trade stays and the rule text is untouched', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1), civic(2), permit(3)] });
    const notes: Record<number, string> = {
      1: 'A 4500 square foot re-roof may call for new gutters.', // number not in the record
      2: 'A leak at Maple Court may lead to pipe repair work.', // name not in the record
      3: 'A re-roof of 2 stories may call for gutter work.', // 2 is in the summary: kept
    };
    const { model } = mockModel((ids) => ({ results: ids.map((id) => ({ id, trades: [{ trade: id === 2 ? 'plumbing' : 'roofing', p: 0.9 }], notes: [{ trade: id === 2 ? 'plumbing' : 'roofing', why: notes[id] }] })) }));
    const s = await runClassify(opts(db, model));
    const by = (id: number) => db.tables.holler_signal_ai.find((x) => x.signal_id === id)!;
    expect(by(1).notes).toEqual({});
    expect(by(2).notes).toEqual({});
    expect(by(3).notes).toEqual({ roofing: notes[3] });
    expect(Object.keys(by(1).trades)).toEqual(['roofing']);
    expect(s.notesDropped).toBe(2);
    expect(s.notesKept).toBe(1);
    // the stored signal text (the rule-based wording) is never rewritten by the AI step
    expect(db.tables.holler_signals.find((x) => x.id === 1)!.title).toBe('Re-roof permit 1 for a single family home');
  });

  it('wording rules on AI output: no vendor chosen, no proof of damage or a condition, no "official record", no banned words', () => {
    const input = 'permit Re-roof permit for a home Permit issued roof';
    const bad: Array<[string, string]> = [
      ['A contractor already has this re-roof job.', 'claims_vendor'],
      ['The permit shows the roofer was selected for the job.', 'claims_vendor'],
      ['A licensed contractor pulled this permit for the re-roof.', 'claims_vendor'],
      ['The bid was awarded so gutter work may follow soon.', 'claims_vendor'],
      ['This permit confirms the roof needs replacing soon.', 'claims_proof'],
      ['The 311 report proves a leak that needs repair.', 'claims_proof'],
      ['See the official record for roof work that may follow.', 'banned_word'],
      ['A seamless gutter job may follow this re-roof permit.', 'banned_word'],
      ['This permit is a new lead for roof and gutter work.', 'claims_customer'],
    ];
    for (const [n, v] of bad) expect(noteViolations(n, input, { kind: 'permit' }), n).toContain(v);
    // weather never proves damage: a cause verb is refused for weather kinds even when hedged
    expect(noteViolations('Hail may have caused roof damage that needs a look soon.', 'alert hail roof', { kind: 'alert' })).toContain('claims_cause');
    expect(noteViolations('Hail this size may leave roofs in need of an inspection soon.', 'alert hail 1.75 inch roof', { kind: 'alert' })).toEqual([]);
    expect(cleanNote('A re-roof permit may lead to gutter and flashing work.', input, { kind: 'permit' })).toBe('A re-roof permit may lead to gutter and flashing work.');
  });

  it('a note that breaks a wording rule is dropped in a full run, and the model output is never trusted over the rules', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1)] });
    const { model } = mockModel(answer('A contractor already has this re-roof job.', 'roofing'));
    await runClassify(opts(db, model));
    expect(db.tables.holler_signal_ai[0].notes).toEqual({});
    expect(db.tables.holler_signal_ai[0].trades).toEqual({ roofing: 0.9 });
  });
});

describe('item 2.5: limits and order', () => {
  it('per run: at most the limit goes to the model, permit and civic oldest first, the rest is deferred', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => (i % 2 ? civic(i + 1) : permit(i + 1)));
    const db = new AiFakeDb({ holler_signals: rows });
    const { model, calls } = mockModel(answer('Roof work may follow this permit.', 'roofing'));
    const s = await runClassify(opts(db, model, { env: { AI_MAX_SIGNALS_PER_RUN: '30' } }));
    const sent = calls.flatMap((c) => c.ids);
    expect(sent).toHaveLength(30);
    expect(s.sentToModel).toBe(30);
    expect(s.limits).toMatchObject({ perRun: 30, allowed: 30, deferred: 70 });
    // sig(): a higher id is older. Oldest first means the highest ids go first.
    expect([...sent].sort((a, b) => b - a)).toEqual(Array.from({ length: 30 }, (_, i) => 100 - i));
    expect(db.tables.holler_signal_ai).toHaveLength(30);
    // the next run takes the next oldest unclassified
    const next = mockModel(answer('Roof work may follow this permit.', 'roofing'));
    await runClassify(opts(db, next.model, { env: { AI_MAX_SIGNALS_PER_RUN: '30' } }));
    expect(next.calls.flatMap((c) => c.ids).sort((a, b) => b - a)).toEqual(Array.from({ length: 30 }, (_, i) => 70 - i));
  });

  it('per day: what today already used is subtracted; a used-up day makes no call and is not a failure', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 50 }, (_, i) => permit(i + 1)) });
    const today = new Date(NOW.getTime() - 3_600_000).toISOString();
    db.tables.holler_ai_spend.push(
      { id: 900, month: '2026-11-01', kind: 'classify', signals: 40, cost_usd: 0.001, created_at: today },
      { id: 901, month: '2026-11-01', kind: 'refused', signals: 500, cost_usd: 0, created_at: today },
      { id: 902, month: '2026-11-01', kind: 'classify', signals: 500, cost_usd: 0.01, created_at: '2026-11-18T23:59:00.000Z' }, // yesterday
    );
    const env = { AI_MAX_SIGNALS_PER_DAY: '50', AI_MAX_SIGNALS_PER_RUN: '200' };
    expect(await modelSignalsToday(db as never, NOW)).toBe(40);
    const a = mockModel(answer('Roof work may follow this permit.', 'roofing'));
    const s = await runClassify(opts(db, a.model, { env }));
    expect(a.calls.flatMap((c) => c.ids)).toHaveLength(10);
    expect(s.limits).toMatchObject({ perDay: 50, usedToday: 40, allowed: 10, deferred: 40 });
    // now the day is used up (the 10 sent are booked in holler_ai_spend; the real table fills created_at itself, the fake does not)
    for (const r of db.tables.holler_ai_spend) r.created_at ??= NOW.toISOString();
    const b = mockModel(answer('Roof work may follow this permit.', 'roofing'));
    const s2 = await runClassify(opts(db, b.model, { env }));
    expect(b.calls).toHaveLength(0);
    expect(s2.reason).toBe('day_limit');
    expect(s2.ok).toBe(true);
  });

  it('today\'s volume unreadable: no model call (fails closed)', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1)] });
    db.failOn['holler_ai_spend.select'] = 'boom';
    const { model, calls } = mockModel(answer('Roof work may follow this permit.', 'roofing'));
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(0);
    expect(s.reason).toBe('spend_unavailable');
    expect(db.tables.holler_signal_ai).toHaveLength(0);
  });

  it('the monthly dollar cap still applies under the volume limits', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1), civic(2)] });
    db.tables.holler_ai_spend.push({ id: 900, month: '2026-11-01', kind: 'classify', signals: 1, cost_usd: 10, created_at: '2026-11-02T00:00:00.000Z' });
    const { model, calls } = mockModel(answer('Roof work may follow this permit.', 'roofing'));
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(0);
    expect(s.reason).toBe('cap_reached');
  });

  it('pickWithinLimit: permit and civic oldest first up to 75% of the limit, the rest newest first, unused room flows over', () => {
    const items = [
      { n: 'o1', kind: 'alert', occurredAt: '2026-11-19T10:00:00Z' },
      { n: 'o2', kind: 'alert', occurredAt: '2026-11-19T09:00:00Z' },
      { n: 'p-new', kind: 'permit', occurredAt: '2026-11-19T08:00:00Z' },
      { n: 'c-old', kind: 'civic', occurredAt: '2026-11-10T08:00:00Z' },
      { n: 'p-mid', kind: 'permit', occurredAt: '2026-11-15T08:00:00Z' },
    ];
    expect(pickWithinLimit(items, 4).picked.map((x) => x.n)).toEqual(['c-old', 'p-mid', 'p-new', 'o1']);
    expect(pickWithinLimit(items, 2).picked.map((x) => x.n)).toEqual(['c-old', 'p-mid']);
    expect(pickWithinLimit(items, 4).deferred).toBe(1);
    expect(pickWithinLimit(items, 0)).toEqual({ picked: [], deferred: 5 });
    expect(pickWithinLimit(items, 99).deferred).toBe(0);
  });

  it('limits come from the environment, with safe defaults', () => {
    expect(runLimit({})).toBe(200);
    expect(dayLimit({})).toBe(1500);
    expect(runLimit({ AI_MAX_SIGNALS_PER_RUN: '15' })).toBe(15);
    expect(runLimit({ AI_MAX_SIGNALS_PER_RUN: 'lots' })).toBe(200);
    expect(dayLimit({ AI_MAX_SIGNALS_PER_DAY: '-4' })).toBe(1500);
  });
});

describe('item 2.5: no gateway key means nothing changes', () => {
  it('no key, no model: no call, no spend row, no day-usage read, nothing written for permits or civic', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1), civic(2)] });
    const s = await runClassify({ db: db as never, now: NOW, deadline: Date.now() + 45_000, env: {}, rematch });
    expect(s.reason).toBe('no_gateway_auth');
    expect(db.tables.holler_ai_spend).toHaveLength(0);
    expect(db.tables.holler_signal_ai).toHaveLength(0);
    expect(db.tables.holler_signals.map((x) => x.categories)).toEqual([['roofing'], ['plumbing']]);
    expect(db.calls).not.toContain('holler_ai_spend.select');
    expect(s.limits.usedToday).toBeNull();
    expect(s.byKind.permit.classified + s.byKind.civic.classified).toBe(0);
  });
});

describe('item 2.5: coverage line', () => {
  it('counts new permit and civic rows classified in the last 24 hours, ignores skip rows, and shows rows outside the 14 day window', async () => {
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
    const db = new AiFakeDb({
      holler_signals: [
        permit(1, { created_at: hoursAgo(2) }),
        permit(2, { created_at: hoursAgo(3) }),
        civic(3, { created_at: hoursAgo(5) }),
        civic(4, { created_at: hoursAgo(6), occurred_at: hoursAgo(24 * 20) }),
        permit(5, { created_at: hoursAgo(30) }), // older than 24 h: not counted
        sig(6, { kind: 'alert', source: 'nws', created_at: hoursAgo(1) }), // not permit or civic
      ],
      holler_signal_ai: [
        { signal_id: 1, origin: 'model', notes: { roofing: 'x' } },
        { signal_id: 3, origin: 'cache', notes: {} },
        { signal_id: 2, origin: 'skip', notes: {} },
        { signal_id: 5, origin: 'model', notes: {} },
      ],
    });
    const c = await loadAiCoverage(db as never, NOW);
    expect(c).toMatchObject({ status: 'ok', total: 4, classified: 2, classifiedShare: 0.5, withNote: 1, withNoteShare: 0.25, outsideWindow: 1 });
    expect(c.byKind).toEqual({ permit: { total: 2, classified: 1 }, civic: { total: 2, classified: 1 } });
    expect(aiCoverageLine(c)).toContain('2 of 4 new permit and civic rows classified (50%)');
    expect(aiCoverageLine(c)).toContain('1 are dated before the 14 day window');
  });

  it('an unreadable table is blank, never 0%; no new rows says so', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1, { created_at: NOW.toISOString() })] });
    db.failOn['holler_signal_ai.select'] = 'relation does not exist';
    const bad = await loadAiCoverage(db as never, NOW);
    expect(bad.status).toBe('unavailable');
    expect(bad.classifiedShare).toBeNull();
    expect(aiCoverageLine(bad)).toMatch(/unavailable/);
    const empty = await loadAiCoverage(new AiFakeDb() as never, NOW);
    expect(empty).toMatchObject({ status: 'ok', total: 0, classifiedShare: null });
    expect(aiCoverageLine(empty)).toMatch(/no new permit or civic rows/);
  });
});
