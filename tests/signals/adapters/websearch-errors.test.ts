import { describe, expect, it } from 'vitest';
import { adapters as webAdapters, braveTuning, errorDetail, redactSecrets } from '@/lib/signals/adapters/websearch';

// Objective B (round 17): the reason an API gives for a refused request is logged, secrets are stripped, and a refused key ends the
// run after two queries. Fake responses only.

braveTuning.spacingMs = 0;
const NOW = new Date('2026-11-22T12:00:00Z');
const SERPER_KEY = 'serper-secret-key-1234567890abcdef';
const BRAVE_KEY = 'BSAbravesecretkeyvalue0123456789';

type Call = { url: string };
async function run(adapter: (typeof webAdapters)[number], f: (n: number) => Response, env: Record<string, string>) {
  const logs: string[] = [];
  const calls: Call[] = [];
  const fetchImpl = (async (u: unknown) => {
    calls.push({ url: String(u) });
    return f(calls.length);
  }) as unknown as typeof fetch;
  const out = await adapter.fetch({ since: NOW, now: NOW, fetch: fetchImpl, env, log: (m) => logs.push(m) });
  return { out, logs, calls };
}
const serper = webAdapters[1];
const brave = webAdapters[0];
const serperEnv = { SERPER_API_KEY: SERPER_KEY };
const braveEnv = { BRAVE_SEARCH_API_KEY: BRAVE_KEY };

describe('errorDetail', () => {
  it('takes the message field of a JSON body: "Not enough credits"', async () => {
    expect(await errorDetail(new Response('{"message":"Not enough credits","statusCode":400}', { status: 400 }))).toBe('Not enough credits');
  });
  it('Brave style nested error detail', async () => {
    const body = { type: 'ErrorResponse', error: { id: 'x', status: 422, code: 'VALIDATION', detail: 'Unable to validate request parameter(s)' } };
    expect(await errorDetail(new Response(JSON.stringify(body), { status: 422 }))).toBe('Unable to validate request parameter(s)');
  });
  it('plain text is collapsed and cut to 200 characters; an HTML page and an empty body give nothing', async () => {
    const long = `bad   request\n${'word '.repeat(200)}`;
    const d = await errorDetail(new Response(long, { status: 400 }));
    expect(d.length).toBeLessThanOrEqual(200);
    expect(d.startsWith('bad request word')).toBe(true);
    expect(await errorDetail(new Response('<html><body>blocked</body></html>', { status: 403 }))).toBe('');
    expect(await errorDetail(new Response('', { status: 400 }))).toBe('');
  });
  it('reads only the start of a huge body', async () => {
    const huge = `{"message":"Quota exceeded"}${' '.repeat(5_000_000)}`;
    expect(await errorDetail(new Response(huge, { status: 400 }))).toBe('Quota exceeded');
  });
  it('strips anything that looks like a key', async () => {
    const cases = [
      `{"message":"Invalid key ${SERPER_KEY}"}`,
      '{"message":"Bad header X-API-KEY: abc123def456"}',
      '{"message":"api_key=short-but-labelled rejected"}',
      '{"message":"Authorization: Bearer abcdefghijklmnop failed"}',
      '{"message":"token sk-live-ABCDEFGHIJKLMNOP is not valid"}',
      '{"message":"unknown subscription 0123456789abcdef0123456789abcdef"}',
    ];
    for (const c of cases) {
      const d = await errorDetail(new Response(c, { status: 401 }), [SERPER_KEY]);
      expect(d, c).not.toMatch(/serper-secret|abc123def456|short-but-labelled|abcdefghijklmnop|ABCDEFGHIJKLMNOP|0123456789abcdef/);
      expect(d).toContain('[removed]');
    }
    expect(redactSecrets('Not enough credits')).toBe('Not enough credits');
    expect(redactSecrets('my short key here', ['short key'])).toBe('my [removed] here');
  });
});

