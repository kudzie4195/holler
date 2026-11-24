// Round 24 FIX2 (review D1): /check marks each record "Emailed as an alert" or "On your matches page", and only lists records a member
// with that one trade at that ZIP would have in the feed. Proved on the real 14-day export (gates/r19/data/signals-14d.json, read only)
// against the REAL notify route (app/api/cron/notify/route.ts): the matches are made by the scan's matchSignals for that member, fed to
// the notify GET through a fake admin client, and the ids it marks notified after the send are the ids it emailed.
// The local build has no database key, so this file is the proof for D1 (the saved HTML pages have empty lists).
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import { checkItemFor, placeOf, type CheckRow } from '@/lib/check/load';
import { memberItems } from '@/lib/check/delivery';
import { groupItems, type CheckItem } from '@/lib/check/group';
import { CHECK_SEARCH_RADIUS_MI, deriveScope } from '@/lib/check/scope';
import { haversineMi, lookupZip } from '@/lib/geo';
import { expandCategoriesForRouting } from '@/lib/signals/permit-routing';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { contactPathOf } from '@/lib/signals/alert-gate';
import { isPermitRecord } from '@/lib/signals/permit-routing';
import { CheckResults, deliveryCountLine } from '@/components/check-results';

// Round 24 FIX3 (review-FIX2 F10): HOLLER_D1_EXPORT only exists so tests/r24/check-delivery-skip.test.ts can prove the skip is visible.
const EXPORT = process.env.HOLLER_D1_EXPORT || '/home/claude/gates/r19/data/signals-14d.json';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const have = existsSync(EXPORT);
type ExportRow = CheckRow & { categories: string[]; data: Record<string, unknown> | null; summary: string | null };
const rows: ExportRow[] = have ? JSON.parse(readFileSync(EXPORT, 'utf8')) : [];

const PLACES: Array<[string, string, string]> = [
  ['Charlotte', '28202', 'siding-gutters'],
  ['Atlanta', '30318', 'landscaping'],
  ['Austin', '78701', 'landscaping'],
];

/** What loadCheck's reads return for the cell (the own-trade and routed reads, without their row limits), as check items. */
function cellItems(zip: string, trade: string): { items: CheckItem[]; candidates: ExportRow[] } {
  const place = lookupZip(zip)!;
  const sc = deriveScope(place);
  const cats = expandCategoriesForRouting([trade]);
  const candidates = rows.filter(
    (r) =>
      (r.categories ?? []).some((c) => cats.includes(c)) &&
      (r.lat == null ? r.state === sc.state && r.severity >= 2 : haversineMi(sc.cellLat, sc.cellLon, r.lat, r.lon as number) <= CHECK_SEARCH_RADIUS_MI),
  );
  const items = candidates.map((r) => checkItemFor(r, trade, NOW.getTime())).filter((x): x is CheckItem => !!x);
  return { items, candidates };
}

/** The scan's matches for one member at the ZIP with this one trade (default 25 miles), each record matched on its own (no per-scan cap). */
function scanMatches(zip: string, trade: string, recs: ExportRow[]) {
  const place = lookupZip(zip)!;
  const member: MatchProfile = { user_id: 'u1', categories: [trade], lat: place.lat, lon: place.lon, state: place.state, radius_mi: 25, plan: null, subscription_status: 'trialing' };
  const out: Array<{ id: number; user_id: string; created_at: string; alert_hold: string | null; signal: Record<string, unknown> }> = [];
  for (const r of recs) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const sub = typeof d.subtype === 'string' ? d.subtype : null;
    const sig: MatchSignal = { ...(r as unknown as MatchSignal), subtype: sub, data: d as MatchSignal['data'] };
    // The scan's contact gate input with no adapter contacts: the public summary alone (lib/signals/run.ts contactPathOf).
    if (isPermitRecord({ source: r.source, kind: r.kind, subtype: sub })) sig.contactPath = contactPathOf([], r.summary);
    const m = matchSignals([sig], [member], undefined, NOW, false)[0];
    if (!m) continue;
    out.push({
      id: 10_000_000 + r.id,
      user_id: 'u1',
      created_at: new Date(NOW.getTime() - 60_000).toISOString(),
      alert_hold: m.alert_hold ?? null,
      // The columns the notify route selects (flattened data keys as its PostgREST aliases deliver them).
      signal: {
        ...r,
        subtype: sub,
        approxLocation: d.approxLocation == null ? null : String(d.approxLocation),
        loc: d.loc ?? null,
        alertId: d.alertId ?? null,
        deadline: d.deadline ?? null,
        fixBy: d.fixBy ?? null,
        responseDeadline: d.responseDeadline ?? null,
        dueDate: d.dueDate ?? null,
        permitStage: d.permitStage ?? null,
      },
    });
  }
  return out;
}

