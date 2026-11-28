/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Round 35: follow-up emails (lifecycle welcome, trial-ending, recap; the outcome follow-up) apply the feed's bid switches, the owner's bid
 * retirement and the alert hold, behind HOLLER_FOLLOWUP_FILTER_ENABLED (off by default). Off, the queries and the emails are what they were.
 * Everything runs through the real store, the real run and the real templates, in English and Spanish.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeDb } from '../ops/fakedb';
import { createStore, type FullProfile } from '@/lib/lifecycle/store';
import { missedSince } from '@/lib/lifecycle/missed';
import { buildMail, runLifecycle } from '@/lib/lifecycle/run';
import { runMoat } from '@/lib/moat/run';
import { FOLLOWUP_FILTER_FLAG, FOLLOWUP_SIGNAL_SELECT, followupDrop, followupFilterEnabled } from '@/lib/signals/followup-filter';
import { ENV_KEYS } from '@/lib/env';
import { makeDb } from '../moat/fakedb';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

const U = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-11-28T15:00:00Z');
const NOW_MS = NOW.getTime();
const FUTURE = '2026-12-20T00:00:00Z';
const PAST = '2026-11-20T00:00:00Z';

/** The select text main sent before round 35 (copied from main, character for character). */
const MAIN_SELECT =
  'status, signal:holler_signals(id, source, kind, title, summary, categories, city, state, lat, lon, severity, occurred_at, subtype:data->>subtype, permitStage:data->>permitStage,permitStageAt:data->>permitStageAt,permitStageUpdate:data->>permitStageUpdate, maxHailSizeIn:data->>maxHailSizeIn,maxWindGustMph:data->>maxWindGustMph,hazardFrom:data->>hazardFrom)';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const sig = (id: number, over: Record<string, unknown> = {}) => ({
  id, source: 'nws', kind: 'alert', title: `Severe Thunderstorm Warning: Fulton County, GA ${id}`, summary: null, city: 'Atlanta', state: 'GA', severity: 2,
  categories: ['tree-service'], occurred_at: `2026-11-${10 + id}T00:00:00Z`, subtype: null, ...over,
});
const bid = (id: number, source: string, over: Record<string, unknown> = {}) => sig(id, { source, kind: 'contract', subtype: 'bid', title: `Open bid in San Francisco: Zebra tree work ${id}`, expires_at: FUTURE, dueDate: null, retiredAt: null, ...over });
const match = (id: number, signal: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ id, user_id: U, status: 'new', created_at: `2026-11-${10 + id}T00:00:00Z`, alert_hold: null, signal, ...over });

/** One world: a plain alert (1), a city bid (2), an E-Rate row (3), a closed bid (4), a retired hand-added bid (5), a held permit (6), a held licence (7). */
function world() {
  return new FakeDb({
    holler_matches: [
      match(1, sig(1)),
      match(2, bid(2, 'bids-sf')),
      match(3, bid(3, 'bids-erate', { title: 'Open bid in Astoria: Marmot network cabling 3' })),
      match(4, bid(4, 'bids-sf', { expires_at: PAST, title: 'Open bid in San Francisco: Closed tree work 4' })),
      match(5, bid(5, 'bids-manual', { retiredAt: PAST, expires_at: FUTURE, title: 'Open bid in Atlanta: Retired tree work 5' })),
      match(6, sig(6, { title: 'Severe Thunderstorm Warning: Fulton County, GA Held permit 6' }), { alert_hold: 'background' }),
      match(7, sig(7, { title: 'Severe Thunderstorm Warning: Fulton County, GA Held licence 7' }), { alert_hold: 'below_min' }),
    ],
  });
}
const ids = (r: { items: { id: number }[] }) => r.items.map((i) => i.id).sort((a, b) => a - b);
const TRADES = ['tree-service'];

function setSwitches(o: { filter?: string; bids?: string; erate?: string }) {
  vi.stubEnv('HOLLER_FOLLOWUP_FILTER_ENABLED', o.filter ?? '');
  vi.stubEnv('HOLLER_BIDS_ENABLED', o.bids ?? '');
  vi.stubEnv('HOLLER_ERATE_ENABLED', o.erate ?? '');
}

describe('the switch', () => {
  it('is off unless 1, true, on or yes, and is a listed env key with LAUNCH.md and .env.example entries', () => {
    expect(FOLLOWUP_FILTER_FLAG).toBe('HOLLER_FOLLOWUP_FILTER_ENABLED');
    expect(followupFilterEnabled(undefined)).toBe(false);
    for (const v of ['', '0', 'false', 'off', 'no', '2', 'enabled']) expect(followupFilterEnabled(v)).toBe(false);
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(followupFilterEnabled(v)).toBe(true);
    expect(ENV_KEYS as readonly string[]).toContain(FOLLOWUP_FILTER_FLAG);
    expect(readFileSync(join(__dirname, '../../LAUNCH.md'), 'utf8')).toContain(FOLLOWUP_FILTER_FLAG);
    expect(readFileSync(join(__dirname, '../../.env.example'), 'utf8')).toMatch(/^HOLLER_FOLLOWUP_FILTER_ENABLED=$/m);
  });
});