describe('websearch error detail in the log', () => {
  it('Serper HTTP 400 logs the reason: "HTTP 400: Not enough credits"', async () => {
    const r = await run(serper, () => new Response('{"message":"Not enough credits","statusCode":400}', { status: 400 }), serperEnv);
    expect(r.logs.some((l) => l === 'error: websearch-serper HTTP 400: Not enough credits')).toBe(true);
  });
  it('Brave non-2xx logs the reason too', async () => {
    const body = { type: 'ErrorResponse', error: { code: 'RATE_LIMITED', detail: 'Request rate limit exceeded for plan' } };
    const r = await run(brave, () => new Response(JSON.stringify(body), { status: 500 }), braveEnv);
    expect(r.logs.some((l) => l.includes('websearch-brave HTTP 500: Request rate limit exceeded for plan'))).toBe(true);
    const r429 = await run(brave, () => new Response(JSON.stringify(body), { status: 429 }), braveEnv);
    expect(r429.logs.some((l) => /HTTP 429: Request rate limit exceeded for plan/.test(l))).toBe(true);
    const r401 = await run(brave, () => new Response('{"message":"Subscription token invalid"}', { status: 401 }), braveEnv);
    expect(r401.logs.some((l) => l.includes('HTTP 401: Subscription token invalid, check BRAVE_SEARCH_API_KEY'))).toBe(true);
  });
  it('a key echoed by the API never reaches the log (both providers)', async () => {
    const rs = await run(serper, () => new Response(`{"message":"bad key ${SERPER_KEY} for plan"}`, { status: 400 }), serperEnv);
    const rb = await run(brave, () => new Response(`{"error":{"detail":"bad token ${BRAVE_KEY} sent"}}`, { status: 422 }), braveEnv);
    for (const l of [...rs.logs, ...rb.logs]) expect(l).not.toMatch(/serper-secret|bravesecretkey/);
    expect(rs.logs.some((l) => l.includes('HTTP 400: bad key [removed] for plan'))).toBe(true);
    expect(rb.logs.some((l) => l.includes('HTTP 422: bad token [removed] sent'))).toBe(true);
  });
  it('no body: the log keeps the old form "HTTP 400"', async () => {
    const r = await run(serper, () => new Response('', { status: 400 }), serperEnv);
    expect(r.logs.some((l) => l === 'error: websearch-serper HTTP 400')).toBe(true);
  });
});

describe('websearch stops early when the key is refused', () => {
  for (const status of [400, 401, 403]) {
    it(`Serper: first 2 queries both HTTP ${status}: only 2 requests are sent`, async () => {
      const r = await run(serper, () => new Response('{"message":"Not enough credits"}', { status }), serperEnv);
      expect(r.calls).toHaveLength(2);
      expect(r.out).toEqual([]);
    });
  }
  it('Serper 400 twice logs the stop once, with the count not sent', async () => {
    const r = await run(serper, () => new Response('{"message":"Not enough credits"}', { status: 400 }), serperEnv);
    const stops = r.logs.filter((l) => /first 2 queries both refused/.test(l));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatch(/HTTP 400 and 400/);
    expect(stops[0]).toMatch(/\d+ queries not sent/);
    // the two 400 lines carry the reason, the stop line is the only extra line
    expect(r.logs.filter((l) => l.includes('HTTP 400: Not enough credits'))).toHaveLength(2);
  });
  it('Brave (paced, one request at a time): two 400s in a row stop the run after the second request', async () => {
    const r = await run(brave, () => new Response('{"error":"bad"}', { status: 400 }), braveEnv);
    expect(r.calls).toHaveLength(2);
    expect(r.logs.filter((l) => /first 2 queries both refused/.test(l))).toHaveLength(1);
  });
  it('one refused and one good does not stop the run', async () => {
    const good = { organic: [{ title: 'Looking for a roofer in Smyrna', link: 'https://example.test/a', snippet: 'Anyone know a good roofer near Smyrna GA?' }] };
    const r = await run(serper, (n) => (n === 1 ? new Response('{"message":"x"}', { status: 400 }) : new Response(JSON.stringify(good), { status: 200 })), serperEnv);
    expect(r.calls.length).toBeGreaterThan(2);
    expect(r.logs.filter((l) => /first 2 queries both refused/.test(l))).toHaveLength(0);
  });
  it('500s are not refusals: the run is not cut short by them', async () => {
    const r = await run(serper, () => new Response('oops', { status: 500 }), serperEnv);
    expect(r.calls.length).toBeGreaterThan(2);
  });
});
