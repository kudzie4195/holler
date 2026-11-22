import { describe, expect, it, vi } from 'vitest';
import { runLifecycle, MAX_MEMBERS_PER_RUN, MAX_TRIES, type RunDeps } from '@/lib/lifecycle/run';
import { NotMigrated, type FullProfile, type LifecycleStore, type MatchesOf } from '@/lib/lifecycle/store';
import { verifyLifecycleUnsub } from '@/lib/lifecycle/unsub';
import type { SendEmailInput, SendEmailResult } from '@/lib/email';
import type { AlertItem } from '@/lib/lifecycle/templates';
import { ITEMS } from './helpers';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-19T12:00:00.000Z');
const H = 3_600_000;
const SECRET = 'test-secret-not-real';
const SITE = 'https://localholler.com';

function prof(id: string, over: Partial<FullProfile> = {}): FullProfile {
  return {
    user_id: id,
    business_name: `Biz ${id}`,
    created_at: new Date(NOW.getTime() - 30 * H).toISOString(), // day 1 by default
    email_verified_at: new Date(NOW.getTime() - 29 * H).toISOString(),
    subscription_status: 'trialing',
    trial_ends_at: new Date(NOW.getTime() + 6 * 24 * H).toISOString(),
    stripe_subscription_id: null,
    categories: ['roofing'],
    lat: 33.7,
    lon: -84.4,
    state: 'GA',
    radius_mi: 25,
    ...over,
  };
}
const trial_ending = (id: string, over: Partial<FullProfile> = {}) =>
  prof(id, { created_at: new Date(NOW.getTime() - 5 * 24 * H).toISOString(), trial_ends_at: new Date(NOW.getTime() + 48 * H).toISOString(), ...over });
const trial_ended = (id: string, over: Partial<FullProfile> = {}) =>
  prof(id, { created_at: new Date(NOW.getTime() - 9 * 24 * H).toISOString(), trial_ends_at: new Date(NOW.getTime() - 30 * H).toISOString(), ...over });

interface World {
  profiles: FullProfile[];
  ledger: Set<string>;
  emails: Record<string, string | null>;
  matches: Record<string, MatchesOf>;
  quiet: Record<string, { lines: { label: string; count: number }[]; total: number; capped: boolean; days: number } | null>;
  missed: Record<string, { count: number; capped: boolean } | Error>;
  log: string[];
}

function world(profiles: FullProfile[], over: Partial<World> = {}): World {
  return { profiles, ledger: new Set(), emails: {}, matches: {}, quiet: {}, missed: {}, log: [], ...over };
}

function storeOf(w: World): LifecycleStore {
  const key = (u: string, k: string) => `${u}:${k}`;
  return {
    async loadProfiles() {
      return w.profiles;
    },
    async loadSends(ids) {
      await Promise.resolve();
      return [...w.ledger].map((k) => ({ user_id: k.split(':')[0], kind: k.split(':')[1] })).filter((r) => ids.includes(r.user_id));
    },
    async claim(u, k) {
      await Promise.resolve();
      if (w.ledger.has(key(u, k))) return 'exists';
      w.ledger.add(key(u, k));
      w.log.push(`claim ${key(u, k)}`);
      return 'claimed';
    },
    async release(u, k) {
      w.ledger.delete(key(u, k));
      w.log.push(`release ${key(u, k)}`);
    },
    async isOptedOut(u) {
      return w.ledger.has(key(u, 'optout'));
    },
    async emailOf(u) {
      return u in w.emails ? w.emails[u] : `${u}@example.test`;
    },
    async matchesOf(u) {
      return w.matches[u] ?? { items: [], total: 0, capped: false };
    },
    async quietPreview(p) {
      return p.user_id in w.quiet ? w.quiet[p.user_id] : { lines: [{ label: 'building permits', count: 4 }], total: 4, capped: false, days: 90 };
    },
    async missedSince(p) {
      const m = w.missed[p.user_id] ?? { count: 0, capped: false };
      if (m instanceof Error) throw m;
      return m;
    },
  };
}

