// Round 19 UNIFY: per-metro scorecard (lib/admin/metros.ts, metros-load.ts, metros-html.ts, GET /api/admin/metros). Rows are hand-written.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeDb } from '../ops/fakedb';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { METROS } from '@/lib/geo/metros';
import { buildMetroReport, metroOfRecord, metroOfZip, NATIONAL_SOURCES, sourcePlaces, type MetroInputs, type MetroSignalLite } from '@/lib/admin/metros';
import { renderMetrosHtml } from '@/lib/admin/metros-html';
import type { Db } from '@/lib/signals/store';
import { PAGE_WATCH_DATASETS } from '@/lib/signals/adapters/page-watch-datasets';
/** Round 20 page watch: its registered pages are on probation too. Exempted by exact id (never by prefix), and pinned below. */
const PW_REGISTERED: ReadonlySet<string> = new Set(PAGE_WATCH_DATASETS.filter((d) => d.verified).map((d) => d.id));


vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const SIGNALS: MetroSignalLite[] = [
  // Atlanta, a roof permit with a contractor on file: market insight for roofing (own trade), coming soon for gutters (downstream).
  { id: 1, source: 'arcgis-atlanta-permits', kind: 'permit', title: 'Roof permit in Atlanta', summary: 'Residential | $12,000 job value', lat: 33.75, lon: -84.39, state: 'GA', city: 'Atlanta', subtype: 'permit' },
  // Atlanta area, a code violation (act now; no contact path in this base).
  { id: 2, source: 'arcgis-dekalb-violations', kind: 'civic', title: 'Code violation in Decatur: ROOF IN DISREPAIR', summary: null, lat: 33.77, lon: -84.3, state: 'GA', city: 'Decatur', subtype: 'violation' },
  // New York, no coordinates, placed by city and state: a no-heat 311 row with the managing company on file.
  { id: 3, source: 'socrata-nyc-311', kind: 'civic', title: '311 request in New York: HEAT/HOT WATER', summary: null, lat: null, lon: null, state: 'NY', city: 'Brooklyn', subtype: '311', managerName: 'PRESTIGE MANAGEMENT INC', managerRole: 'agent' },
  // Austin: outside the 10 metros.
  { id: 4, source: 'socrata-austin-permits', kind: 'permit', title: 'Roof permit in Austin', summary: null, lat: 30.27, lon: -97.74, state: 'TX', city: 'Austin', subtype: 'permit' },
  // Stamford CT: inside the New York circle but not in a New York metro state.
  { id: 5, source: 'socrata-nyc-permits', kind: 'permit', title: 'Roof permit in Stamford', summary: null, lat: 41.0534, lon: -73.5387, state: 'CT', city: 'Stamford', subtype: 'permit' },
];

const ALERTS: MetroInputs['alerts'] = [
  { signal_id: 1, trade: 'roofing', created_at: ago(5) },
  { signal_id: 1, trade: 'siding-gutters', created_at: ago(6) },
  { signal_id: 2, trade: 'roofing', created_at: ago(7) },
  { signal_id: 3, trade: 'hvac', created_at: ago(8) },
  { signal_id: 4, trade: 'roofing', created_at: ago(9) },
  { signal_id: 5, trade: 'siding-gutters', created_at: ago(10) },
  { signal_id: null, trade: 'roofing', created_at: ago(11) },
  { signal_id: 1, trade: 'roofing', created_at: ago(24 * 8) }, // older than 7 days: not counted
];

const base = (over: Partial<MetroInputs> = {}): MetroInputs => ({
  now: NOW,
  alerts: ALERTS,
  signals: SIGNALS,
  namedContactIds: new Set([1]),
  adapters: ALL_ADAPTERS.map((a) => ({ id: a.id, probation: a.probation })),
  states: new Map([['arcgis-atlanta-permits', 'healthy'], ['arcgis-dekalb-permits', 'delayed'], ['carto-phl-permits', 'healthy']] as const),
  samples: new Map([['carto-phl-permits', 120], ['carto-phl-violations', 0]]),
  areaWaitlistZips: ['30080', '19103', '78701'],
  zipWaitlistZips: ['10001'],
  ...over,
});

