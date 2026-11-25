import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, DEFAULT_CLASSIFY_MODEL, normalizeForKey, PROMPT_V, runClassify, SKIP_SOURCES, type RunOptions } from '../../lib/ai/classify';
import { scoresFor } from '../../lib/ai';
import { AiFakeDb, NOW, sig } from './fake-db';
import { goodAnswer, mockModel } from './mock-model';

const M = DEFAULT_CLASSIFY_MODEL;
const rematch = vi.fn(async (_db: unknown, ids: number[]): Promise<{ created: number; error?: string }> => ({ created: ids.length }));
beforeEach(() => {
  rematch.mockClear();
});
const opts = (db: AiFakeDb, model: RunOptions['model'], over: Partial<RunOptions> = {}): RunOptions => ({
  db: db as never, now: NOW, deadline: Date.now() + 45_000, env: {}, model, rematch, concurrency: 3, ...over,
});
const keyOf = (row: Record<string, unknown>) => cacheKey(row as never, M);

describe('cache key', () => {
  // Review r3 P1: stripping addresses, units and digits joined records that differ in a trade word, so the key now keeps every word
  // and every digit; only case and whitespace are normalized (tests/ai/r3-review.test.ts has the collision cases).
  it('normalizes only case and spaces: digits, ZIP codes, addresses and units stay', () => {
    expect(normalizeForKey('  Re-Roof at 1234 N Main St, Apt 4B,  Smyrna GA 30080-1234 #12 ')).toBe('re-roof at 1234 n main st, apt 4b, smyrna ga 30080-1234 #12');
    expect(normalizeForKey('Permit\t2026-000123:   55 Peachtree')).toBe('permit 2026-000123: 55 peachtree');
    expect(normalizeForKey(null)).toBe('');
  });

  it('the same text in other case or spacing gives the same key; any other change gives another key', () => {
    const a = { source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit', title: 'RESIDENTIAL REROOF at 1234 N Main St', summary: 'Tear off and replace, 2 layers. 60614' };
    const b = { ...a, title: 'Residential reroof  at 1234 n main st', summary: 'tear off   and replace, 2 layers. 60614' };
    const k = cacheKey(a, M);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey(b, M)).toBe(k);
    expect(cacheKey({ ...a, title: 'Residential reroof at 99 W Oak Ave' }, M)).not.toBe(k);
    expect(cacheKey({ ...a, summary: 'Tear off and replace, 3 layers. 60614' }, M)).not.toBe(k);
    expect(cacheKey({ ...a, source: 'socrata-nyc-permits' }, M)).not.toBe(k);
    expect(cacheKey({ ...a, kind: 'civic' }, M)).not.toBe(k);
    expect(cacheKey({ ...a, subtype: '311' }, M)).not.toBe(k);
    expect(cacheKey({ ...a, title: 'Residential solar install' }, M)).not.toBe(k);
    expect(cacheKey({ ...a, summary: 'New construction' }, M)).not.toBe(k);
    expect(cacheKey(a, 'anthropic/other-model')).not.toBe(k);
    expect(cacheKey(a, M, PROMPT_V + 1)).not.toBe(k);
  });
});