function mailer(results: (SendEmailResult | Error)[] | ((i: number) => SendEmailResult | Error) = []) {
  const sent: SendEmailInput[] = [];
  const send = async (input: SendEmailInput): Promise<SendEmailResult> => {
    const i = sent.length;
    sent.push(input);
    const r = typeof results === 'function' ? results(i) : (results[i] ?? { ok: true as const, id: `m${i}` });
    if (r instanceof Error) throw r;
    return r;
  };
  return { send, sent };
}

const withMatches = (n: number): MatchesOf => ({ items: ITEMS.slice(0, n).map((x, i) => ({ ...x, id: i + 1 })), total: n, capped: false });
const deps = (w: World, m: ReturnType<typeof mailer>, over: Partial<RunDeps> = {}): RunDeps => ({ store: storeOf(w), send: m.send, siteUrl: SITE, secret: SECRET, now: NOW, ...over });
const summary = <T>(r: T) => r as Exclude<T, { skipped: string }>;

describe('what gets sent', () => {
  it('sends day 1, day 5 and day 8 to the right members, once each', async () => {
    const w = world([prof('a'), trial_ending('b'), trial_ended('c')], { matches: { a: withMatches(3), b: withMatches(4) }, missed: { c: { count: 6, capped: false } } });
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m)));
    expect(s.sent).toEqual({ welcome: 1, trial_ending: 1, trial_ended: 1 });
    expect(m.sent.map((x) => [x.to, x.subject])).toEqual([
      ['b@example.test', 'Your trial ends in 2 days'],
      ['a@example.test', 'What we found near you'],
      ['c@example.test', 'Your alerts are paused'],
    ]);
    expect([...w.ledger].sort()).toEqual(['a:welcome', 'b:trial_ending', 'c:trial_ended']);
  });

  it('every message carries both parts and the one-click headers, and the link opts out exactly that member', async () => {
    const w = world([prof('a')], { matches: { a: withMatches(2) } });
    const m = mailer();
    await runLifecycle(deps(w, m));
    const [mail] = m.sent;
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.html.length).toBeGreaterThan(0);
    const url = mail.headers?.['List-Unsubscribe']?.replace(/^<|>$/g, '') ?? '';
    expect(url.startsWith(`${SITE}/api/cron/lifecycle/unsubscribe?t=`)).toBe(true);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.text).toContain(url);
    const token = decodeURIComponent(new URL(url).searchParams.get('t') ?? '');
    expect(verifyLifecycleUnsub(token, SECRET, NOW.getTime())).toBe('a');
  });

  it('day 1 uses the matches variant when there are matches, the quiet variant when there are none', async () => {
    const w = world([prof('a'), prof('b')], { matches: { a: withMatches(2) } });
    const m = mailer();
    await runLifecycle(deps(w, m));
    const byTo = Object.fromEntries(m.sent.map((x) => [x.to, x.text]));
    expect(byTo['a@example.test']).toContain('2 records already match');
    expect(byTo['b@example.test']).toContain('nothing has matched your trades and area yet');
    expect(byTo['b@example.test']).toContain('all of them are building permits');
  });

  it('day 1 with no matches and no counts is not sent at all, and the row is given back', async () => {
    const w = world([prof('a')], { quiet: { a: null } });
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(0);
    expect(w.ledger.size).toBe(0);
    expect(s.skipped_no_data).toBe(1);
  });

  it('day 5 with no matches still goes out, honestly', async () => {
    const w = world([trial_ending('b')]);
    const m = mailer();
    await runLifecycle(deps(w, m));
    expect(m.sent[0].text).toContain('has not matched anything to your trades and area yet');
  });

  it('day 5 picks the 3 best by severity then newest, and passes the AI ranking hook through', async () => {
    const items: (AlertItem & { id: number })[] = [
      { id: 1, title: 'Low old', severity: 1, occurredAt: '2026-11-10T00:00:00Z', kind: 'alert' },
      { id: 2, title: 'High old', severity: 3, occurredAt: '2026-11-11T00:00:00Z', kind: 'alert' },
      { id: 3, title: 'High new', severity: 3, occurredAt: '2026-11-18T00:00:00Z', kind: 'alert' },
      { id: 4, title: 'Mid new', severity: 2, occurredAt: '2026-11-19T00:00:00Z', kind: 'alert' },
      { id: 5, title: 'Mid old', severity: 2, occurredAt: '2026-11-12T00:00:00Z', kind: 'alert' },
    ];
    const w = world([trial_ending('b')], { matches: { b: { items, total: 5, capped: false } } });
    const m = mailer();
    await runLifecycle(deps(w, m));
    const titles = (t: string) => ['High new', 'High old', 'Mid new', 'Mid old', 'Low old'].filter((x) => t.includes(x));
    expect(titles(m.sent[0].text)).toEqual(['High new', 'High old', 'Mid new']);

    const w2 = world([trial_ending('b')], { matches: { b: { items, total: 5, capped: false } } });
    const m2 = mailer();
    const rank = vi.fn(<T extends AlertItem>(xs: T[]): T[] => [...xs].sort((a, b) => a.title.localeCompare(b.title)));
    await runLifecycle(deps(w2, m2, { rank: rank as unknown as RunDeps['rank'] }));
    expect(rank).toHaveBeenCalledTimes(1);
    expect(['High new', 'High old', 'Mid new', 'Mid old', 'Low old'].filter((x) => m2.sent[0].text.includes(x))).toEqual(['High new', 'High old', 'Low old']);
  });

  it('rankFor (integration: the AI scores per member) gets the member and the items; its ranker wins; a rejection keeps the default', async () => {
    const items: (AlertItem & { id: number })[] = [
      { id: 1, title: 'Low old', severity: 1, occurredAt: '2026-11-10T00:00:00Z', kind: 'alert' },
      { id: 2, title: 'High old', severity: 3, occurredAt: '2026-11-11T00:00:00Z', kind: 'alert' },
      { id: 3, title: 'High new', severity: 3, occurredAt: '2026-11-18T00:00:00Z', kind: 'alert' },
      { id: 4, title: 'Mid new', severity: 2, occurredAt: '2026-11-19T00:00:00Z', kind: 'alert' },
    ];
    const order = (t: string) => ['High new', 'High old', 'Mid new', 'Low old'].filter((x) => t.includes(x));
    const w = world([trial_ending('b')], { matches: { b: { items, total: 4, capped: false } } });
    const m = mailer();
    const seen: string[] = [];
    const rankFor: RunDeps['rankFor'] = async (p, xs) => {
      seen.push(`${p.user_id}:${xs.map((x) => x.id).join(',')}`);
      return <T extends AlertItem>(list: T[]) => [...list].sort((a, b) => a.title.localeCompare(b.title));
    };
    await runLifecycle(deps(w, m, { rankFor }));
    expect(seen).toEqual(['b:1,2,3,4']);
    expect(order(m.sent[0].text)).toEqual(['High new', 'High old', 'Low old']);

    const w2 = world([trial_ending('b')], { matches: { b: { items, total: 4, capped: false } } });
    const m2 = mailer();
    await runLifecycle(deps(w2, m2, { rankFor: async () => Promise.reject(new Error('scores down')) }));
    expect(order(m2.sent[0].text)).toEqual(['High new', 'High old', 'Mid new']);
  });

  it('day 8 says what was missed as a real count, or only that alerts are paused', async () => {
    const w = world([trial_ended('c'), trial_ended('d')], { missed: { c: { count: 9, capped: false }, d: { count: 0, capped: false } } });
    const m = mailer();
    await runLifecycle(deps(w, m));
    const byTo = Object.fromEntries(m.sent.map((x) => [x.to, x.text]));
    expect(byTo['c@example.test']).toContain('Since then, 9 new public records have matched');
    expect(byTo['d@example.test']).not.toContain('Since then');
  });

  it('day 8 whose count cannot be read is not sent (no guessed number), and retries later', async () => {
    const w = world([trial_ended('c')], { missed: { c: new Error('db down') } });
    const m = mailer();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(0);
    expect(w.ledger.size).toBe(0);
    expect(s.failed).toBe(MAX_TRIES);
    vi.restoreAllMocks();
  });

  it('members who pay, paid, or have a subscription get nothing, at any stage', async () => {
    const w = world([
      prof('a', { subscription_status: 'active' }),
      trial_ending('b', { subscription_status: 'past_due' }),
      trial_ended('c', { subscription_status: 'canceled' }),
      trial_ending('d', { stripe_subscription_id: 'sub_1' }),
      prof('e', { email_verified_at: null }),
    ]);
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(0);
    expect(s.selected).toBe(0);
    expect(w.ledger.size).toBe(0);
  });
});