describe('where sources and records are', () => {
  it('every registered adapter has a place or is a national source', () => {
    const places = sourcePlaces();
    const unplaced = ALL_ADAPTERS.map((a) => a.id).filter((id) => !places.has(id) && !NATIONAL_SOURCES.includes(id));
    expect(unplaced).toEqual([]);
  });

  it('places city and county sources in their metro, or in none', () => {
    const p = sourcePlaces();
    expect(p.get('carto-phl-permits')).toBe('philadelphia');
    expect(p.get('arcgis-atlanta-permits')).toBe('atlanta');
    expect(p.get('arcgis-dekalb-permits')).toBe('atlanta');
    expect(p.get('arcgis-cobb-residential-permits')).toBe('atlanta');
    expect(p.get('bids-gwinnett')).toBe('atlanta');
    expect(p.get('socrata-nyc-311')).toBe('new-york');
    expect(p.get('socrata-chicago-permits')).toBe('chicago');
    expect(p.get('arcgis-dc-permits')).toBe('washington-dc');
    expect(p.get('socrata-montgomery-permits')).toBe('washington-dc');
    expect(p.get('socrata-la-permits')).toBe('los-angeles');
    expect(p.get('socrata-dallas-311')).toBe('dallas-fort-worth');
    expect(p.get('socrata-austin-permits')).toBeNull();
  });

  it('places a record by coordinates in a metro state, else by core city and state (the scorecard SQL rule)', () => {
    expect(metroOfRecord(SIGNALS[0])).toBe('atlanta');
    expect(metroOfRecord(SIGNALS[2])).toBe('new-york');
    expect(metroOfRecord(SIGNALS[3])).toBeNull();
    expect(metroOfRecord(SIGNALS[4])).toBeNull();
    expect(metroOfZip('19103')).toBe('philadelphia');
    expect(metroOfZip('78701')).toBeNull();
  });
});

