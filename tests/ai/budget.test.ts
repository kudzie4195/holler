import { describe, expect, it } from 'vitest';
import {
  alertFlags,
  claimAlert,
  costUsd,
  DEFAULT_AI_MONTHLY_CAP_USD,
  monthlyCapUsd,
  monthSpendUsd,
  releaseAlert,
  reserve,
  settle,
  worstCaseUsd,
} from '../../lib/ai/budget';
import { AiFakeDb, MONTH } from './fake-db';

const db = (rows: Record<string, unknown>[] = []) => new AiFakeDb({ holler_ai_spend: rows });

describe('prices and estimates', () => {
  it('$0.10 per M input and $0.50 per M output', () => {
    expect(costUsd(1_000_000, 0)).toBe(0.1);
    expect(costUsd(0, 1_000_000)).toBe(0.5);
    expect(costUsd(6000, 3800)).toBe(0.0025);
  });
  it('worst case: characters / 3 for input, the full max output', () => {
    expect(worstCaseUsd(9000, 4000)).toBe(costUsd(3000, 4000));
  });
  it('cap from env, default 10, junk falls back', () => {
    expect(DEFAULT_AI_MONTHLY_CAP_USD).toBe(10);
    expect(monthlyCapUsd({})).toBe(10);
    expect(monthlyCapUsd({ AI_MONTHLY_CAP_USD: '25' })).toBe(25);
    expect(monthlyCapUsd({ AI_MONTHLY_CAP_USD: 'lots' })).toBe(10);
    expect(monthlyCapUsd({ AI_MONTHLY_CAP_USD: '-1' })).toBe(10);
  });
});