describe('opt-out is respected', () => {
  it('a member with an opt-out row gets nothing, even for a kind they have not had', async () => {
    const w = world([prof('a'), trial_ending('b'), trial_ended('c')], { ledger: new Set(['a:optout', 'b:optout', 'c:optout']) });
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(0);
    expect(s.selected).toBe(0);
  });

  it('an opt-out that lands after selection but before the send still stops the email', async () => {
    const w = world([prof('a')], { matches: { a: withMatches(2) } });
    const store = storeOf(w);
    const realClaim = store.claim.bind(store);
    store.claim = async (u, k) => {
      const r = await realClaim(u, k);
      w.ledger.add(`${u}:optout`); // the member clicks stop between the selection and the send
      return r;
    };
    const m = mailer();
    const s = summary(await runLifecycle({ ...deps(w, m), store }));
    expect(m.sent).toHaveLength(0);
    expect(s.skipped_opted_out).toBe(1);
    expect(w.ledger.has('a:welcome')).toBe(false);
    expect(w.ledger.has('a:optout')).toBe(true);
  });

  it('an opt-out for one member does not affect another', async () => {
    const w = world([prof('a'), prof('b')], { ledger: new Set(['a:optout']), matches: { b: withMatches(1) } });
    const m = mailer();
    await runLifecycle(deps(w, m));
    expect(m.sent.map((x) => x.to)).toEqual(['b@example.test']);
  });
});