describe('buildMetroReport', () => {
  it('lists the 10 metros in registry order', () => {
    expect(buildMetroReport(base()).metros.map((m) => m.id)).toEqual(METROS.map((m) => m.id));
  });

  it('counts cards per metro and trade by this base label (lead-rules labelFor), last 7 days only', () => {
    const r = buildMetroReport(base());
    const atl = r.metros.find((m) => m.id === 'atlanta')!;
    expect(atl.cards.total).toBe(3);
    expect(atl.cards.byLabel).toEqual({ act_now: 1, coming_soon: 1, market_insight: 1, context: 0 });
    const roofing = atl.trades.find((t) => t.trade === 'roofing')!;
    expect(roofing.byLabel).toEqual({ act_now: 1, coming_soon: 0, market_insight: 1, context: 0 });
    expect(atl.trades.find((t) => t.trade === 'siding-gutters')!.byLabel.coming_soon).toBe(1);
    const ny = r.metros.find((m) => m.id === 'new-york')!;
    expect(ny.cards.byLabel.act_now).toBe(1); // no heat
    // Austin, Stamford CT and the pruned record are outside.
    expect(r.outside.total).toBe(3);
  });

  it('contact share: of alerted cards whose record can carry a contact path, the ones that have one', () => {
    const r = buildMetroReport(base());
    const atl = r.metros.find((m) => m.id === 'atlanta')!;
    // alerted: gutters on the permit (eligible, contractor on file) and the violation (not eligible); roofing permit is market insight.
    expect(atl.cards.alerted).toBe(2);
    expect(atl.cards.contactEligible).toBe(1);
    expect(atl.cards.withContact).toBe(1);
    expect(atl.cards.contactShare).toBe(1);
    const ny = r.metros.find((m) => m.id === 'new-york')!;
    expect(ny.cards).toMatchObject({ alerted: 1, contactEligible: 1, withContact: 1 }); // the managing company counts
    // A failed contact read is blank, never zero.
    const failed = buildMetroReport(base({ namedContactIds: null }));
    expect(failed.metros.find((m) => m.id === 'atlanta')!.cards.contactShare).toBeNull();
    expect(failed.sections.contacts).toBe('unavailable');
  });

  it('sources healthy and behind per metro; probation sources apart with their sample counts', () => {
    const r = buildMetroReport(base());
    const atl = r.metros.find((m) => m.id === 'atlanta')!;
    expect(atl.sources!.healthy).toBeGreaterThanOrEqual(1);
    expect(atl.sources!.behindIds).toContain('arcgis-dekalb-permits');
    const phl = r.metros.find((m) => m.id === 'philadelphia')!;
    expect(phl.sources!.total).toBe(0);
    // Round 20 page watch adds Philadelphia bid pages on probation (PW_REGISTERED, exact ids).
    expect(phl.probation.filter((p) => !PW_REGISTERED.has(p.id))).toEqual([
      { id: 'carto-phl-business', samples: 0, state: null },
      { id: 'carto-phl-permits', samples: 120, state: 'healthy' },
      { id: 'carto-phl-violations', samples: 0, state: null },
    ]);
    expect(r.national!.total).toBe(NATIONAL_SOURCES.length);
  });

  it('a missing samples table or failed state read is said, never zero', () => {
    const r = buildMetroReport(base({ samples: 'missing', states: null }));
    expect(r.sections.samples).toBe('missing');
    expect(r.metros.find((m) => m.id === 'philadelphia')!.probation[0].samples).toBeNull();
    expect(r.metros[0].sources).toBeNull();
    expect(r.notes.join(' ')).toMatch(/apply migration 0032/);
  });

  it('waitlist sign-ups per metro from both tables; a missing table is blank', () => {
    const r = buildMetroReport(base());
    expect(r.metros.find((m) => m.id === 'atlanta')!.waitlist).toEqual({ area: 1, zipConfirmed: 0 });
    expect(r.metros.find((m) => m.id === 'philadelphia')!.waitlist).toEqual({ area: 1, zipConfirmed: 0 });
    expect(r.metros.find((m) => m.id === 'new-york')!.waitlist).toEqual({ area: 0, zipConfirmed: 1 });
    const missing = buildMetroReport(base({ zipWaitlistZips: 'missing' }));
    expect(missing.sections.zipWaitlist).toBe('missing');
    expect(missing.metros[0].waitlist.zipConfirmed).toBeNull();
  });

  it('carries no record text, title, name or member id', () => {
    const json = JSON.stringify(buildMetroReport(base()));
    for (const s of ['Roof permit in', 'PRESTIGE', 'ROOF IN DISREPAIR', 'HEAT/HOT WATER', '30080', '10001']) expect(json, s).not.toContain(s);
  });

  it('the HTML page escapes, has one table per metro and no script', () => {
    const html = renderMetrosHtml(buildMetroReport(base()));
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toMatch(/<script/i);
    for (const m of METROS) expect(html).toContain(`<h2 id="${m.id}">`);
    expect(html).toContain('<th>Act now</th><th>Coming soon</th><th>Market insight</th><th>Context</th>');
    expect(html).toContain('carto-phl-permits: 120 sample rows');
    expect(html).not.toMatch(/\bleads?\b(?!-rules)|guaranteed|official record/i);
    expect(html).toContain('Dallas–Fort Worth');
  });
});

