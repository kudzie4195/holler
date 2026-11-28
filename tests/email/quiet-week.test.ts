/**
 * Round 24 FIXMAIL, review P1-5: the quiet-week email is really sent, and only when HOLLER_QUIET_WEEK_ENABLED is exactly "1".
 *   - flag off (unset, "0", "true", "yes", " 1"): the notify cron is byte-identical to commit f581d0c: same database calls, same rows
 *     written, same emails, same JSON. Proven by running f581d0c's own route (git show) and this one on the same fake database.
 *   - flag on: a member with alerts on, a verified email, an active trial or plan, no un-notified match and no alert email in 7 days gets
 *     ONE quiet-week email with the digest's List-Unsubscribe headers, `last_notified_at` is stamped, and nothing again within 7 days.
 *   - unsubscribed, unverified and locked (trial ended) members get nothing; a member with a pending alert gets the digest only.
 *   - what it says is checked: "no public record matched" only when this member had no match in 7 days; the coverage gate's own words in a
 *     limited cell; feed-only matches are said to be in the feed.
 *   - a missing column or table on the live database never breaks the cron.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { renderDigest } from '@/lib/email/templates';
import { digestCoverage } from '@/lib/email/coverage';
import { quietWeekEnabled, sendQuietWeek, QUIET_WEEK_DAYS } from '@/lib/email/quiet-week';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

const NOW = Date.parse('2026-11-23T14:07:00.000Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const SECRET = 's3cret-not-real';

const ID = {
  quiet: '10000000-0000-4000-8000-000000000001',
  feedOnly: '10000000-0000-4000-8000-000000000002',
  pending: '10000000-0000-4000-8000-000000000003',
  unsub: '10000000-0000-4000-8000-000000000004',
  unverified: '10000000-0000-4000-8000-000000000005',
  locked: '10000000-0000-4000-8000-000000000006',
  recent: '10000000-0000-4000-8000-000000000007',
  newAccount: '10000000-0000-4000-8000-000000000008',
  spanish: '10000000-0000-4000-8000-000000000009',
  limited: '10000000-0000-4000-8000-000000000010',
  paid: '10000000-0000-4000-8000-000000000011',
  pastDue: '10000000-0000-4000-8000-000000000012',
};
// Round 35: the default member sits in Austin, where landscaping and lawn care are live cells; Raleigh's two were re-measured to limited.
const AUSTIN = { lat: 30.2672, lon: -97.7431, state: 'TX' };
const ATLANTA = { lat: 33.749, lon: -84.388, state: 'GA' };

const profile = (id: string, over: Record<string, unknown> = {}) => ({
  user_id: id,
  business_name: `Shop ${id.slice(-2)}`,
  categories: ['lawn-care', 'landscaping'],
  plan: null,
  alert_email: true,
  subscription_status: 'trialing',
  trial_ends_at: iso(NOW + 10 * DAY),
  last_notified_at: null,
  email_verified_at: '2026-10-01T00:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
  ...AUSTIN,
  extra_areas: null,
  plan_source: null,
  store_expires_at: null,
  language: 'en',
  ...over,
});

function seed(): FakeDb {
  return new FakeDb({
    holler_profiles: [
      profile(ID.quiet),
      profile(ID.feedOnly),
      profile(ID.pending),
      profile(ID.unsub, { alert_email: false }),
      profile(ID.unverified, { email_verified_at: null }),
      profile(ID.locked, { trial_ends_at: iso(NOW - DAY) }),
      profile(ID.recent, { last_notified_at: iso(NOW - 3 * DAY) }),
      profile(ID.newAccount, { created_at: iso(NOW - 2 * DAY) }),
      profile(ID.spanish, { language: 'es' }),
      profile(ID.limited, { categories: ['lawn-care'], ...ATLANTA }),
      profile(ID.paid, { subscription_status: 'active', trial_ends_at: null, plan: 'solo', last_notified_at: iso(NOW - 9 * DAY) }),
      profile(ID.pastDue, { subscription_status: 'past_due', trial_ends_at: null }),
    ],
    holler_matches: [
      // the pending member: one un-notified alert, so the digest goes out and no quiet email does
      {
        id: 501,
        user_id: ID.pending,
        created_at: iso(NOW - 3_600_000),
        notified: false,
        status: 'new',
        signal: { id: 9001, source: 'spc', external_id: 'x1', expires_at: null, kind: 'report', title: '1.75 inch hail reported near 2 ESE Raleigh, NC', summary: 'HAIL | Ping pong sized hail', url: 'https://www.spc.noaa.gov/x', city: 'Raleigh', state: 'NC', lat: 35.78, lon: -78.64, occurred_at: iso(NOW - 2 * 3_600_000), severity: 3, categories: ['roofing', 'landscaping'], subtype: null },
      },
      // the feed-only member: a match this week, already notified (a feed-only card): the quiet email must not say nothing matched
      { id: 502, user_id: ID.feedOnly, created_at: iso(NOW - 2 * DAY), notified: true, status: 'new', signal: null },
      // the quiet member: an old match only (two weeks ago)
      { id: 503, user_id: ID.quiet, created_at: iso(NOW - 14 * DAY), notified: true, status: 'done', signal: null },
    ],
  });
}

type Sent = { to: string; subject: string; html: string; text: string; headers?: Record<string, string>; idempotencyKey?: string };
const EMAILS: Record<string, string> = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, `${k}@shop.test`]));

async function runNotify(db: FakeDb, opts: { flag?: string; nowMs?: number; routeFile?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', SECRET);
  if (opts.flag === undefined) delete process.env.HOLLER_QUIET_WEEK_ENABLED;
  else vi.stubEnv('HOLLER_QUIET_WEEK_ENABLED', opts.flag);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(opts.nowMs ?? NOW);
  const sent: Sent[] = [];
  const admin = Object.assign(db, { auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: EMAILS[id] ?? null } }, error: null }) } } });
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
  vi.doMock('@/lib/outreach/loader', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/loader')>()), loadMemberContacts: async () => new Map() }));
  vi.doMock('@/lib/push/notify', () => ({ pushNewMatches: async () => ({ skipped: 'test' }) }));
  vi.doMock('@/lib/analytics/server', () => ({ track: async () => {} }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async (m: Sent) => (sent.push(m), { ok: true as const, id: `e${sent.length}` }),
  }));
  const { GET } = (await import(opts.routeFile ?? '@/app/api/cron/notify/route')) as typeof import('@/app/api/cron/notify/route');
  const res = await GET(new Request('https://holler.test/api/cron/notify', { headers: { authorization: `Bearer ${SECRET}` } }));
  const body = (await res.json()) as Record<string, unknown>;
  delete body.ms;
  return { status: res.status, body, sent };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.HOLLER_QUIET_WEEK_ENABLED;
  for (const m of ['@/lib/supabase/admin', '@/lib/outreach/loader', '@/lib/email', '@/lib/push/notify', '@/lib/analytics/server', 'server-only']) vi.doUnmock(m);
});

// f581d0c's own notify route, from git, so "off is unchanged" is compared against the real thing and not a copy kept in this repo.
let baseDir = '';
let baseRoute = '';
beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'holler-notify-f581d0c-'));
  baseRoute = join(baseDir, 'route.ts');
  writeFileSync(baseRoute, execFileSync('git', ['show', 'f581d0c:app/api/cron/notify/route.ts'], { encoding: 'utf8' }));
});
afterAll(() => rmSync(baseDir, { recursive: true, force: true }));

describe('the switch', () => {
  it('is on only for exactly "1"', () => {
    expect(quietWeekEnabled('1')).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'yes', 'on', ' 1', '1 ', 'TRUE', '2']) expect(quietWeekEnabled(v), String(v)).toBe(false);
  });
  it('is named in .env.example and LAUNCH.md (NEEDS KUDZI, after one real-inbox test)', async () => {
    const { readFileSync } = await import('node:fs');
    const ex = readFileSync('.env.example', 'utf8');
    expect(ex).toMatch(/# OPTIONAL\. The quiet-week email[^\n]*\nHOLLER_QUIET_WEEK_ENABLED=\n/);
    expect(readFileSync('LAUNCH.md', 'utf8')).toMatch(/NEEDS KUDZI \(round 24 mail\): `HOLLER_QUIET_WEEK_ENABLED`[^]*Turn on after one real-inbox test/);
  });
});

describe('flag off: the notify cron is byte-identical to f581d0c', () => {
  for (const flag of [undefined, '0', 'true', 'yes', ' 1']) {
    it(`HOLLER_QUIET_WEEK_ENABLED=${JSON.stringify(flag)}: same calls, same rows, same emails, same JSON`, async () => {
      const dbBase = seed();
      const base = await runNotify(dbBase, { flag, routeFile: baseRoute });
      const dbNow = seed();
      const now = await runNotify(dbNow, { flag });
      expect(now.status).toBe(200);
      expect(now.body).toEqual(base.body);
      expect(now.body).not.toHaveProperty('quiet');
      expect(dbNow.calls).toEqual(dbBase.calls);
      expect(dbNow.tables).toEqual(dbBase.tables);
      expect(now.sent).toEqual(base.sent);
      // and that is: the one digest, to the member with a pending alert, nothing to anyone else
      expect(now.sent.map((m) => m.to)).toEqual(['pending@shop.test']);
    });
  }
  it('with nobody pending at all (the early-return path), still identical and nothing is sent', async () => {
    const empty = () => {
      const db = seed();
      db.tables.holler_matches = db.tables.holler_matches.filter((m) => m.notified);
      return db;
    };
    const dbBase = empty();
    const base = await runNotify(dbBase, { routeFile: baseRoute });
    const dbNow = empty();
    const now = await runNotify(dbNow, {});
    expect(now.body).toEqual(base.body);
    expect(dbNow.calls).toEqual(dbBase.calls);
    expect(dbNow.tables).toEqual(dbBase.tables);
    expect(now.sent).toEqual([]);
  });
});

describe('flag on ("1")', () => {
  it('sends one quiet-week email to each eligible member, with the digest headers, and stamps last_notified_at', async () => {
    const db = seed();
    const r = await runNotify(db, { flag: '1' });
    expect(r.status).toBe(200);
    const to = r.sent.map((m) => m.to).sort();
    expect(to).toEqual(['feedOnly@shop.test', 'limited@shop.test', 'paid@shop.test', 'pending@shop.test', 'quiet@shop.test', 'spanish@shop.test']);
    // unsubscribed, unverified, locked (trial ended), past due, emailed 3 days ago, account 2 days old: nothing
    for (const k of ['unsub', 'unverified', 'locked', 'pastDue', 'recent', 'newAccount']) expect(to, k).not.toContain(`${k}@shop.test`);
    // the pending member got the digest, not a quiet email
    expect(r.sent.filter((m) => m.to === 'pending@shop.test')).toHaveLength(1);
    expect(r.sent.find((m) => m.to === 'pending@shop.test')!.subject).not.toBe(en['email.subject.quiet']);
    expect(r.body).toMatchObject({ emailed: 1, quiet: { sent: 5, failed: 0 } });
    for (const m of r.sent) {
      expect(m.headers?.['List-Unsubscribe']).toMatch(/^<https?:\/\/[^>]+\/api\/cron\/notify\/unsubscribe\?t=[^>]+>$/);
      expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(m.html).toContain('2535 Dallas Highway SW STE B #1036, Marietta, GA 30064, USA');
      expect(m.text).toMatch(/(Turn off email alerts|Desactivar las alertas por correo): https?:\/\/\S+\/api\/cron\/notify\/unsubscribe\?t=/);
    }
    for (const id of [ID.quiet, ID.feedOnly, ID.spanish, ID.limited, ID.paid]) {
      expect(db.tables.holler_profiles.find((p) => p.user_id === id)!.last_notified_at, id).toBe(iso(NOW));
    }
    for (const id of [ID.unsub, ID.unverified, ID.locked, ID.newAccount]) expect(db.tables.holler_profiles.find((p) => p.user_id === id)!.last_notified_at).toBeNull();
    expect(db.tables.holler_profiles.find((p) => p.user_id === ID.recent)!.last_notified_at).toBe(iso(NOW - 3 * DAY));
    // one quiet email per member per day at the provider too
    expect(r.sent.filter((m) => m.to === 'quiet@shop.test')[0].idempotencyKey).toBe(`holler-quiet-week-${ID.quiet}-2026-11-23`);
  });

  it('says only what was checked: nothing matched, feed only, or the coverage gate\'s words; Spanish for a Spanish member', async () => {
    const r = await runNotify(seed(), { flag: '1' });
    const mail = (k: string) => r.sent.find((m) => m.to === `${k}@shop.test`)!;
    // nothing at all in 7 days (the only match is two weeks old): the claim is true, and it is the exact email the template makes
    const quiet = profile(ID.quiet);
    const expected = renderDigest({ businessName: quiet.business_name, items: [], totalCount: 0, appUrl: `${new URL(mail('quiet').headers!['List-Unsubscribe'].slice(1, -1)).origin}/app`, unsubscribeUrl: mail('quiet').headers!['List-Unsubscribe'].slice(1, -1), now: new Date(NOW), lang: 'en', coverage: digestCoverage(quiet), matchedLastWeek: 0 });
    expect(mail('quiet').html).toBe(expected.html);
    expect(mail('quiet').subject).toBe('A quiet week near you');
    expect(mail('quiet').text).toContain(en['email.empty.body']);
    // a feed-only match this week: never "no public record matched"
    expect(mail('feedOnly').subject).toBe(en['email.subject.quiet']);
    expect(mail('feedOnly').text).toContain(en['email.empty.feed_only']);
    expect(mail('feedOnly').text).not.toContain('No public record near you matched');
    // Atlanta lawn care is a 'limited' cell on /check: the email says so in the site's words
    expect(digestCoverage(profile(ID.limited, { categories: ['lawn-care'], ...ATLANTA }))).toEqual({ state: 'limited', trades: ['lawn-care'] });
    expect(mail('limited').text).toContain('Few records for lawn care near you so far');
    expect(mail('limited').text).not.toContain('Quiet weeks happen');
    // Spanish member
    expect(mail('spanish').html).toContain('lang="es"');
    expect(mail('spanish').text).toContain(es['email.empty.body']);
  });

  it('once, and not again within 7 days; again after 7 days', async () => {
    const db = seed();
    const first = await runNotify(db, { flag: '1' });
    expect(first.sent.filter((m) => m.to === 'quiet@shop.test')).toHaveLength(1);
    const got = new Set(first.sent.map((m) => m.to));
    expect(got.size).toBe(6);
    for (const later of [15 * 60_000, DAY, 6 * DAY + 23 * 3_600_000]) {
      const again = await runNotify(db, { flag: '1', nowMs: NOW + later });
      // nobody emailed in the first run (digest or quiet week) is emailed again inside 7 days
      expect(again.sent.filter((m) => got.has(m.to)).map((m) => m.to), `+${later / 3_600_000} h`).toEqual([]);
    }
    const week = await runNotify(db, { flag: '1', nowMs: NOW + 7 * DAY + 60_000 });
    expect(week.sent.map((m) => m.to)).toContain('quiet@shop.test');
  });

  it('a missing column on the live database does not break the cron (store columns 0020, area columns): read again without them', async () => {
    for (const missing of ['plan_source', 'extra_areas']) {
      const db = seed();
      const from = db.from.bind(db);
      db.from = ((table: string) => {
        const b = from(table);
        const select = b.select.bind(b);
        b.select = ((cols?: string, o?: { count?: string; head?: boolean }) => {
          if (table === 'holler_profiles' && cols?.includes(missing)) {
            db.failOn['holler_profiles.select'] = `column holler_profiles.${missing} does not exist`;
            db.failCode['holler_profiles.select'] = '42703';
          } else if (table === 'holler_profiles') {
            delete db.failOn['holler_profiles.select'];
          }
          return select(cols, o);
        }) as typeof b.select;
        return b;
      }) as typeof db.from;
      const r = await runNotify(db, { flag: '1' });
      expect(r.status, missing).toBe(200);
      expect(r.sent.map((m) => m.to), missing).toContain('quiet@shop.test');
      expect((r.body.quiet as { error?: string }).error, missing).toBeUndefined();
    }
  });

  it('every profile read failing (columns missing): the run still answers 200, sends no quiet email and says why', async () => {
    const db = seed();
    db.tables.holler_matches = db.tables.holler_matches.filter((m) => m.notified);
    db.failOn['holler_profiles.select'] = 'column holler_profiles.last_notified_at does not exist';
    db.failCode['holler_profiles.select'] = '42703';
    const r = await runNotify(db, { flag: '1' });
    expect(r.status).toBe(200);
    expect(r.sent).toEqual([]);
    expect(r.body).toMatchObject({ ok: true, quiet: { sent: 0, error: 'profiles_failed' } });
  });
});

describe('sendQuietWeek on its own', () => {
  const deps = (db: FakeDb, over: Partial<Parameters<typeof sendQuietWeek>[0]> = {}) => {
    const sent: Sent[] = [];
    return {
      sent,
      d: {
        db,
        now: new Date(NOW),
        siteUrl: 'https://localholler.com',
        secret: SECRET,
        emailOf: async (id: string) => EMAILS[id] ?? null,
        send: async (m: Sent) => (sent.push(m), { ok: true as const }),
        skip: new Set<string>(),
        cap: 150,
        outOfTime: () => false,
        ...over,
      },
    };
  };

  it('caps the run like the digest does (longest-unemailed first), and stops when out of time', async () => {
    const { sent, d } = deps(seed(), { cap: 2 });
    const c = await sendQuietWeek(d);
    expect(c.sent).toBe(2);
    expect(c.capped).toBeGreaterThan(0);
    expect(sent).toHaveLength(2);
    const late = deps(seed(), { outOfTime: () => true });
    expect((await sendQuietWeek(late.d)).sent).toBe(0);
  });

  it('a member with an un-notified match is never sent one, even when the digest did not read it', async () => {
    const { sent, d } = deps(seed());
    const c = await sendQuietWeek(d);
    expect(sent.map((m) => m.to)).not.toContain('pending@shop.test');
    expect(c.skipped_pending).toBe(1);
  });

  it('a missing matches table: no email for anyone (nothing could be checked), no throw', async () => {
    const db = seed();
    db.failOn['holler_matches.select'] = 'relation "public.holler_matches" does not exist';
    db.failCode['holler_matches.select'] = '42P01';
    const { sent, d } = deps(db);
    const c = await sendQuietWeek(d);
    expect(sent).toEqual([]);
    expect(c.skipped_check_failed).toBeGreaterThan(0);
  });

  it('no email provider: stops at the first skip; a failed send does not stamp the member', async () => {
    const skipped = deps(seed(), { send: async () => ({ skipped: true as const }) });
    const c = await sendQuietWeek(skipped.d);
    expect(c).toMatchObject({ sent: 0, skipped_no_email_provider: 1 });
    const db = seed();
    const failing = deps(db, { send: async () => ({ ok: false as const }) });
    const f = await sendQuietWeek(failing.d);
    expect(f.sent).toBe(0);
    expect(db.tables.holler_profiles.every((p) => p.last_notified_at === null || p.user_id === ID.recent || p.user_id === ID.paid)).toBe(true);
  });

  it('QUIET_WEEK_DAYS is 7', () => {
    expect(QUIET_WEEK_DAYS).toBe(7);
  });
});