describe('idempotence and overlapping runs', () => {
  it('a second run after the first sends nothing', async () => {
    const w = world([prof('a'), trial_ending('b'), trial_ended('c')], { matches: { a: withMatches(1), b: withMatches(1) } });
    const m = mailer();
    await runLifecycle(deps(w, m));
    const first = m.sent.length;
    await runLifecycle(deps(w, m));
    expect(first).toBe(3);
    expect(m.sent).toHaveLength(3);
  });

  it('two runs at the same moment send each email once', async () => {
    const profiles = [prof('a'), prof('a2'), trial_ending('b'), trial_ended('c')];
    const w = world(profiles, { matches: { a: withMatches(1), a2: withMatches(2), b: withMatches(3) } });
    const m = mailer();
    const results = await Promise.all([runLifecycle(deps(w, m)), runLifecycle(deps(w, m)), runLifecycle(deps(w, m))]);
    expect(m.sent).toHaveLength(4);
    const totals = results.map((r) => summary(r)).reduce((n, r) => n + r.sent.welcome + r.sent.trial_ending + r.sent.trial_ended, 0);
    expect(totals).toBe(4);
    expect(results.map((r) => summary(r).already_sent).reduce((a, b) => a + b, 0)).toBe(8);
    expect([...m.sent.map((x) => `${x.to}|${x.subject}`)].sort()).toEqual(
      ['a2@example.test|What we found near you', 'a@example.test|What we found near you', 'b@example.test|Your trial ends in 2 days', 'c@example.test|Your alerts are paused'].sort(),
    );
  });

  it('only the call whose insert succeeded sends: a claim that finds the row sends nothing', async () => {
    const w = world([prof('a')], { ledger: new Set() });
    const store = storeOf(w);
    store.loadSends = async () => []; // this run did not see the other run's row
    w.ledger.add('a:welcome'); // the other run claimed it a moment ago
    const m = mailer();
    const s = summary(await runLifecycle({ ...deps(w, m), store }));
    expect(m.sent).toHaveLength(0);
    expect(s.already_sent).toBe(1);
    expect(w.ledger.has('a:welcome')).toBe(true); // the other run's row is untouched
  });
});