describe('switch OFF (the default): the queries and the lists are what they were', () => {
  it('sends main\'s select, character for character, and lists every match the old code listed (bids included, even with the bid switches off)', async () => {
    setSwitches({ bids: '', erate: '' });
    const db = world();
    const selects: string[] = [];
    const wrapped = { from: (t: string) => { const b = db.from(t) as any; const s = b.select.bind(b); b.select = (c?: string, o?: any) => (t === 'holler_matches' && selects.push(c ?? ''), s(c, o)); return b; }, auth: {} };
    const r = await createStore(wrapped as never).matchesOf(U, TRADES);
    expect(selects).toEqual([MAIN_SELECT]);
    expect(r.dropped).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual(['capped', 'items', 'total']);
    expect(ids(r)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('without trades every match is listed, as before', async () => {
    setSwitches({});
    expect(ids(await createStore(world() as never).matchesOf(U))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('the moat run is unchanged: a switched-off bid is still asked about, no count key appears, the signals select has no new column', async () => {
    setSwitches({ bids: '' });
    const { db, selects } = moatWorld();
    const c = await runMoat({ db, now: NOW, dry: true, siteUrl: 'https://x.test', secret: 's', send: vi.fn() as never });
    expect(c.followup_dropped).toBeUndefined();
    expect(c.candidates).toBe(4);
    expect(selects).toEqual(['id, source, kind, title, city, state, occurred_at']);
  });
  it('the lifecycle run summary has no followup_dropped key', async () => {
    setSwitches({});
    const s = await runWelcome('en');
    expect((s as any).followup_dropped).toBeUndefined();
  });
});

describe('switch ON: lifecycle lists (welcome, trial-ending, recap)', () => {
  it('bids switch off: every bid source is dropped, so are retired and held matches; the plain alert stays; counts add up', async () => {
    setSwitches({ filter: '1', bids: '' });
    const r = await createStore(world() as never).matchesOf(U, TRADES);
    expect(ids(r)).toEqual([1]);
    // The two feed-only matches (6, 7) are not listed as alerts but are still matches: they count.
    expect(r.total).toBe(3);
    expect(r.feedOnly).toBe(2);
    // 2, 3, 4 are bids (bid switch off), 5 is retired (reported first).
    expect(r.dropped).toEqual({ retired: 1, bid_hidden: 3 });
  });
  it('bids on, E-Rate empty: only the E-Rate row, the closed bid, the retired bid and the held matches go', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '' });
    const r = await createStore(world() as never).matchesOf(U, TRADES);
    expect(ids(r)).toEqual([1, 2]);
    expect(r.total).toBe(4);
    expect(r.dropped).toEqual({ retired: 1, bid_hidden: 2 });
  });
  it('bids on and E-Rate on: the E-Rate row stays; the closed, retired and held ones still go', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '1' });
    const r = await createStore(world() as never).matchesOf(U, TRADES);
    expect(ids(r)).toEqual([1, 2, 3]);
    expect(r.total).toBe(5);
    expect(r.dropped).toEqual({ retired: 1, bid_hidden: 1 });
  });
  it('a retired hand-added bid is dropped even when its due date is still in the future (data.retiredAt alone)', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '1' });
    const db = new FakeDb({ holler_matches: [match(5, bid(5, 'bids-manual', { retiredAt: PAST, expires_at: FUTURE })), match(8, bid(8, 'bids-manual', { retiredAt: null, expires_at: FUTURE, title: 'Open bid in Atlanta: Live manual bid 8' }))] });
    const r = await createStore(db as never).matchesOf(U, TRADES);
    expect(ids(r)).toEqual([8]);
    expect(r.dropped).toEqual({ retired: 1, bid_hidden: 0 });
  });
  it('the select adds only the bid columns and alert_hold; a database before 0027 is read again without alert_hold (bids still filtered, held not)', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '1' });
    const db = world();
    const selects: string[] = [];
    let failed = false;
    const wrapped = {
      auth: {},
      from: (t: string) => {
        const b = db.from(t) as any;
        const s = b.select.bind(b);
        b.select = (c?: string, o?: any) => {
          if (t !== 'holler_matches') return s(c, o);
          selects.push(c ?? '');
          if ((c ?? '').includes('alert_hold') && !failed) {
            failed = true;
            // A database without the column holds no alert_hold in its rows either (the fake returns whole rows, whatever the select says).
            for (const r of db.tables.holler_matches) delete r.alert_hold;
            db.failOn['holler_matches.select'] = 'column holler_matches.alert_hold does not exist';
            db.failCode['holler_matches.select'] = '42703';
          } else delete db.failOn['holler_matches.select'];
          return s(c, o);
        };
        return b;
      },
    };
    const r = await createStore(wrapped as never).matchesOf(U, TRADES);
    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain('status, alert_hold, signal:holler_signals(');
    expect(selects[0]).toContain(FOLLOWUP_SIGNAL_SELECT);
    expect(selects[1]).not.toContain('alert_hold');
    expect(selects[1]).toContain(FOLLOWUP_SIGNAL_SELECT);
    expect(ids(r)).toEqual([1, 2, 3, 6, 7]);
    expect(r.dropped).toEqual({ retired: 1, bid_hidden: 1 });
    expect(r.feedOnly).toBe(0);
  });
  it('any other read error still throws', async () => {
    setSwitches({ filter: '1' });
    const db = world();
    db.failOn['holler_matches.select'] = 'boom';
    await expect(createStore(db as never).matchesOf(U, TRADES)).rejects.toThrow('matches: boom');
  });
});

