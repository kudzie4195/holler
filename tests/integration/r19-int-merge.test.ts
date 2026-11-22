/**
 * Round 19 integration, step 1 (r18-ship merged into r19-metros): the silent interactions between the two lines of work, one test each.
 *  - probation (r19) against the contact gate / alert_hold, work profiles and caps (r18): each keeps its own rule, neither re-enables the other;
 *  - lists (r18) never list a probation row; the business lookup (r18) never runs for one;
 *  - probation samples get the round 18 contact rule (contactsAllowedFor) instead of the removed noContactSubtype;
 *  - security: both sides' token pages are no-referrer, every admin route of both sides is Bearer-only and listed;
 *  - waitlist: the double opt-in path of r19 is the only sign-up path; nothing writes holler_area_waitlist;
 *  - trial: no member-facing string that came from r19-metros states a trial length.
 * Rows and fakes are hand-written. The /app page interactions are in tests/builders/app-section.test.ts, Spanish in tests/i18n/english-leak.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { matchArea, matchOne, matchSignals, membersOfTrade, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { PROBATION_SOURCE_IDS, isProbationSource } from '@/lib/signals/probation';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { buildList, isListablePermit } from '@/lib/lists/core';
import { lookupForCards, lookupSettings, newBudget } from '@/lib/enrich/business-lookup';
import { sanitizeSample } from '@/lib/signals/samples';
import type { ContactRecord } from '@/lib/contacts/types';
import type { SignalInput } from '@/lib/signals/types';
import { ENV, fakeFetch, item, newDb, NOW as LNOW } from '../enrich/helpers';

const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 39.95, lon: -75.16 }; // Philadelphia
const landscaper: MatchProfile = { user_id: 'm1', categories: ['landscaping', 'general-contractor'], lat: LOC.lat, lon: LOC.lon, state: 'PA', radius_mi: 25 };
let nextId = 1;
const rec = (over: Partial<MatchSignal> = {}): MatchSignal => ({
  id: nextId++,
  source: 'socrata-chicago-permits',
  kind: 'permit',
  subtype: 'permit',
  title: 'New home permit in Philadelphia',
  summary: 'New Construction | Single Family Dwelling | Issued',
  categories: ['general-contractor', 'real-estate', 'moving'],
  lat: LOC.lat + 0.01,
  lon: LOC.lon,
  state: 'PA',
  severity: 1,
  occurred_at: '2026-11-19T00:00:00Z',
  data: { subtype: 'permit' },
  ...over,
});
const PHL = 'carto-phl-permits';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('probation set', () => {
  it('equals the registry: exactly the adapters with probation on, and the three Philadelphia sources are in it', () => {
    expect([...PROBATION_SOURCE_IDS].sort()).toEqual(ALL_ADAPTERS.filter((a) => a.probation).map((a) => a.id).sort());
    for (const id of ['carto-phl-permits', 'carto-phl-violations', 'carto-phl-business']) expect(isProbationSource(id), id).toBe(true);
    expect(isProbationSource('socrata-chicago-permits')).toBe(false);
    expect(isProbationSource(null)).toBe(false);
  });
});

describe('probation (r19) and the contact gate, work profile and caps (r18): each keeps its own rule', () => {
  it('a probation row never matches, with or without a contact path, under any work profile; matchOne, matchArea and membersOfTrade agree', () => {
    const profiles: MatchProfile[] = [
      landscaper,
      { ...landscaper, user_id: 'm2', work_property: 'both', work_min_value: null, work_type: 'both' } as MatchProfile,
      { ...landscaper, user_id: 'm3', work_property: 'residential', work_min_value: 1000, work_type: 'installs' } as MatchProfile,
    ];
    const sigs = [rec({ source: PHL, contactPath: null }), rec({ source: PHL, contactPath: 'business' }), rec({ source: PHL, contactPath: 'site' }), rec({ source: PHL })];
    for (const gateOn of [false, true]) expect(matchSignals(sigs, profiles, undefined, NOW, gateOn)).toEqual([]);
    for (const s of sigs) {
      expect(matchOne(s, landscaper, false, NOW.getTime())).toBeNull();
      expect(matchArea(s, landscaper, false)).toBeNull();
      expect(membersOfTrade(s, 'general-contractor', profiles, false)).toBe(0);
    }
  });

  it('the same row from a live source: held (background) without a contact path, an alert with one; the probation rule does not touch it', () => {
    const none = rec({ contactPath: null });
    const biz = rec({ contactPath: 'business' });
    const phlNone = rec({ source: PHL, contactPath: null });
    const rows = matchSignals([none, biz, phlNone], [landscaper], undefined, NOW, false);
    expect(rows.map((r) => r.signal_id).sort()).toEqual([none.id, biz.id].sort());
    expect(rows.find((r) => r.signal_id === none.id)).toMatchObject({ alert_hold: 'background' });
    expect(rows.find((r) => r.signal_id === biz.id)).not.toHaveProperty('alert_hold');
  });

  it('a probation row takes no place in the per-member cap: 30 live alerts plus 30 probation rows give exactly the cap of live rows', async () => {
    const { MAX_MATCHES_PER_USER } = await import('@/lib/signals/match');
    const live = Array.from({ length: 30 }, () => rec({ contactPath: 'business' }));
    const phl = Array.from({ length: 30 }, () => rec({ source: PHL, contactPath: 'business' }));
    const rows = matchSignals([...phl, ...live], [landscaper], undefined, NOW, false);
    expect(rows).toHaveLength(MAX_MATCHES_PER_USER);
    const phlIds = new Set(phl.map((s) => s.id));
    expect(rows.some((r) => phlIds.has(r.signal_id))).toBe(false);
  });
});

describe('lists (r18) never list a probation row', () => {
  const permit = (source: string, n: number) => ({
    id: n, source, kind: 'permit', subtype: 'permit', title: 'Roof permit in Philadelphia', summary: `Roof | ${100 + n} MAIN ST`,
    occurred_at: '2026-11-19T00:00:00Z', lat: LOC.lat, lon: LOC.lon, zip: '19103', city: 'Philadelphia', state: 'PA', url: 'https://example.org/p', projectOf: null, categories: ['roofing'],
  });
  it('isListablePermit and buildList drop the probation source and keep the live one', () => {
    expect(isListablePermit(permit(PHL, 1) as never)).toBe(false);
    expect(isListablePermit(permit('socrata-chicago-permits', 2) as never)).toBe(true);
    const built = buildList([permit(PHL, 1), permit('socrata-chicago-permits', 2)] as never, { center: { lat: LOC.lat, lon: LOC.lon, radiusMi: 5 } });
    expect(built.entries.map((e) => e.address)).toEqual(['102 MAIN ST']);
  });
});

describe('business lookup (r18) never runs for a probation row', () => {
  it('a card from a probation source makes no call and gets no listing; the same card from a live source is looked up', async () => {
    const c: ContactRecord = { signalId: 1, role: 'contractor', name: 'Peachtree Roofing LLC', city: null, state: null };
    const deps = (fetch: unknown) => ({ db: newDb() as never, fetch: fetch as typeof globalThis.fetch, env: ENV, now: () => LNOW, sleep: async () => {} });
    const budget = () => newBudget(lookupSettings(ENV));
    const fetch1 = fakeFetch([item()]);
    const out1 = await lookupForCards(new Map([[1, [c]]]), [{ signalId: 1, city: 'Atlanta', state: 'GA', contact: c, source: PHL }], budget(), deps(fetch1));
    expect(fetch1).not.toHaveBeenCalled();
    expect(out1.get(1)![0].listing).toBeUndefined();
    const fetch2 = fakeFetch([item()]);
    const out2 = await lookupForCards(new Map([[1, [c]]]), [{ signalId: 1, city: 'Atlanta', state: 'GA', contact: c, source: 'socrata-chicago-permits' }], budget(), deps(fetch2));
    expect(fetch2).toHaveBeenCalledTimes(1);
    expect(out2.get(1)![0].listing).toBeTruthy();
  });

  it('the notify route passes the record source to the lookup', () => {
    expect(readFileSync('app/api/cron/notify/route.ts', 'utf8')).toMatch(/signalId: s\.id as number, city: s\.city, state: s\.state, source: s\.source \?\? null, contact:/);
  });
});

describe('probation samples get the round 18 contact rule (store.ts noContactSubtype was removed by r18)', () => {
  const s = (subtype: string, contacts: SignalInput['contacts']): SignalInput =>
    ({ source: PHL, externalId: 'x', kind: 'civic', title: 't', city: 'Philadelphia', state: 'PA', occurredAt: '2026-11-19T00:00:00Z', categories: [], data: { subtype }, contacts }) as unknown as SignalInput;
  it('311: none; violation: none with owners off, only the owner company with owners on; permit: no owner row', () => {
    const owner = { role: 'owner', name: 'Philadelphia Housing Authority' };
    const contractor = { role: 'contractor', name: 'Acme Roofing LLC' };
    expect(sanitizeSample(s('311', [contractor] as never)).contacts).toEqual([]);
    expect(sanitizeSample(s('violation', [owner, contractor] as never)).contacts).toEqual([]);
    vi.stubEnv('HOLLER_VIOLATION_OWNERS_ENABLED', '1');
    expect(sanitizeSample(s('violation', [owner, contractor] as never)).contacts?.map((c) => c.role)).toEqual(['owner']);
    expect(sanitizeSample(s('permit', [owner, contractor] as never)).contacts?.map((c) => c.role)).toEqual(['contractor']);
  });
});

describe('security after the merge', () => {
  it('both sides\' token pages are no-referrer: /waitlist/confirm (r19) and /es/confirm (r18)', async () => {
    const { TOKEN_PAGE_PATHS } = await import('@/lib/security-headers');
    expect(TOKEN_PAGE_PATHS).toEqual(expect.arrayContaining(['/waitlist/confirm', '/es/confirm', '/auth/confirm/continue', '/request/confirm']));
  });

  it('every admin and cron route on disk (r18 lookup-probe, stage-probe; r19 metros) is in the Bearer-only list and reads no ?key=', () => {
    const src = readFileSync('tests/security/cron-bearer-only.test.ts', 'utf8');
    const listed = [...src.slice(src.indexOf('const ROUTES = ['), src.indexOf('] as const;')).matchAll(/'([a-z-]+\/[a-z-]+)'/g)].map((m) => m[1]).sort();
    const onDisk = ['admin', 'cron'].flatMap((d) => readdirSync(`app/api/${d}`).filter((n) => { try { return statSync(`app/api/${d}/${n}/route.ts`).isFile(); } catch { return false; } }).map((n) => `${d}/${n}`)).sort();
    expect(listed).toEqual(onDisk);
    for (const r of ['admin/metros', 'admin/lookup-probe', 'admin/stage-probe', 'admin/firecrawl-probe', 'admin/quality', 'admin/scores', 'admin/sources']) {
      expect(listed, r).toContain(r);
      const route = readFileSync(`app/api/${r}/route.ts`, 'utf8');
      expect(route, r).not.toMatch(/searchParams\.get\(['"]key['"]\)/);
      expect(route, r).toMatch(/isBearerAuthorized|isCronAuthorized/);
    }
  });
});

describe('waitlist: the double opt-in path stands', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  const src = ['app', 'lib', 'components'].flatMap(files);

  it('no product file writes holler_area_waitlist; the only waitlist write is the double opt-in upsert into holler_zip_waitlist', () => {
    const writers = src.filter((f) => /holler_area_waitlist['"`]\)\s*\.(insert|upsert|update)/.test(readFileSync(f, 'utf8')));
    expect(writers).toEqual([]);
    const zipWriters = src.filter((f) => /from\(\s*(?:WAITLIST_TABLE|ZIP_WAITLIST_TABLE|'holler_zip_waitlist')\s*\)\s*\.(insert|upsert)/.test(readFileSync(f, 'utf8')));
    expect(zipWriters).toEqual(['lib/waitlist/deps.ts']);
  });

  it('the sign-up service sends a confirmation link and answers ok only when the email went out', async () => {
    const { WAITLIST_TABLE } = await import('@/lib/waitlist/service');
    expect(WAITLIST_TABLE).toBe('holler_zip_waitlist');
    const svc = readFileSync('lib/waitlist/service.ts', 'utf8');
    expect(svc).toMatch(/\/waitlist\/confirm\?token=/);
    expect(svc).toMatch(/sendConfirm/);
  });
});

describe('trial: no member-facing string from r19-metros states a trial length', () => {
  it('builders, waitlist (card, confirm page, email), the fifth Coming-next feature and the lifecycle chips', async () => {
    const { en } = await import('@/lib/i18n/en');
    const { es } = await import('@/lib/i18n/es');
    const { WAITLIST } = await import('@/lib/waitlist/copy');
    const { FEATURES } = await import('@/lib/interest/features');
    const keys = Object.keys(en).filter((k) => /^(builders\.|wl\.|next\.f\.more-areas|chip\.|chk\.uncovered)/.test(k));
    expect(keys.length).toBeGreaterThan(20);
    const texts = [
      ...keys.flatMap((k) => [(en as Record<string, string>)[k], (es as Record<string, string>)[k]]),
      ...Object.values(WAITLIST).flatMap((v) => (typeof v === 'function' ? [v('Philadelphia, PA')] : typeof v === 'string' ? [v] : Object.values(v))),
      ...FEATURES.flatMap((f) => [f.label, f.description]),
    ];
    const LENGTH = /\b(?:14|fourteen|60|sixty)[- ]?(?:day|días)|\b(?:two|2|dos)\s+(?:weeks|semanas|months|meses)\b|free trial|prueba gratis/i;
    expect(texts.filter((s) => LENGTH.test(s))).toEqual([]);
  });
});