describe('failures', () => {
  // Changed in round 7 (review r4): a plain { ok: false } or a throw from the sender may mean the provider accepted the email and only the
  // answer was lost, so the row is now KEPT (at most once). Only a failure the sender marks notSent: true (the provider refused it, so
  // nothing went out) gives the row back for a retry.
  it('a send the provider refused (notSent) deletes the row so it can retry, and the retry in the same run can succeed', async () => {
    const w = world([prof('a')], { matches: { a: withMatches(1) } });
    const m = mailer([{ ok: false, error: 'boom', notSent: true } as SendEmailResult]);
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(2);
    expect(s.sent.welcome).toBe(1);
    expect(s.failed).toBe(1);
    expect(w.ledger.has('a:welcome')).toBe(true);
    expect(w.log).toEqual(['claim a:welcome', 'release a:welcome', 'claim a:welcome']);
  });

  // Changed in round 7 fix-g2 (verify-v3 P2, commander decision 10): an ambiguous send is retried ONCE at once with the same input and
  // idempotency key, then the row is kept.
  it('an ambiguous send failure (ok: false with no notSent) is retried once with the same key, then the row is kept: treated as sent, logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world([prof('a')], { matches: { a: withMatches(1) } });
    const m = mailer([{ ok: false, error: 'socket hang up' }, { ok: false, error: 'socket hang up' }]);
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(2);
    expect(m.sent[1]).toEqual(m.sent[0]); // identical payload, same idempotency key
    expect(s.send_retried).toBe(1);
    expect(s.send_unknown).toBe(1);
    expect(s.sent.welcome).toBe(0);
    expect(w.ledger.has('a:welcome')).toBe(true);
    expect(w.log).toEqual(['claim a:welcome']);
    expect(err.mock.calls.some((c) => String(c[0]).includes('outcome unknown'))).toBe(true);
    // The next hourly run inside the window sends nothing either.
    const m2 = mailer();
    await runLifecycle(deps(w, m2));
    expect(m2.sent).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('passes a stable idempotency key per member and kind to the sender', async () => {
    const w = world([prof('a'), trial_ending('b')], { matches: { a: withMatches(1) } });
    const m = mailer();
    await runLifecycle(deps(w, m));
    const keys = m.sent.map((x) => (x as SendEmailInput & { idempotencyKey?: string }).idempotencyKey).sort();
    expect(keys).toEqual(['lifecycle:a:welcome', 'lifecycle:b:trial_ending']);
  });

  it('gives up after 3 refused tries in one run, leaves no row, and the next run tries again', async () => {
    const w = world([prof('a'), prof('b')], { matches: { a: withMatches(1), b: withMatches(1) } });
    const down = mailer(() => ({ ok: false, error: 'provider down', notSent: true }) as SendEmailResult);
    const s = summary(await runLifecycle(deps(w, down)));
    expect(down.sent).toHaveLength(2 * MAX_TRIES);
    expect(s.failed).toBe(2 * MAX_TRIES);
    expect(w.ledger.size).toBe(0);
    const up = mailer();
    const s2 = summary(await runLifecycle(deps(w, up)));
    expect(up.sent).toHaveLength(2);
    expect(s2.sent.welcome).toBe(2);
  });

  it('a thrown error from the send is ambiguous: one retry with the same key, then the row is kept and nothing more', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world([prof('a')], { matches: { a: withMatches(1) } });
    const m = mailer([new Error('network'), new Error('network'), new Error('network')]);
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(2);
    expect(s.send_unknown).toBe(1);
    expect(w.ledger.has('a:welcome')).toBe(true);
    vi.restoreAllMocks();
  });

  it('verify-v3 P2 reviewer repro: a Resend 500 then ok on the in-run retry -> the trial_ending email goes (same key), counted sent once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world([trial_ending('b')], { matches: { b: withMatches(2) } });
    const m = mailer([{ ok: false, error: '500' }, { ok: true, id: 'm1' }]);
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(2);
    expect((m.sent[1] as SendEmailInput & { idempotencyKey?: string }).idempotencyKey).toBe('lifecycle:b:trial_ending');
    expect(m.sent[1]).toEqual(m.sent[0]);
    expect(s.sent.trial_ending).toBe(1);
    expect(s.send_unknown).toBe(0);
    expect(w.ledger.has('b:trial_ending')).toBe(true);
    // The next run sends nothing more.
    const m2 = mailer();
    await runLifecycle(deps(w, m2));
    expect(m2.sent).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('an ambiguous first send then a refused (notSent) retry still keeps the row: the first may have gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world([prof('a')], { matches: { a: withMatches(1) } });
    const m = mailer([new Error('network'), { ok: false, error: 'bad', notSent: true } as SendEmailResult]);
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(2);
    expect(s.send_unknown).toBe(1);
    expect(w.ledger.has('a:welcome')).toBe(true);
    expect(w.log).toEqual(['claim a:welcome']);
    vi.restoreAllMocks();
  });

  it('an error before the send (building the email) still gives the row back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world([trial_ended('c')], { missed: { c: new Error('read failed') } });
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(0);
    expect(s.failed).toBe(MAX_TRIES);
    expect(w.ledger.size).toBe(0);
    vi.restoreAllMocks();
  });

  it('one member failing does not stop the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world([prof('a'), prof('b')], { matches: { a: withMatches(1), b: withMatches(1) } });
    // Changed in round 7 fix-g2: member a's ambiguous failure is retried once (and fails again); b is unaffected.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mailer((i) => (i <= 1 ? { ok: false, error: 'x' } : { ok: true }));
    const s = summary(await runLifecycle(deps(w, m)));
    expect(s.sent.welcome).toBe(1);
    expect(s.send_unknown).toBe(1);
    expect(m.sent.map((x) => x.to)).toEqual(['a@example.test', 'a@example.test', 'b@example.test']);
    vi.restoreAllMocks();
  });

  it('a returning member (trial stamp older than this profile) gets no second welcome, and the row is kept', async () => {
    const w = world([prof('a'), prof('b')], { matches: { a: withMatches(1), b: withMatches(1) } });
    const store = storeOf(w);
    store.trialStartedAt = async (u) => (u === 'a' ? new Date(NOW.getTime() - 40 * 24 * H).toISOString() : new Date(NOW.getTime() - 30 * H).toISOString());
    const m = mailer();
    const s = summary(await runLifecycle({ ...deps(w, m), store }));
    expect(m.sent.map((x) => x.to)).toEqual(['b@example.test']);
    expect(s.skipped_returning).toBe(1);
    expect(w.ledger.has('a:welcome')).toBe(true); // never asked again
    const dw = world([prof('a')], { matches: { a: withMatches(1) } });
    const dstore = storeOf(dw);
    dstore.trialStartedAt = store.trialStartedAt;
    const dm = mailer();
    const dry = summary(await runLifecycle({ ...deps(dw, dm), store: dstore, dry: true }));
    expect(dm.sent).toHaveLength(0);
    expect(dry.would_send).toEqual([]);
    expect(dry.skipped_returning).toBe(1);
  });

  it('a returning member still gets the trial_ending email (only the welcome is skipped)', async () => {
    const w = world([trial_ending('a')]);
    const store = storeOf(w);
    store.trialStartedAt = async () => new Date(NOW.getTime() - 40 * 24 * H).toISOString();
    const m = mailer();
    const s = summary(await runLifecycle({ ...deps(w, m), store }));
    expect(s.sent.trial_ending).toBe(1);
  });

  it('no email provider: the row is given back and nothing is retried', async () => {
    const w = world([prof('a')], { matches: { a: withMatches(1) } });
    const m = mailer([{ skipped: true, reason: 'no_api_key' }]);
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(1);
    expect(s.skipped_no_provider).toBe(1);
    expect(w.ledger.size).toBe(0);
  });

  it('a member with no email address is skipped and the row is given back', async () => {
    const w = world([prof('a')], { emails: { a: null }, matches: { a: withMatches(1) } });
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m)));
    expect(m.sent).toHaveLength(0);
    expect(s.skipped_no_email).toBe(1);
    expect(w.ledger.size).toBe(0);
  });

  it('a claim error is a failure with no send', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world([prof('a')], { matches: { a: withMatches(1) } });
    const store = storeOf(w);
    store.claim = async () => {
      throw new Error('db');
    };
    const m = mailer();
    const s = summary(await runLifecycle({ ...deps(w, m), store }));
    expect(m.sent).toHaveLength(0);
    expect(s.failed).toBe(MAX_TRIES);
    vi.restoreAllMocks();
  });

  it('the migration not being applied skips the run without throwing', async () => {
    const w = world([prof('a')]);
    const store = storeOf(w);
    store.loadSends = async () => {
      throw new NotMigrated();
    };
    const m = mailer();
    expect(await runLifecycle({ ...deps(w, m), store })).toEqual({ ok: true, skipped: 'not_migrated' });
    const store2 = storeOf(w);
    store2.claim = async () => {
      throw new NotMigrated();
    };
    expect(await runLifecycle({ ...deps(w, m), store: store2 })).toEqual({ ok: true, skipped: 'not_migrated' });
    expect(m.sent).toHaveLength(0);
  });
});

