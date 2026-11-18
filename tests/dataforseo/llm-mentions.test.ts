import { describe, expect, it, vi } from 'vitest';
import { DOMAIN_LABEL, QUERIES, TARGET_DOMAIN, evaluateResult, runLlmMentions } from '../../lib/dataforseo/llm-mentions';
import { MONTH, deps, jsonRes, okBody } from './helpers';

const item = (over: Record<string, unknown> = {}) => ({ platform: 'google', question: 'how to find roofing leads', answer: 'Use permits.', sources: [{ domain: 'example.com', url: 'https://example.com/x' }], ai_search_volume: 50, brand_entities: [], ...over });

describe('evaluateResult', () => {
  it('cited: our domain is a source (also www and subdomains)', () => {
    for (const s of [{ domain: 'localholler.com' }, { domain: 'www.localholler.com' }, { url: 'https://app.localholler.com/p' }, { domain: 'LocalHoller.com' }]) {
      expect(evaluateResult({ total_count: 1, items: [item({ sources: [s] })] }).status).toBe('cited');
    }
  });

  it('look-alike domains are not ours', () => {
    expect(evaluateResult({ total_count: 1, items: [item({ sources: [{ domain: 'notlocalholler.com.evil.test' }, { url: 'https://localholler.com.evil.test/' }] })] }).status).toBe('not_found');
  });

  it('mentioned: brand in the answer or in brand entities, not cited', () => {
    expect(evaluateResult({ total_count: 1, items: [item({ answer: 'Try LocalHoller for alerts.' })] })).toMatchObject({ status: 'mentioned', cited: false, mentioned: true });
    expect(evaluateResult({ total_count: 1, items: [item({ brand_entities: [{ title: 'localholler.com' }] })] }).status).toBe('mentioned');
  });

  it('no_data when nothing matched the query, not_found when answers exist without us', () => {
    expect(evaluateResult({ total_count: 0, items: [] }).status).toBe('no_data');
    expect(evaluateResult({ total_count: 12, items: [item(), item()] }).status).toBe('not_found');
  });

  it('domain check: a positive total counts as cited even if rows carry no sources', () => {
    expect(evaluateResult({ total_count: 3, items: [] }, { domainCheck: true }).status).toBe('cited');
    expect(evaluateResult({ total_count: 0, items: [] }, { domainCheck: true }).status).toBe('no_data');
  });

  it('raw is trimmed: no answer text, at most 5 matches, question cut to 200', () => {
    const many = Array.from({ length: 9 }, (_, i) => item({ question: 'q'.repeat(500) + i, answer: 'long answer mentioning localholler ' + 'x'.repeat(5000), sources: [{ domain: TARGET_DOMAIN, url: 'https://localholler.com/' + 'u'.repeat(600) }] }));
    const v = evaluateResult({ total_count: 9, items: many });
    expect(v.raw.matches).toHaveLength(5);
    expect(v.raw.matches[0].question!.length).toBe(200);
    expect(v.raw.matches[0].source_url!.length).toBe(300);
    const s = JSON.stringify(v.raw);
    expect(s).not.toContain('long answer');
    expect(s.length).toBeLessThan(4000);
  });

  it('fails soft on junk', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { items: 'no' }, { total_count: 'many', items: [null, 3, 'x', { sources: 'no', brand_entities: 7 }] }]) {
      expect(() => evaluateResult(bad)).not.toThrow();
    }
    expect(evaluateResult(null).status).toBe('no_data');
  });
});

describe('runLlmMentions', () => {
  it('stays within 10 calls and one entity per target', () => {
    expect(QUERIES.length + 1).toBeLessThanOrEqual(10);
  });

  it('not_configured: nothing happens', async () => {
    const { d, db, fetch } = deps({ env: {} });
    expect((await runLlmMentions({ deps: d })).status).toBe('not_configured');
    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it('checks each query once, stores a trimmed row and the real cost, and posts to the search_mentions path', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const t = JSON.parse(String(init.body))[0];
      const isDomain = Boolean(t.target[0].domain);
      return jsonRes(okBody([{ total_count: isDomain ? 2 : 1, items_count: 1, items: [item({ answer: 'Holler is localholler.com' })] }], 0.11));
    });
    const { d, db } = deps({ fetch: f });
    const r = await runLlmMentions({ deps: d });
    expect(r).toMatchObject({ status: 'done', checked: QUERIES.length + 1, failed: 0, skipped: 0 });
    expect(r.spentUsd).toBeCloseTo(0.11 * (QUERIES.length + 1), 5);
    const urls = f.mock.calls.map((c) => c[0]);
    expect(new Set(urls)).toEqual(new Set(['https://api.dataforseo.com/v3/ai_optimization/llm_mentions/search_mentions/live']));
    const bodies = f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))[0]);
    expect(bodies.every((b) => b.target.length === 1 && b.location_code === 2840 && b.limit <= 25)).toBe(true);
    expect(bodies.find((b) => b.target[0].domain)?.target[0].domain).toBe('localholler.com');
    const rows = db.tables.holler_llm_mentions;
    expect(rows).toHaveLength(QUERIES.length + 1);
    expect(rows.every((x) => x.month === MONTH && x.mentioned === true && x.cost_usd === 0.11)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('Holler is localholler.com'); // answer text is not kept
    expect(rows.find((x) => x.query === DOMAIN_LABEL)?.status).toBe('cited');
  });

  it('skips queries already stored this month (resume) and spends nothing when all are stored', async () => {
    const f = vi.fn(async () => jsonRes(okBody([{ total_count: 0, items: [] }], 0.1)));
    const { d, db } = deps({ fetch: f });
    for (const q of [...QUERIES, DOMAIN_LABEL].slice(0, 4)) db.tables.holler_llm_mentions.push({ month: MONTH, query: q, status: 'no_data' });
    const r = await runLlmMentions({ deps: d });
    expect(r).toMatchObject({ checked: QUERIES.length + 1 - 4, skipped: 4 });
    expect(f).toHaveBeenCalledTimes(QUERIES.length + 1 - 4);
    const again = await runLlmMentions({ deps: d });
    expect(again).toMatchObject({ checked: 0, skipped: QUERIES.length + 1, status: 'done' });
    expect(f).toHaveBeenCalledTimes(QUERIES.length + 1 - 4);
  });

  it('the cap applies: no call over the cap, status cap_reached, failed queries are not stored', async () => {
    const f = vi.fn(async () => jsonRes(okBody([{ total_count: 0, items: [] }], 0.12)));
    const { d, db } = deps({ fetch: f, env: { DATAFORSEO_LOGIN: 'a', DATAFORSEO_PASSWORD: 'b', DATAFORSEO_MONTHLY_CAP_USD: '0.2' } });
    const r = await runLlmMentions({ deps: d });
    expect(r.status).toBe('cap_reached');
    expect(f.mock.calls.length).toBeLessThan(QUERIES.length + 1);
    expect(db.tables.holler_llm_mentions.length).toBe(r.checked);
    expect(r.failed).toBeGreaterThan(0);
  });

  it('an API error on one query does not stop the others and is not stored', async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 2 ? new Response('', { status: 400 }) : jsonRes(okBody([{ total_count: 0, items: [] }], 0.1))));
    const { d, db } = deps({ fetch: f });
    const r = await runLlmMentions({ deps: d });
    expect(r).toMatchObject({ status: 'partial', failed: 1, checked: QUERIES.length });
    expect(db.tables.holler_llm_mentions).toHaveLength(QUERIES.length);
  });
});