describe('the emails, English and Spanish', () => {
  const prof: FullProfile = {
    user_id: U, business_name: 'Acme Trees', created_at: '2026-11-27T00:00:00Z', email_verified_at: '2026-11-27T01:00:00Z', subscription_status: 'trialing',
    trial_ends_at: '2026-12-03T00:00:00Z', stripe_subscription_id: null, categories: ['tree-service'], lat: 33.7, lon: -84.4, state: 'GA', radius_mi: 25,
  };
  const mail = async (kind: 'welcome' | 'trial_ending', lang: 'en' | 'es', rows: number[]) => {
    const all = (world() as any).tables.holler_matches.filter((m: any) => rows.includes(m.id));
    const store = createStore(new FakeDb({ holler_matches: all }) as never);
    const drops: any[] = [];
    const m = await buildMail(kind, prof, { store, siteUrl: 'https://localholler.com', secret: 'test-secret', langFor: async () => lang }, NOW, (d) => drops.push(d));
    return { m: m!, drops };
  };
  // Each group: the plain alert (1) plus two matches the feed hides, the switches that make them hidden, and the count the filter reports.
  const GROUPS = [
    { name: 'a switched-off city bid and an E-Rate row', rows: [1, 2, 3], sw: { bids: '' }, hidden: ['Zebra tree work 2', 'Marmot network cabling'], drops: { retired: 0, bid_hidden: 2, held: 0 } },
    { name: 'a retired hand-added bid and a held permit', rows: [1, 5, 6], sw: { bids: '1', erate: '1' }, hidden: ['Retired tree work 5', 'Held permit 6'], drops: { retired: 1, bid_hidden: 0, held: 1 } },
    { name: 'a closed bid and a held licence', rows: [1, 4, 7], sw: { bids: '1', erate: '1' }, hidden: ['Closed tree work 4', 'Held licence 7'], drops: { retired: 0, bid_hidden: 1, held: 1 } },
    { name: 'an E-Rate row with HOLLER_ERATE_ENABLED empty (city bids on)', rows: [1, 2, 3], sw: { bids: '1', erate: '' }, hidden: ['Marmot network cabling'], drops: { retired: 0, bid_hidden: 1, held: 0 } },
  ];
  for (const kind of ['welcome', 'trial_ending'] as const) {
    for (const lang of ['en', 'es'] as const) {
      for (const g of GROUPS) {
        it(`${kind} ${lang}, ${g.name}: switch off names them; switch on does not and keeps the plain alert`, async () => {
          setSwitches(g.sw);
          const off = await mail(kind, lang, g.rows);
          const offBody = off.m.html + off.m.text;
          for (const n of g.hidden) expect(offBody).toContain(n);
          expect(off.drops).toEqual([]);

          setSwitches({ ...g.sw, filter: '1' });
          const on = await mail(kind, lang, g.rows);
          const body = on.m.html + on.m.text;
          for (const n of g.hidden) expect(body).not.toContain(n);
          expect(body).toContain('Fulton County, GA 1');
          expect(on.drops).toEqual([g.drops]);
        });
      }
    }
  }
  it('a welcome whose only matches are bids the feed hides does not name them (quiet email, no stub)', async () => {
    setSwitches({ filter: '1', bids: '' });
    const db = new FakeDb({ holler_matches: [match(2, bid(2, 'bids-sf')), match(5, bid(5, 'bids-manual', { retiredAt: PAST }))] });
    const m = await buildMail('welcome', prof, { store: createStore(db as never), siteUrl: 'https://localholler.com', secret: 'test-secret' }, NOW);
    expect((m?.html ?? '') + (m?.text ?? '')).not.toMatch(/Zebra|Retired tree/);
  });
});