describe('loadMetroReport (read only, fake database)', () => {
  const seed = () =>
    new FakeDb({
      holler_alert_log: ALERTS.map((a, i) => ({ id: i + 1, user_id: `u${i}`, ...a })),
      holler_signals: SIGNALS.map((s) => ({ ...s })),
      holler_signal_contacts: [
        { id: 1, signal_id: 1, role: 'contractor', name: 'Acme Roofing LLC' },
        { id: 2, signal_id: 1, role: 'site', name: '' },
      ],
      holler_source_samples: [
        { id: 1, source: 'carto-phl-permits', external_id: 'a', fetched_at: ago(10), row: {} },
        { id: 2, source: 'carto-phl-permits', external_id: 'b', fetched_at: ago(24 * 20), row: {} },
      ],
      holler_area_waitlist: [{ id: 1, email: 'a@x.test', zip: '30080', trade: 'roofing' }],
      holler_zip_waitlist: [
        { id: 1, email: 'b@x.test', zip: '10001', confirmed_at: ago(3), unsubscribed_at: null },
        { id: 2, email: 'c@x.test', zip: '10001', confirmed_at: null, unsubscribed_at: null },
        { id: 3, email: 'd@x.test', zip: '10001', confirmed_at: ago(3), unsubscribed_at: ago(1) },
      ],
      holler_source_health: [],
      holler_scan_runs: [],
    });

  it('selects only; counts what the rows say', async () => {
    const { loadMetroReport } = await import('@/lib/admin/metros-load');
    const db = seed();
    const r = await loadMetroReport(db as unknown as Db, NOW);
    expect(db.calls.every((c) => c.endsWith('.select'))).toBe(true);
    const atl = r.metros.find((m) => m.id === 'atlanta')!;
    expect(atl.cards.total).toBe(3);
    expect(atl.cards.withContact).toBe(1);
    expect(r.metros.find((m) => m.id === 'philadelphia')!.probation.find((p) => p.id === 'carto-phl-permits')!.samples).toBe(1);
    expect(atl.waitlist.area).toBe(1);
    expect(r.metros.find((m) => m.id === 'new-york')!.waitlist.zipConfirmed).toBe(1);
    expect(r.sections).toMatchObject({ cards: 'ok', contacts: 'ok', sources: 'ok', samples: 'ok', areaWaitlist: 'ok', zipWaitlist: 'ok' });
    expect(JSON.stringify(r)).not.toMatch(/@x\.test|u0|Acme/);
  });

  it.each([
    ['PGRST205', "Could not find the table 'public.holler_source_samples' in the schema cache"],
    ['42P01', 'relation "public.holler_source_samples" does not exist'],
  ])('missing samples and zip waitlist tables (%s) are "missing", the rest still reads', async (code, message) => {
    const { loadMetroReport } = await import('@/lib/admin/metros-load');
    const db = seed();
    for (const k of ['holler_source_samples.select', 'holler_zip_waitlist.select']) {
      db.failOn[k] = message.replace('holler_source_samples', k.split('.')[0]);
      db.failCode[k] = code;
    }
    const r = await loadMetroReport(db as unknown as Db, NOW);
    expect(r.sections.samples).toBe('missing');
    expect(r.sections.zipWaitlist).toBe('missing');
    expect(r.sections.cards).toBe('ok');
    expect(r.metros.find((m) => m.id === 'atlanta')!.waitlist.area).toBe(1);
  });

  it('a failed alert log read makes the cards blank, never zero', async () => {
    const { loadMetroReport } = await import('@/lib/admin/metros-load');
    const db = seed();
    db.failOn['holler_alert_log.select'] = 'boom';
    const r = await loadMetroReport(db as unknown as Db, NOW);
    expect(r.sections.cards).toBe('unavailable');
    expect(r.notes.join(' ')).toMatch(/blank, not zero/);
  });
});

describe('GET /api/admin/metros', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@/lib/supabase/admin');
  });
  const SECRET = 'right-secret-for-tests-0123456789';

  it('401 without the Bearer secret; JSON and HTML with it', async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', SECRET);
    const db = new FakeDb({ holler_alert_log: [], holler_source_health: [], holler_scan_runs: [], holler_area_waitlist: [], holler_zip_waitlist: [], holler_source_samples: [] });
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    const { GET } = await import('@/app/api/admin/metros/route');
    expect((await GET(new NextRequest('https://localholler.com/api/admin/metros'))).status).toBe(401);
    expect((await GET(new NextRequest(`https://localholler.com/api/admin/metros?key=${SECRET}`))).status).toBe(401);
    const auth = { authorization: `Bearer ${SECRET}` };
    const json = await GET(new NextRequest('https://localholler.com/api/admin/metros', { headers: auth }));
    expect(json.status).toBe(200);
    expect(json.headers.get('cache-control')).toBe('no-store');
    const body = (await json.json()) as { metros: { id: string }[] };
    expect(body.metros).toHaveLength(10);
    const html = await GET(new NextRequest('https://localholler.com/api/admin/metros?format=html', { headers: auth }));
    expect(html.headers.get('content-type')).toMatch(/text\/html/);
    expect(await html.text()).toContain('Holler metro scorecard');
  });
});