describe('limits', () => {
  it('processes at most 200 members per run', async () => {
    const ps = Array.from({ length: 250 }, (_, i) => trial_ended(`u${String(i).padStart(3, '0')}`));
    const w = world(ps);
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m)));
    expect(MAX_MEMBERS_PER_RUN).toBe(200);
    expect(s.selected).toBe(200);
    expect(m.sent).toHaveLength(200);
    const s2 = summary(await runLifecycle(deps(w, m)));
    expect(s2.selected).toBe(50);
    expect(m.sent).toHaveLength(250);
  });

  it('a caller cannot raise the cap above 200', async () => {
    const w = world(Array.from({ length: 230 }, (_, i) => trial_ended(`u${i}`)));
    const m = mailer();
    const s = summary(await runLifecycle(deps(w, m, { limit: 1000 })));
    expect(s.selected).toBe(200);
  });

  it('stops starting new members when the time budget is spent', async () => {
    const w = world(Array.from({ length: 10 }, (_, i) => trial_ended(`u${i}`)));
    const m = mailer();
    let t = 0;
    const s = summary(await runLifecycle(deps(w, m, { clock: () => (t += 20_000), budgetMs: 50_000 })));
    expect(m.sent.length).toBeGreaterThan(0);
    expect(m.sent.length).toBeLessThan(10);
    expect(s.selected).toBe(10);
  });
});