// ---- P1-1: feed-only matches are still matches ------------------------------------------------------------------------------------
const permit = (id: number, over: Record<string, unknown> = {}) => ({
  id, source: 'arcgis-dekalb-permits', kind: 'permit', subtype: 'permit', title: `New home permit in DeKalb County ${id}`, summary: 'New Construction | Single Family Dwelling | Issued',
  city: 'Decatur', state: 'GA', severity: 1, categories: ['general-contractor'], occurred_at: `2026-11-${10 + id}T00:00:00Z`, ...over,
});
const gcProf: FullProfile = {
  user_id: U, business_name: 'Acme Builders', created_at: '2026-11-27T00:00:00Z', email_verified_at: '2026-11-27T01:00:00Z', subscription_status: 'trialing',
  trial_ends_at: '2026-12-03T00:00:00Z', stripe_subscription_id: null, categories: ['general-contractor'], lat: 33.7, lon: -84.4, state: 'GA', radius_mi: 25,
};
const onlyHeld = () => new FakeDb({
  holler_matches: [
    match(1, permit(1), { alert_hold: 'background' }),
    match(2, permit(2), { alert_hold: 'below_min' }),
    match(3, permit(3), { alert_hold: 'held' }),
  ],
});
const mailFor = async (db: FakeDb, kind: 'welcome' | 'trial_ending', lang: 'en' | 'es') =>
  buildMail(kind, gcProf, { store: createStore(db as never), siteUrl: 'https://localholler.com', secret: 'test-secret', langFor: async () => lang }, NOW);

describe('P1-1: a member whose only matches are feed only is never told nothing matched (quietPreview not stubbed)', () => {
  it('the store counts them and lists none', async () => {
    setSwitches({ filter: '1' });
    const r = await createStore(onlyHeld() as never).matchesOf(U, ['general-contractor']);
    expect(r.items).toHaveLength(0);
    expect(r.total).toBe(3);
    expect(r.feedOnly).toBe(3);
  });
  it('welcome EN: "3 records already match", no "nothing has matched", no titles', async () => {
    setSwitches({ filter: '1' });
    const m = (await mailFor(onlyHeld(), 'welcome', 'en'))!;
    const body = m.html + m.text;
    expect(body).toContain('3 records already match');
    expect(body).not.toMatch(/nothing has matched|has not matched anything/);
    expect(body).not.toContain('DeKalb County 1');
    expect(body).toContain('Open your account to see what is there.');
    expect(body).not.toContain('The rest are in your account');
  });
  it('welcome ES: says 3 registros coinciden, never "todavía no hay registros nuevos"', async () => {
    setSwitches({ filter: '1' });
    const m = (await mailFor(onlyHeld(), 'welcome', 'es'))!;
    const body = m.html + m.text;
    expect(body).toMatch(/3 registros que coinciden/);
    expect(body).not.toMatch(/todavía no hay registros nuevos|todavía no encontró nada/);
    expect(body).toContain('Abra su cuenta para ver qué hay.');
  });
  it('trial_ending EN and ES: says the records exist and are feed only; never "has not matched anything"', async () => {
    setSwitches({ filter: '1' });
    const en = (await mailFor(onlyHeld(), 'trial_ending', 'en'))!;
    const es = (await mailFor(onlyHeld(), 'trial_ending', 'es'))!;
    expect(en.variant).toBe('feed_only');
    expect(es.variant).toBe('feed_only');
    expect(en.html + en.text).toContain('Your account has 3 public records that match your trades and area. They are feed only, not alerts, so none is listed here.');
    expect(en.html + en.text).not.toContain('has not matched anything');
    expect(es.html + es.text).toContain('Su cuenta tiene 3 registros públicos que coinciden con sus oficios y su zona. Son solo para su lista, no alertas, así que ninguno aparece aquí.');
    expect(es.html + es.text).not.toContain('todavía no encontró nada');
  });
  it('one feed-only record: singular wording, EN and ES', async () => {
    setSwitches({ filter: '1' });
    const db = new FakeDb({ holler_matches: [match(1, permit(1), { alert_hold: 'background' })] });
    const en = (await mailFor(db, 'trial_ending', 'en'))!;
    const es = (await mailFor(db, 'trial_ending', 'es'))!;
    expect(en.html + en.text).toContain('Your account has 1 public record that matches your trades and area. It is feed only, not an alert, so it is not listed here.');
    expect(es.html + es.text).toContain('Su cuenta tiene 1 registro público que coincide con sus oficios y su zona. Es solo para su lista, no una alerta, así que no aparece aquí.');
  });
  it('switch off: the same member gets what main sent (all three listed, no new wording)', async () => {
    setSwitches({});
    const m = (await mailFor(onlyHeld(), 'welcome', 'en'))!;
    expect(m.html + m.text).toContain('DeKalb County 1');
    const t = (await mailFor(onlyHeld(), 'trial_ending', 'en'))!;
    expect(t.html + t.text).not.toContain('feed only');
  });
  it('a mix: the listed alert is named, the feed-only ones are counted but not named', async () => {
    setSwitches({ filter: '1' });
    const db = new FakeDb({ holler_matches: [match(1, permit(1)), match(2, permit(2), { alert_hold: 'background' }), match(3, permit(3), { alert_hold: 'held' })] });
    const m = (await mailFor(db, 'welcome', 'en'))!;
    const body = m.html + m.text;
    expect(body).toContain('3 records already match');
    expect(body).toContain('DeKalb County 1');
    expect(body).not.toContain('DeKalb County 2');
    expect(body).toContain('The rest are in your account');
  });
});