const marked: Array<{ ids: number[]; afterSend: boolean }> = [];
let sends = 0;
function adminFake(matches: unknown[], trade: string) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let patch: unknown = null;
      for (const m of ['select', 'eq', 'order', 'is', 'gte', 'lte', 'not', 'limit']) q[m] = () => q;
      q.range = (a: number, b: number) => Promise.resolve({ data: table === 'holler_matches' ? matches.slice(a, b + 1) : [], error: null });
      q.update = (p: unknown) => ((patch = p), q);
      q.insert = () => Promise.resolve({ error: null });
      q.upsert = () => Promise.resolve({ error: null });
      q.in = (_col: unknown, ids: unknown) =>
        patch
          ? (table === 'holler_matches' && marked.push({ ids: ids as number[], afterSend: sends > 0 }), Promise.resolve({ error: null }))
          : Promise.resolve({
              data:
                table === 'holler_profiles'
                  ? [{ user_id: 'u1', business_name: 'Acme', categories: [trade], plan: null, alert_email: true, subscription_status: 'trialing', trial_ends_at: '2026-12-20T00:00:00Z', last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z', language: 'en' }]
                  : [],
              error: null,
            });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
  };
}

/** Runs the real notify GET over the member's matches and returns the record ids it emailed (marked notified after the send). */
async function emailedByNotify(matches: ReturnType<typeof scanMatches>, trade: string): Promise<Set<number>> {
  marked.length = 0;
  sends = 0;
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches, trade) }));
  vi.doMock('@/lib/outreach/loader', async (orig) => {
    const real = await orig<typeof import('@/lib/outreach/loader')>();
    return { ...real, loadMemberContacts: async () => new Map() };
  });
  vi.doMock('@/lib/push/notify', () => ({ pushNewMatches: async () => ({}) }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async () => (sends++, { ok: true, id: 'x' }),
  }));
  const GET = (await import('@/app/api/cron/notify/route')).GET;
  const res = await GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  expect(res.status).toBe(200);
  vi.unstubAllEnvs();
  return new Set(marked.filter((m) => m.afterSend).flatMap((m) => m.ids).map((id) => id - 10_000_000));
}