describe('dry run', () => {
  it('lists who would get what, sends nothing, writes nothing, and shows no email addresses', async () => {
    const w = world([prof('a'), prof('q'), trial_ending('b'), trial_ended('c'), trial_ended('d')], {
      matches: { a: withMatches(2), b: withMatches(3) },
      missed: { c: { count: 5, capped: false }, d: { count: 0, capped: false } },
    });
    const m = mailer();
    const before = new Set(w.ledger);
    const s = summary(await runLifecycle(deps(w, m, { dry: true })));
    expect(m.sent).toHaveLength(0);
    expect(w.log).toEqual([]);
    expect(w.ledger).toEqual(before);
    expect(s.dry).toBe(true);
    expect(s.would_send).toEqual([
      { user_id: 'b', kind: 'trial_ending', variant: 'alerts' },
      { user_id: 'a', kind: 'welcome', variant: 'matches' },
      { user_id: 'q', kind: 'welcome', variant: 'quiet' },
      { user_id: 'c', kind: 'trial_ended', variant: 'missed' },
      { user_id: 'd', kind: 'trial_ended', variant: 'paused_only' },
    ]);
    expect(JSON.stringify(s)).not.toContain('@');
  });

  it('a dry run counts day 1 members with nothing to say as skipped, not as would-send', async () => {
    const w = world([prof('a')], { quiet: { a: null } });
    const s = summary(await runLifecycle(deps(w, mailer(), { dry: true })));
    expect(s.would_send).toEqual([]);
    expect(s.skipped_no_data).toBe(1);
  });
});