describe('reserve and settle', () => {
  it('reserves the worst case, then settles to the reported usage', async () => {
    const d = db();
    const r = await reserve(d as never, { month: MONTH, capUsd: 10, signals: 24, inputChars: 9000, maxOutputTokens: 3800 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(d.tables.holler_ai_spend[0]).toMatchObject({ kind: 'reserved', signals: 24, input_tokens: 3000, output_tokens: 3800, cost_usd: r.estimateUsd });
    const c = await settle(d as never, r.id, { kind: 'classify', inputTokens: 2500, outputTokens: 1500, estimateUsd: r.estimateUsd });
    expect(c).toBe(costUsd(2500, 1500));
    expect(d.tables.holler_ai_spend[0]).toMatchObject({ kind: 'classify', input_tokens: 2500, output_tokens: 1500, cost_usd: c });
    expect(await monthSpendUsd(d as never, MONTH)).toBe(c);
  });

  it('a higher gateway-reported cost wins, a lower one does not', async () => {
    const d = db();
    const r = await reserve(d as never, { month: MONTH, capUsd: 10, signals: 1, inputChars: 300, maxOutputTokens: 350 });
    if (!r.ok) throw new Error('reserve');
    expect(await settle(d as never, r.id, { kind: 'classify', inputTokens: 100, outputTokens: 100, gatewayCostUsd: 0.5, estimateUsd: r.estimateUsd })).toBe(0.5);
    const r2 = await reserve(d as never, { month: MONTH, capUsd: 10, signals: 1, inputChars: 300, maxOutputTokens: 350 });
    if (!r2.ok) throw new Error('reserve');
    expect(await settle(d as never, r2.id, { kind: 'classify', inputTokens: 100, outputTokens: 100, gatewayCostUsd: 0, estimateUsd: r2.estimateUsd })).toBe(costUsd(100, 100));
  });

  it('a timeout keeps the worst-case estimate (unknown)', async () => {
    const d = db();
    const r = await reserve(d as never, { month: MONTH, capUsd: 10, signals: 24, inputChars: 9000, maxOutputTokens: 3800 });
    if (!r.ok) throw new Error('reserve');
    await settle(d as never, r.id, { kind: 'unknown' });
    expect(d.tables.holler_ai_spend[0]).toMatchObject({ kind: 'unknown', cost_usd: r.estimateUsd });
  });

  it('refuses with cap_reached when month total plus the reservation would pass the cap; the refused row costs 0', async () => {
    const d = db([{ id: 100, month: MONTH, kind: 'classify', cost_usd: 9.999 }]);
    const r = await reserve(d as never, { month: MONTH, capUsd: 10, signals: 24, inputChars: 9000, maxOutputTokens: 3800 });
    expect(r).toMatchObject({ ok: false, reason: 'cap_reached', capUsd: 10, spentUsd: 9.999 });
    expect(d.tables.holler_ai_spend.find((x) => x.id !== 100)).toMatchObject({ kind: 'refused', cost_usd: 0 });
    expect(await monthSpendUsd(d as never, MONTH)).toBe(9.999);
  });

  it('another month does not count', async () => {
    const d = db([{ id: 100, month: '2026-10-01', kind: 'classify', cost_usd: 50 }]);
    expect((await reserve(d as never, { month: MONTH, capUsd: 10, signals: 1, inputChars: 10, maxOutputTokens: 10 })).ok).toBe(true);
  });

  it('two overlapping runs cannot pass the cap together (insert, then sum)', async () => {
    // Room for exactly one reservation. Run B inserts its reservation right after run A's insert, before A sums.
    const d = db([{ id: 100, month: MONTH, kind: 'classify', cost_usd: 9.997 }]);
    let injected = false;
    d.onSpendInsert = () => {
      if (injected) return;
      injected = true;
      void reserve(d as never, { month: MONTH, capUsd: 10, signals: 24, inputChars: 9000, maxOutputTokens: 3800 }).then((b) => (resB = b));
    };
    let resB: Awaited<ReturnType<typeof reserve>> | undefined;
    const resA = await reserve(d as never, { month: MONTH, capUsd: 10, signals: 24, inputChars: 9000, maxOutputTokens: 3800 });
    await new Promise((r) => setTimeout(r, 10));
    const okCount = [resA, resB].filter((x) => x?.ok).length;
    expect(resB).toBeDefined();
    expect(okCount).toBeLessThanOrEqual(1);
    expect(await monthSpendUsd(d as never, MONTH)).toBeLessThanOrEqual(10);
  });

  it('many concurrent reservations never book more than the cap', async () => {
    const d = db();
    const all = await Promise.all(
      Array.from({ length: 40 }, () => reserve(d as never, { month: MONTH, capUsd: 0.02, signals: 24, inputChars: 9000, maxOutputTokens: 3800 })),
    );
    // Near the cap every racing reservation may refuse (the safe side); the books never pass the cap.
    expect(all.every((x) => x.ok || x.reason === 'cap_reached')).toBe(true);
    expect(await monthSpendUsd(d as never, MONTH)).toBeLessThanOrEqual(0.02);
    // Far from the cap, concurrency refuses nothing.
    const f = db();
    const far = await Promise.all(
      Array.from({ length: 40 }, () => reserve(f as never, { month: MONTH, capUsd: 10, signals: 24, inputChars: 9000, maxOutputTokens: 3800 })),
    );
    expect(far.every((x) => x.ok)).toBe(true);
  });

  it('fails closed when spend cannot be written or read', async () => {
    const d = db();
    d.failOn['holler_ai_spend.insert'] = 'relation "holler_ai_spend" does not exist';
    expect(await reserve(d as never, { month: MONTH, capUsd: 10, signals: 1, inputChars: 10, maxOutputTokens: 10 })).toMatchObject({ ok: false, reason: 'spend_unavailable' });
    const e = db();
    e.failOn['holler_ai_spend.select'] = 'boom';
    e.failOn['rpc.holler_ai_month_spend'] = 'boom';
    expect(await reserve(e as never, { month: MONTH, capUsd: 10, signals: 1, inputChars: 10, maxOutputTokens: 10 })).toMatchObject({ ok: false, reason: 'spend_unavailable' });
    expect(e.tables.holler_ai_spend[0]).toMatchObject({ kind: 'refused', cost_usd: 0 });
  });
});

describe('alerts', () => {
  it('flags at 80% and at the cap', () => {
    expect(alertFlags(7.99, 10, false)).toEqual([]);
    expect(alertFlags(8, 10, false)).toEqual(['alert_80']);
    expect(alertFlags(9.5, 10, true)).toEqual(['alert_80', 'alert_100']);
    expect(alertFlags(10, 10, false)).toEqual(['alert_80', 'alert_100']);
    expect(alertFlags(0, 0, false)).toEqual([]);
  });

  it('each threshold is claimed once per month; release lets a later run retry', async () => {
    const d = db();
    expect(await claimAlert(d as never, MONTH, 'alert_80')).toBe(true);
    expect(await claimAlert(d as never, MONTH, 'alert_80')).toBe(false);
    expect(await claimAlert(d as never, MONTH, 'alert_100')).toBe(true);
    expect(await claimAlert(d as never, '2026-12-01', 'alert_80')).toBe(true);
    await releaseAlert(d as never, MONTH, 'alert_80');
    expect(await claimAlert(d as never, MONTH, 'alert_80')).toBe(true);
    expect(await monthSpendUsd(d as never, MONTH)).toBe(0);
  });
});
