// Round 18 integration: review 3 probe (logs/REV3-LOOKUP-probe-tests) kept as a permanent regression test. Findings fixed at integration
// (P2-1 health line, P3-1 outage stop, P3-2/P3-3 closed listings, P3-5 address forms, P3-6 address before ambiguity, P3-7 tie order) now assert
// the fixed behaviour; every other assertion is the reviewer's as written.
// REV3 probe (r18 LOOKUP redo 2, cac086d), task 4: the daily circuit breaker.
// Prints one line per check. Assertions freeze what cac086d does; DEFECT lines are discussed in review-LOOKUP-3.md.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { BREAKER_SAMPLE, LOOKUP_CONCURRENCY, OUTAGE_STOP, lookupOutage, outageMessage, nameRefusal, attachCachedListings, breakerMessage, lookupBreaker, lookupBusiness, lookupForCards, lookupSettings, newBudget } from '@/lib/enrich/business-lookup';
import type { ContactRecord } from '@/lib/contacts/types';
import { FakeDb } from '../ops/fakedb';
import { ENV, LOOKUP_URL, fakeFetch, item, jsonRes, listingsBody, newDb } from '../enrich/helpers';

const out: string[] = [];
const say = (id: string, verdict: string, note: string) => out.push(`${id.padEnd(4)} ${verdict.padEnd(10)} ${note}`);
afterAll(async () => {
   
  console.log('\n' + out.join('\n') + '\n');
  const { writeFileSync } = await import('node:fs');
  if (process.env.REV3_OUT) writeFileSync(`${process.env.REV3_OUT}/REV3-LOOKUP-breaker.txt`, out.join('\n') + '\n');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/supabase/admin');
  vi.doUnmock('@/lib/signals/registry');
  vi.doUnmock('@/lib/email');
  vi.restoreAllMocks();
});