describe('any trial length: each email exactly once, at the right time', () => {
  for (const trialDays of [14, 7]) {
    it(`a ${trialDays}-day trial (length read only from trial_ends_at) gets welcome, trial_ending and trial_ended once each`, async () => {
      const T0 = Date.parse('2026-12-01T08:30:00.000Z');
      const created = new Date(T0).toISOString();
      const ends = new Date(T0 + trialDays * 24 * H).toISOString();
      const p = prof('m', { created_at: created, email_verified_at: created, trial_ends_at: ends });
      const w = world([p], { matches: { m: withMatches(2) } });
      const at: Record<string, number[]> = {};
      let t = T0;
      const send = async (input: SendEmailInput): Promise<SendEmailResult> => {
        (at[input.subject] ??= []).push(t);
        return { ok: true };
      };
      for (let h = 0; h <= (trialDays + 5) * 24; h++) {
        t = T0 + h * H;
        await runLifecycle({ store: storeOf(w), send, siteUrl: SITE, secret: SECRET, now: new Date(t) });
      }
      expect(Object.keys(at).sort()).toEqual(['What we found near you', 'Your alerts are paused', 'Your trial ends in 2 days']);
      for (const times of Object.values(at)) expect(times).toHaveLength(1);
      const hrs = (ms: number) => ms / H;
      expect(hrs(at['What we found near you'][0] - T0)).toBe(20); // first hourly run inside the window
      expect(hrs(Date.parse(ends) - at['Your trial ends in 2 days'][0])).toBeGreaterThanOrEqual(36);
      expect(hrs(Date.parse(ends) - at['Your trial ends in 2 days'][0])).toBeLessThanOrEqual(60);
      expect(hrs(at['Your alerts are paused'][0] - Date.parse(ends))).toBeGreaterThanOrEqual(18);
      expect(hrs(at['Your alerts are paused'][0] - Date.parse(ends))).toBeLessThanOrEqual(48);
      expect([...w.ledger].sort()).toEqual(['m:trial_ended', 'm:trial_ending', 'm:welcome']);
    });
  }

  it('no template or source text names a trial length or a day number', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { samples } = await import('./helpers');
    const dir = path.join(__dirname, '../../lib/lifecycle');
    const bad = /\b7[- ]days?\b|\b14[- ]days?\b|\bday ?[158]\b|\bseven\b|\bfourteen\b/i;
    for (const m of Object.values(samples())) expect(bad.test(m.subject + m.text + m.html)).toBe(false);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(bad.test(code), f).toBe(false);
    }
  });
});

describe('member language (round 18 ES, review P3-9)', () => {
  it('reads every picked member\'s language once per run, sends each email in that language, and a failed read sends English', async () => {
    const w = world([prof('a'), prof('b')], { matches: { a: withMatches(2), b: withMatches(2) } });
    const calls: string[][] = [];
    const m = mailer();
    await runLifecycle(deps(w, m, { langsFor: async (ids) => (calls.push([...ids].sort()), new Map([['a', 'es' as const]])) }));
    expect(calls).toEqual([['a', 'b']]);
    const subjects = m.sent.map((x) => x.subject).sort();
    expect(subjects).toEqual(['Lo que encontramos cerca de usted', 'What we found near you']);
    const w2 = world([prof('a')], { matches: { a: withMatches(2) } });
    const m2 = mailer();
    await runLifecycle(deps(w2, m2, { langsFor: async () => { throw new Error('42703'); } }));
    expect(m2.sent.map((x) => x.subject)).toEqual(['What we found near you']);
  });
});