describe('P2-1: the hold the feed still shows decides, and a saved or finished match is never left out', () => {
  const noContact = 'New Construction | Single Family Dwelling | Issued';
  const withAddress = 'Residential Alteration | 5600 LA SALLE SW, ATLANTA, GA 30331';
  it('a permit held "no contact" that now carries a street address is listed; one without stays feed only', async () => {
    setSwitches({ filter: '1' });
    const db = new FakeDb({ holler_matches: [match(1, permit(1, { summary: withAddress }), { alert_hold: 'background' }), match(2, permit(2, { summary: noContact }), { alert_hold: 'background' })] });
    const r = await createStore(db as never).matchesOf(U, ['general-contractor']);
    expect(ids(r)).toEqual([1]);
    expect(r.feedOnly).toBe(1);
    expect(r.total).toBe(2);
  });
  it('a saved or done match with a hold stays listed; a new one with the same hold does not', async () => {
    setSwitches({ filter: '1' });
    const db = new FakeDb({ holler_matches: [match(1, permit(1), { alert_hold: 'background', status: 'saved' }), match(2, permit(2), { alert_hold: 'background', status: 'done' }), match(3, permit(3), { alert_hold: 'background' })] });
    const r = await createStore(db as never).matchesOf(U, ['general-contractor']);
    expect(ids(r)).toEqual([1, 2]);
    expect(r.feedOnly).toBe(1);
  });
  it('a below-minimum permit is listed once the member has cleared the minimum, and stays feed only while one is set above its value', async () => {
    setSwitches({ filter: '1' });
    const rows = [match(1, permit(1, { summary: 'New Construction | $4,000 job value' }), { alert_hold: 'below_min' })];
    const withMin = (min: number | null) => {
      const db = new FakeDb({ holler_matches: rows.map((r) => ({ ...r })) });
      const real = db.from.bind(db);
      return { auth: {}, from: (t: string) => (t === 'holler_work_profiles' ? ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { work_property: 'any', work_type: 'any', work_min_value: min }, error: null }) }) }) }) : real(t)) };
    };
    const kept = await createStore(withMin(null) as never).matchesOf(U, ['general-contractor']);
    expect(ids(kept)).toEqual([1]);
    const held = await createStore(withMin(10000) as never).matchesOf(U, ['general-contractor']);
    expect(ids(held)).toEqual([]);
    expect(held.feedOnly).toBe(1);
  });
  it('the hold is read with the same function the feed uses (shownHold)', () => {
    const src = readFileSync(join(__dirname, '../../lib/lifecycle/store.ts'), 'utf8');
    expect(src).toMatch(/shownHold\(holdOf\(r\)/);
  });
  it('the alert_hold retry is announced in the log, never silent', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '1' });
    const db = world();
    let failed = false;
    const wrapped = { auth: {}, from: (t: string) => { const b = db.from(t) as any; const s = b.select.bind(b); b.select = (c?: string, o?: any) => { if (t === 'holler_matches' && !failed && (c ?? '').includes('alert_hold')) { failed = true; db.failOn['holler_matches.select'] = 'column holler_matches.alert_hold does not exist'; db.failCode['holler_matches.select'] = '42703'; } else delete db.failOn['holler_matches.select']; return s(c, o); }; return b; } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await createStore(wrapped as never).matchesOf(U, TRADES);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('alert_hold column missing'));
    warn.mockRestore();
  });
});