describe('skipped sources', () => {
  it('the skip list is the real registry ids, plus resident requests', async () => {
    const { ALL_ADAPTERS } = await import('../../lib/signals/registry');
    const { HOLLER_REQUEST_SOURCE } = await import('../../lib/signals/request-visibility');
    const ids = new Set(ALL_ADAPTERS.map((a) => a.id));
    for (const s of SKIP_SOURCES) if (s !== HOLLER_REQUEST_SOURCE) expect(ids.has(s), s).toBe(true);
    // Round 33: NWS local storm reports (lsr) are weather, like spc.
    expect([...SKIP_SOURCES].sort()).toEqual(['faa', 'fema', 'holler-request', 'lsr', 'nws', 'spc', 'usgs']);
  });

  it('a resident request never goes to the model', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1, { source: 'holler-request', kind: 'request', categories: ['plumbing'] })] });
    const { model, calls } = mockModel(goodAnswer);
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(0);
    expect(s).toMatchObject({ skipped: 1, sentToModel: 0 });
    expect(db.tables.holler_signal_ai.every((r) => r.origin === 'skip')).toBe(true);
    expect(db.tables.holler_signals[0].categories).toEqual(['plumbing']);
  });

  it('never go to the model, are stored empty as skip, need no gateway, rank as unknown', async () => {
    const db = new AiFakeDb({
      holler_signals: ['nws', 'spc', 'fema', 'usgs', 'faa'].map((source, i) => sig(i + 1, { source, kind: 'alert', categories: ['roofing'] })),
    });
    const { model, calls } = mockModel(goodAnswer);
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(0);
    expect(s).toMatchObject({ skipped: 5, cacheHits: 0, cacheMisses: 0, sentToModel: 0, signalsClassified: 5, signalsApplied: 0, reason: null });
    expect(db.tables.holler_signal_ai.every((r) => r.origin === 'skip' && r.model === 'skip' && Object.keys(r.trades).length === 0)).toBe(true);
    expect(db.tables.holler_signals.every((r) => r.categories.join() === 'roofing' && !r.data.cat_src)).toBe(true);
    expect(rematch).not.toHaveBeenCalled();
    expect(db.tables.holler_ai_spend).toEqual([expect.objectContaining({ kind: 'run', signals: 5, skipped: 5, cost_usd: 0 })]);
    expect((await scoresFor(db as never, [1, 2, 3, 4, 5], ['roofing'])).size).toBe(0);
    // without gateway auth too
    const db2 = new AiFakeDb({ holler_signals: [sig(1, { source: 'nws' })] });
    const s2 = await runClassify({ db: db2 as never, now: NOW, deadline: Date.now() + 45_000, env: {}, rematch });
    expect(s2.reason).toBeNull();
    expect(db2.tables.holler_signal_ai).toHaveLength(1);
  });
});