const DAY = '2026-11-23';
const NEXT = '2026-11-24';
const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00Z`);
const TRADES = ['Roofing', 'Plumbing', 'Electric', 'Painting', 'Fencing', 'Paving', 'Masonry', 'Flooring', 'Siding'];
// made-up first words; only those the name checks accept with every trade word are used (the classifier refuses some)
const STEMS = ['Zorvex', 'Quillon', 'Brantex', 'Veltrix', 'Norvane', 'Kestrol', 'Dynavo', 'Maxtron', 'Trivane', 'Pellar', 'Oxbridge', 'Lumetra', 'Corvix', 'Halcyon', 'Stratex', 'Vantix', 'Keystone', 'Ironwood', 'Bluepeak', 'Redrock', 'Summitline', 'Tricore', 'Novatek', 'Apexline']
  .filter((w) => TRADES.every((t) => nameRefusal(`${w} ${t}`, { city: 'Atlanta', state: 'GA' }) === null))
  .slice(0, 9);
const NAMES = STEMS.map((w) => `${w} Roofing`);
const env20 = { ...ENV, HOLLER_LOOKUP_MAX_PER_RUN: '20' };
const empty = () => jsonRes(listingsBody([], 0.012));
const one = (db: unknown, name: string, when: Date, fetch: unknown, opts: Record<string, unknown> = {}) =>
  lookupBusiness({ name, city: 'Atlanta', state: 'GA' }, { db: db as never, fetch: fetch as never, env: env20, now: () => when, sleep: async () => {} }, opts);
const row = (i: number, status: string, when: Date) => ({ name_key: `seed${i} roofing`, city_key: 'atlanta', state: 'GA', status, phone: status === 'found' ? '404-555-0123' : null, website: null, listing_name: status === 'found' ? 'x' : null, cost_usd: 0.012, checked_at: when.toISOString() });

describe('4. circuit breaker', () => {
  it('the made-up names of this probe are all looked up', () => {
    expect(NAMES).toHaveLength(9);
  });

  it('4.1 stops for the UTC day after the first 5 answers with no found, whatever the refusal reason', async () => {
    const db = newDb({}, () => at('09:00'));
    // five ordinary refusals, none of them "truncated": nothing listed, another name, closed, ambiguous, too far
    const answers = [
      listingsBody([], 0.012),
      listingsBody([item({ title: 'Somebody Else Roofing' })]),
      listingsBody([item({ title: NAMES[2], work_time: { work_hours: { current_status: 'closed_forever' } } })]),
      listingsBody([item({ title: NAMES[3] }), item({ title: NAMES[3], phone: '+14045550999' })]),
      listingsBody([item({ title: NAMES[4], latitude: 34.9, longitude: -84.388 })]),
    ];
    let n = 0;
    const fetch = vi.fn(async () => jsonRes(answers[Math.min(n++, answers.length - 1)]));
    const res: string[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await one(db, NAMES[i], at(`09:0${i}`), fetch);
      res.push(r.status === 'skipped' ? `skipped:${r.reason}` : `${r.status}:${'reason' in r ? r.reason : ''}`);
    }
    expect(res).toEqual(['not_found:no_listing', 'not_found:no_match', 'not_found:closed', 'not_found:ambiguous', 'not_found:too_far', 'skipped:breaker', 'skipped:breaker']);
    expect(fetch).toHaveBeenCalledTimes(BREAKER_SAMPLE);
    expect(await lookupBreaker(db as never, at('23:59'))).toEqual({ tripped: true, tried: 5, message: breakerMessage(5) });
    // a tripped breaker books nothing and writes no claim
    expect(db.tables.holler_dataforseo_spend).toHaveLength(5);
    expect(db.tables.holler_business_lookup.filter((r) => r.status === 'retry')).toHaveLength(0);
    say('4.1', 'ok', `5 answers with no found (no_listing, no_match, closed, ambiguous, too_far) stop the day: calls 6 and 7 are skipped "breaker", no ledger row, no claim`);
    say('4.1', 'NOTE', 'the breaker counts every refusal, not only "truncated": five ordinary not-found answers in a row turn the feature off until 00:00 UTC');
  });

  it('4.2 / 4.3 it resets at 00:00 UTC, and a found on the next day is attached', async () => {
    const db = newDb({ holler_business_lookup: Array.from({ length: 5 }, (_, i) => row(i, i % 2 ? 'truncated' : 'not_found', at(`0${i}:10`))) }, () => at('00:05', '2026-11-24'));
    expect((await lookupBreaker(db as never, at('23:59:59'.slice(0, 5))))?.tripped).toBe(true);
    expect(await lookupBreaker(db as never, new Date('2026-11-23T23:59:59.999Z'))).toMatchObject({ tripped: true });
    expect(await lookupBreaker(db as never, new Date('2026-11-24T00:00:00.000Z'))).toEqual({ tripped: false, tried: 0, message: null });
    const r = await one(db, 'Peachtree Roofing LLC', at('00:05', '2026-11-24'), fakeFetch([item()]));
    expect(r).toMatchObject({ status: 'found', source: 'api' });
    say('4.2', 'ok', 'a found answer on the next UTC day is attached: yesterday\'s trip blocks nothing after 00:00 UTC');
    say('4.3', 'ok', 'tripped at 23:59:59.999Z, not tripped at 00:00:00.000Z of the next day');
    // the same business that was truncated yesterday stays blocked by its own cache row for 7 days (no call, no cost), then is asked again
    const db2 = newDb({ holler_business_lookup: [{ ...row(0, 'truncated', at('10:00')), name_key: 'apex roofing' }] });
    const f2 = fakeFetch([item({ title: 'Apex Roofing' })]);
    expect(await one(db2, 'Apex Roofing', at('10:00', '2026-11-29'), f2)).toMatchObject({ status: 'not_found', source: 'cache', reason: 'truncated' });
    expect(f2).not.toHaveBeenCalled();
    expect(await one(db2, 'Apex Roofing', at('10:01', '2026-11-30'), f2)).toMatchObject({ status: 'found', source: 'api' });
    say('4.2', 'ok', 'a truncated answer blocks only its own business, for 7 days; on day 8 it is asked again and a found is attached');
  });

  it('4.2b one found among the first 5 keeps the day open; a found as answer 6 does not reopen it', async () => {
    const seq = (s: string[]) => newDb({ holler_business_lookup: s.map((st, i) => row(i, st, at(`09:${String(i).padStart(2, '0')}`))) });
    expect(await lookupBreaker(seq(['found', 'not_found', 'not_found', 'not_found', 'not_found', 'not_found', 'not_found', 'not_found']) as never, at('12:00'))).toMatchObject({ tripped: false, tried: 8 });
    expect(await lookupBreaker(seq(['not_found', 'not_found', 'not_found', 'not_found', 'found']) as never, at('12:00'))).toMatchObject({ tripped: false });
    expect(await lookupBreaker(seq(['not_found', 'not_found', 'not_found', 'not_found', 'not_found', 'found']) as never, at('12:00'))).toMatchObject({ tripped: true, tried: 6 });
    say('4.2', 'ok', 'found among answers 1 to 5: open all day. Found as answer 6 (three calls can be in flight when answer 5 lands): still tripped for the day');
    say('4.6', 'NOTE', 'a found as answer 1 keeps the day open even if every later answer is empty: up to 24 more paid calls that day with no line (bounded by the day cap, $0.46)');
  });

  it('4.5 cached answers cost nothing and cannot trip it', async () => {
    // nine businesses answered yesterday (not_found and truncated). Today every card is a cache hit.
    const y = '2026-11-22';
    const rows = NAMES.map((n, i) => ({ ...row(i, i % 2 ? 'truncated' : 'not_found', at('15:00', y)), name_key: n.toLowerCase() }));
    const db = newDb({ holler_business_lookup: rows }, () => at('09:00'));
    const fetch = fakeFetch([item()]);
    const contacts = new Map<number, ContactRecord[]>(NAMES.map((n, i) => [i + 1, [{ signalId: i + 1, role: 'contractor', name: n, city: null, state: null }]]));
    const cards = NAMES.map((_, i) => ({ signalId: i + 1, city: 'Atlanta', state: 'GA', contact: contacts.get(i + 1)![0] }));
    const budget = newBudget(lookupSettings(env20), 60_000);
    await lookupForCards(contacts, cards, budget, { db: db as never, fetch: fetch as never, env: env20, now: () => at('09:00'), sleep: async () => {} });
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.cacheHits).toBe(9);
    expect(db.tables.holler_business_lookup.every((r) => String(r.checked_at).startsWith(y))).toBe(true); // a cache hit rewrites nothing
    expect(await lookupBreaker(db as never, at('09:01'))).toEqual({ tripped: false, tried: 0, message: null });
    // the display side reads only
    const before = JSON.stringify(db.tables.holler_business_lookup);
    await attachCachedListings(db as never, contacts, new Map(cards.map((c) => [c.signalId, { city: 'Atlanta', state: 'GA' }])), at('09:02'), env20);
    expect(JSON.stringify(db.tables.holler_business_lookup)).toBe(before);
    // retry claims and the owner probe are not answers either
    const db3 = newDb({ holler_business_lookup: Array.from({ length: 9 }, (_, i) => row(i, 'retry', at('08:00'))) }, () => at('09:00'));
    for (let i = 0; i < 6; i++) await one(db3, NAMES[i], at('09:00'), vi.fn(async () => empty()), { probe: true });
    expect(await lookupBreaker(db3 as never, at('09:30'))).toEqual({ tripped: false, tried: 0, message: null });
    expect(db3.tables.holler_dataforseo_spend).toHaveLength(6);
    say('4.5', 'ok', '9 cache hits (yesterday\'s not_found and truncated rows): 0 calls, no row rewritten, breaker {tripped:false, tried:0}; the display read, 9 retry claims and 6 empty owner-probe answers do not count either');
  });

  it('4.6 a hard outage (HTTP 503, 401, a network error, an API task error) stops after a few calls and reaches the health email (fixed at integration)', async () => {
    const kinds: [string, () => Promise<Response>][] = [
      ['http 503', async () => new Response('{}', { status: 503 })],
      ['http 401 (wrong password)', async () => new Response('{"status_code":40100}', { status: 401 })],
      ['network error', async () => Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' }))],
      ['HTTP 200, task status 40200 Payment Required', async () => jsonRes({ status_code: 20000, tasks: [{ status_code: 40200, status_message: 'Payment Required.', cost: 0, result: null }] })],
    ];
    for (const [label, impl] of kinds) {
      const db = newDb({}, () => at('09:00'));
      const fetch = vi.fn(impl);
      // 9 runs through the day, each with 9 cards
      const budgets = [];
      for (let run = 0; run < 9; run++) {
        const when = at(`${String(9 + run).padStart(2, '0')}:00`);
        const names = NAMES.map((n) => n.replace('Roofing', TRADES[run]));
        const contacts = new Map<number, ContactRecord[]>(names.map((n, i) => [i + 1, [{ signalId: i + 1, role: 'contractor', name: n, city: null, state: null }]]));
        const cards = names.map((_, i) => ({ signalId: i + 1, city: 'Atlanta', state: 'GA', contact: contacts.get(i + 1)![0] }));
        const budget = newBudget(lookupSettings(ENV), 60_000);
        await lookupForCards(contacts, cards, budget, { db: db as never, fetch: fetch as never, env: ENV, now: () => when, sleep: async () => {} });
        budgets.push(budget);
      }
      const calls = fetch.mock.calls.length;
      const booked = db.tables.holler_dataforseo_spend.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
      // Was 25 failed calls a day (the whole day cap). Now: at most OUTAGE_STOP plus the calls already in flight in that run.
      expect(calls, label).toBeLessThanOrEqual(OUTAGE_STOP + LOOKUP_CONCURRENCY - 1);
      expect(calls, label).toBeGreaterThanOrEqual(OUTAGE_STOP);
      const o = await lookupOutage(db as never, at('18:30'));
      expect(o?.stopped, label).toBe(true);
      expect(budgets.at(-1)!.breaker, label).toBe(outageMessage(o!.failed));
      expect(budgets.at(-1)!.skipped.outage ?? 0, label).toBeGreaterThan(0);
      // the health email: the same day, and (the email runs at 13:03 UTC) the next day as "yesterday"
      const sameDay = await health(db, at('13:03'));
      expect(sameDay.body.watch, label).toContain(outageMessage(o!.failed));
      const nextDay = await health(db, at('13:03', NEXT));
      expect(nextDay.body.watch, label).toContain(outageMessage(o!.failed, 'yesterday'));
      expect(nextDay.mail?.text ?? '', label).toContain('Check the DataForSEO login and balance.');
      say('4.6', 'FIXED', `${label}: 9 runs made ${calls} failed calls (ledger rows: ${db.tables.holler_dataforseo_spend.length}, booked $${booked.toFixed(4)}); outage stop on; health line today and the next day`);
    }
  });

  it('4.6b an outage that answers HTTP 200 with nothing in it DOES trip it', async () => {
    const db = newDb({}, () => at('09:00'));
    const fetch = vi.fn(async () => jsonRes({ status_code: 20000, cost: 0.012, tasks: [{ status_code: 20000, cost: 0.012, result: [{ total_count: 0, items: null }] }] }));
    for (let i = 0; i < 7; i++) await one(db, NAMES[i], at(`09:0${i}`), fetch);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(await lookupBreaker(db as never, at('10:00'))).toMatchObject({ tripped: true, tried: 5 });
    say('4.6', 'ok', 'HTTP 200 with no items (or a changed response shape, read as "no items"): 5 calls, then tripped with the owner line');
  });

  async function health(db: FakeDb, when: Date) {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(when);
    const sendEmail = vi.fn(async () => ({ ok: true, id: 'em' }));
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('ADMIN_EMAIL', 'owner@x.test');
    vi.stubEnv('DATAFORSEO_LOGIN', ENV.DATAFORSEO_LOGIN);
    vi.stubEnv('DATAFORSEO_PASSWORD', ENV.DATAFORSEO_PASSWORD);
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [] }));
    vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }));
    const { GET } = await import('@/app/api/cron/health/route');
    const res = await GET(new Request('http://x.test/api/cron/health', { headers: { authorization: 'Bearer s3cret' } }));
    const body = (await res.json()) as { lookup: unknown; watch: string[] };
    const mail = (sendEmail.mock.calls[0] as unknown as [{ text: string; html: string; subject: string }] | undefined)?.[0];
    vi.useRealTimers();
    return { body, mail };
  }
  const LINE = 'Business lookups returned no usable match today';

  it('4.4 the health email line: present when the trip came before the 13:03 UTC health run of the same day', async () => {
    const db = new FakeDb({ holler_scan_runs: [], holler_business_lookup: Array.from({ length: 5 }, (_, i) => row(i, 'truncated', at(`0${i + 1}:00`))) });
    const { body, mail } = await health(db, at('13:03'));
    expect(body.lookup).toEqual({ tripped: true, tried: 5, message: breakerMessage(5) });
    expect(body.watch[0]).toBe(breakerMessage(5));
    expect(mail?.text).toContain(breakerMessage(5));
    expect(mail?.html).toContain(LINE);
    say('4.4', 'ok', `tripped 01:00 to 05:00 UTC, health run 13:03 UTC: Watch line in the text and HTML email and in the JSON ("${breakerMessage(5)}")`);
  });

  it('4.4b DEFECT the line never appears when the trip comes after 13:03 UTC (US business hours): today\'s email is already out and tomorrow\'s reads only tomorrow', async () => {
    // LAUNCH.md: holler-health runs once a day at 13:03 UTC. The fifth empty answer lands at 15:00 UTC (10:00 in Atlanta).
    const rows = Array.from({ length: 5 }, (_, i) => row(i, 'truncated', at(`14:${String(i * 10).padStart(2, '0')}`)));
    const dbMorning = new FakeDb({ holler_scan_runs: [], holler_business_lookup: [] });
    const morning = await health(dbMorning, at('13:03'));
    expect(morning.body.lookup).toEqual({ tripped: false, tried: 0, message: null });
    const db = new FakeDb({ holler_scan_runs: [], holler_business_lookup: rows });
    expect(await lookupBreaker(db as never, at('15:00'))).toMatchObject({ tripped: true });
    const next = await health(db, at('13:03', '2026-11-24'));
    expect(next.body.lookup).toEqual({ tripped: false, tried: 0, message: null });
    expect(next.body.watch.join('\n')).not.toContain(LINE);
    expect(next.mail?.text ?? '').not.toContain(LINE);
    say('4.4', 'DEFECT', 'answers 1 to 5 at 14:00 to 14:40 UTC: tripped from 14:40 to 24:00. The 13:03 email of that day was sent before; the 13:03 email of the next day reads only the new day: {tripped:false, tried:0}, no line. The owner is never told');
    // and when it repeats every day after 13:03, it is never told on any day
    const week = [];
    for (let d = 24; d <= 28; d++) for (let i = 0; i < 5; i++) week.push({ ...row(d * 10 + i, 'truncated', at(`14:${String(i * 10).padStart(2, '0')}`, `2026-11-${d}`)) });
    let lines = 0;
    for (let d = 24; d <= 29; d++) {
      const now = at('13:03', `2026-11-${d}`);
      // only the rows that exist when this health run starts
      const dbDay = new FakeDb({ holler_scan_runs: [], holler_business_lookup: week.filter((r) => r.checked_at < now.toISOString()) });
      if ((await health(dbDay, now)).body.watch.join('\n').includes(LINE)) lines++;
    }
    expect(lines).toBe(0);
    say('4.4', 'DEFECT', 'five days in a row tripped at 14:40 UTC (25 paid calls, none usable): 0 of 6 daily health emails carry the line');
  });

  it('4.4c answers that share one checked_at: which five are "first" is not defined', async () => {
    // lookupBusiness stamps checked_at with the time the lookup STARTED; three lookups of one run can carry the same millisecond.
    const t = at('09:00');
    const tie = [row(0, 'not_found', at('08:00')), row(1, 'not_found', at('08:01')), row(2, 'not_found', at('08:02')), row(3, 'not_found', t), row(4, 'not_found', t), row(5, 'found', t)];
    const a = await lookupBreaker(newDb({ holler_business_lookup: tie }) as never, at('10:00'));
    const b = await lookupBreaker(newDb({ holler_business_lookup: [...tie.slice(0, 3), tie[5], tie[3], tie[4]] }) as never, at('10:00'));
    // FIXED (review 3 P3-7, round 18 integration): ties on checked_at are broken by name_key, then city_key, so row order does not matter.
    expect([a?.tripped, b?.tripped]).toEqual([true, true]);
    say('4.4', 'FIXED', `rows 4, 5, 6 share one checked_at: tripped=${a?.tripped} in one row order, ${b?.tripped} in the other (second sort keys)`);
  });

  it('4.7 how often five ordinary answers in a row hold no found (the false-trip rate, by arithmetic)', () => {
    const p = (hit: number) => Math.pow(1 - hit, BREAKER_SAMPLE);
    const line = [0.75, 0.5, 0.3, 0.2, 0.1].map((h) => `hit rate ${Math.round(h * 100)}%: ${(p(h) * 100).toFixed(1)}% of days`).join('; ');
    say('4.7', 'NOTE', `chance that the first 5 answers of a day hold no found, with independent answers: ${line}`);
    expect(p(0.75)).toBeLessThan(0.001);
    expect(p(0.2)).toBeGreaterThan(0.3);
  });

  it('4.8 through one alert run: three calls in flight when the fifth answer lands', async () => {
    const db = newDb({ holler_business_lookup: Array.from({ length: 4 }, (_, i) => row(i, 'not_found', at(`08:0${i}`))) }, () => at('09:00'));
    const fetch = vi.fn(async (url: unknown) => (String(url) === LOOKUP_URL ? empty() : jsonRes({})));
    const contacts = new Map<number, ContactRecord[]>(NAMES.map((n, i) => [i + 1, [{ signalId: i + 1, role: 'contractor', name: n, city: null, state: null }]]));
    const cards = NAMES.map((_, i) => ({ signalId: i + 1, city: 'Atlanta', state: 'GA', contact: contacts.get(i + 1)![0] }));
    const budget = newBudget(lookupSettings(env20), 60_000);
    await lookupForCards(contacts, cards, budget, { db: db as never, fetch: fetch as never, env: env20, now: () => at('09:00'), sleep: async () => {} });
    const calls = fetch.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(3);
    expect(budget.breaker).toMatch(/^Business lookups returned no usable match today \(\d+ tried\)\. Run the lookup probe\.$/);
    say('4.8', 'ok', `4 empty answers already today, one run with 9 cards: ${calls} calls (at most 3 in flight), then "breaker"; budget.breaker = "${budget.breaker}"`);
  });
});