describe('P2-2: the trial-ended count leaves out retired and closed bids (filter on only)', () => {
  const profile2 = { categories: ['tree-service'] as string[] | null, lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25, plan: null, subscription_status: 'trialing', extra_areas: null, keywords: null };
  const rows = () => [
    { id: 1, source: 'bids-manual', kind: 'contract', title: 'Open bid in Atlanta: Live tree work', summary: null, state: 'GA', lat: 33.75, lon: -84.39, categories: ['tree-service'], severity: 2, occurred_at: '2026-11-26T00:00:00Z', subtype: 'bid', expires_at: FUTURE, dueDate: null, retiredAt: null },
    { id: 2, source: 'bids-manual', kind: 'contract', title: 'Open bid in Atlanta: Retired tree work', summary: null, state: 'GA', lat: 33.75, lon: -84.39, categories: ['tree-service'], severity: 2, occurred_at: '2026-11-26T00:00:00Z', subtype: 'bid', expires_at: FUTURE, dueDate: null, retiredAt: PAST },
    { id: 3, source: 'bids-sf', kind: 'contract', title: 'Open bid in Atlanta: Closed tree work', summary: null, state: 'GA', lat: 33.75, lon: -84.39, categories: ['tree-service'], severity: 2, occurred_at: '2026-11-26T00:00:00Z', subtype: 'bid', expires_at: PAST, dueDate: null, retiredAt: null },
  ];
  function stub(a: Record<string, unknown>[]) {
    const selects: string[] = [];
    const db = { from: () => { const q: string[] = []; const chain: Record<string, unknown> = {}; for (const m of ['select', 'neq', 'overlaps', 'gte', 'lte', 'order', 'limit', 'not', 'is', 'or', 'in']) chain[m] = (...args: unknown[]) => (q.push(`${m}:${args.map(String).join(',')}`), chain); chain.then = (res: (v: unknown) => unknown) => { selects.push(...q.filter((x) => x.startsWith('select:'))); return Promise.resolve(res({ data: q.some((f) => f.startsWith('is:lat')) || q.some((f) => f.startsWith('in:source,')) ? [] : a, error: null })); }; return chain; } };
    return { db: db as never, selects };
  }
  it('switch off counts all three (as main); switch on counts the live one only', async () => {
    setSwitches({ bids: '1', erate: '1' });
    const off = await missedSince(stub(rows()).db, profile2 as never, new Date('2026-11-25T00:00:00Z'), NOW);
    setSwitches({ filter: '1', bids: '1', erate: '1' });
    const on = await missedSince(stub(rows()).db, profile2 as never, new Date('2026-11-25T00:00:00Z'), NOW);
    expect(on.count).toBe(1);
    expect(off.count).toBe(3);
  });
  it('the select gains the three columns only while the switch is on', async () => {
    setSwitches({});
    const off = stub([]);
    await missedSince(off.db, profile2 as never, new Date('2026-11-25T00:00:00Z'), NOW);
    setSwitches({ filter: '1' });
    const on = stub([]);
    await missedSince(on.db, profile2 as never, new Date('2026-11-25T00:00:00Z'), NOW);
    const sel = (f: { selects: string[] }) => f.selects.filter((x) => x.startsWith('select:'));
    expect(sel(off).length).toBeGreaterThan(0);
    expect(sel(off).some((c) => c.includes('retiredAt'))).toBe(false);
    expect(sel(on).every((c) => c.includes('retiredAt:data->>retiredAt') && c.includes('expires_at'))).toBe(true);
  });
});

describe('the lifecycle run counts what it left out (a dry run shows what would be)', () => {
  it('followup_dropped sums every email of the run, per reason', async () => {
    setSwitches({ filter: '1', bids: '' });
    const s = (await runWelcome('en')) as any;
    expect(s.followup_dropped).toEqual({ retired: 1, bid_hidden: 3, held: 2 });
  });
  it('a dry run reports the same count and sends nothing', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '' });
    const send = vi.fn(async () => ({ ok: true as const }));
    const s = (await runWelcome('es', true, send)) as any;
    expect(send).not.toHaveBeenCalled();
    expect(s.followup_dropped).toEqual({ retired: 1, bid_hidden: 2, held: 2 });
  });
});

function profile(over: Partial<FullProfile> = {}): FullProfile {
  return {
    user_id: U, business_name: 'Acme Trees', created_at: new Date(NOW_MS - 30 * 3_600_000).toISOString(), email_verified_at: new Date(NOW_MS - 29 * 3_600_000).toISOString(),
    subscription_status: 'trialing', trial_ends_at: new Date(NOW_MS + 6 * 86_400_000).toISOString(), stripe_subscription_id: null, categories: ['tree-service'], lat: 33.7, lon: -84.4, state: 'GA', radius_mi: 25, ...over,
  };
}
async function runWelcome(lang: 'en' | 'es', dry = false, send: (i: any) => Promise<any> = async () => ({ ok: true })) {
  const real = createStore(world() as never);
  const store = {
    ...real,
    loadProfiles: async () => [profile()],
    loadSends: async () => [],
    claim: async () => 'claimed' as const,
    release: async () => undefined,
    isOptedOut: async () => false,
    emailOf: async () => 'u@example.test',
  };
  return runLifecycle({ store, send, siteUrl: 'https://localholler.com', secret: 'test-secret', now: NOW, dry, langFor: async () => lang });
}