describe('result cache', () => {
  it('a hit is written with no model call and zero cost, applies categories, counts the hit', async () => {
    const s1 = sig(1);
    const db = new AiFakeDb({
      holler_signals: [s1],
      holler_ai_cache: [{ key: keyOf(s1), trades: { roofing: 0.9 }, notes: { roofing: 'Roofs here may need a close look soon.' }, model: M, prompt_v: 1, hits: 0 }],
    });
    const { model, calls } = mockModel(goodAnswer);
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(0);
    expect(s).toMatchObject({ cacheHits: 1, cacheMisses: 0, sentToModel: 0, signalsClassified: 1, signalsApplied: 1 });
    expect(s.spend.costUsd).toBe(0);
    expect(db.tables.holler_signal_ai[0]).toMatchObject({ origin: 'cache', trades: { roofing: 0.9 }, notes: { roofing: 'Roofs here may need a close look soon.' } });
    expect(db.tables.holler_signals[0].categories).toEqual(['roofing']);
    expect(rematch).toHaveBeenCalledWith(db, [1]);
    expect(db.tables.holler_ai_cache[0].hits).toBe(1);
    expect(db.tables.holler_ai_spend.filter((r) => r.kind !== 'run')).toHaveLength(0);
    expect(db.tables.holler_ai_spend.find((r) => r.kind === 'run')).toMatchObject({ signals: 1, cache_hits: 1, cache_misses: 0 });
  });

  it("a cached note must pass every rule against THIS signal's input, else it is dropped (trades kept)", async () => {
    const atl = sig(2, { title: 'Roof permit for a single family home', summary: 'Replace roof shingles.', city: 'Atlanta' });
    const db = new AiFakeDb({
      holler_signals: [atl],
      holler_ai_cache: [
        // written for another record: a number and a city that are not in this one
        { key: keyOf(atl), trades: { roofing: 0.9, 'siding-gutters': 0.7 }, notes: { roofing: 'Hail of 1.75 inch may mean more roof work soon.', 'siding-gutters': 'Gutters near Smyrna may need a look.' }, model: M, prompt_v: 1, hits: 0 },
      ],
    });
    const s = await runClassify(opts(db, mockModel(goodAnswer).model));
    expect(db.tables.holler_signal_ai[0]).toMatchObject({ origin: 'cache', trades: { roofing: 0.9, 'siding-gutters': 0.7 }, notes: {} });
    expect(s.notesDropped).toBe(2);
  });

  it('a cached unknown trade or bad confidence is dropped like fresh model output', async () => {
    const s3 = sig(3);
    const db = new AiFakeDb({ holler_signals: [s3], holler_ai_cache: [{ key: keyOf(s3), trades: { admin: 1, roofing: 7, hvac: 0.5 }, notes: { admin: 'x' }, model: M, prompt_v: 1, hits: 0 }] });
    await runClassify(opts(db, mockModel(goodAnswer).model));
    expect(db.tables.holler_signal_ai[0]).toMatchObject({ trades: { hvac: 0.5 }, notes: {} });
  });

  it('misses go to the model and fill the cache; the next signal with the same text is a hit', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1), sig(2)] });
    const { model, calls } = mockModel(goodAnswer);
    await runClassify(opts(db, model));
    expect(calls).toHaveLength(1);
    expect(db.tables.holler_ai_cache.map((c) => c.key).sort()).toEqual([keyOf(sig(1)), keyOf(sig(2))].sort());
    expect(db.tables.holler_ai_cache[0]).toMatchObject({ trades: { roofing: 0.9, 'auto-body': 0.5 }, model: M, prompt_v: 2 });
    // a new record with the same text, in other case and spacing (another address or number would be a new key)
    db.tables.holler_signals.push(sig(3, { title: sig(1).title.toUpperCase(), summary: `  ${sig(1).summary}  ` }));
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(1);
    expect(s.cacheHits).toBe(1);
    expect(db.tables.holler_signal_ai.find((r) => r.signal_id === 3)!.origin).toBe('cache');
  });

  it('one model call per distinct key per run: followers take the result, with their own note check', async () => {
    // Followers have the same text in other case and spacing, so the same numbers: the rep's note passes their own check too.
    const kinds = ['alpha', 'bravo', 'charlie'];
    const rows = Array.from({ length: 30 }, (_, i) =>
      sig(i + 1, { occurred_at: new Date(NOW.getTime() - (30 - i) * 60_000).toISOString(), title: i < 3 ? `Reroof permit ${kinds[i % 3]} at Main St` : `REROOF permit  ${kinds[i % 3].toUpperCase()} at main st`, summary: i < 3 ? `Replace roof, ${i + 2} squares.` : `replace roof,  ${(i % 3) + 2} squares.` }),
    );
    const db = new AiFakeDb({ holler_signals: rows });
    const { model, calls } = mockModel((ids) => ({
      results: ids.map((id) => ({ id, trades: [{ trade: 'roofing', p: 0.9 }], notes: [{ trade: 'roofing', why: `Roofs may need ${id + 1} squares of shingles soon.` }] })),
    }));
    const s = await runClassify(opts(db, model));
    expect(calls.flatMap((c) => c.ids)).toHaveLength(3);
    expect(s).toMatchObject({ cacheMisses: 30, sentToModel: 3, dedupedInRun: 27, signalsClassified: 30 });
    expect(db.tables.holler_signal_ai.filter((r) => r.origin === 'model')).toHaveLength(3);
    expect(db.tables.holler_signal_ai.filter((r) => r.origin === 'cache')).toHaveLength(27);
    // each follower got its representative's note, checked against its own input (same numbers, so it passes)
    for (const r of db.tables.holler_signal_ai.filter((x) => x.origin === 'cache')) {
      const rep = ((r.signal_id - 1) % 3) + 1;
      expect(r.notes).toEqual({ roofing: `Roofs may need ${rep + 1} squares of shingles soon.` });
    }
    for (const r of db.tables.holler_signal_ai.filter((x) => x.origin === 'model')) expect(Object.keys(r.notes)).toEqual(['roofing']);
    expect(db.tables.holler_ai_spend.find((r) => r.kind === 'classify')).toMatchObject({ signals: 3, cache_hits: 27, cache_misses: 30 });
    expect(db.tables.holler_ai_spend.find((r) => r.kind === 'run')).toMatchObject({ signals: 30, cache_hits: 27, cache_misses: 3, skipped: 0 });
    expect(s.spend.usdPer1kSignals).toBeCloseTo((s.spend.costUsd * 1000) / 30, 6);
    expect(s.spend.usdPer1kModelSignals).toBeCloseTo((s.spend.costUsd * 1000) / 3, 6);
  });

  it('a record the model skipped is stored empty, never cached, and its followers wait', async () => {
    // permits go oldest first, so id 1 is made the oldest and is the representative
    const rows = [sig(1, { title: 'Same text', summary: 'x', occurred_at: new Date(NOW.getTime() - 120_000).toISOString() }), sig(2, { title: 'Same text', summary: 'x' })];
    const db = new AiFakeDb({ holler_signals: rows });
    const { model } = mockModel(() => ({ results: [] }));
    const s = await runClassify(opts(db, model));
    expect(db.tables.holler_ai_cache).toHaveLength(0);
    expect(db.tables.holler_signal_ai.map((r) => r.signal_id)).toEqual([1]);
    expect(s.dedupedInRun).toBe(0);
  });

  it('a cache read error makes everything a miss and nothing breaks', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1)] });
    db.failOn['holler_ai_cache.select'] = 'boom';
    const { model, calls } = mockModel(goodAnswer);
    const s = await runClassify(opts(db, model));
    expect(s.cacheReadOk).toBe(false);
    expect(calls).toHaveLength(1);
    expect(s.signalsClassified).toBe(1);
  });

  it('a failed model batch writes nothing for its followers or the cache', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1, { title: 'T', summary: 's' }), sig(2, { title: 'T', summary: 's' })] });
    const { model } = mockModel(() => 'not json');
    await runClassify(opts(db, model));
    expect(db.tables.holler_signal_ai).toHaveLength(0);
    // no result is cached; the only row is the attempt counter of the one record that was sent (lib/ai/poison.ts, model 'poison-attempts')
    expect(db.tables.holler_ai_cache.filter((r) => r.model !== 'poison-attempts')).toHaveLength(0);
    expect(db.tables.holler_ai_cache).toHaveLength(1);
  });

  it('dry run reports skipped, hits, misses and what would be sent, and writes nothing', async () => {
    const s1 = sig(1);
    const db = new AiFakeDb({
      holler_signals: [s1, sig(2), sig(3, { source: 'nws' }), sig(4, { title: sig(2).title, summary: sig(2).summary })],
      holler_ai_cache: [{ key: keyOf(s1), trades: { roofing: 0.9 }, notes: {}, model: M, prompt_v: 1, hits: 0 }],
    });
    const s = await runClassify(opts(db, mockModel(goodAnswer).model, { dry: true }));
    expect(s).toMatchObject({ candidates: 4, skipped: 1, cacheHits: 1, cacheMisses: 2, sentToModel: 1, batchesPlanned: 1 });
    // the read-only SQL month total is a read too
    expect(db.calls.filter((c) => !c.endsWith('.select') && c !== 'rpc.holler_ai_month_spend')).toEqual([]);
  });

  it('old cache rows are pruned at the end of a run', async () => {
    const db = new AiFakeDb({
      holler_signals: [sig(1)],
      holler_ai_cache: [
        { key: 'a'.repeat(64), trades: {}, notes: {}, model: M, prompt_v: 1, hits: 0, created_at: new Date(NOW.getTime() - 121 * 86_400_000).toISOString() },
        { key: 'b'.repeat(64), trades: {}, notes: {}, model: M, prompt_v: 1, hits: 0, created_at: new Date(NOW.getTime() - 5 * 86_400_000).toISOString() },
      ],
    });
    await runClassify(opts(db, mockModel(goodAnswer).model));
    expect(db.tables.holler_ai_cache.map((c) => c.key)).not.toContain('a'.repeat(64));
    expect(db.tables.holler_ai_cache.map((c) => c.key)).toContain('b'.repeat(64));
  });
});