// Round 24 FIX3 (review-FIX2 F10): without the export the D1 cases are skipped by name, never silently.
if (!have) {
  describe('D1: /check marks match what the notify route really emails (14-day export)', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN): every D1 case on real records`, () => {});
  });
}
describe.skipIf(!have)('D1: /check marks match what the notify route really emails (14-day export)', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => vi.useRealTimers());

  const counts: Record<string, { listed: number; email: number; feed: number }> = {};

  for (const [name, zip, trade] of PLACES) {
    it(`${name} ${zip} ${trade}: every "emailed" row is emailed by the notify route, every "matches page" row is not`, async () => {
      const place = lookupZip(zip)!;
      const { items, candidates } = cellItems(zip, trade);
      const member = memberItems(items, place, trade);
      const listed = groupItems(member as CheckItem[], NOW.getTime(), { lat: place.lat, lon: place.lon }).flatMap((g) => g.items);
      expect(listed.length).toBeGreaterThan(0);
      const emailed = await emailedByNotify(scanMatches(zip, trade, candidates), trade);
      expect(emailed.size).toBeGreaterThan(0);
      // Every member item, not only the listed ones.
      for (const it of member) {
        if (it.delivery === 'email') expect(emailed.has(it.id), `${it.id} ${it.title}`).toBe(true);
        else expect(emailed.has(it.id), `${it.id} ${it.title}`).toBe(false);
      }
      // And nothing the route emails to this member is missing from the member's items.
      const memberIds = new Set(member.map((i) => i.id));
      for (const id of emailed) expect(memberIds.has(id), String(id)).toBe(true);
      counts[name] = { listed: listed.length, email: listed.filter((i) => i.delivery === 'email').length, feed: listed.filter((i) => i.delivery === 'feed').length };
      // The counted sentence is computed from the listed rows.
      const line = deliveryCountLine(listed, 'en');
      const c = counts[name];
      // R25 check fix (review R25CHECK P1-1): the line speaks only of the rows shown.
      expect(line).toBe(c.email === 0 ? `Of the ${c.listed} shown here, none would have been emailed to you. They would be on your matches page.` : c.email === c.listed ? `Of the ${c.listed} shown here, all would have been emailed to you as alerts.` : `Of the ${c.listed} shown here, ${c.email} would have been emailed to you as ${c.email === 1 ? 'an alert' : 'alerts'}. The rest would be on your matches page.`);
    }, 60_000);
  }

  it('Charlotte siding-gutters: the downstream roof permits are listed and marked emailed; the own-trade permits are matches page only', () => {
    const place = lookupZip('28202')!;
    const member = memberItems(cellItems('28202', 'siding-gutters').items, place, 'siding-gutters') as CheckItem[];
    const roof = member.filter((i) => i.title === 'Roof permit in Mecklenburg County');
    expect(roof.length).toBeGreaterThan(0);
    expect(roof.every((i) => i.delivery === 'email')).toBe(true);
    const own = member.filter((i) => /siding permit/.test(i.title));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((i) => i.delivery === 'feed')).toBe(true);
  });

  it('Atlanta and Austin landscaping: downstream new-build permits are listed and emailed', () => {
    for (const zip of ['30318', '78701']) {
      const place = lookupZip(zip)!;
      const member = memberItems(cellItems(zip, 'landscaping').items, place, 'landscaping') as CheckItem[];
      const down = member.filter((i) => /New (construction|home) permit/.test(i.title) && i.delivery === 'email');
      expect(down.length, zip).toBeGreaterThan(0);
    }
  });

  it('records no member feed would show are not listed (context, other trades), and record fields never reach the page', () => {
    const place = lookupZip('78701')!;
    const { items, candidates } = cellItems('78701', 'landscaping');
    expect(items.length).toBeLessThan(candidates.length);
    const member = memberItems(items, place, 'landscaping');
    for (const it of member) expect(it).not.toHaveProperty('signal');
    // An Austin structure condition violation is tagged for other trades only: landscaping never sees it.
    expect(member.some((i) => /Structure Condition/.test(i.title))).toBe(false);
  });

  it('counts (for the report)', () => {
    console.log('[D1 counts]', JSON.stringify(counts));
    expect(Object.keys(counts)).toHaveLength(3);
  });
});

describe('D1: the page says only what the listed rows support (EN and ES)', () => {
  const base = { id: 1, kind: 'permit', source: 'socrata-austin-permits', title: 'New construction permit in Austin', url: 'https://example.com/x', place: 'Austin, TX', lat: 30.27, lon: -97.74, occurredAt: '2026-11-20T12:00:00Z', severity: 1 };
  const render = (items: CheckItem[], lang: 'en' | 'es') =>
    renderToStaticMarkup(
      createElement(CheckResults, { items, mode: 'results', checkedAt: '2026-11-23T12:00:00Z', placeLabel: 'Austin, TX', trade: 'landscaping', tradeLabel: 'Landscaping', citySlug: 'austin-tx', watches: [], now: NOW.getTime(), origin: { lat: 30.27, lon: -97.74 }, lang }),
    );

  it('a mixed list: marks on each row, the counted sentence and an email promise that names the marked rows', () => {
    const items: CheckItem[] = [{ ...base, id: 1, delivery: 'email' }, { ...base, id: 2, title: 'Landscaping permit in Austin', delivery: 'feed' }];
    const en = render(items, 'en');
    expect(en).toContain('Emailed as an alert');
    expect(en).toContain('On your matches page, not emailed');
    expect(en).toContain('Of the 2 shown here, 1 would have been emailed to you as an alert. The rest would be on your matches page.');
    expect(en).toContain('Alerts like the ones marked above are emailed as they appear. The rest are on your matches page.');
    expect(en).toContain('Get alerts by email. 30-day free trial, no card');
    expect(en).not.toContain('Get these by email');
    const es = render(items, 'es');
    expect(es).toContain('Enviado por correo como alerta');
    expect(es).toContain('En su página de coincidencias, sin correo');
    expect(es).toContain('De los 2 que se muestran aquí, 1 se le habría enviado por correo como alerta.');
    expect(es).toContain('Reciba alertas por correo. Prueba gratis de 30 días, sin tarjeta');
  });

  it('a list where nothing would be emailed: no sentence and no button promises email', () => {
    const items: CheckItem[] = [{ ...base, id: 1, delivery: 'feed' }, { ...base, id: 2, delivery: 'feed' }];
    const en = render(items, 'en');
    expect(en).toContain('Of the 2 shown here, none would have been emailed to you. They would be on your matches page.');
    expect(en).toContain('Records like these are on your matches page when you log in.');
    expect(en).toContain('Start your 30-day free trial, no card');
    expect(en).not.toMatch(/by email|land in your inbox|are emailed as they appear/i);
    const es = render(items, 'es');
    expect(es).toContain('De los 2 que se muestran aquí, ninguno se le habría enviado por correo.');
    expect(es).toContain('Empiece su prueba gratis de 30 días, sin tarjeta');
    expect(es).not.toMatch(/por correo como alertas|Reciba alertas por correo|llegan por correo/i);
  });

  it('record links say "Public source" (EN) and "Fuente pública" (ES)', () => {
    const items: CheckItem[] = [{ ...base, delivery: 'email' }];
    expect(render(items, 'en')).toContain('Public source: ');
    expect(render(items, 'es')).toContain('Fuente pública: ');
  });
});

describe('D1: the list is the member area (25 miles from the ZIP), by the scan\'s own area test', () => {
  it('a record 30 miles from the ZIP is read for the cell but not listed; one 10 miles away is', () => {
    const place = lookupZip('30318')!;
    const at = (miles: number): CheckRow => ({
      id: miles, source: 'socrata-atlanta-permits', kind: 'permit', title: 'New home permit in Atlanta', url: null, city: 'Atlanta', state: 'GA',
      lat: place.lat + miles / 69.09, lon: place.lon, severity: 1, occurred_at: '2026-11-20T12:00:00Z', summary: '12 Main St NW', categories: ['general-contractor'], data: { subtype: 'permit' },
    });
    const items = [at(10), at(30)].map((r) => checkItemFor(r, 'landscaping', NOW.getTime())).filter((x): x is CheckItem => !!x);
    expect(items.map((i) => i.id)).toEqual([10, 30]);
    expect(memberItems(items, place, 'landscaping').map((i) => i.id)).toEqual([10]);
  });

  it('a city stored as "0" or blank is not a place: the state alone (review P3-6)', () => {
    expect(placeOf('0', 'MI')).toBe('MI');
    expect(placeOf('', 'MI')).toBe('MI');
    expect(placeOf(' - ', null)).toBe(null);
    expect(placeOf('Austin', 'TX')).toBe('Austin, TX');
  });
});
