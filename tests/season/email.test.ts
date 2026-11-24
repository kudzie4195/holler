/**
 * Round 30: the season line ("This week in your area") in the alert digest and the quiet-week email (lib/email/templates.ts renderDigest
 * `season`, app/api/cron/notify/route.ts, lib/email/quiet-week.ts), behind HOLLER_SEASON_ENABLED.
 *
 *  - No season (no row applies, or the switch is off): renderDigest is byte-identical for every fixture card set, EN and ES, digest and
 *    quiet week; the cron with the switch off makes the same calls and sends the same bytes as f581d0c (the round 24 baseline the
 *    quiet-week suite also compares to); with the switch on and a day with no row (Jul 1) it sends the same bytes too.
 *  - Charlotte, siding and gutters, Dec 1 2026: the gutter line, its "Public source" link, in the HTML and the plain text, EN and ES,
 *    above the cards; in the quiet-week email under the quiet sentence.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { renderDigest, type DigestItem } from '@/lib/email/templates';
import { activeSeasons, seasonLines } from '@/lib/season/active';
import { SEASON_TABLE } from '@/lib/season/table';
import { lookupZip } from '@/lib/geo';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { FIXTURES, digestItem, NOW as FIX_NOW } from '../signals/brief-fixtures';
import { shipCases, shipDigestItem } from '../signals/ship-fixtures';

const CLT = lookupZip('28202')!;
const GUTTERS = SEASON_TABLE.find((r) => r.id === 'gutters-charlotte')!;
const DEC1 = new Date('2026-12-01T14:07:00.000Z');
const JUL1 = new Date('2026-07-01T14:07:00.000Z');
const APP = 'https://localholler.com/app';
const UNSUB = 'https://localholler.com/api/cron/notify/unsubscribe?t=x';

const seasonAt = (date: Date, trades: string[], lang: 'en' | 'es') => seasonLines(activeSeasons({ lat: CLT.lat, lon: CLT.lon, trades, date }), lang);

describe('renderDigest: byte-identical when no season applies', () => {
  it('every fixture card set, EN and ES, digest and quiet week: Jul 1 (no row) renders the same bytes as no season at all', async () => {
    const ship = await shipCases();
    const sets: DigestItem[][] = [FIXTURES.map(digestItem), ship.map(shipDigestItem), ...FIXTURES.map((c) => [digestItem(c)]), []];
    let n = 0;
    for (const lang of ['en', 'es'] as const) {
      const season = seasonAt(JUL1, ['siding-gutters', 'landscaping', 'lawn-care', 'cleaning'], lang);
      expect(season).toEqual([]);
      for (const items of sets) {
        for (const extra of [{}, { matchedLastWeek: 0 }, { matchedLastWeek: 3 }]) {
          const base = renderDigest({ businessName: 'Acme Gutters', items, appUrl: APP, unsubscribeUrl: UNSUB, now: FIX_NOW, lang, ...extra });
          for (const s of [season, null, undefined]) {
            const got = renderDigest({ businessName: 'Acme Gutters', items, appUrl: APP, unsubscribeUrl: UNSUB, now: FIX_NOW, lang, ...extra, season: s });
            expect(got.html).toBe(base.html);
            expect(got.text).toBe(base.text);
            expect(got.subject).toBe(base.subject);
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });
});

describe('renderDigest: Charlotte siding and gutters on Dec 1 2026', () => {
  const items = FIXTURES.slice(0, 3).map(digestItem);
  for (const lang of ['en', 'es'] as const) {
    const dict = lang === 'en' ? en : es;
    const text = lang === 'en' ? GUTTERS.en : GUTTERS.es;
    it(`${lang}: the alert digest carries one "${dict['season.h']}" line above the cards, html and text`, () => {
      const season = seasonAt(DEC1, ['siding-gutters'], lang);
      expect(season.map((l) => l.id)).toEqual(['gutters-charlotte']);
      const mail = renderDigest({ businessName: 'Acme Gutters', items, appUrl: APP, unsubscribeUrl: UNSUB, now: DEC1, lang, season });
      const base = renderDigest({ businessName: 'Acme Gutters', items, appUrl: APP, unsubscribeUrl: UNSUB, now: DEC1, lang });
      expect(mail.subject).toBe(base.subject);
      expect(mail.html).toContain(`<strong>${dict['season.h']}:</strong> ${text.replace(/'/g, '&#39;')}`);
      expect(mail.html).toContain(`<a class="h-link" href="${GUTTERS.source}"`);
      expect(mail.html).toContain(`>${dict['season.source']}</a>`);
      expect(mail.html.indexOf('data-season="gutters-charlotte"')).toBeLessThan(mail.html.indexOf('role="list"'));
      expect(mail.html.split('data-season=').length - 1).toBe(1);
      expect(mail.text).toContain(`${dict['season.h']}: ${text} ${dict['season.source']}: ${GUTTERS.source}\n\n`);
      expect(mail.text.indexOf(dict['season.h'])).toBeLessThan(mail.text.indexOf('1. '));
      // the season block is the only change
      expect(mail.html.replace(/<div style="margin:0;padding:0"><p class="h-why"[^]*?<\/p><\/div>/, '')).toBe(base.html);
      expect(mail.text.replace(`${dict['season.h']}: ${text} ${dict['season.source']}: ${GUTTERS.source}\n\n`, '')).toBe(base.text);
      expect(mail.html).not.toContain('—');
      expect(mail.text).not.toContain('—');
    });
    it(`${lang}: the quiet-week email carries the same line under the quiet sentence`, () => {
      const season = seasonAt(DEC1, ['siding-gutters'], lang);
      const mail = renderDigest({ businessName: 'Acme Gutters', items: [], totalCount: 0, appUrl: APP, unsubscribeUrl: UNSUB, now: DEC1, lang, matchedLastWeek: 0, season });
      expect(mail.html).toContain(`<strong>${dict['season.h']}:</strong>`);
      expect(mail.html.indexOf(dict['email.empty.body'].slice(0, 20))).toBeLessThan(mail.html.indexOf('data-season='));
      expect(mail.html.indexOf('data-season=')).toBeLessThan(mail.html.indexOf(dict['email.empty.next'].slice(0, 20)));
      expect(mail.text).toContain(`${dict['season.h']}: ${text} ${dict['season.source']}: ${GUTTERS.source}\n\n${dict['email.empty.next']}`);
    });
  }
  it('two lines: the label once, each line with its own link', () => {
    const season = seasonAt(DEC1, ['siding-gutters', 'landscaping'], 'en');
    expect(season.map((l) => l.id)).toEqual(['gutters-charlotte', 'leaf-cleanup-charlotte']);
    const mail = renderDigest({ businessName: 'Acme', items, appUrl: APP, unsubscribeUrl: UNSUB, now: DEC1, season });
    expect(mail.html.split(en['season.h']).length - 1).toBe(1);
    expect(mail.html.split(`>${en['season.source']}</a>`).length - 1).toBe(2);
    expect(mail.text.split(`${en['season.source']}: https://`).length - 1).toBe(2);
  });
});

// ---- the cron ------------------------------------------------------------------------------------------------------------------------

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const SECRET = 's3cret-not-real';
const ID = { pending: '30000000-0000-4000-8000-000000000001', quiet: '30000000-0000-4000-8000-000000000002', spanish: '30000000-0000-4000-8000-000000000003', austin: '30000000-0000-4000-8000-000000000004' };
const EMAILS: Record<string, string> = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, `${k}@shop.test`]));
const AUSTIN = lookupZip('78701')!;

function seed(nowMs: number): FakeDb {
  const profile = (id: string, over: Record<string, unknown> = {}) => ({
    user_id: id, business_name: `Gutters ${id.slice(-2)}`, categories: ['siding-gutters'], plan: null, alert_email: true, subscription_status: 'trialing',
    trial_ends_at: iso(nowMs + 10 * DAY), last_notified_at: null, email_verified_at: '2026-05-01T00:00:00Z', created_at: '2026-05-01T00:00:00Z',
    lat: CLT.lat, lon: CLT.lon, state: 'NC', extra_areas: null, plan_source: null, store_expires_at: null, language: 'en', ...over,
  });
  return new FakeDb({
    holler_profiles: [profile(ID.pending), profile(ID.quiet), profile(ID.spanish, { language: 'es' }), profile(ID.austin, { lat: AUSTIN.lat, lon: AUSTIN.lon, state: 'TX' })],
    holler_matches: [
      {
        id: 701, user_id: ID.pending, created_at: iso(nowMs - 3_600_000), notified: false, status: 'new',
        signal: { id: 9101, source: 'spc', external_id: 'x1', expires_at: null, kind: 'report', title: '1.75 inch hail reported near 2 ESE Charlotte, NC', summary: 'HAIL | Ping pong sized hail', url: 'https://www.spc.noaa.gov/x', city: 'Charlotte', state: 'NC', lat: 35.22, lon: -80.84, occurred_at: iso(nowMs - 2 * 3_600_000), severity: 3, categories: ['roofing', 'siding-gutters'], subtype: null },
      },
      { id: 702, user_id: ID.quiet, created_at: iso(nowMs - 14 * DAY), notified: true, status: 'done', signal: null },
    ],
  });
}

type Sent = { to: string; subject: string; html: string; text: string; headers?: Record<string, string>; idempotencyKey?: string };

async function runNotify(db: FakeDb, opts: { quiet?: string; season?: string; nowMs: number; routeFile?: string }) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', SECRET);
  if (opts.quiet === undefined) delete process.env.HOLLER_QUIET_WEEK_ENABLED;
  else vi.stubEnv('HOLLER_QUIET_WEEK_ENABLED', opts.quiet);
  if (opts.season === undefined) delete process.env.HOLLER_SEASON_ENABLED;
  else vi.stubEnv('HOLLER_SEASON_ENABLED', opts.season);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(opts.nowMs);
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
  delete process.env.HOLLER_SEASON_ENABLED;
  for (const m of ['@/lib/supabase/admin', '@/lib/outreach/loader', '@/lib/email', '@/lib/push/notify', '@/lib/analytics/server', 'server-only']) vi.doUnmock(m);
});

let baseDir = '';
let baseRoute = '';
beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'holler-notify-r30-'));
  baseRoute = join(baseDir, 'route.ts');
  writeFileSync(baseRoute, execFileSync('git', ['show', 'f581d0c:app/api/cron/notify/route.ts'], { encoding: 'utf8' }));
});
afterAll(() => rmSync(baseDir, { recursive: true, force: true }));

describe('the notify cron', () => {
  it('switch off, Dec 1 (a season day): same calls, rows and email bytes as f581d0c; no season line', async () => {
    for (const season of [undefined, '0', 'true', ' 1']) {
      const dbBase = seed(DEC1.getTime());
      const base = await runNotify(dbBase, { nowMs: DEC1.getTime(), routeFile: baseRoute });
      const dbNow = seed(DEC1.getTime());
      const now = await runNotify(dbNow, { nowMs: DEC1.getTime(), season });
      expect(now.body).toEqual(base.body);
      expect(dbNow.calls).toEqual(dbBase.calls);
      expect(dbNow.tables).toEqual(dbBase.tables);
      expect(now.sent).toEqual(base.sent);
      expect(now.sent.map((m) => m.to)).toEqual(['pending@shop.test']);
      expect(now.sent[0].html).not.toContain(en['season.h']);
    }
  });

  it('switch on, Jul 1 (no row applies): the email bytes and rows are the same as f581d0c; only the point read is added', async () => {
    const dbBase = seed(JUL1.getTime());
    const base = await runNotify(dbBase, { nowMs: JUL1.getTime(), routeFile: baseRoute });
    const dbNow = seed(JUL1.getTime());
    const now = await runNotify(dbNow, { nowMs: JUL1.getTime(), season: '1' });
    expect(now.body).toEqual(base.body);
    expect(now.sent).toEqual(base.sent);
    expect(dbNow.tables).toEqual(dbBase.tables);
    // exactly one extra call: the member point read (holler_profiles.select), right after the language read; everything else in order
    expect(dbNow.calls.length).toBe(dbBase.calls.length + 1);
    const at = dbNow.calls.findIndex((c, i) => c !== dbBase.calls[i]);
    expect(dbNow.calls[at]).toBe('holler_profiles.select');
    expect([...dbNow.calls.slice(0, at), ...dbNow.calls.slice(at + 1)]).toEqual(dbBase.calls);
  });

  it('switch on, Dec 1: the Charlotte gutters digest carries the gutter line in html and text', async () => {
    const r = await runNotify(seed(DEC1.getTime()), { nowMs: DEC1.getTime(), season: '1' });
    expect(r.sent.map((m) => m.to)).toEqual(['pending@shop.test']);
    const m = r.sent[0];
    expect(m.html).toContain(`<strong>${en['season.h']}:</strong> ${GUTTERS.en}`);
    expect(m.text).toContain(`${en['season.h']}: ${GUTTERS.en} ${en['season.source']}: ${GUTTERS.source}`);
  });

  it('a failed point read leaves the line out and the digest goes out as before', async () => {
    const db = seed(DEC1.getTime());
    const base = await runNotify(seed(DEC1.getTime()), { nowMs: DEC1.getTime() });
    // the point read is the only select of exactly these columns; make it fail
    const from = db.from.bind(db);
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = from(t) as unknown as { select: (c: string) => unknown };
      if (t !== 'holler_profiles') return b;
      const sel = b.select.bind(b);
      b.select = (c: string) => (c === 'user_id, lat, lon' ? { in: async () => ({ data: null, error: { message: 'boom' } }) } : sel(c));
      return b;
    };
    const r = await runNotify(db, { nowMs: DEC1.getTime(), season: '1' });
    expect(r.sent).toEqual(base.sent);
  });

  it('quiet week (both switches on), Dec 1: the Charlotte members get the line, EN and ES; Austin gets none for gutters', async () => {
    const r = await runNotify(seed(DEC1.getTime()), { nowMs: DEC1.getTime(), quiet: '1', season: '1' });
    const mail = (k: string) => r.sent.find((m) => m.to === `${k}@shop.test`)!;
    expect(mail('quiet').html).toContain(`<strong>${en['season.h']}:</strong> ${GUTTERS.en}`);
    expect(mail('quiet').text).toContain(`${en['season.h']}: ${GUTTERS.en} ${en['season.source']}: ${GUTTERS.source}`);
    expect(mail('spanish').html).toContain(`<strong>${es['season.h']}:</strong> ${GUTTERS.es}`);
    expect(mail('spanish').text).toContain(`${es['season.h']}: ${GUTTERS.es} ${es['season.source']}: ${GUTTERS.source}`);
    expect(mail('austin').html).not.toContain('data-season=');
    expect(mail('austin').text).not.toContain(en['season.h']);
  });

  it('quiet week on, season switch off, Dec 1: the quiet email is exactly the template without a season', async () => {
    const r = await runNotify(seed(DEC1.getTime()), { nowMs: DEC1.getTime(), quiet: '1' });
    for (const m of r.sent) expect(m.html).not.toContain('data-season=');
  });
});