describe('followupDrop (the pure rule)', () => {
  const base = { bidsOn: true, erateOn: true, nowMs: NOW_MS };
  it('order: retired, then bid_hidden; a plain record is never dropped', () => {
    expect(followupDrop({ source: 'bids-manual', subtype: 'bid', retiredAt: PAST, expires_at: PAST }, base)).toBe('retired');
    expect(followupDrop({ source: 'bids-sf', subtype: 'bid', expires_at: PAST }, base)).toBe('bid_hidden');
    expect(followupDrop({ source: 'nws', subtype: null }, base)).toBeNull();
    expect(followupDrop(null, base)).toBeNull();
    expect(followupDrop({ source: 'nws', retiredAt: '   ' }, base)).toBeNull();
  });
  it('a federal bid past its response date is dropped for a list, kept for the outcome follow-up (keepClosed)', () => {
    const s = { source: 'sam-gov', subtype: null, expires_at: PAST };
    expect(followupDrop(s, base)).toBe('bid_hidden');
    expect(followupDrop(s, { ...base, keepClosed: true })).toBeNull();
    expect(followupDrop({ source: 'bids-sf', subtype: 'bid', expires_at: PAST }, { ...base, keepClosed: true })).toBeNull();
    expect(followupDrop({ source: 'bids-sf', subtype: 'bid', expires_at: PAST }, { ...base, keepClosed: true, bidsOn: false })).toBe('bid_hidden');
    expect(followupDrop({ source: 'bids-erate', subtype: 'bid', expires_at: FUTURE }, { ...base, keepClosed: true, erateOn: false })).toBe('bid_hidden');
    expect(followupDrop({ source: 'bids-manual', subtype: 'bid', retiredAt: PAST }, { ...base, keepClosed: true })).toBe('retired');
  });
  it('agrees with the feed: bidHidden is the test for bids', async () => {
    const { bidHidden } = await import('@/lib/signals/bid-sources');
    for (const s of [{ source: 'bids-sf', subtype: 'bid', expires_at: PAST }, { source: 'bids-sf', subtype: 'bid', expires_at: FUTURE }, { source: 'bids-erate', subtype: 'bid', expires_at: FUTURE }, { source: 'sam-gov', expires_at: PAST }, { source: 'nws' }])
      for (const bidsOn of [true, false])
        for (const erateOn of [true, false]) expect(followupDrop(s, { bidsOn, erateOn, nowMs: NOW_MS }) === 'bid_hidden').toBe(bidHidden(s, bidsOn, NOW_MS, erateOn));
  });
});

function moatWorld() {
  const day = 86_400_000;
  const ago = (n: number) => new Date(NOW_MS - n * day).toISOString();
  const feedback = [1, 2, 3, 4].map((i) => ({ user_id: 'u1', signal_id: i, verdict: 'useful', updated_at: ago(10 + i * 0.01) }));
  const signals = [
    { id: 1, source: 'nws', kind: 'alert', title: 'Storm one', city: 'Marietta', state: 'GA', occurred_at: ago(12), subtype: null },
    // A switched-off city bid, an E-Rate row (E-Rate empty), and a retired hand-added bid.
    { id: 2, source: 'bids-sf', kind: 'contract', title: 'Open bid in San Francisco: Zebra tree work', city: 'San Francisco', state: 'CA', occurred_at: ago(12), subtype: 'bid', expires_at: PAST, dueDate: null, retiredAt: null },
    { id: 3, source: 'bids-erate', kind: 'contract', title: 'A school in Astoria is asking for bids on network cabling', city: 'Astoria', state: 'NY', occurred_at: ago(12), subtype: 'bid', expires_at: FUTURE, dueDate: null, retiredAt: null },
    { id: 4, source: 'bids-manual', kind: 'contract', title: 'Open bid in Atlanta: Retired tree work', city: 'Atlanta', state: 'GA', occurred_at: ago(12), subtype: 'bid', expires_at: PAST, dueDate: null, retiredAt: PAST },
  ];
  const db = makeDb(
    {
      holler_signal_feedback: feedback, holler_signals: signals, holler_outcome_asks: [],
      holler_profiles: [{ user_id: 'u1', business_name: 'Acme Roofing', alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: ago(0.001), email_verified_at: ago(30), created_at: ago(40), language: 'en' }],
    },
    { users: { u1: 'u1@example.test' } },
  );
  const selects: string[] = [];
  const from = db.from.bind(db);
  db.from = (t: string) => {
    const q = from(t);
    if (t === 'holler_signals') {
      const s = q.select;
      q.select = (c: string) => (selects.push(c), s(c));
    }
    return q;
  };
  return { db, selects };
}

describe('the outcome follow-up (moat)', () => {
  const send = () => vi.fn(async () => ({ ok: true as const }));
  it('switch on, bids off: the switched-off bid, the E-Rate row and the retired bid are not asked about; the plain alert is', async () => {
    setSwitches({ filter: '1', bids: '' });
    const { db, selects } = moatWorld();
    const s = send();
    const c = await runMoat({ db, now: NOW, dry: false, siteUrl: 'https://x.test', secret: 'sec', send: s as never });
    expect(c.candidates).toBe(1);
    expect(c.emailed_alerts).toBe(1);
    expect(c.followup_dropped).toEqual({ bid_hidden: 2, retired: 1 });
    expect(db.tables.holler_outcome_asks.map((a: any) => a.signal_id)).toEqual([1]);
    const mailBody = JSON.stringify((s.mock.calls[0] as any[])[0]);
    expect(mailBody).toContain('Storm one');
    for (const n of ['Zebra', 'Astoria', 'Retired tree work']) expect(mailBody).not.toContain(n);
    expect(selects[0]).toContain(FOLLOWUP_SIGNAL_SELECT);
  });
  it('bids on, E-Rate empty: a bid that simply closed is still asked about; the E-Rate row and the retired bid are not', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '' });
    const { db } = moatWorld();
    const c = await runMoat({ db, now: NOW, dry: true, siteUrl: 'https://x.test', secret: 'sec', send: send() as never });
    expect(c.candidates).toBe(2);
    expect(c.followup_dropped).toEqual({ bid_hidden: 1, retired: 1 });
  });
  it('bids on, E-Rate on: only the retired bid is left out', async () => {
    setSwitches({ filter: '1', bids: '1', erate: '1' });
    const { db } = moatWorld();
    const c = await runMoat({ db, now: NOW, dry: true, siteUrl: 'https://x.test', secret: 'sec', send: send() as never });
    expect(c.candidates).toBe(3);
    expect(c.followup_dropped).toEqual({ bid_hidden: 0, retired: 1 });
  });
  it('a Spanish member gets the same list (and a Spanish email)', async () => {
    setSwitches({ filter: '1', bids: '' });
    const { db } = moatWorld();
    db.tables.holler_profiles[0].language = 'es';
    const s = send();
    await runMoat({ db, now: NOW, dry: false, siteUrl: 'https://x.test', secret: 'sec', send: s as never });
    const mailBody = JSON.stringify((s.mock.calls[0] as any[])[0]);
    expect(mailBody).toContain('Storm one');
    expect(mailBody).not.toContain('Zebra');
    expect(mailBody).toMatch(/l=es/);
  });
  it('P3: hidden bids are removed before the 600-candidate cut, so they never use up the places', async () => {
    setSwitches({ filter: '1', bids: '' });
    const day = 86_400_000;
    const ago = (n: number) => new Date(NOW_MS - n * day).toISOString();
    const hidden = Array.from({ length: 650 }, (_, i) => ({ id: 1000 + i, source: 'bids-sf', kind: 'contract', title: `Open bid ${i}`, city: 'SF', state: 'CA', occurred_at: ago(12), subtype: 'bid', expires_at: FUTURE, retiredAt: null }));
    const plain = [1, 2, 3].map((i) => ({ id: i, source: 'nws', kind: 'alert', title: `Storm ${i}`, city: 'Marietta', state: 'GA', occurred_at: ago(12), subtype: null }));
    const fb = [...hidden, ...plain].map((s, i) => ({ user_id: 'u1', signal_id: s.id, verdict: 'useful', updated_at: new Date(NOW_MS - 20 * day + i * 1000).toISOString() }));
    const db = makeDb(
      { holler_signal_feedback: fb, holler_signals: [...hidden, ...plain], holler_outcome_asks: [], holler_profiles: [{ user_id: 'u1', business_name: 'Acme', alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: ago(0.001), email_verified_at: ago(30), created_at: ago(40) }] },
      { users: { u1: 'u1@example.test' } },
    );
    const c = await runMoat({ db, now: NOW, dry: true, siteUrl: 'https://x.test', secret: 'sec', send: vi.fn() as never });
    expect(c.candidates).toBe(3);
    expect(c.followup_dropped).toEqual({ bid_hidden: 650, retired: 0 });
  });
});
